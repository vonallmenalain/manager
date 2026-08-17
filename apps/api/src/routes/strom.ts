import { randomUUID } from 'node:crypto'

import {
  analyse,
  API_ERROR_CODES,
  billInputSchema,
  billPositionSchema,
  BILL_KIND_LABELS,
  COST_GROUP_LABELS,
  formatAmount,
  formatPeriod,
  formatRappen,
  meterReadingSchema,
  TARIFF_LABELS,
  type BillInput,
  type BillPosition,
  type ElectricityBill,
  type ImportResult,
  type MeterReading,
} from '@manager/shared'
import { asc, eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { db } from '../db/index.js'
import { electricityBills, type ElectricityBillRow } from '../db/schema.js'
import { apiError, notFound, unauthorized, validationError } from '../lib/errors.js'
import { extractPdfLines, PdfTextError } from '../lib/pdf-text.js'
import { parseElectricityInvoice } from '../lib/strom-parser.js'

/**
 * Eine Rechnung ist ein paar Dutzend Zahlen auf zwei Seiten – mehr als ein
 * halbes Megabyte hat noch keine gebraucht. Die Grenze schützt davor, dass
 * jemand versehentlich ein Fotoalbum durch den Parser schickt.
 */
const MAX_PDF_BYTES = 8 * 1024 * 1024

const idParamSchema = z.object({ id: z.string().min(1) })

// ------------------------------------------------------------ Zeile ↔ Objekt

/**
 * Ablesungen und Positionen liegen als JSON in einer Spalte. Beim Lesen laufen
 * sie durch dasselbe Schema wie beim Schreiben: Eine von Hand reparierte
 * Datenbankzeile soll die Auswertung nicht mit `undefined` überraschen.
 */
function parseJsonColumn<T>(raw: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      const result = schema.safeParse(entry)
      return result.success ? [result.data] : []
    })
  } catch {
    return []
  }
}

function toBill(row: ElectricityBillRow): ElectricityBill {
  return {
    id: row.id,
    kind: row.kind === 'akonto' ? 'akonto' : 'abrechnung',
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    customerNumber: row.customerNumber,
    meterPoint: row.meterPoint,
    meterNumber: row.meterNumber,
    readings: parseJsonColumn<MeterReading>(row.readings, meterReadingSchema),
    positions: parseJsonColumn<BillPosition>(row.positions, billPositionSchema),
    energyCents: row.energyCents,
    gridCents: row.gridCents,
    leviesCents: row.leviesCents,
    subtotalCents: row.subtotalCents,
    prepaidCents: row.prepaidCents,
    totalCents: row.totalCents,
    vatCents: row.vatCents,
    sourceFile: row.sourceFile,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toColumns(input: BillInput) {
  return {
    kind: input.kind,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    customerNumber: input.customerNumber,
    meterPoint: input.meterPoint,
    meterNumber: input.meterNumber,
    readings: JSON.stringify(input.readings),
    positions: JSON.stringify(input.positions),
    energyCents: input.energyCents,
    gridCents: input.gridCents,
    leviesCents: input.leviesCents,
    subtotalCents: input.subtotalCents,
    prepaidCents: input.prepaidCents,
    totalCents: input.totalCents,
    vatCents: input.vatCents,
    sourceFile: input.sourceFile,
    note: input.note,
  }
}

async function loadBills(): Promise<ElectricityBill[]> {
  const rows = await db
    .select()
    .from(electricityBills)
    .orderBy(asc(electricityBills.periodStart), asc(electricityBills.invoiceNumber))
  return rows.map(toBill)
}

/** Liest den Datenstrom einer hochgeladenen Datei in den Speicher. */
async function readUpload(
  stream: AsyncIterable<Buffer>,
  limit: number,
): Promise<Buffer | 'zu-gross'> {
  const parts: Buffer[] = []
  let size = 0

  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) return 'zu-gross'
    parts.push(chunk)
  }

  return Buffer.concat(parts)
}

// ------------------------------------------------------------------- Routen

const stromRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/strom', async (_request, reply) => {
    return reply.send({ bills: await loadBills() })
  })

  /**
   * Ein PDF auslesen – ohne etwas zu speichern.
   *
   * Der Import ist bewusst zweistufig: Hier entsteht nur ein Vorschlag, den
   * der Mensch davor bestätigt oder korrigiert. Ein Automat, der stillschweigend
   * Datensätze anlegt, wäre beim ersten unbekannten Rechnungsaufbau nicht mehr
   * einzufangen – und niemand merkte es, weil die Zahlen ja „da" wären.
   */
  fastify.post('/api/strom/import', async (request, reply) => {
    const upload = await request.file({ limits: { fileSize: MAX_PDF_BYTES } })
    if (!upload) {
      return reply
        .status(400)
        .send(apiError(API_ERROR_CODES.validationFailed, 'Keine Datei empfangen.'))
    }

    if (upload.mimetype !== 'application/pdf') {
      upload.file.resume()
      return reply
        .status(415)
        .send(apiError('unsupported_type', 'Nur PDF-Rechnungen lassen sich auslesen.'))
    }

    const data = await readUpload(upload.file, MAX_PDF_BYTES)
    if (data === 'zu-gross' || upload.file.truncated) {
      return reply
        .status(413)
        .send(
          apiError(
            'file_too_large',
            `Die Datei ist grösser als ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB.`,
          ),
        )
    }

    let result: ImportResult
    try {
      const lines = extractPdfLines(data)
      const parsed = parseElectricityInvoice(lines, upload.filename ?? null)
      result = { ...parsed, bereitsVorhanden: false }
    } catch (error) {
      if (error instanceof PdfTextError) {
        return reply.status(422).send(apiError('unreadable_pdf', error.message))
      }
      request.log.error({ err: error }, 'Stromrechnung konnte nicht gelesen werden')
      return reply
        .status(422)
        .send(apiError('unreadable_pdf', 'Dieses PDF liess sich nicht auslesen.'))
    }

    // Ob es die Rechnung schon gibt, entscheidet der Server – der Browser
    // kennt nur, was er gerade geladen hat, und das kann veraltet sein.
    if (result.bill) {
      const vorhanden = await db
        .select({ id: electricityBills.id })
        .from(electricityBills)
        .where(eq(electricityBills.invoiceNumber, result.bill.invoiceNumber))
        .limit(1)

      result.bereitsVorhanden = vorhanden.length > 0
    }

    return reply.send(result)
  })

  /**
   * Eine Rechnung übernehmen – aus der Vorschau oder von Hand erfasst.
   *
   * Beide Wege enden hier, weil beide dasselbe Ergebnis haben sollen. Wer die
   * Zahlen aus einer alten Tabelle nachträgt, soll dieselbe Auswertung bekommen
   * wie jemand, der ein PDF hochlädt.
   */
  fastify.post('/api/strom/rechnungen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = billInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const vorhanden = await db
      .select({ id: electricityBills.id })
      .from(electricityBills)
      .where(eq(electricityBills.invoiceNumber, parsed.data.invoiceNumber))
      .limit(1)

    if (vorhanden.length > 0) {
      return reply
        .status(409)
        .send(
          apiError(
            'duplicate',
            `Die Rechnung Nr. ${parsed.data.invoiceNumber} ist bereits erfasst.`,
            { invoiceNumber: 'Diese Rechnungsnummer gibt es schon' },
          ),
        )
    }

    const id = randomUUID()
    await db.insert(electricityBills).values({ id, ...toColumns(parsed.data), createdBy: user.id })

    return reply.status(201).send({ bills: await loadBills() })
  })

  /** Nachbessern, was der Automat falsch gelesen hat. */
  fastify.put('/api/strom/rechnungen/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = billInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    // Die Rechnungsnummer darf sich ändern – aber nicht auf eine, die schon
    // einer anderen Zeile gehört.
    const gleicheNummer = await db
      .select({ id: electricityBills.id })
      .from(electricityBills)
      .where(eq(electricityBills.invoiceNumber, parsed.data.invoiceNumber))
      .limit(1)

    if (gleicheNummer[0] && gleicheNummer[0].id !== params.data.id) {
      return reply
        .status(409)
        .send(
          apiError('duplicate', `Die Rechnung Nr. ${parsed.data.invoiceNumber} ist bereits erfasst.`, {
            invoiceNumber: 'Diese Rechnungsnummer gibt es schon',
          }),
        )
    }

    const geaendert = await db
      .update(electricityBills)
      .set({ ...toColumns(parsed.data), updatedAt: new Date().toISOString() })
      .where(eq(electricityBills.id, params.data.id))
      .returning({ id: electricityBills.id })

    if (geaendert.length === 0) return reply.status(404).send(notFound('Rechnung nicht gefunden.'))

    return reply.send({ bills: await loadBills() })
  })

  fastify.delete('/api/strom/rechnungen/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const geloescht = await db
      .delete(electricityBills)
      .where(eq(electricityBills.id, params.data.id))
      .returning({ id: electricityBills.id })

    if (geloescht.length === 0) return reply.status(404).send(notFound('Rechnung nicht gefunden.'))

    return reply.send({ bills: await loadBills() })
  })

  /**
   * Alles als CSV – Semikolon und BOM wie bei den Finanzen, damit Excel die
   * Datei ohne Import-Dialog und mit richtigen Umlauten öffnet.
   *
   * Zwei Tabellen in einer Datei: oben je Rechnung eine Zeile mit den
   * Kennzahlen, unten die einzelnen Positionen. Wer weiterrechnen will, hat
   * damit dieselbe Grundlage wie die App.
   */
  fastify.get('/api/strom/export.csv', async (_request, reply) => {
    const { abrechnungen, akonto } = analyse(await loadBills())

    const rows: string[][] = [
      [
        'Art',
        'Rechnung Nr.',
        'Rechnungsdatum',
        'Periode von',
        'Periode bis',
        'Tage',
        'Hochtarif kWh',
        'Niedertarif kWh',
        'Verbrauch kWh',
        'Energie CHF',
        'Netznutzung CHF',
        'Abgaben CHF',
        'Kosten Periode CHF',
        'Ø Preis Rp./kWh',
        'Akontoabzug CHF',
        'Rechnungsbetrag CHF',
        'MWST CHF',
      ],
      ...[...abrechnungen, ...akonto]
        .sort((left, right) => left.bill.periodStart.localeCompare(right.bill.periodStart))
        .map((entry) => [
          BILL_KIND_LABELS[entry.bill.kind],
          entry.bill.invoiceNumber,
          entry.bill.invoiceDate,
          entry.bill.periodStart,
          entry.bill.periodEnd,
          String(entry.days),
          entry.highKwh === null ? '' : String(entry.highKwh),
          entry.lowKwh === null ? '' : String(entry.lowKwh),
          entry.totalKwh === null ? '' : String(entry.totalKwh),
          formatAmount(entry.energyCents),
          formatAmount(entry.gridCents),
          formatAmount(entry.leviesCents),
          formatAmount(entry.periodCostCents),
          entry.pricePerKwhHundredths === null
            ? ''
            : formatRappen(entry.pricePerKwhHundredths),
          formatAmount(entry.bill.prepaidCents),
          formatAmount(entry.bill.totalCents),
          formatAmount(entry.bill.vatCents),
        ]),
      [],
      ['Positionen', 'Rechnung Nr.', 'Periode', 'Gruppe', 'Bezeichnung'],
      [
        '',
        '',
        '',
        '',
        '',
        'Menge',
        'Einheit',
        'Ansatz',
        'Einheit',
        'Dauer Mt.',
        'MWST %',
        'Betrag exkl. CHF',
        'Betrag inkl. CHF',
      ],
      ...abrechnungen.flatMap((entry) =>
        entry.bill.positions.map((position) => [
          '',
          entry.bill.invoiceNumber,
          formatPeriod(entry.bill.periodStart, entry.bill.periodEnd),
          COST_GROUP_LABELS[position.group],
          position.label,
          String(position.quantity),
          position.unit,
          position.rateHundredths === null ? '' : formatRappen(position.rateHundredths),
          position.rateUnit ?? '',
          position.durationMonths === null ? '' : String(position.durationMonths),
          (position.vatBasisPoints / 100).toFixed(2),
          formatAmount(position.netCents),
          formatAmount(position.grossCents),
        ]),
      ),
      [],
      ['Zählerstände', 'Rechnung Nr.', 'Tarif', 'Stand alt', 'Stand neu', 'Menge kWh'],
      ...abrechnungen.flatMap((entry) =>
        entry.bill.readings.map((reading) => [
          '',
          entry.bill.invoiceNumber,
          TARIFF_LABELS[reading.tariff],
          reading.startValue === null ? '' : String(reading.startValue),
          reading.endValue === null ? '' : String(reading.endValue),
          String(reading.kwh),
        ]),
      ),
    ]

    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="stromverbrauch.csv"')
      .send(`﻿${csv}`)
  })
}

export default stromRoutes

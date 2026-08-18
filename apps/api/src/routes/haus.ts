import { randomUUID } from 'node:crypto'

import {
  analyse,
  API_ERROR_CODES,
  billInputSchema,
  billSubject,
  BILL_KIND_LABELS,
  COST_GROUP_LABELS,
  DEFAULT_BEREICH,
  DIVISION_LABELS,
  formatAmount,
  formatPeriod,
  formatPricePerUnit,
  formatRappen,
  priceUnitLabel,
  TARIFF_LABELS,
  type BillInput,
  type ImportResult,
  type UtilityBill,
} from '@manager/shared'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { db } from '../db/index.js'
import { documents, utilityBills, type UtilityBillRow } from '../db/schema.js'
import { intakeDocument } from '../lib/document-intake.js'
import { apiError, notFound, unauthorized, validationError } from '../lib/errors.js'
import { extractPdfLines, PdfTextError } from '../lib/pdf-text.js'
import { parseUtilityInvoice } from '../lib/haus-parser.js'
import { discardUpload, storeTemporarily } from '../lib/storage.js'

/**
 * Eine Rechnung ist ein paar Dutzend Zahlen auf zwei Seiten – mehr als ein
 * halbes Megabyte hat noch keine gebraucht. Die Grenze schützt davor, dass
 * jemand versehentlich ein Fotoalbum durch den Parser schickt.
 */
const MAX_PDF_BYTES = 8 * 1024 * 1024

const idParamSchema = z.object({ id: z.string().min(1) })

// ------------------------------------------------------------ Zeile ↔ Objekt

/**
 * Die Sparten liegen als JSON in einer Spalte. Beim Lesen laufen sie durch
 * dasselbe Schema wie beim Schreiben: Eine von Hand reparierte Datenbankzeile
 * soll die Auswertung nicht mit `undefined` überraschen.
 */
function parseSections(raw: string): UtilityBill['sections'] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const schema = billInputSchema.innerType().shape.sections.element
    return parsed.flatMap((entry) => {
      const result = schema.safeParse(entry)
      return result.success ? [result.data] : []
    })
  } catch {
    return []
  }
}

function toBill(row: UtilityBillRow): UtilityBill {
  return {
    id: row.id,
    kind: row.kind === 'akonto' ? 'akonto' : 'abrechnung',
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    customerNumber: row.customerNumber,
    sections: parseSections(row.sections),
    subtotalCents: row.subtotalCents,
    prepaidCents: row.prepaidCents,
    totalCents: row.totalCents,
    vatCents: row.vatCents,
    documentId: row.documentId,
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
    sections: JSON.stringify(input.sections),
    subtotalCents: input.subtotalCents,
    prepaidCents: input.prepaidCents,
    totalCents: input.totalCents,
    vatCents: input.vatCents,
    documentId: input.documentId,
    sourceFile: input.sourceFile,
    note: input.note,
  }
}

async function loadBills(): Promise<UtilityBill[]> {
  const rows = await db
    .select()
    .from(utilityBills)
    .orderBy(asc(utilityBills.periodStart), asc(utilityBills.invoiceNumber))
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

/** „Abrechnung Strom Nr. 231125" – wie die Rechnung in der Ablage heisst. */
function documentTitle(bill: BillInput): string {
  return `${BILL_KIND_LABELS[bill.kind]} ${billSubject(bill)} Nr. ${bill.invoiceNumber}`
}

// ------------------------------------------------------------------- Routen

const hausRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/haus', async (_request, reply) => {
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
  fastify.post('/api/haus/import', async (request, reply) => {
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
      const parsed = parseUtilityInvoice(lines, upload.filename ?? null)
      result = { ...parsed, bereitsVorhanden: false }
    } catch (error) {
      if (error instanceof PdfTextError) {
        return reply.status(422).send(apiError('unreadable_pdf', error.message))
      }
      request.log.error({ err: error }, 'Rechnung konnte nicht gelesen werden')
      return reply
        .status(422)
        .send(apiError('unreadable_pdf', 'Dieses PDF liess sich nicht auslesen.'))
    }

    // Ob es die Rechnung schon gibt, entscheidet der Server – der Browser
    // kennt nur, was er gerade geladen hat, und das kann veraltet sein.
    if (result.bill) {
      const vorhanden = await db
        .select({ id: utilityBills.id })
        .from(utilityBills)
        .where(eq(utilityBills.invoiceNumber, result.bill.invoiceNumber))
        .limit(1)

      result.bereitsVorhanden = vorhanden.length > 0
    }

    return reply.send(result)
  })

  /**
   * Eine Rechnung übernehmen – aus der Vorschau oder von Hand erfasst.
   *
   * Kommt das PDF mit, wandert es im selben Durchgang in die Dokumente. Zwei
   * getrennte Aufrufe wären eine Gelegenheit für halbe Zustände: eine Rechnung
   * ohne Beleg, oder – schlimmer – ein Beleg in der Ablage zu einer Rechnung,
   * die nie gespeichert wurde.
   *
   * Deshalb nimmt diese Route beides entgegen: als JSON, wenn von Hand erfasst
   * wird, und als Formular mit Datei, wenn ein PDF dahintersteht.
   */
  fastify.post('/api/haus/rechnungen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    let rohdaten: unknown = request.body
    let datei: {
      /** Wird vorab vergeben, weil die Kennung im Dateipfad steckt. */
      documentId: string
      stored: Awaited<ReturnType<typeof storeTemporarily>>
      mimetype: string
      filename: string
    } | null = null
    let categoryId: string | null = null

    if (request.isMultipart()) {
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
          .send(apiError('unsupported_type', 'Nur PDF-Rechnungen lassen sich ablegen.'))
      }

      // Die Felder stehen im Formular vor der Datei und sind deshalb hier
      // bereits gelesen.
      const feld = upload.fields['bill']
      const rohtext =
        feld && !Array.isArray(feld) && feld.type === 'field' && typeof feld.value === 'string'
          ? feld.value
          : null
      if (!rohtext) {
        upload.file.resume()
        return reply
          .status(400)
          .send(apiError(API_ERROR_CODES.validationFailed, 'Die Rechnung fehlt im Formular.'))
      }

      try {
        rohdaten = JSON.parse(rohtext)
      } catch {
        upload.file.resume()
        return reply
          .status(400)
          .send(apiError(API_ERROR_CODES.validationFailed, 'Die Rechnung war unlesbar.'))
      }

      const kategorie = upload.fields['categoryId']
      if (kategorie && !Array.isArray(kategorie) && kategorie.type === 'field') {
        const wert = typeof kategorie.value === 'string' ? kategorie.value.trim() : ''
        categoryId = wert && wert.length <= 60 ? wert : null
      }

      const documentId = randomUUID()
      const stored = await storeTemporarily(DEFAULT_BEREICH, upload.file, documentId)

      if (upload.file.truncated) {
        await discardUpload(stored.tempPath)
        return reply
          .status(413)
          .send(
            apiError(
              'file_too_large',
              `Die Datei ist grösser als ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB.`,
            ),
          )
      }

      datei = {
        documentId,
        stored,
        mimetype: upload.mimetype,
        filename: upload.filename ?? 'rechnung.pdf',
      }
    }

    const parsed = billInputSchema.safeParse(rohdaten)
    if (!parsed.success) {
      if (datei) await discardUpload(datei.stored.tempPath)
      return reply.status(400).send(validationError(parsed.error))
    }

    const vorhanden = await db
      .select({ id: utilityBills.id })
      .from(utilityBills)
      .where(eq(utilityBills.invoiceNumber, parsed.data.invoiceNumber))
      .limit(1)

    if (vorhanden.length > 0) {
      if (datei) await discardUpload(datei.stored.tempPath)
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

    let documentId = parsed.data.documentId

    if (datei) {
      // Liegt dieselbe Datei schon in der Ablage, wird sie verknüpft statt ein
      // zweites Mal abgelegt: Wer eine Rechnung löscht und neu importiert,
      // soll keine Dublette im Archiv erzeugen.
      const gleiche = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.sha256, datei.stored.sha256),
            eq(documents.bereich, DEFAULT_BEREICH),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1)

      if (gleiche[0]) {
        await discardUpload(datei.stored.tempPath)
        documentId = gleiche[0].id
      } else {
        const titel = documentTitle(parsed.data)
        const row = await intakeDocument({
          bereich: DEFAULT_BEREICH,
          documentId: datei.documentId,
          stored: datei.stored,
          mimeType: datei.mimetype,
          filename: datei.filename,
          title: titel,
          // Das Datum auf dem Beleg, nicht das des Imports: In der Ablage
          // sortiert sich die Rechnung damit dorthin, wo sie hingehört.
          docDate: parsed.data.invoiceDate,
          categoryId,
          assignedTo: null,
          status: 'erledigt',
          userId: user.id,
          vendor: 'Energie- und Wasserversorgung Oberburg',
          amountCents: parsed.data.totalCents,
          activity: `„${titel}" über den Bereich Haus abgelegt`,
        })
        documentId = row.id
      }
    }

    const id = randomUUID()
    await db.insert(utilityBills).values({
      id,
      ...toColumns({ ...parsed.data, documentId }),
      createdBy: user.id,
    })

    return reply.status(201).send({ bills: await loadBills() })
  })

  /** Nachbessern, was der Automat falsch gelesen hat. */
  fastify.put('/api/haus/rechnungen/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = billInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    // Die Rechnungsnummer darf sich ändern – aber nicht auf eine, die schon
    // einer anderen Zeile gehört.
    const gleicheNummer = await db
      .select({ id: utilityBills.id })
      .from(utilityBills)
      .where(eq(utilityBills.invoiceNumber, parsed.data.invoiceNumber))
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
      .update(utilityBills)
      .set({ ...toColumns(parsed.data), updatedAt: new Date().toISOString() })
      .where(eq(utilityBills.id, params.data.id))
      .returning({ id: utilityBills.id })

    if (geaendert.length === 0) return reply.status(404).send(notFound('Rechnung nicht gefunden.'))

    return reply.send({ bills: await loadBills() })
  })

  /**
   * Eine Rechnung entfernen.
   *
   * Das abgelegte PDF bleibt, wo es ist: Es gehört in die Ablage und nicht in
   * die Auswertung. Wer den Beleg loswerden will, löscht ihn dort – mit
   * Papierkorb und Gnadenfrist, die es hier nicht gibt.
   */
  fastify.delete('/api/haus/rechnungen/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const geloescht = await db
      .delete(utilityBills)
      .where(eq(utilityBills.id, params.data.id))
      .returning({ id: utilityBills.id })

    if (geloescht.length === 0) return reply.status(404).send(notFound('Rechnung nicht gefunden.'))

    return reply.send({ bills: await loadBills() })
  })

  /**
   * Alles als CSV – Semikolon und BOM wie bei den Finanzen, damit Excel die
   * Datei ohne Import-Dialog und mit richtigen Umlauten öffnet.
   *
   * Drei Tabellen in einer Datei: je Sparte und Periode eine Zeile mit den
   * Kennzahlen, darunter die einzelnen Positionen und die Zählerstände. Wer
   * weiterrechnen will, hat damit dieselbe Grundlage wie die App.
   */
  fastify.get('/api/haus/export.csv', async (_request, reply) => {
    const { entries, akonto } = analyse(await loadBills())
    const alle = [...entries, ...akonto].sort((links, rechts) =>
      links.bill.periodStart.localeCompare(rechts.bill.periodStart),
    )

    const rows: string[][] = [
      [
        'Sparte',
        'Art',
        'Rechnung Nr.',
        'Rechnungsdatum',
        'Periode von',
        'Periode bis',
        'Tage',
        'Menge',
        'Einheit',
        'Kosten CHF',
        'Ø Preis',
        'Einheit Preis',
        'Energie CHF',
        'Netznutzung CHF',
        'Abgaben CHF',
      ],
      ...alle.map((entry) => [
        DIVISION_LABELS[entry.division],
        BILL_KIND_LABELS[entry.bill.kind],
        entry.bill.invoiceNumber,
        entry.bill.invoiceDate,
        entry.bill.periodStart,
        entry.bill.periodEnd,
        String(entry.days),
        entry.quantity === null ? '' : String(entry.quantity),
        entry.unit ?? '',
        formatAmount(entry.costCents),
        formatPricePerUnit(entry.pricePerUnitHundredths, entry.unit),
        priceUnitLabel(entry.unit).label,
        entry.energyCents === null ? '' : formatAmount(entry.energyCents),
        entry.gridCents === null ? '' : formatAmount(entry.gridCents),
        entry.leviesCents === null ? '' : formatAmount(entry.leviesCents),
      ]),
      [],
      ['Rechnungen', 'Nr.', 'Periode', 'Zwischentotal CHF', 'Akontoabzug CHF', 'Rechnungsbetrag CHF', 'MWST CHF'],
      ...[...new Map(alle.map((entry) => [entry.bill.id, entry.bill])).values()].map((bill) => [
        BILL_KIND_LABELS[bill.kind],
        bill.invoiceNumber,
        formatPeriod(bill.periodStart, bill.periodEnd),
        formatAmount(bill.subtotalCents),
        formatAmount(bill.prepaidCents),
        formatAmount(bill.totalCents),
        formatAmount(bill.vatCents),
      ]),
      [],
      [
        'Positionen',
        'Rechnung Nr.',
        'Sparte',
        'Block',
        'Bezeichnung',
        'Menge',
        'Einheit',
        'Ansatz',
        'Einheit',
        'Dauer Mt.',
        'MWST %',
        'Betrag exkl. CHF',
        'Betrag inkl. CHF',
      ],
      ...entries.flatMap((entry) =>
        entry.section.positions.map((position) => [
          '',
          entry.bill.invoiceNumber,
          DIVISION_LABELS[entry.division],
          position.group ? COST_GROUP_LABELS[position.group] : '',
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
      ['Zählerstände', 'Rechnung Nr.', 'Sparte', 'Tarif', 'Stand alt', 'Stand neu', 'Menge', 'Einheit'],
      ...entries.flatMap((entry) =>
        entry.section.readings.map((reading) => [
          '',
          entry.bill.invoiceNumber,
          DIVISION_LABELS[entry.division],
          TARIFF_LABELS[reading.tariff],
          reading.startValue === null ? '' : String(reading.startValue),
          reading.endValue === null ? '' : String(reading.endValue),
          String(reading.quantity),
          reading.unit,
        ]),
      ),
    ]

    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="haus-kosten.csv"')
      .send(`﻿${csv}`)
  })
}

export default hausRoutes

import { randomUUID } from 'node:crypto'

import {
  amortizationInputSchema,
  API_ERROR_CODES,
  buildQuarters,
  effectiveRate,
  EMPTY_MORTGAGE_SETTINGS,
  formatAmount,
  formatDate,
  formatRate,
  hypothekImportSchema,
  LOAN_KIND_LABELS,
  loanInputSchema,
  mortgageSettingsSchema,
  mortgageYears,
  saveQuarterSchema,
  summarizeAmortization,
  type AmortizationPayment,
  type HypothekDaten,
  type HypothekImportResult,
  type LoanInput,
  type MortgageLoan,
  type MortgageSettings,
  type Quarter,
} from '@manager/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { db } from '../db/index.js'
import {
  mortgageAmortizations,
  mortgageInterest,
  mortgageLoans,
  mortgageSettings,
  type MortgageAmortizationRow,
  type MortgageLoanRow,
  type MortgageSettingsRow,
} from '../db/schema.js'
import { apiError, notFound, unauthorized, validationError } from '../lib/errors.js'
import { parseHypothekExcel } from '../lib/hypothek-excel.js'
import { readUpload } from '../lib/read-upload.js'
import { readXlsx } from '../ocr/office.js'

/** Die eine Zeile der Grunddaten. */
const SETTINGS_ID = 'haus'

/** Eine Hypothekentabelle ist ein paar Dutzend Zellen – mehr braucht keine. */
const MAX_EXCEL_BYTES = 4 * 1024 * 1024

const XLSX_TYP = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const idParamSchema = z.object({ id: z.string().min(1).max(60) })

const quarterParamSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
})

// ------------------------------------------------------------ Zeile ↔ Objekt

function toSettings(row: MortgageSettingsRow | undefined): MortgageSettings {
  if (!row) return { ...EMPTY_MORTGAGE_SETTINGS }
  return {
    propertyValueCents: row.propertyValueCents,
    mortgageTotalCents: row.mortgageTotalCents,
    firstMortgageCents: row.firstMortgageCents,
    amortizationPerYearCents: row.amortizationPerYearCents,
    carriedOverCents: row.carriedOverCents,
    carriedOverDate: row.carriedOverDate,
    referenceRateMillipercent: row.referenceRateMillipercent,
  }
}

function toLoan(row: MortgageLoanRow): MortgageLoan {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'saron' ? 'saron' : 'fest',
    amountCents: row.amountCents,
    rateMillipercent: row.rateMillipercent,
    startDate: row.startDate,
    endDate: row.endDate,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toAmortization(row: MortgageAmortizationRow): AmortizationPayment {
  return {
    id: row.id,
    year: row.year,
    paidOn: row.paidOn,
    amountCents: row.amountCents,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

function loanColumns(input: LoanInput) {
  return {
    name: input.name,
    kind: input.kind,
    amountCents: input.amountCents,
    rateMillipercent: input.rateMillipercent,
    startDate: input.startDate,
    endDate: input.endDate,
    note: input.note,
  }
}

async function loadDaten(): Promise<HypothekDaten> {
  const [settings] = await db
    .select()
    .from(mortgageSettings)
    .where(eq(mortgageSettings.id, SETTINGS_ID))
    .limit(1)
  const loans = await db
    .select()
    .from(mortgageLoans)
    .orderBy(asc(mortgageLoans.startDate), asc(mortgageLoans.name))
  const interest = await db
    .select()
    .from(mortgageInterest)
    .orderBy(asc(mortgageInterest.year), asc(mortgageInterest.quarter))
  const amortizations = await db
    .select()
    .from(mortgageAmortizations)
    .orderBy(asc(mortgageAmortizations.paidOn), asc(mortgageAmortizations.createdAt))

  return {
    settings: toSettings(settings),
    loans: loans.map(toLoan),
    interest: interest.map((row) => ({
      loanId: row.loanId,
      year: row.year,
      quarter: Math.min(4, Math.max(1, row.quarter)) as Quarter,
      amountCents: row.amountCents,
    })),
    amortizations: amortizations.map(toAmortization),
  }
}

/** Ob schon etwas erfasst ist – dann übernimmt der Import nichts mehr. */
async function hatDaten(): Promise<boolean> {
  const [loan] = await db.select({ id: mortgageLoans.id }).from(mortgageLoans).limit(1)
  const [tranche] = await db
    .select({ id: mortgageAmortizations.id })
    .from(mortgageAmortizations)
    .limit(1)
  return Boolean(loan || tranche)
}

function saveSettings(settings: MortgageSettings, userId: string, tx: Pick<typeof db, 'insert'> = db): void {
  const werte = { ...settings, updatedBy: userId, updatedAt: new Date().toISOString() }
  tx.insert(mortgageSettings)
    .values({ id: SETTINGS_ID, ...werte })
    .onConflictDoUpdate({ target: mortgageSettings.id, set: werte })
    .run()
}

function csvZeilen(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\r\n')
}

// ------------------------------------------------------------------- Routen

const hypothekRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/haus/hypothek', async (_request, reply) => {
    return reply.send(await loadDaten())
  })

  /** Liegenschaftswert, Ausgangslage der Amortisation, Übertrag und SARON. */
  fastify.put('/api/haus/hypothek/grunddaten', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = mortgageSettingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    saveSettings(parsed.data, user.id)
    return reply.send(await loadDaten())
  })

  fastify.post('/api/haus/hypothek/vertraege', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = loanInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    await db.insert(mortgageLoans).values({
      id: randomUUID(),
      ...loanColumns(parsed.data),
      createdBy: user.id,
    })
    return reply.status(201).send(await loadDaten())
  })

  fastify.put('/api/haus/hypothek/vertraege/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = loanInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const geaendert = await db
      .update(mortgageLoans)
      .set({ ...loanColumns(parsed.data), updatedAt: new Date().toISOString() })
      .where(eq(mortgageLoans.id, params.data.id))
      .returning({ id: mortgageLoans.id })

    if (geaendert.length === 0) return reply.status(404).send(notFound('Hypothek nicht gefunden.'))
    return reply.send(await loadDaten())
  })

  /** Mit ihren erfassten Zinsen – das Fenster sagt vorher, wie viele Quartale das sind. */
  fastify.delete('/api/haus/hypothek/vertraege/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const geloescht = await db
      .delete(mortgageLoans)
      .where(eq(mortgageLoans.id, params.data.id))
      .returning({ id: mortgageLoans.id })

    if (geloescht.length === 0) return reply.status(404).send(notFound('Hypothek nicht gefunden.'))
    return reply.send(await loadDaten())
  })

  /**
   * Die Zinsen eines Quartals, als Ganzes gespeichert: Was nicht mitkommt, ist
   * für dieses Quartal gelöscht. In einer Transaktion, damit ein Quartal nie
   * halb leer dasteht.
   */
  fastify.put('/api/haus/hypothek/zinsen/:year/:quarter', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const params = quarterParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = saveQuarterSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const bekannt = new Set(
      (await db.select({ id: mortgageLoans.id }).from(mortgageLoans)).map((row) => row.id),
    )
    const fremd = parsed.data.entries.find((entry) => !bekannt.has(entry.loanId))
    if (fremd) {
      return reply
        .status(400)
        .send(apiError(API_ERROR_CODES.validationFailed, 'Eine der Hypotheken gibt es nicht mehr.'))
    }

    const { year, quarter } = params.data
    db.transaction((tx) => {
      tx.delete(mortgageInterest)
        .where(and(eq(mortgageInterest.year, year), eq(mortgageInterest.quarter, quarter)))
        .run()
      if (parsed.data.entries.length > 0) {
        tx.insert(mortgageInterest)
          .values(
            parsed.data.entries.map((entry) => ({
              loanId: entry.loanId,
              year,
              quarter,
              amountCents: entry.amountCents,
              updatedBy: user.id,
            })),
          )
          .run()
      }
    })

    return reply.send(await loadDaten())
  })

  fastify.post('/api/haus/hypothek/amortisation', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = amortizationInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    await db.insert(mortgageAmortizations).values({
      id: randomUUID(),
      ...parsed.data,
      createdBy: user.id,
    })
    return reply.status(201).send(await loadDaten())
  })

  fastify.put('/api/haus/hypothek/amortisation/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = amortizationInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const geaendert = await db
      .update(mortgageAmortizations)
      .set(parsed.data)
      .where(eq(mortgageAmortizations.id, params.data.id))
      .returning({ id: mortgageAmortizations.id })

    if (geaendert.length === 0) return reply.status(404).send(notFound('Tranche nicht gefunden.'))
    return reply.send(await loadDaten())
  })

  fastify.delete('/api/haus/hypothek/amortisation/:id', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const geloescht = await db
      .delete(mortgageAmortizations)
      .where(eq(mortgageAmortizations.id, params.data.id))
      .returning({ id: mortgageAmortizations.id })

    if (geloescht.length === 0) return reply.status(404).send(notFound('Tranche nicht gefunden.'))
    return reply.send(await loadDaten())
  })

  /**
   * Eine eigene Excel-Tabelle auslesen – ohne etwas zu speichern.
   *
   * Wie beim Import einer Rechnung entsteht hier nur ein Vorschlag. Gespeichert
   * wird mit `uebernehmen`, nachdem jemand ihn angeschaut hat.
   */
  fastify.post('/api/haus/hypothek/import', async (request, reply) => {
    const upload = await request.file({ limits: { fileSize: MAX_EXCEL_BYTES } })
    if (!upload) {
      return reply
        .status(400)
        .send(apiError(API_ERROR_CODES.validationFailed, 'Keine Datei empfangen.'))
    }

    // Manche Handys schicken eine Excel-Datei als „application/octet-stream" –
    // dann entscheidet die Endung.
    const istExcel = upload.mimetype === XLSX_TYP || /\.xlsx$/i.test(upload.filename ?? '')
    if (!istExcel) {
      upload.file.resume()
      return reply
        .status(415)
        .send(apiError('unsupported_type', 'Nur Excel-Tabellen (.xlsx) lassen sich auslesen.'))
    }

    const data = await readUpload(upload.file, MAX_EXCEL_BYTES)
    if (data === 'zu-gross' || upload.file.truncated) {
      return reply
        .status(413)
        .send(
          apiError(
            'file_too_large',
            `Die Datei ist grösser als ${Math.round(MAX_EXCEL_BYTES / 1024 / 1024)} MB.`,
          ),
        )
    }

    let result: HypothekImportResult
    try {
      result = { ...parseHypothekExcel(readXlsx(data)), bereitsVorhanden: await hatDaten() }
    } catch (error) {
      request.log.warn({ err: error }, 'Excel-Tabelle der Hypothek nicht lesbar')
      return reply
        .status(422)
        .send(apiError('unreadable_file', 'Diese Datei liess sich nicht als Excel-Tabelle lesen.'))
    }
    return reply.send(result)
  })

  /**
   * Die bestätigte Vorschau speichern – Grunddaten, Hypotheken und ihre Zinsen
   * in einem Zug.
   *
   * Nur solange noch nichts erfasst ist: Ein zweiter Import legte jede
   * Hypothek ein zweites Mal an, und welche davon die richtige ist, wüsste
   * danach niemand mehr.
   */
  fastify.post('/api/haus/hypothek/uebernehmen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const parsed = hypothekImportSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    if (await hatDaten()) {
      return reply
        .status(409)
        .send(
          apiError(
            'duplicate',
            'Es ist schon eine Hypothek erfasst. Übernommen wird nur in eine leere Sparte.',
          ),
        )
    }

    db.transaction((tx) => {
      saveSettings(parsed.data.settings, user.id, tx)
      for (const { interest, ...loan } of parsed.data.loans) {
        const id = randomUUID()
        tx.insert(mortgageLoans)
          .values({ id, ...loanColumns(loan), createdBy: user.id })
          .run()

        // Je Quartal höchstens ein Betrag – der zuletzt gelesene gilt.
        const jeQuartal = new Map(interest.map((entry) => [`${entry.year}-${entry.quarter}`, entry]))
        if (jeQuartal.size > 0) {
          tx.insert(mortgageInterest)
            .values(
              [...jeQuartal.values()].map((entry) => ({
                loanId: id,
                year: entry.year,
                quarter: entry.quarter,
                amountCents: entry.amountCents,
                updatedBy: user.id,
              })),
            )
            .run()
        }
      }
    })

    return reply.status(201).send(await loadDaten())
  })

  /**
   * Alles als CSV – Semikolon und BOM wie bei den Rechnungen, damit Excel die
   * Datei ohne Import-Dialog und mit richtigen Umlauten öffnet.
   */
  fastify.get('/api/haus/hypothek/export.csv', async (_request, reply) => {
    const daten = await loadDaten()
    const heute = new Date().toISOString().slice(0, 10)
    const quartale = buildQuarters(daten, heute)
    const amortisation = summarizeAmortization(daten, heute)
    const jahre = mortgageYears(quartale, amortisation)

    const rows: string[][] = [
      ['Hypothek', 'Art', 'Betrag CHF', 'Zinssatz / Marge %', 'Zinssatz heute %', 'Beginn', 'Ende', 'Notiz'],
      ...daten.loans.map((loan) => [
        loan.name,
        LOAN_KIND_LABELS[loan.kind],
        formatAmount(loan.amountCents),
        formatRate(loan.rateMillipercent),
        formatRate(effectiveRate(loan, daten.settings)),
        formatDate(loan.startDate),
        loan.endDate ? formatDate(loan.endDate) : '',
        loan.note,
      ]),
      [],
      ['Quartal', 'Hypothek', 'Prognose CHF', 'Bezahlt CHF'],
      ...quartale.flatMap((row) =>
        row.loans.map((zeile) => [
          row.label,
          zeile.loan.name,
          formatAmount(zeile.forecastCents),
          zeile.actualCents === null ? '' : formatAmount(zeile.actualCents),
        ]),
      ),
      [],
      ['Amortisation', 'Jahr', 'Zahltag', 'Betrag CHF', 'Notiz'],
      ...(amortisation.carriedOverCents > 0
        ? [
            [
              'Übertrag',
              '',
              amortisation.carriedOverDate ? formatDate(amortisation.carriedOverDate) : '',
              formatAmount(amortisation.carriedOverCents),
              '',
            ],
          ]
        : []),
      ...daten.amortizations.map((payment) => [
        'Tranche',
        String(payment.year),
        formatDate(payment.paidOn),
        formatAmount(payment.amountCents),
        payment.note,
      ]),
      [],
      ['Jahr', 'Zinsen bezahlt CHF', 'Zinsen erwartet CHF', 'Amortisation Soll CHF', 'Amortisation bezahlt CHF'],
      ...jahre.map((jahr) => [
        String(jahr.year),
        formatAmount(jahr.interestPaidCents),
        formatAmount(jahr.interestExpectedCents),
        jahr.amortization ? formatAmount(jahr.amortization.targetCents) : '',
        jahr.amortization ? formatAmount(jahr.amortization.paidCents) : '',
      ]),
    ]

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="haus-hypothek.csv"')
      .send(`﻿${csvZeilen(rows)}`)
  })
}

export default hypothekRoutes

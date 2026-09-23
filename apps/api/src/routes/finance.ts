import { randomUUID } from 'node:crypto'

import {
  computePayment,
  computeTaxYears,
  computeYear,
  createPaymentSchema,
  DONATION_LABELS,
  formatAmount,
  monthListLabel,
  monthName,
  normalizeMonths,
  saveMonthSchema,
  saveTaxesSchema,
  sumDonations,
  type Donation,
  type IncomeEntry,
  type TaxCredit,
  type TaxEntry,
} from '@manager/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { db } from '../db/index.js'
import {
  donations,
  donationTaxCredits,
  incomeEntries,
  taxEntries,
  type DonationRow,
  type IncomeEntryRow,
  type TaxEntryRow,
} from '../db/schema.js'
import { notFound, unauthorized, validationError } from '../lib/errors.js'
import { legacySettingsSchema, legacyTaxEntries, taxYearsOfPayment } from '../lib/finance-compat.js'

/** Nur Jahre, die ein Haushalt realistisch erfasst. */
const yearParamSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
})

const monthParamSchema = yearParamSchema.extend({
  month: z.coerce.number().int().min(1).max(12),
})

function toIncome(row: IncomeEntryRow): IncomeEntry {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    userId: row.userId,
    label: row.label,
    amountCents: row.amountCents,
  }
}

function toTaxEntry(row: TaxEntryRow): TaxEntry {
  return { id: row.id, year: row.year, label: row.label, amountCents: row.amountCents }
}

function toDonation(row: DonationRow, taxCredits: TaxCredit[]): Donation {
  return {
    id: row.id,
    year: row.year,
    kind: row.kind as Donation['kind'],
    amountCents: row.amountCents,
    paidOn: row.paidOn,
    coversMonths: parseMonths(row.coversMonths),
    taxAppliedCents: row.taxAppliedCents,
    taxCredits,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

/** '3,4,5' → [3, 4, 5]. Leer und Unlesbares ergeben eine leere Liste. */
function parseMonths(raw: string): number[] {
  return normalizeMonths(raw.split(',').map((part) => Number(part.trim())))
}

async function loadYear(year: number) {
  const [entryRows, donationRows, taxRows, creditRows] = await Promise.all([
    db
      .select()
      .from(incomeEntries)
      .where(eq(incomeEntries.year, year))
      .orderBy(asc(incomeEntries.month), asc(incomeEntries.createdAt)),
    db
      .select()
      .from(donations)
      .where(eq(donations.year, year))
      .orderBy(desc(donations.paidOn), desc(donations.createdAt)),
    // Die Steuern und Verrechnungen aller Jahre, nicht nur dieses einen: Eine
    // Zahlung darf verrechnen, was in einem anderen Jahr an Steuern anfiel,
    // und muss dafür sehen, was dort noch offen ist. Es sind eine Handvoll
    // Zeilen je Jahr.
    db.select().from(taxEntries).orderBy(asc(taxEntries.year), asc(taxEntries.position)),
    db.select().from(donationTaxCredits).orderBy(asc(donationTaxCredits.taxYear)),
  ])

  const creditsOf = (donationId: string): TaxCredit[] =>
    creditRows
      .filter((credit) => credit.donationId === donationId)
      .map((credit) => ({ taxYear: credit.taxYear, amountCents: credit.amountCents }))

  const entries = entryRows.map(toIncome)
  const paid = donationRows.map((row) => toDonation(row, creditsOf(row.id)))
  const taxYears = computeTaxYears(taxRows, creditRows)
  const tax = taxYears.find((candidate) => candidate.year === year)

  return {
    year,
    entries,
    donations: paid,
    /** Die Steuern dieses Jahres, in ihrer Reihenfolge – für das Fenster „Steuern". */
    taxEntries: taxRows.filter((row) => row.year === year).map(toTaxEntry),
    /** Alle Steuerjahre mit dem, was dort offen ist – für die Zahlung. */
    taxYears,
    figures: computeYear(entries, paid, tax),
    // Für Apps von vor den Steuerjahren, siehe finance-compat.ts.
    settings: { taxCents: tax?.taxCents ?? 0 },
  }
}

/**
 * Ersetzt die Steuern eines Jahres. In einer Transaktion: Ein Jahr, dem
 * zwischen Löschen und Schreiben die Steuern abhandenkämen, gäbe jeder
 * späteren Zahlung ein falsches Guthaben.
 */
function replaceTaxEntries(
  year: number,
  entries: readonly { label: string; amountCents: number }[],
  userId: string,
): void {
  // better-sqlite3 arbeitet synchron; siehe die Monatsroute weiter unten.
  db.transaction((tx) => {
    tx.delete(taxEntries).where(eq(taxEntries.year, year)).run()

    if (entries.length > 0) {
      tx.insert(taxEntries)
        .values(
          entries.map((entry, position) => ({
            id: randomUUID(),
            year,
            label: entry.label,
            amountCents: entry.amountCents,
            position,
            updatedBy: userId,
          })),
        )
        .run()
    }
  })
}

const financeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/finanzen/:year', async (request, reply) => {
    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    return reply.send(await loadYear(params.data.year))
  })

  /**
   * Die Steuern eines Jahres, als Ganzes gespeichert: Was nicht mitkommt, ist
   * gelöscht. Was davon schon verrechnet ist, bleibt verrechnet – die
   * Zahlungen sind geschehen, auch wenn ein Betrag nachträglich sinkt.
   */
  fastify.put('/api/finanzen/:year/steuern', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = saveTaxesSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    replaceTaxEntries(params.data.year, parsed.data.entries, user.id)
    return reply.send(await loadYear(params.data.year))
  })

  /** Hier speichert eine alte App ihren einen Steuerbetrag, siehe finance-compat.ts. */
  fastify.put('/api/finanzen/:year/einstellungen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = legacySettingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { year } = params.data
    const existing = await db
      .select()
      .from(taxEntries)
      .where(eq(taxEntries.year, year))
      .orderBy(asc(taxEntries.position))

    const next = legacyTaxEntries(existing, parsed.data.taxCents)
    if (next === 'mehrdeutig') {
      request.log.warn(
        { year, taxCents: parsed.data.taxCents },
        'Alte App wollte Steuern aus mehreren Beträgen als eine Summe speichern – nicht übernommen',
      )
    } else if (next !== 'unverändert') {
      replaceTaxEntries(year, next, user.id)
    }

    return reply.send(await loadYear(year))
  })

  /**
   * Ein Monat wird als Ganzes gespeichert: Was nicht mitkommt, ist gelöscht.
   * Beträge von 0 bleiben bewusst erhalten – „diesen Monat kein Lohn" ist eine
   * Angabe und muss den Steueranteil mittragen.
   */
  fastify.put('/api/finanzen/:year/monat/:month', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const params = monthParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = saveMonthSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { year, month } = params.data

    // better-sqlite3 arbeitet synchron; die Transaktion darf deshalb kein
    // Promise zurückgeben. Darum .run() statt await – ein await hier bricht
    // zur Laufzeit ab, nicht beim Übersetzen.
    db.transaction((tx) => {
      tx.delete(incomeEntries)
        .where(and(eq(incomeEntries.year, year), eq(incomeEntries.month, month)))
        .run()

      if (parsed.data.entries.length > 0) {
        tx.insert(incomeEntries)
          .values(
            parsed.data.entries.map((entry) => ({
              id: randomUUID(),
              year,
              month,
              userId: entry.userId,
              label: entry.label,
              amountCents: entry.amountCents,
              createdBy: user.id,
            })),
          )
          .run()
      }
    })

    return reply.send(await loadYear(year))
  })

  /**
   * Eine Zahlung: die abgehakten Monate, das Fastopfer je Monat und das
   * verrechnete Steuerguthaben samt den Steuerjahren, aus denen es stammt.
   *
   * Der Zehnte kommt nicht aus dem Formular, sondern aus dem erfassten
   * Einkommen dieser Monate – gerechnet mit derselben Funktion wie die
   * Vorschau im Fenster. Ein Betrag, den der Server selbst kennt, soll nicht
   * über das Netz gereicht werden können. Dasselbe gilt für das Guthaben: Was
   * in einem Steuerjahr noch offen ist, weiss der Server.
   */
  fastify.post('/api/finanzen/:year/zahlungen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = createPaymentSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { year } = params.data
    const stand = await loadYear(year)
    const rechnung = computePayment(
      stand.entries,
      { ...parsed.data, taxYears: taxYearsOfPayment(parsed.data.taxYears, year) },
      stand.taxYears,
    )

    const gemeinsam = {
      year,
      paidOn: parsed.data.paidOn,
      coversMonths: rechnung.months.join(','),
      createdBy: user.id,
    }

    // Alle Zeilen entstehen in einer Transaktion: Eine halbe Zahlung wäre
    // schlimmer als keine.
    db.transaction((tx) => {
      // Der Zehnte wird immer festgehalten, auch mit 0 – er ist es, der die
      // abgehakten Monate abrechnet, und ein Monat ohne Lohn will genauso
      // abgehakt werden wie einer mit.
      const zehntenId = randomUUID()
      tx.insert(donations)
        .values({
          ...gemeinsam,
          id: zehntenId,
          kind: 'zehnten',
          amountCents: rechnung.netTithingCents,
          taxAppliedCents: rechnung.taxAppliedCents,
        })
        .run()

      if (rechnung.taxCredits.length > 0) {
        tx.insert(donationTaxCredits)
          .values(
            rechnung.taxCredits.map((credit) => ({
              donationId: zehntenId,
              taxYear: credit.taxYear,
              amountCents: credit.amountCents,
            })),
          )
          .run()
      }

      if (rechnung.fastOfferingCents > 0) {
        tx.insert(donations)
          .values({
            ...gemeinsam,
            id: randomUUID(),
            kind: 'fastopfer',
            amountCents: rechnung.fastOfferingCents,
            // Das Fastopfer verrechnet keine Steuern; die Monate stehen nur
            // dabei, damit auf dem Beleg steht, wofür es geleistet wurde.
            taxAppliedCents: 0,
          })
          .run()
      }
    })

    return reply.status(201).send(await loadYear(year))
  })

  fastify.delete('/api/finanzen/:year/zahlungen/:id', async (request, reply) => {
    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const { id } = request.params as { id: string }
    const deleted = await db
      .delete(donations)
      .where(and(eq(donations.year, params.data.year), eq(donations.id, id)))
      .returning({ id: donations.id })

    if (deleted.length === 0) return reply.status(404).send(notFound('Zahlung nicht gefunden.'))

    // Abrechnungsstand und verrechnete Steuern folgen den Zahlungen: Mit der
    // gelöschten Zeile verschwindet auch, was sie abgedeckt hat – ihre
    // Verrechnungen gehen per Fremdschlüssel mit, und das Guthaben steht in
    // seinem Steuerjahr wieder offen.
    return reply.send(await loadYear(params.data.year))
  })

  /**
   * Jahresübersicht als CSV. Semikolon als Trennzeichen und ein BOM voran –
   * so öffnet Excel die Datei ohne Import-Dialog und mit richtigen Umlauten.
   */
  fastify.get('/api/finanzen/:year/export.csv', async (request, reply) => {
    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const { year, figures, taxEntries: steuern, donations: paid } = await loadYear(
      params.data.year,
    )

    const rows = [
      ['Monat', 'Einkommen', 'Zehnter (10 %)'],
      ...figures.months
        .filter((month) => month.entered)
        .map((month) => [
          monthName(month.month),
          formatAmount(month.incomeCents),
          formatAmount(month.tithingCents),
        ]),
      [],
      ['Einkommen', formatAmount(figures.totalIncomeCents)],
      ['Zehnter geschuldet', formatAmount(figures.owedTithingCents)],
      ['Steuern verrechnet', formatAmount(figures.taxCreditAppliedCents)],
      ['Zehnter bezahlt', formatAmount(figures.paidTithingCents)],
      ['Noch offen', formatAmount(figures.openTithingCents)],
      ['Abgerechnete Monate', monthListLabel(figures.settledMonths) || '–'],
      [],
      // Die Steuern dieses Jahres mit ihren Beträgen – verrechnet werden sie
      // womöglich erst mit den Zahlungen eines späteren Jahres.
      [`Steuern ${year}`, 'Betrag'],
      ...steuern.map((entry) => [entry.label || 'Steuern', formatAmount(entry.amountCents)]),
      ['Total', formatAmount(figures.taxTotalCents)],
      ['Davon verrechenbar (10 %)', formatAmount(figures.taxCreditTotalCents)],
      ['Davon noch nicht verrechnet', formatAmount(figures.taxCreditOpenCents)],
      [],
      // Die Belege gehören in dieselbe Datei – sonst muss man fürs
      // Jahresgespräch zwei Sachen zusammensuchen.
      ['Zahlungen', 'Datum', 'Betrag', 'Steuern verrechnet', 'Aus Steuerjahr', 'Rechnet ab für'],
      ...paid.map((donation) => [
        DONATION_LABELS[donation.kind],
        donation.paidOn,
        formatAmount(donation.amountCents),
        donation.taxAppliedCents > 0 ? formatAmount(donation.taxAppliedCents) : '',
        donation.taxCredits.map((credit) => credit.taxYear).join(', '),
        monthListLabel(donation.coversMonths),
      ]),
      [],
      ['Fastopfer einbezahlt', formatAmount(figures.paidFastOfferingCents)],
      ['Weitere Spenden', formatAmount(sumDonations(paid, 'andere'))],
    ]

    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="zehnten-${year}.csv"`)
      .send(`﻿${csv}`)
  })
}

export default financeRoutes

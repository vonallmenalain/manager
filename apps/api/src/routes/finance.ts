import { randomUUID } from 'node:crypto'

import {
  computeYear,
  createPaymentSchema,
  DEFAULT_FINANCE_SETTINGS,
  DONATION_LABELS,
  financeSettingsSchema,
  formatAmount,
  monthName,
  saveMonthSchema,
  sumDonations,
  type Donation,
  type FinanceSettings,
  type IncomeEntry,
} from '@manager/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { db } from '../db/index.js'
import {
  donations,
  financeYears,
  incomeEntries,
  type DonationRow,
  type FinanceYearRow,
  type IncomeEntryRow,
} from '../db/schema.js'
import { notFound, unauthorized, validationError } from '../lib/errors.js'

/** Nur Jahre, die ein Haushalt realistisch erfasst. */
const yearParamSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
})

const monthParamSchema = yearParamSchema.extend({
  month: z.coerce.number().int().min(1).max(12),
})

function toSettings(row: FinanceYearRow): FinanceSettings {
  return { taxCents: row.taxCents }
}

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

function toDonation(row: DonationRow): Donation {
  return {
    id: row.id,
    year: row.year,
    kind: row.kind as Donation['kind'],
    amountCents: row.amountCents,
    paidOn: row.paidOn,
    note: row.note,
    coversThroughMonth: row.coversThroughMonth,
    taxAppliedCents: row.taxAppliedCents,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

/**
 * Liefert die Einstellungen des Jahres und legt sie beim ersten Zugriff mit
 * den Standardwerten an – so muss niemand ein Jahr "eröffnen", bevor er die
 * erste Zahl eintippen kann.
 */
async function loadSettings(year: number): Promise<FinanceSettings> {
  const rows = await db.select().from(financeYears).where(eq(financeYears.year, year)).limit(1)
  const row = rows[0]
  if (row) return toSettings(row)

  await db.insert(financeYears).values({ year }).onConflictDoNothing()
  return { ...DEFAULT_FINANCE_SETTINGS }
}

async function loadYear(year: number) {
  const [settings, entryRows, donationRows] = await Promise.all([
    loadSettings(year),
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
  ])

  const entries = entryRows.map(toIncome)
  const paid = donationRows.map(toDonation)
  return {
    year,
    settings,
    entries,
    donations: paid,
    figures: computeYear(entries, paid, settings),
  }
}

const financeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', fastify.requireAuth)

  fastify.get('/api/finanzen/:year', async (request, reply) => {
    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    return reply.send(await loadYear(params.data.year))
  })

  fastify.put('/api/finanzen/:year/einstellungen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = financeSettingsSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    await db
      .insert(financeYears)
      .values({ year: params.data.year, ...parsed.data, updatedBy: user.id })
      .onConflictDoUpdate({
        target: financeYears.year,
        set: { ...parsed.data, updatedBy: user.id, updatedAt: new Date().toISOString() },
      })

    return reply.send(await loadYear(params.data.year))
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

    // Das Jahr wird angelegt, falls es das noch nicht gibt – sonst stünde
    // gleich danach ein Monat ohne Einstellungen da.
    await loadSettings(year)
    return reply.send(await loadYear(year))
  })

  /**
   * Eine Zahlung: Zehnter und Fastopfer für denselben Zeitraum, dazu die
   * Steuern, die dabei verrechnet werden.
   *
   * Gespeichert wird je Art eine Zeile – die Kirche weist beides getrennt
   * aus, und die bestehende Auswertung zählt je Art zusammen. Beide entstehen
   * in einer Transaktion: Eine halbe Zahlung wäre schlimmer als keine.
   */
  fastify.post('/api/finanzen/:year/zahlungen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = createPaymentSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { year } = params.data
    const payment = parsed.data
    await loadSettings(year)

    const gemeinsam = {
      year,
      paidOn: payment.paidOn,
      note: payment.note,
      createdBy: user.id,
    }

    db.transaction((tx) => {
      // Auch eine Zahlung über 0 wird festgehalten, wenn sie Steuern
      // verrechnet: Der Steuerabzug ist dann ihr ganzer Zweck.
      if (payment.tithingCents > 0 || payment.taxAppliedCents > 0) {
        tx.insert(donations)
          .values({
            ...gemeinsam,
            id: randomUUID(),
            kind: 'zehnten',
            amountCents: payment.tithingCents,
            coversThroughMonth: payment.coversThroughMonth,
            taxAppliedCents: payment.taxAppliedCents,
          })
          .run()
      }

      if (payment.fastOfferingCents > 0) {
        tx.insert(donations)
          .values({
            ...gemeinsam,
            id: randomUUID(),
            kind: 'fastopfer',
            amountCents: payment.fastOfferingCents,
            // Das Fastopfer rechnet keine Monate ab und verrechnet keine Steuern.
            coversThroughMonth: null,
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
    // gelöschten Zeile verschwindet auch, was sie abgedeckt hat.
    return reply.send(await loadYear(params.data.year))
  })

  /**
   * Jahresübersicht als CSV. Semikolon als Trennzeichen und ein BOM voran –
   * so öffnet Excel die Datei ohne Import-Dialog und mit richtigen Umlauten.
   */
  fastify.get('/api/finanzen/:year/export.csv', async (request, reply) => {
    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const { year, figures, settings, donations: paid } = await loadYear(params.data.year)

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
      ['Steuern verrechnet', formatAmount(figures.taxAppliedCents)],
      ['Steuern ganzes Jahr', formatAmount(settings.taxCents)],
      ['Basis', formatAmount(figures.baseCents)],
      ['Zehnter geschuldet', formatAmount(figures.owedTithingCents)],
      ['Zehnter bezahlt', formatAmount(figures.paidTithingCents)],
      ['Noch offen', formatAmount(figures.openTithingCents)],
      [
        'Abgerechnet bis',
        figures.settledThroughMonth === 0 ? '–' : monthName(figures.settledThroughMonth),
      ],
      [],
      // Die Belege gehören in dieselbe Datei – sonst muss man fürs
      // Jahresgespräch zwei Sachen zusammensuchen.
      ['Zahlungen', 'Datum', 'Betrag', 'Steuern verrechnet', 'Rechnet ab bis', 'Notiz'],
      ...paid.map((donation) => [
        DONATION_LABELS[donation.kind],
        donation.paidOn,
        formatAmount(donation.amountCents),
        donation.taxAppliedCents > 0 ? formatAmount(donation.taxAppliedCents) : '',
        donation.coversThroughMonth ? monthName(donation.coversThroughMonth) : '',
        donation.note,
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

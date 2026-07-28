import { randomUUID } from 'node:crypto'

import {
  computeYear,
  createDonationSchema,
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
  return {
    taxCents: row.taxCents,
    deductTax: row.deductTax,
    rateBasisPoints: row.rateBasisPoints,
    settledThroughMonth: row.settledThroughMonth,
  }
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
  return {
    year,
    settings,
    entries,
    donations: donationRows.map(toDonation),
    figures: computeYear(entries, settings),
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

  fastify.post('/api/finanzen/:year/zahlungen', async (request, reply) => {
    const user = request.user
    if (!user) return reply.status(401).send(unauthorized())

    const params = yearParamSchema.safeParse(request.params)
    if (!params.success) return reply.status(400).send(validationError(params.error))

    const parsed = createDonationSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send(validationError(parsed.error))

    const { year } = params.data
    const settings = await loadSettings(year)

    await db.insert(donations).values({
      id: randomUUID(),
      year,
      kind: parsed.data.kind,
      amountCents: parsed.data.amountCents,
      paidOn: parsed.data.paidOn,
      note: parsed.data.note,
      // Nur der Zehnte rechnet Monate ab; beim Fastopfer gibt es nichts
      // nachzuführen.
      coversThroughMonth: parsed.data.kind === 'zehnten' ? parsed.data.coversThroughMonth : null,
      createdBy: user.id,
    })

    // Eine Zahlung, die weiter reicht als der bisherige Stand, schiebt ihn
    // nach. Zurück geht es nur von Hand – sonst würde ein nachgetragener
    // alter Beleg den Stand versehentlich zurückstellen.
    const covers = parsed.data.kind === 'zehnten' ? parsed.data.coversThroughMonth : null
    if (covers !== null && covers > settings.settledThroughMonth) {
      await db
        .update(financeYears)
        .set({ settledThroughMonth: covers, updatedBy: user.id, updatedAt: new Date().toISOString() })
        .where(eq(financeYears.year, year))
    }

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

    // Der Abrechnungsstand bleibt stehen: Wer eine Zahlung löscht, will meist
    // einen Tippfehler korrigieren, nicht die Abrechnung zurückdrehen. Das
    // geht in den Einstellungen ausdrücklich.
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
      ['Monat', 'Einkommen', 'Steueranteil', 'Basis', 'Zehnter'],
      ...figures.months
        .filter((month) => month.entered)
        .map((month) => [
          monthName(month.month),
          formatAmount(month.incomeCents),
          formatAmount(month.taxShareCents),
          formatAmount(month.baseCents),
          formatAmount(month.tithingCents),
        ]),
      [],
      [
        'Total',
        formatAmount(figures.totalIncomeCents),
        formatAmount(figures.totalTaxCents),
        formatAmount(figures.totalBaseCents),
        formatAmount(figures.totalTithingCents),
      ],
      [],
      ['Abgerechnet bis', settings.settledThroughMonth === 0 ? '–' : monthName(settings.settledThroughMonth)],
      ['Bereits abgerechnet', formatAmount(figures.settledTithingCents)],
      ['Noch offen', formatAmount(figures.openTithingCents)],
      [],
      // Die Belege gehören in dieselbe Datei – sonst muss man fürs
      // Jahresgespräch zwei Sachen zusammensuchen.
      ['Zahlungen', 'Datum', 'Betrag', 'Rechnet ab bis', 'Notiz'],
      ...paid.map((donation) => [
        DONATION_LABELS[donation.kind],
        donation.paidOn,
        formatAmount(donation.amountCents),
        donation.coversThroughMonth ? monthName(donation.coversThroughMonth) : '',
        donation.note,
      ]),
      [],
      ['Zehnter einbezahlt', formatAmount(sumDonations(paid, 'zehnten'))],
      ['Fastopfer einbezahlt', formatAmount(sumDonations(paid, 'fastopfer'))],
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

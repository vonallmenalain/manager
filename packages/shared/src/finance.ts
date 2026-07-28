import { z } from 'zod'

export const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month)
}

/**
 * Der Zehnte ist ein Zehntel – daher der Name.
 *
 * Stand früher als einstellbarer Satz in der Datenbank. Ein Feld, das seit
 * jeher auf demselben Wert steht und für das es keinen zweiten gibt, ist
 * keine Einstellung, sondern eine Stelle zum Verstellen.
 */
export const TITHING_RATE = 0.1

export const DONATION_KINDS = ['zehnten', 'fastopfer', 'andere'] as const
export type DonationKind = (typeof DONATION_KINDS)[number]

export const DONATION_LABELS: Record<DonationKind, string> = {
  zehnten: 'Zehnter',
  fastopfer: 'Fastopfer',
  andere: 'Weitere Spende',
}

// ---------------------------------------------------------------- Schemas

/**
 * Was zu einem Jahr eingestellt wird: der Steuerbetrag. Sonst nichts.
 *
 * Wie viel davon abgezogen wird, entscheidet sich nicht hier, sondern bei
 * jeder Zahlung – dort weiss man, wie viel Steuern bis dahin tatsächlich
 * angefallen sind.
 */
export const financeSettingsSchema = z.object({
  /** Steuerbetrag für das ganze Jahr, in Rappen. */
  taxCents: z.number().int().min(0).max(100_000_000),
})

export type FinanceSettings = z.infer<typeof financeSettingsSchema>

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  taxCents: 0,
}

export const incomeEntrySchema = z.object({
  id: z.string(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  userId: z.string(),
  /** Leer für den normalen Lohn, sonst z. B. „Bonus" oder „Nebenjob". */
  label: z.string(),
  amountCents: z.number().int(),
})

export type IncomeEntry = z.infer<typeof incomeEntrySchema>

/**
 * Ein Monat wird immer als Ganzes gespeichert. Das UI zeigt zwei Felder plus
 * allfällige weitere Einnahmen – was nicht mitkommt, ist gelöscht. Das erspart
 * das Nachhalten einzelner IDs auf einem Bildschirm, den man in zehn Sekunden
 * ausfüllen können soll.
 */
export const saveMonthSchema = z.object({
  entries: z
    .array(
      z.object({
        userId: z.string().min(1),
        label: z.string().trim().max(60).default(''),
        amountCents: z.number().int().min(0).max(100_000_000),
      }),
    )
    .max(20),
})

export type SaveMonthInput = z.infer<typeof saveMonthSchema>

export const donationSchema = z.object({
  id: z.string(),
  year: z.number().int(),
  kind: z.enum(DONATION_KINDS),
  amountCents: z.number().int(),
  paidOn: z.string(),
  note: z.string(),
  /** Nur beim Zehnten: bis und mit welchem Monat diese Zahlung abrechnet. */
  coversThroughMonth: z.number().int().min(1).max(12).nullable(),
  /** Nur beim Zehnten: wie viel der Jahressteuer mit ihr verrechnet wurde. */
  taxAppliedCents: z.number().int().min(0),
  createdBy: z.string(),
  createdAt: z.string(),
})

export type Donation = z.infer<typeof donationSchema>

/**
 * Eine Zahlung, wie sie im Alltag stattfindet: Zehnter und Fastopfer gehen
 * zusammen aufs Mal, für denselben Zeitraum. Deshalb ein Vorgang mit zwei
 * Beträgen statt zweier Formulare – gespeichert werden trotzdem zwei Zeilen,
 * weil die Kirche beides getrennt ausweist.
 */
export const createPaymentSchema = z
  .object({
    tithingCents: z.number().int().min(0).max(100_000_000).default(0),
    fastOfferingCents: z.number().int().min(0).max(100_000_000).default(0),
    /** Wie viel der Jahressteuer diese Zahlung verrechnet. */
    taxAppliedCents: z.number().int().min(0).max(100_000_000).default(0),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
    note: z.string().trim().max(200).default(''),
    coversThroughMonth: z.number().int().min(1).max(12).nullable().default(null),
  })
  .refine(
    (payment) =>
      payment.tithingCents > 0 || payment.fastOfferingCents > 0 || payment.taxAppliedCents > 0,
    { message: 'Bitte einen Betrag eingeben' },
  )

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>

// ---------------------------------------------------------------- Berechnung

export interface MonthFigures {
  month: number
  /** Summe aller Einnahmen dieses Monats. */
  incomeCents: number
  /** Ein Zehntel davon – vor der Verrechnung der Steuern. */
  tithingCents: number
  /** Ob für diesen Monat überhaupt etwas erfasst ist. */
  entered: boolean
}

export interface YearFigures {
  months: MonthFigures[]
  /** Letzter Monat, für den etwas erfasst ist. 0 = noch nichts. */
  lastEnteredMonth: number

  totalIncomeCents: number
  /** Steuern, die über die Zahlungen bereits verrechnet wurden. */
  taxAppliedCents: number
  /** Der Steuerbetrag des ganzen Jahres, aus den Einstellungen. */
  taxTotalCents: number
  /** Was davon noch nicht verrechnet ist. Nie negativ. */
  taxOpenCents: number

  /** Einkommen minus verrechnete Steuern. Nie negativ. */
  baseCents: number
  /** Ein Zehntel der Basis – der geschuldete Zehnte. */
  owedTithingCents: number
  paidTithingCents: number
  /** Was noch offen ist. Nie negativ. */
  openTithingCents: number
  paidFastOfferingCents: number

  /** Bis und mit welchem Monat abgerechnet ist – aus den Zahlungen abgeleitet. */
  settledThroughMonth: number
  /** Die Monate, die seither erfasst und noch nicht abgerechnet sind. */
  openMonths: number[]
}

/**
 * Rechnet ein Jahr durch.
 *
 * Die Rechnung ist bewusst eine Jahresrechnung und keine Aneinanderreihung
 * von Monaten: Einkommen aufsummieren, die bis dahin verrechneten Steuern
 * abziehen, davon ein Zehntel – und dagegen die geleisteten Zahlungen. Was
 * bleibt, ist offen.
 *
 * Früher stand hier eine kumulative Monatsrechnung, weil die Jahressteuer zu
 * zwölfteln war. Seit die Steuer bei der Zahlung verrechnet wird und nicht
 * mehr über die Monate verteilt, ist das nicht mehr nötig – und ein Monat
 * ohne Lohn hat keinen negativen Zehnten mehr, was am Bildschirm nie jemand
 * erklären konnte.
 *
 * Der Monatswert ist damit schlicht ein Zehntel des Monatseinkommens. Die
 * Summe der Monate ist der Zehnte vor Steuerabzug; was die Steuern davon
 * abziehen, steht in der Jahresübersicht.
 */
export function computeYear(
  entries: readonly IncomeEntry[],
  donations: readonly Donation[],
  settings: FinanceSettings,
): YearFigures {
  const income = monthlyTotals(entries)

  // „Erfasst" heisst: Es gibt einen Eintrag – auch einen über 0. Ein Monat
  // ohne Lohn ist eine Angabe, kein fehlender Wert.
  let lastEnteredMonth = 0
  for (const entry of entries) {
    if (entry.month > lastEnteredMonth && entry.month <= 12) lastEnteredMonth = entry.month
  }

  const months: MonthFigures[] = []
  let totalIncomeCents = 0

  for (let month = 1; month <= 12; month += 1) {
    const entered = month <= lastEnteredMonth
    const incomeCents = entered ? (income[month - 1] ?? 0) : 0
    totalIncomeCents += incomeCents

    months.push({
      month,
      incomeCents,
      tithingCents: Math.round(incomeCents * TITHING_RATE),
      entered,
    })
  }

  const taxAppliedCents = donations.reduce((sum, donation) => sum + donation.taxAppliedCents, 0)
  const baseCents = Math.max(0, totalIncomeCents - taxAppliedCents)
  const owedTithingCents = Math.round(baseCents * TITHING_RATE)
  const paidTithingCents = sumDonations(donations, 'zehnten')

  // Der Abrechnungsstand folgt den Zahlungen: Er ist der weiteste Monat, den
  // eine Zahlung abdeckt. Eine gelöschte Zahlung nimmt ihn damit zurück, und
  // es gibt keine zweite Stelle, an der er von Hand verstellt werden müsste.
  let settledThroughMonth = 0
  for (const donation of donations) {
    if (donation.kind !== 'zehnten' || donation.coversThroughMonth === null) continue
    if (donation.coversThroughMonth > settledThroughMonth) {
      settledThroughMonth = donation.coversThroughMonth
    }
  }

  const openMonths: number[] = []
  for (let month = Math.min(settledThroughMonth, lastEnteredMonth) + 1; month <= lastEnteredMonth; month += 1) {
    openMonths.push(month)
  }

  return {
    months,
    lastEnteredMonth,
    totalIncomeCents,
    taxAppliedCents,
    taxTotalCents: settings.taxCents,
    taxOpenCents: Math.max(0, settings.taxCents - taxAppliedCents),
    baseCents,
    owedTithingCents,
    paidTithingCents,
    openTithingCents: Math.max(0, owedTithingCents - paidTithingCents),
    paidFastOfferingCents: sumDonations(donations, 'fastopfer'),
    settledThroughMonth,
    openMonths,
  }
}

/** Fasst die Einträge eines Jahres zu zwölf Monatssummen zusammen. */
export function monthlyTotals(entries: readonly IncomeEntry[]): number[] {
  const totals = new Array<number>(12).fill(0)
  for (const entry of entries) {
    const index = entry.month - 1
    if (index >= 0 && index < 12) {
      totals[index] = (totals[index] ?? 0) + entry.amountCents
    }
  }
  return totals
}

export function sumDonations(donations: readonly Donation[], kind: DonationKind): number {
  return donations
    .filter((donation) => donation.kind === kind)
    .reduce((sum, donation) => sum + donation.amountCents, 0)
}

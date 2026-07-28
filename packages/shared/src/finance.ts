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

/** Zehnten-Satz in Hundertstelprozent: 1000 = 10 %. */
export const DEFAULT_RATE_BASIS_POINTS = 1000

export const DONATION_KINDS = ['zehnten', 'fastopfer', 'andere'] as const
export type DonationKind = (typeof DONATION_KINDS)[number]

export const DONATION_LABELS: Record<DonationKind, string> = {
  zehnten: 'Zehnter',
  fastopfer: 'Fastopfer',
  andere: 'Weitere Spende',
}

// ---------------------------------------------------------------- Schemas

export const financeSettingsSchema = z.object({
  /** Steuerbetrag für das ganze Jahr, in Rappen. */
  taxCents: z.number().int().min(0).max(100_000_000),
  /** Ob die Steuer vom Einkommen abgezogen wird, bevor der Zehnte berechnet wird. */
  deductTax: z.boolean(),
  rateBasisPoints: z.number().int().min(0).max(10_000),
  /** Bis und mit welchem Monat der Zehnte abgerechnet ist. 0 = noch nichts. */
  settledThroughMonth: z.number().int().min(0).max(12),
})

export type FinanceSettings = z.infer<typeof financeSettingsSchema>

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  taxCents: 0,
  deductTax: true,
  rateBasisPoints: DEFAULT_RATE_BASIS_POINTS,
  settledThroughMonth: 0,
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
  createdBy: z.string(),
  createdAt: z.string(),
})

export type Donation = z.infer<typeof donationSchema>

export const createDonationSchema = z.object({
  kind: z.enum(DONATION_KINDS),
  amountCents: z.number().int().min(1).max(100_000_000),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
  note: z.string().trim().max(200).default(''),
  coversThroughMonth: z.number().int().min(1).max(12).nullable().default(null),
})

export type CreateDonationInput = z.infer<typeof createDonationSchema>

// ---------------------------------------------------------------- Berechnung

export interface MonthFigures {
  month: number
  /** Summe aller Einnahmen dieses Monats. */
  incomeCents: number
  /** Anteil der Jahressteuer, der auf diesen Monat entfällt. */
  taxShareCents: number
  /** Einkommen minus Steueranteil – der Beitrag dieses Monats zur Basis. */
  baseCents: number
  /** Zehnter für diesen Monat. Kann negativ sein, siehe computeYear(). */
  tithingCents: number
  /** Ob für diesen Monat überhaupt etwas erfasst ist. */
  entered: boolean
}

export interface YearFigures {
  months: MonthFigures[]
  /** Letzter Monat, für den etwas erfasst ist. 0 = noch nichts. */
  lastEnteredMonth: number
  /** Summen über die erfassten Monate. */
  totalIncomeCents: number
  totalTaxCents: number
  totalBaseCents: number
  /** Zehnter, der bis zum letzten erfassten Monat geschuldet ist. */
  totalTithingCents: number
  /** Bereits abgerechnet – der Zehnte bis und mit settledThroughMonth. */
  settledTithingCents: number
  /** Was noch offen ist. Nie negativ. */
  openTithingCents: number
  /** Die Monate, die im offenen Betrag stecken. */
  openMonths: number[]
}

/**
 * Rechnet ein Jahr durch.
 *
 * **Warum kumulativ und nicht Monat für Monat:** Die Steuer ist ein
 * Jahresbetrag. Rechnet man jeden Monat für sich und schneidet negative
 * Ergebnisse ab, stimmt die Jahressumme am Schluss nicht mehr mit
 * `(Jahreseinkommen − Steuern) × Satz` überein – und genau diese Zahl ist es,
 * die am Jahresende zählt.
 *
 * Deshalb wird für jeden Monat der bis dahin aufgelaufene Zehnte gerechnet;
 * der Monatswert ist die Differenz zum Vormonat. Die Monatswerte summieren
 * sich damit exakt auf den Jahreswert.
 *
 * Die Folge, die man kennen muss: In einem Monat ohne Einkommen wird der
 * Steueranteil trotzdem angerechnet, der Monatswert ist dann negativ. Das ist
 * keine Gutschrift zum Auszahlen, sondern die Verrechnung mit den Monaten
 * davor – über das Jahr geht es genau auf.
 */
export function computeYear(
  entries: readonly IncomeEntry[],
  settings: FinanceSettings,
): YearFigures {
  const rate = settings.rateBasisPoints / 10_000
  const taxCents = settings.deductTax ? settings.taxCents : 0

  const income = monthlyTotals(entries)

  // „Erfasst" heisst: Es gibt einen Eintrag – auch einen über 0. Ein Monat
  // ohne Lohn ist eine Angabe, kein fehlender Wert, und muss den Steueranteil
  // mittragen.
  let lastEnteredMonth = 0
  for (const entry of entries) {
    if (entry.month > lastEnteredMonth && entry.month <= 12) lastEnteredMonth = entry.month
  }

  const months: MonthFigures[] = []
  let cumIncome = 0
  let previousCumTax = 0
  let previousCumTithing = 0

  for (let month = 1; month <= 12; month += 1) {
    const monthIncome = income[month - 1] ?? 0
    const entered = month <= lastEnteredMonth

    if (!entered) {
      // Für noch nicht erfasste Monate wird nichts angerechnet – sonst
      // stünden dort Steueranteile und negative Zehnten für Monate, die es
      // noch gar nicht gab.
      months.push({
        month,
        incomeCents: 0,
        taxShareCents: 0,
        baseCents: 0,
        tithingCents: 0,
        entered: false,
      })
      continue
    }

    cumIncome += monthIncome
    const cumTax = Math.round((taxCents * month) / 12)
    const cumBase = Math.max(0, cumIncome - cumTax)
    const cumTithing = Math.round(cumBase * rate)

    months.push({
      month,
      incomeCents: monthIncome,
      taxShareCents: cumTax - previousCumTax,
      baseCents: monthIncome - (cumTax - previousCumTax),
      tithingCents: cumTithing - previousCumTithing,
      entered: true,
    })

    previousCumTax = cumTax
    previousCumTithing = cumTithing
  }

  const totalTithingCents = previousCumTithing
  const settledThrough = Math.min(settings.settledThroughMonth, lastEnteredMonth)
  const settledTithingCents = months
    .slice(0, settledThrough)
    .reduce((sum, figures) => sum + figures.tithingCents, 0)

  const openMonths: number[] = []
  for (let month = settledThrough + 1; month <= lastEnteredMonth; month += 1) {
    openMonths.push(month)
  }

  return {
    months,
    lastEnteredMonth,
    totalIncomeCents: cumIncome,
    totalTaxCents: previousCumTax,
    totalBaseCents: cumIncome - previousCumTax,
    totalTithingCents,
    settledTithingCents,
    openTithingCents: Math.max(0, totalTithingCents - settledTithingCents),
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

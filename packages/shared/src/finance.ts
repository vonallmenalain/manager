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
 * Eine Liste von Monaten so, wie man sie ausspricht: Was zusammenhängt, wird
 * zu „Januar–März", der Rest kommt mit Komma dahinter. „Januar–März, Juni"
 * liest sich in einer Zeile, zwölf Monatsnamen tun das nicht.
 */
export function monthListLabel(months: readonly number[]): string {
  const sorted = normalizeMonths(months)
  if (sorted.length === 0) return ''

  const parts: string[] = []
  let from = sorted[0] as number
  let to = from

  for (const month of sorted.slice(1)) {
    if (month === to + 1) {
      to = month
      continue
    }
    parts.push(from === to ? monthName(from) : `${monthName(from)}–${monthName(to)}`)
    from = month
    to = month
  }
  parts.push(from === to ? monthName(from) : `${monthName(from)}–${monthName(to)}`)

  return parts.join(', ')
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

/**
 * Was sich von einem Steuerbetrag überhaupt verrechnen lässt: ein Zehntel.
 *
 * Steuern mindern nicht die Zahlung, sondern das Einkommen, auf das der
 * Zehnte gerechnet wird. Von CHF 15'000 Steuern bleiben darum CHF 1'500
 * übrig, um die es beim Zehnten weniger wird – und nicht die ganze Summe.
 */
export function taxCreditFor(taxCents: number): number {
  return Math.round(taxCents * TITHING_RATE)
}

// ---------------------------------------------------------------- Schemas

/**
 * Ein Steuerbetrag eines Jahres, etwa die Bundessteuer. Ein Jahr kann mehrere
 * haben – verrechnet wird ihre Summe.
 */
export const taxEntrySchema = z.object({
  id: z.string(),
  /** Das Steuerjahr, für das der Betrag geschuldet ist. */
  year: z.number().int(),
  /** z. B. „Bundessteuer". Leer, wenn der Betrag keinen Namen braucht. */
  label: z.string(),
  amountCents: z.number().int(),
})

export type TaxEntry = z.infer<typeof taxEntrySchema>

/**
 * Die Steuern eines Jahres werden als Ganzes gespeichert, wie ein Monat: Was
 * nicht mitkommt, ist gelöscht. Es sind eine Handvoll Zeilen in einem
 * Fenster, das von selbst speichert – einzelne IDs nachzuhalten lohnt nicht.
 *
 * Wann das Guthaben daraus verrechnet wird, entscheidet sich nicht hier,
 * sondern bei jeder Zahlung – dort weiss man, was bis dahin angefallen ist.
 */
export const saveTaxesSchema = z.object({
  entries: z
    .array(
      z.object({
        label: z.string().trim().max(60).default(''),
        amountCents: z.number().int().min(0).max(100_000_000),
      }),
    )
    .max(20),
})

export type SaveTaxesInput = z.infer<typeof saveTaxesSchema>

/**
 * Ein Stück Steuerguthaben, das eine Zahlung verrechnet: aus welchem
 * Steuerjahr, und wie viel.
 */
export const taxCreditSchema = z.object({
  taxYear: z.number().int(),
  amountCents: z.number().int().min(0),
})

export type TaxCredit = z.infer<typeof taxCreditSchema>

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
  /** Die Monate, die diese Zahlung abrechnet – aufsteigend und ohne Doppel. */
  coversMonths: z.array(z.number().int().min(1).max(12)),
  /** Nur beim Zehnten: wie viel Steuerguthaben mit ihr verrechnet wurde. */
  taxAppliedCents: z.number().int().min(0),
  /** Woher dieses Guthaben stammt – je Steuerjahr, das älteste zuerst. */
  taxCredits: z.array(taxCreditSchema),
  createdBy: z.string(),
  createdAt: z.string(),
})

export type Donation = z.infer<typeof donationSchema>

/**
 * Eine Zahlung, wie sie im Alltag stattfindet: Man hakt die Monate ab, die
 * noch nicht abgerechnet sind, und überweist, was dafür zusammenkommt.
 *
 * Eingegeben wird nur, was man wirklich weiss – die Monate, das Fastopfer je
 * Monat, das verrechnete Steuerguthaben samt den Steuerjahren, aus denen es
 * stammt, und der Zahltag. Der Zehnte selbst ergibt sich aus dem erfassten
 * Einkommen dieser Monate; ein Feld dafür wäre eine Gelegenheit, sich zu
 * vertippen.
 *
 * Gespeichert werden zwei Zeilen (Zehnter und Fastopfer), weil die Kirche
 * beides getrennt ausweist.
 */
export const createPaymentSchema = z.object({
  /** Die abgehakten Monate. Ohne Monat gibt es nichts abzurechnen. */
  months: z.array(z.number().int().min(1).max(12)).min(1).max(12),
  fastOfferingPerMonthCents: z.number().int().min(0).max(10_000_000).default(0),
  /** Wie viel Steuerguthaben diese Zahlung verrechnet. */
  taxAppliedCents: z.number().int().min(0).max(100_000_000).default(0),
  /**
   * Die angehakten Steuerjahre – aus ihnen stammt das Guthaben. Leer heisst:
   * aus allen, in denen noch etwas offen ist, das älteste zuerst.
   *
   * Fehlt das Feld ganz, kommt die Zahlung von einer App aus der Zeit vor den
   * Steuerjahren. Die kannte nur die Steuern des eigenen Jahres, und dabei
   * bleibt es für sie (siehe `finance-compat.ts` im Backend).
   */
  taxYears: z.array(z.number().int().min(2000).max(2100)).max(100).optional(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT'),
})

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
  /** Ein Zehntel davon – der geschuldete Zehnte, vor jeder Verrechnung. */
  owedTithingCents: number
  /** Was an Zehnten einbezahlt wurde. */
  paidTithingCents: number

  /** Die Steuern dieses Jahres – die Summe seiner Einträge. */
  taxTotalCents: number
  /** Ein Zehntel davon: mehr lässt sich aus diesem Steuerjahr nicht verrechnen. */
  taxCreditTotalCents: number
  /**
   * Was die Zahlungen dieses Jahres an Steuerguthaben verrechnet haben – aus
   * welchem Steuerjahr auch immer. Um so viel wird der Zehnte kleiner.
   */
  taxCreditAppliedCents: number
  /** Was vom Guthaben dieses Steuerjahres noch nicht verrechnet ist. Nie negativ. */
  taxCreditOpenCents: number

  /** Zehnter minus bezahlt minus verrechnetes Guthaben. Nie negativ. */
  openTithingCents: number
  paidFastOfferingCents: number

  /** Die Monate, die eine Zahlung abrechnet – aufsteigend. */
  settledMonths: number[]
  /** Die Monate, für die etwas erfasst und noch nicht abgerechnet ist. */
  openMonths: number[]
}

/**
 * Rechnet ein Jahr durch.
 *
 * Die Rechnung ist bewusst eine Jahresrechnung und keine Aneinanderreihung
 * von Monaten: Einkommen aufsummieren, davon ein Zehntel – und dagegen das
 * Bezahlte und das verrechnete Steuerguthaben. Was bleibt, ist offen.
 *
 * Früher stand hier eine kumulative Monatsrechnung, weil die Jahressteuer zu
 * zwölfteln war. Seit die Steuer bei der Zahlung verrechnet wird und nicht
 * mehr über die Monate verteilt, ist das nicht mehr nötig – und ein Monat
 * ohne Lohn hat keinen negativen Zehnten mehr, was am Bildschirm nie jemand
 * erklären konnte.
 *
 * Der Monatswert ist damit schlicht ein Zehntel des Monatseinkommens. Die
 * Summe der Monate ist der geschuldete Zehnte; was das Steuerguthaben davon
 * abzieht, steht in der Jahresübersicht.
 *
 * `tax` ist das Steuerjahr mit derselben Zahl, aus `computeTaxYears`. Fehlt
 * es, sind für das Jahr keine Steuern hinterlegt.
 */
export function computeYear(
  entries: readonly IncomeEntry[],
  donations: readonly Donation[],
  tax?: TaxYearFigures,
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

  const owedTithingCents = Math.round(totalIncomeCents * TITHING_RATE)
  const paidTithingCents = sumDonations(donations, 'zehnten')

  // Den Zehnten dieses Jahres mindert, was seine Zahlungen verrechnet haben –
  // auch wenn das Guthaben aus den Steuern eines anderen Jahres stammt.
  const taxCreditAppliedCents = donations.reduce(
    (sum, donation) => sum + donation.taxAppliedCents,
    0,
  )

  // Der Abrechnungsstand folgt den Zahlungen: abgerechnet ist, was eine
  // Zahlung abhakt. Eine gelöschte Zahlung gibt ihre Monate damit wieder
  // frei, und es gibt keine zweite Stelle, an der von Hand nachzuführen wäre.
  const settled = new Set<number>()
  for (const donation of donations) {
    if (donation.kind !== 'zehnten') continue
    for (const month of donation.coversMonths) settled.add(month)
  }
  const settledMonths = [...settled].sort((a, b) => a - b)

  const openMonths = months
    .filter((month) => month.entered && !settled.has(month.month))
    .map((month) => month.month)

  return {
    months,
    lastEnteredMonth,
    totalIncomeCents,
    owedTithingCents,
    paidTithingCents,
    taxTotalCents: tax?.taxCents ?? 0,
    taxCreditTotalCents: tax?.creditCents ?? 0,
    taxCreditAppliedCents,
    taxCreditOpenCents: tax?.openCents ?? 0,
    openTithingCents: Math.max(0, owedTithingCents - paidTithingCents - taxCreditAppliedCents),
    paidFastOfferingCents: sumDonations(donations, 'fastopfer'),
    settledMonths,
    openMonths,
  }
}

// ------------------------------------------------------------ Steuerjahre

/** Ein Steuerjahr: was an Steuern anfiel und was davon verrechnet ist. */
export interface TaxYearFigures {
  year: number
  /** Die Summe seiner Einträge. */
  taxCents: number
  /** Ein Zehntel davon – mehr lässt sich aus diesem Jahr nicht verrechnen. */
  creditCents: number
  /** Was Zahlungen davon schon verrechnet haben, gleich in welchem Jahr. */
  appliedCents: number
  /** Was noch zu verrechnen bleibt. Nie negativ. */
  openCents: number
  /** Die Bezeichnungen der Einträge in ihrer Reihenfolge, leere weggelassen. */
  labels: string[]
}

/**
 * Stellt die Steuerjahre nebeneinander, das älteste zuerst.
 *
 * Die Steuern eines Jahres stehen meist erst im nächsten fest. Das Guthaben
 * gehört deshalb dem Steuerjahr und nicht dem Jahr der Zahlung: Eine Zahlung
 * im März 2026 darf verrechnen, was 2025 an Steuern anfiel – und was sie
 * davon nimmt, fehlt danach bei 2025 und nirgends sonst.
 *
 * Verrechenbar ist ein Zehntel der Summe aller Einträge, nicht die Summe der
 * einzelnen Zehntel: Bundessteuer und Staatssteuer sind Teile einer Rechnung.
 * Ein Jahr taucht auf, sobald es Einträge hat oder eine Zahlung etwas daraus
 * verrechnet hat – auch wenn seine Einträge danach gelöscht wurden.
 */
export function computeTaxYears(
  entries: readonly Pick<TaxEntry, 'year' | 'label' | 'amountCents'>[],
  credits: readonly TaxCredit[],
): TaxYearFigures[] {
  const years = new Map<number, { taxCents: number; appliedCents: number; labels: string[] }>()
  const yearOf = (year: number) => {
    let figures = years.get(year)
    if (!figures) {
      figures = { taxCents: 0, appliedCents: 0, labels: [] }
      years.set(year, figures)
    }
    return figures
  }

  for (const entry of entries) {
    const figures = yearOf(entry.year)
    figures.taxCents += entry.amountCents
    const label = entry.label.trim()
    if (label) figures.labels.push(label)
  }
  for (const credit of credits) yearOf(credit.taxYear).appliedCents += credit.amountCents

  return [...years]
    .sort(([a], [b]) => a - b)
    .map(([year, figures]) => {
      const creditCents = taxCreditFor(figures.taxCents)
      return {
        year,
        taxCents: figures.taxCents,
        creditCents,
        appliedCents: figures.appliedCents,
        openCents: Math.max(0, creditCents - figures.appliedCents),
        labels: figures.labels,
      }
    })
}

// ------------------------------------------------------- Rechnung je Zahlung

export interface PaymentDraft {
  /** Die abgehakten Monate. */
  months: readonly number[]
  fastOfferingPerMonthCents: number
  /** Was an Steuerguthaben verrechnet werden soll – wird gedeckelt. */
  taxAppliedCents: number
  /**
   * Die angehakten Steuerjahre, aus denen das Guthaben stammt. Leer oder
   * weggelassen heisst: aus allen mit offenem Rest, das älteste zuerst.
   */
  taxYears?: readonly number[]
}

export interface PaymentFigures {
  /** Die Monate der Zahlung, aufsteigend und ohne Doppel. */
  months: number[]
  /** Einkommen der gewählten Monate. */
  incomeCents: number
  /** Ein Zehntel davon – der Zehnte dieser Zahlung. */
  tithingCents: number
  /** Was in den gewählten Steuerjahren noch an Guthaben offen ist. */
  availableTaxCreditCents: number
  /** So viel Steuerguthaben lässt sich hier höchstens verrechnen. */
  maxTaxCreditCents: number
  /** Was tatsächlich verrechnet wird: der Wunsch, gedeckelt. */
  taxAppliedCents: number
  /** Woher das Verrechnete stammt – je Steuerjahr, das älteste zuerst. */
  taxCredits: TaxCredit[]
  /** Fastopfer je Monat mal Anzahl Monate. */
  fastOfferingCents: number
  /** Der Zehnte, wie er einbezahlt wird: nach Abzug des Guthabens. */
  netTithingCents: number
  /** Was insgesamt zu überweisen ist. */
  totalCents: number
}

/**
 * Rechnet eine Zahlung aus, bevor es sie gibt.
 *
 * Dieselbe Funktion rechnet die Vorschau im Fenster und den Beleg auf dem
 * Server. So kann am Bildschirm keine andere Zahl stehen als gleich danach in
 * der Liste – und was sich nicht verrechnen lässt, wird an beiden Orten
 * gleich gedeckelt statt einmal abgewiesen und einmal übernommen.
 *
 * `taxYears` sind die Steuerjahre, wie `computeTaxYears` sie liefert – mit
 * dem, was in jedem noch offen ist.
 */
export function computePayment(
  entries: readonly IncomeEntry[],
  draft: PaymentDraft,
  taxYears: readonly Pick<TaxYearFigures, 'year' | 'openCents'>[],
): PaymentFigures {
  const months = normalizeMonths(draft.months)
  const chosen = new Set(months)

  const incomeCents = entries
    .filter((entry) => chosen.has(entry.month))
    .reduce((sum, entry) => sum + entry.amountCents, 0)
  const tithingCents = Math.round(incomeCents * TITHING_RATE)

  // Das Guthaben stammt aus den angehakten Steuerjahren – oder, ist keines
  // angehakt, aus allen mit offenem Rest. Das älteste kommt zuerst dran: Es
  // wartet am längsten, und ein Betrag von Hand soll kein junges Jahr
  // anbrechen, während ein altes offen bleibt.
  const picked = new Set(draft.taxYears ?? [])
  const sources = taxYears
    .filter((tax) => tax.openCents > 0 && (picked.size === 0 || picked.has(tax.year)))
    .sort((a, b) => a.year - b.year)
  const availableTaxCreditCents = sources.reduce((sum, tax) => sum + tax.openCents, 0)

  // Verrechnet werden kann nur, was noch an Guthaben da ist – und höchstens
  // so viel, wie diese Zahlung an Zehnten trägt. Ein Rest bleibt stehen und
  // wartet auf die nächste Zahlung; ein negativer Beleg wäre keine Zahlung.
  const maxTaxCreditCents = Math.min(availableTaxCreditCents, tithingCents)
  const taxAppliedCents = Math.min(Math.max(0, draft.taxAppliedCents), maxTaxCreditCents)

  const taxCredits: TaxCredit[] = []
  let rest = taxAppliedCents
  for (const source of sources) {
    if (rest === 0) break
    const amountCents = Math.min(rest, source.openCents)
    taxCredits.push({ taxYear: source.year, amountCents })
    rest -= amountCents
  }

  const netTithingCents = tithingCents - taxAppliedCents
  const fastOfferingCents = Math.max(0, draft.fastOfferingPerMonthCents) * months.length

  return {
    months,
    incomeCents,
    tithingCents,
    availableTaxCreditCents,
    maxTaxCreditCents,
    taxAppliedCents,
    taxCredits,
    fastOfferingCents,
    netTithingCents,
    totalCents: netTithingCents + fastOfferingCents,
  }
}

/** Monate aufsteigend, ohne Doppel und ohne Unmögliches. */
export function normalizeMonths(months: readonly number[]): number[] {
  const clean = new Set<number>()
  for (const month of months) {
    if (Number.isInteger(month) && month >= 1 && month <= 12) clean.add(month)
  }
  return [...clean].sort((a, b) => a - b)
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

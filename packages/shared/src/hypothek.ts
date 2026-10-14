import { z } from 'zod'

/**
 * Die Sparte Hypothek im Bereich Haus: woraus die Hypothek besteht, was sie an
 * Zinsen kostet und wie weit die 2. Hypothek schon amortisiert ist.
 *
 * Eine Hypothek ist hier nicht eine Zahl, sondern ein paar Verträge
 * nebeneinander – Festhypotheken mit eigenem Zinssatz und eigener Laufzeit,
 * dazu SARON-Hypotheken, deren Zins mit dem Referenzzins wandert. Läuft eine
 * Festhypothek aus, kommt eine neue an ihre Stelle; beide bleiben stehen,
 * damit die bezahlten Zinsen der alten nachlesbar bleiben.
 *
 * Erfasst wird, was tatsächlich bezahlt wurde: die Zinsen je Quartal und
 * Hypothek, wie sie auf der Abrechnung der Bank stehen, und die Amortisation
 * in so vielen Tranchen, wie sie eben überwiesen wurde. Die Prognose daneben
 * rechnet die App selbst – aus Betrag, Zinssatz und Laufzeit. Sie füllt das
 * Formular vor und steht dort, wo noch nichts bezahlt ist, aber sie ersetzt
 * nie einen erfassten Betrag.
 *
 * Beträge stehen wie überall in der App als ganze Rappen in `…Cents`.
 * Zinssätze stehen als Tausendstelprozent in `…Millipercent`: 1.130 % → 1130.
 * Basispunkte (wie bei der MWST) reichten für 1.13 %, aber nicht für die drei
 * Nachkommastellen, mit denen Banken Margen und den SARON angeben.
 */

// ------------------------------------------------------------------- Arten

export const LOAN_KINDS = ['fest', 'saron'] as const
export type LoanKind = (typeof LOAN_KINDS)[number]

export const LOAN_KIND_LABELS: Record<LoanKind, string> = {
  fest: 'Festhypothek',
  saron: 'SARON-Hypothek',
}

/** Kurzform für enge Stellen – Abzeichen, Tabellenkopf. */
export const LOAN_KIND_SHORT: Record<LoanKind, string> = {
  fest: 'Fest',
  saron: 'SARON',
}

export const QUARTERS = [1, 2, 3, 4] as const
export type Quarter = (typeof QUARTERS)[number]

/** Tausendstelprozent je Prozent: 1 % → 1000. */
const MILLIPERCENT = 1000

// ------------------------------------------------------------------ Schemas

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')

/** Bis 100 Millionen Franken – darüber ist es kein Einfamilienhaus mehr. */
const betrag = z.number().int().min(0).max(10_000_000_000)

const loanFieldsSchema = z.object({
  /** Wie die Bank sie nennt: „Festhypothek 0003", „SARON-Hypothek 0005". */
  name: z.string().trim().min(1, 'Bitte einen Namen eingeben').max(80),
  kind: z.enum(LOAN_KINDS),
  amountCents: betrag.min(1, 'Bitte einen Betrag eingeben'),
  /**
   * Bei der Festhypothek der feste Zinssatz, bei der SARON-Hypothek die Marge
   * der Bank. Der SARON selbst steht in den Grunddaten: Er gilt für alle
   * SARON-Hypotheken zugleich und ändert sich, ohne dass sich ein Vertrag
   * ändert.
   */
  rateMillipercent: z.number().int().min(0).max(20 * MILLIPERCENT),
  /** Ab wann Zins anfällt. */
  startDate: isoDate,
  /** „Laufzeit bis" – null bei einer SARON-Hypothek ohne festes Ende. */
  endDate: isoDate.nullable().default(null),
  note: z.string().trim().max(500).default(''),
})

const endeNachBeginn = {
  message: 'Das Ende liegt vor dem Beginn',
  path: ['endDate'],
}

export const loanInputSchema = loanFieldsSchema.refine(
  (loan) => loan.endDate === null || loan.endDate >= loan.startDate,
  endeNachBeginn,
)

export type LoanInput = z.infer<typeof loanInputSchema>

export interface MortgageLoan extends LoanInput {
  id: string
  createdAt: string
  updatedAt: string
}

/**
 * Was für die ganze Hypothek gilt und nicht für einen einzelnen Vertrag.
 *
 * Der Betrag, von dem aus amortisiert wird, steht hier fest und wird nicht aus
 * den Hypotheken zusammengezählt: Wer direkt amortisiert, sieht die Hypothek
 * kleiner werden, und die Amortisation zählte dann doppelt – einmal als
 * Zahlung, einmal als fehlender Betrag. Wer indirekt über die Säule 3a
 * amortisiert, sieht die Hypothek gar nicht kleiner werden. Für beide stimmt
 * nur eine feste Ausgangslage.
 */
export const mortgageSettingsSchema = z.object({
  /** Wert der Liegenschaft – die Grundlage der Belehnung. */
  propertyValueCents: betrag.default(0),
  /** Die ganze Hypothek zu Beginn, wie in „Total Hypothek". */
  mortgageTotalCents: betrag.default(0),
  /** Die 1. Hypothek – üblicherweise zwei Drittel des Liegenschaftswerts. */
  firstMortgageCents: betrag.default(0),
  /** Was die Bank pro Jahr an Amortisation verlangt. */
  amortizationPerYearCents: betrag.default(0),
  /**
   * Bereits amortisiert, bevor hier erfasst wurde – der Übertrag aus der
   * eigenen Tabelle. Ab dem Tag danach zählen die einzelnen Tranchen.
   */
  carriedOverCents: betrag.default(0),
  carriedOverDate: isoDate.nullable().default(null),
  /** Der SARON (oder Leitzins), wie ihn die Bank für die SARON-Hypotheken verrechnet. */
  referenceRateMillipercent: z.number().int().min(0).max(10 * MILLIPERCENT).default(0),
})

export type MortgageSettings = z.infer<typeof mortgageSettingsSchema>

export const EMPTY_MORTGAGE_SETTINGS: MortgageSettings = {
  propertyValueCents: 0,
  mortgageTotalCents: 0,
  firstMortgageCents: 0,
  amortizationPerYearCents: 0,
  carriedOverCents: 0,
  carriedOverDate: null,
  referenceRateMillipercent: 0,
}

/** Die Zinsen einer Hypothek für ein Quartal – so, wie sie bezahlt wurden. */
export interface InterestPayment {
  loanId: string
  year: number
  quarter: Quarter
  amountCents: number
}

/**
 * Ein Quartal wird als Ganzes gespeichert, wie ein Monat bei den Finanzen: Was
 * nicht mitkommt, ist gelöscht. Ein leeres Feld heisst „noch nicht bezahlt",
 * nicht „null Franken".
 */
export const saveQuarterSchema = z.object({
  entries: z
    .array(
      z.object({
        loanId: z.string().trim().min(1).max(60),
        amountCents: betrag,
      }),
    )
    .max(20)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.loanId)).size === entries.length,
      'Jede Hypothek höchstens einmal je Quartal',
    ),
})

export type SaveQuarterInput = z.infer<typeof saveQuarterSchema>

/**
 * Eine Tranche der Amortisation.
 *
 * Das Jahr steht eigens neben dem Datum: Wer die Amortisation für 2026 erst im
 * Januar 2027 überweist, hat trotzdem 2026 amortisiert.
 */
export const amortizationInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  paidOn: isoDate,
  amountCents: betrag.min(1, 'Bitte einen Betrag eingeben'),
  note: z.string().trim().max(200).default(''),
})

export type AmortizationInput = z.infer<typeof amortizationInputSchema>

export interface AmortizationPayment extends AmortizationInput {
  id: string
  createdBy: string
  createdAt: string
}

/** Alles, was die Sparte kennt – jede Änderung liefert es als Ganzes zurück. */
export interface HypothekDaten {
  settings: MortgageSettings
  loans: MortgageLoan[]
  interest: InterestPayment[]
  amortizations: AmortizationPayment[]
}

// ------------------------------------------------------------ Excel-Import

export const importInterestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  amountCents: betrag,
})

/**
 * Was aus einer eigenen Tabelle übernommen wird: die Grunddaten und je
 * Hypothek ihre bezahlten Zinsen. Gespeichert wird es erst, wenn die Vorschau
 * bestätigt ist – wie beim Import einer Rechnung.
 */
export const hypothekImportSchema = z.object({
  settings: mortgageSettingsSchema,
  loans: z
    .array(
      loanFieldsSchema
        .extend({ interest: z.array(importInterestSchema).max(400).default([]) })
        .refine(
          (loan) => loan.endDate === null || loan.endDate >= loan.startDate,
          endeNachBeginn,
        ),
    )
    .min(1)
    .max(20),
})

export type HypothekImportInput = z.infer<typeof hypothekImportSchema>

export interface HypothekImportResult {
  /** Was gelesen wurde – null, wenn die Datei keine solche Tabelle enthält. */
  daten: HypothekImportInput | null
  /** Was abgeleitet, übersprungen oder nicht gefunden wurde. */
  hinweise: string[]
  /** Ob schon etwas erfasst ist – dann lässt sich nicht übernehmen. */
  bereitsVorhanden: boolean
}

// --------------------------------------------------------------- Zinssätze

/**
 * Wandelt eine Eingabe wie „1.13", „1,13 %" oder „0.625" in Tausendstelprozent.
 * Mehr als drei Nachkommastellen werden gerundet; Unlesbares gibt null.
 */
export function parseRate(input: string): number | null {
  const cleaned = input.replace(/[%\s ]/g, '').replace(',', '.')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0 || value > 20) return null
  return Math.round(value * MILLIPERCENT)
}

/**
 * „1.13" aus 1130, „0.625" aus 625 – mindestens zwei Nachkommastellen, wie
 * auf jeder Offerte, und die dritte nur, wenn es sie gibt.
 */
export function formatRate(millipercent: number | null): string {
  if (millipercent === null) return '–'
  return (millipercent / MILLIPERCENT).toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  })
}

/**
 * Der Zinssatz, der für eine Hypothek gilt: bei der Festhypothek der feste,
 * bei der SARON-Hypothek der Referenzzins plus Marge.
 */
export function effectiveRate(
  loan: Pick<LoanInput, 'kind' | 'rateMillipercent'>,
  settings: Pick<MortgageSettings, 'referenceRateMillipercent'>,
): number {
  return loan.kind === 'saron'
    ? settings.referenceRateMillipercent + loan.rateMillipercent
    : loan.rateMillipercent
}

// --------------------------------------------------------------- Kalender

function parseDay(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 }
}

/** Das Datum `days` Tage später (oder früher). */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function quarterOfDate(iso: string): { year: number; quarter: Quarter } {
  const { year, month } = parseDay(iso)
  return { year, quarter: (Math.floor((month - 1) / 3) + 1) as Quarter }
}

/** Der erste Tag des Quartals: Q3 2026 → 2026-07-01. */
export function quarterStart(year: number, quarter: Quarter): string {
  return `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`
}

/** Der letzte Tag des Quartals: Q3 2026 → 2026-09-30. */
export function quarterEnd(year: number, quarter: Quarter): string {
  return addDays(nextQuarterStart(year, quarter), -1)
}

function nextQuarterStart(year: number, quarter: Quarter): string {
  return quarter === 4 ? `${year + 1}-01-01` : quarterStart(year, (quarter + 1) as Quarter)
}

export function quarterKey(year: number, quarter: Quarter): string {
  return `${year}-Q${quarter}`
}

/** „Q3 2026". */
export function quarterLabel(year: number, quarter: Quarter): string {
  return `Q${quarter} ${year}`
}

/** „Q3 26" – für die Achse eines Diagramms. */
export function shortQuarterLabel(year: number, quarter: Quarter): string {
  return `Q${quarter} ${String(year).slice(2)}`
}

function quarterIndex(year: number, quarter: Quarter): number {
  return year * 4 + (quarter - 1)
}

function fromQuarterIndex(index: number): { year: number; quarter: Quarter } {
  return { year: Math.floor(index / 4), quarter: ((index % 4) + 1) as Quarter }
}

/**
 * Zinstage nach der Usanz 30/360: jeder Monat 30 Tage, das Jahr 360.
 *
 * So rechnen die Banken hierzulande die Hypothekarzinsen ab – deshalb kostet
 * eine Festhypothek jedes Quartal genau ein Viertel ihres Jahreszinses, ob es
 * 90 oder 92 Kalendertage hat. Gezählt wird von `from` (mitgezählt) bis `to`
 * (nicht mitgezählt); der 31. eines Monats zählt wie der 30.
 */
export function days360(from: string, to: string): number {
  const a = parseDay(from)
  const b = parseDay(to)
  const d1 = Math.min(a.day, 30)
  const d2 = Math.min(b.day, 30)
  return 360 * (b.year - a.year) + 30 * (b.month - a.month) + (d2 - d1)
}

/** Ob die Hypothek an mindestens einem Tag des Zeitraums Zins trägt. */
function activeBetween(loan: Pick<LoanInput, 'startDate' | 'endDate'>, from: string, to: string): boolean {
  return loan.startDate <= to && (loan.endDate === null || loan.endDate >= from)
}

/**
 * Die Zinsen, die eine Hypothek für ein Quartal kosten sollte.
 *
 * Beginnt oder endet sie mitten im Quartal, zählen nur ihre Tage darin. Für
 * eine SARON-Hypothek gilt der Referenzzins von heute – für vergangene
 * Quartale ist das nur eine Näherung, und deshalb steht dort, wo bezahlt ist,
 * immer der bezahlte Betrag.
 */
export function loanForecastCents(
  loan: Pick<LoanInput, 'kind' | 'rateMillipercent' | 'amountCents' | 'startDate' | 'endDate'>,
  settings: Pick<MortgageSettings, 'referenceRateMillipercent'>,
  year: number,
  quarter: Quarter,
): number {
  const von = loan.startDate > quarterStart(year, quarter) ? loan.startDate : quarterStart(year, quarter)
  const endeExklusiv = loan.endDate === null ? null : addDays(loan.endDate, 1)
  const quartalsEnde = nextQuarterStart(year, quarter)
  const bis = endeExklusiv !== null && endeExklusiv < quartalsEnde ? endeExklusiv : quartalsEnde
  if (von >= bis) return 0

  const tage = days360(von, bis)
  const satz = effectiveRate(loan, settings) / (100 * MILLIPERCENT)
  return Math.round((loan.amountCents * satz * tage) / 360)
}

/** Die Zinsen eines Monats bei vollem Satz – wie „Monatliche Zinskosten" in der Tabelle. */
export function monthlyInterestCents(
  loan: Pick<LoanInput, 'kind' | 'rateMillipercent' | 'amountCents'>,
  settings: Pick<MortgageSettings, 'referenceRateMillipercent'>,
): number {
  return (loan.amountCents * effectiveRate(loan, settings)) / (100 * MILLIPERCENT) / 12
}

// ------------------------------------------------------------- Hypotheken

export type LoanState = 'aktiv' | 'abgelaufen' | 'kuenftig'

export interface LoanStatus {
  loan: MortgageLoan
  state: LoanState
  effectiveRateMillipercent: number
  /** Zins pro Monat bei vollem Satz. Ungerundet – gerundet wird beim Anzeigen. */
  monthlyInterestCents: number
  /** Verstrichener Anteil der Laufzeit, 0 bis 1. null ohne festes Ende. */
  elapsed: number | null
  /** Ganze Monate bis zum Ende. null ohne festes Ende oder wenn sie abgelaufen ist. */
  monthsLeft: number | null
}

/** Ganze Monate von `from` bis `to` – angebrochene zählen nicht. */
function monthsBetween(from: string, to: string): number {
  const a = parseDay(from)
  const b = parseDay(to)
  let months = (b.year - a.year) * 12 + (b.month - a.month)
  if (b.day < a.day) months -= 1
  return Math.max(0, months)
}

export function loanStatus(loan: MortgageLoan, settings: MortgageSettings, today: string): LoanStatus {
  const state: LoanState =
    loan.startDate > today ? 'kuenftig' : loan.endDate !== null && loan.endDate < today ? 'abgelaufen' : 'aktiv'

  let elapsed: number | null = null
  if (loan.endDate !== null) {
    const start = Date.parse(`${loan.startDate}T00:00:00Z`)
    const end = Date.parse(`${loan.endDate}T00:00:00Z`)
    const now = Date.parse(`${today}T00:00:00Z`)
    elapsed = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1
  }

  return {
    loan,
    state,
    effectiveRateMillipercent: effectiveRate(loan, settings),
    monthlyInterestCents: monthlyInterestCents(loan, settings),
    elapsed,
    monthsLeft: loan.endDate !== null && state !== 'abgelaufen' ? monthsBetween(today, loan.endDate) : null,
  }
}

/** „1 J. 11 Mt.", „4 Mt.", „3 J." – die Restlaufzeit in der Kürze, die eine Zeile hergibt. */
export function formatMonths(months: number): string {
  const jahre = Math.floor(months / 12)
  const monate = months % 12
  if (jahre === 0) return `${monate} Mt.`
  if (monate === 0) return `${jahre} J.`
  return `${jahre} J. ${monate} Mt.`
}

/**
 * Der Stand heute: was an Hypotheken läuft, was sie im Schnitt kosten und
 * was jeden Monat dafür weggeht.
 */
export interface MortgageStatus {
  loans: LoanStatus[]
  /** Nur die laufenden. */
  active: LoanStatus[]
  totalCents: number
  /** Nach Betrag gewichtet – eine kleine teure Hypothek zieht den Schnitt kaum. */
  averageRateMillipercent: number | null
  monthlyInterestCents: number
  /** Die geplante Amortisation, auf den Monat verteilt. */
  monthlyAmortizationCents: number
  /** Hypothek im Verhältnis zum Liegenschaftswert, 0 bis 1. null ohne Wert. */
  loanToValue: number | null
}

export function mortgageStatus(daten: HypothekDaten, today: string): MortgageStatus {
  const loans = [...daten.loans]
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name))
    .map((loan) => loanStatus(loan, daten.settings, today))
  const active = loans.filter((status) => status.state === 'aktiv')

  const totalCents = active.reduce((sum, status) => sum + status.loan.amountCents, 0)
  const gewichtet = active.reduce(
    (sum, status) => sum + status.loan.amountCents * status.effectiveRateMillipercent,
    0,
  )

  return {
    loans,
    active,
    totalCents,
    averageRateMillipercent: totalCents > 0 ? Math.round(gewichtet / totalCents) : null,
    monthlyInterestCents: active.reduce((sum, status) => sum + status.monthlyInterestCents, 0),
    monthlyAmortizationCents: daten.settings.amortizationPerYearCents / 12,
    loanToValue:
      daten.settings.propertyValueCents > 0 ? totalCents / daten.settings.propertyValueCents : null,
  }
}

// ---------------------------------------------------------------- Quartale

export type QuarterTime = 'vergangen' | 'laufend' | 'kommend'

export interface QuarterLoanRow {
  loan: MortgageLoan
  forecastCents: number
  /** Was bezahlt wurde – null, solange nichts erfasst ist. */
  actualCents: number | null
}

export interface QuarterRow {
  year: number
  quarter: Quarter
  key: string
  label: string
  start: string
  end: string
  time: QuarterTime
  /** Die Hypotheken, die in diesem Quartal liefen oder für die etwas erfasst ist. */
  loans: QuarterLoanRow[]
  forecastCents: number
  /** Summe des Erfassten – null, solange für dieses Quartal nichts erfasst ist. */
  actualCents: number | null
  /** Ob für jede laufende Hypothek ein Betrag erfasst ist. */
  complete: boolean
  /** Erfasstes, wo es das gibt, sonst die Prognose – die beste Schätzung des Quartals. */
  expectedCents: number
}

/**
 * Alle Quartale vom Beginn der ersten Hypothek bis zum Ende des laufenden
 * Jahres – die künftigen mit ihrer Prognose, damit ein angefangenes Jahr
 * zeigt, was noch kommt.
 */
export function buildQuarters(daten: HypothekDaten, today: string): QuarterRow[] {
  const erfasst = new Map<string, number>()
  for (const entry of daten.interest) {
    erfasst.set(`${entry.loanId}|${quarterKey(entry.year, entry.quarter)}`, entry.amountCents)
  }

  const anfaenge = [
    ...daten.loans.map((loan) => quarterOfDate(loan.startDate)),
    ...daten.interest.map((entry) => ({ year: entry.year, quarter: entry.quarter })),
  ].map((ref) => quarterIndex(ref.year, ref.quarter))
  if (anfaenge.length === 0) return []

  const heute = quarterOfDate(today)
  const heuteIndex = quarterIndex(heute.year, heute.quarter)
  const letzterErfasst = daten.interest.map((entry) => quarterIndex(entry.year, entry.quarter))
  const von = Math.min(...anfaenge)
  const bis = Math.max(quarterIndex(heute.year, 4), ...letzterErfasst)

  const loans = [...daten.loans].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name),
  )

  const rows: QuarterRow[] = []
  for (let index = von; index <= bis; index += 1) {
    const { year, quarter } = fromQuarterIndex(index)
    const start = quarterStart(year, quarter)
    const end = quarterEnd(year, quarter)
    const key = quarterKey(year, quarter)

    const zeilen: QuarterLoanRow[] = loans
      .map((loan) => {
        const actual = erfasst.get(`${loan.id}|${key}`)
        return {
          loan,
          forecastCents: loanForecastCents(loan, daten.settings, year, quarter),
          actualCents: actual ?? null,
          aktiv: activeBetween(loan, start, end),
        }
      })
      .filter((zeile) => zeile.aktiv || zeile.actualCents !== null)
      .map(({ loan, forecastCents, actualCents }) => ({ loan, forecastCents, actualCents }))

    if (zeilen.length === 0) continue

    const mitBetrag = zeilen.filter((zeile) => zeile.actualCents !== null)
    rows.push({
      year,
      quarter,
      key,
      label: quarterLabel(year, quarter),
      start,
      end,
      time: index < heuteIndex ? 'vergangen' : index === heuteIndex ? 'laufend' : 'kommend',
      loans: zeilen,
      forecastCents: zeilen.reduce((sum, zeile) => sum + zeile.forecastCents, 0),
      actualCents:
        mitBetrag.length === 0
          ? null
          : mitBetrag.reduce((sum, zeile) => sum + (zeile.actualCents ?? 0), 0),
      // Eine Hypothek, die in diesem Quartal keinen Zins mehr trägt (Ende am
      // ersten Tag), muss nicht erfasst sein, damit das Quartal fertig ist.
      complete: zeilen.every((zeile) => zeile.actualCents !== null || zeile.forecastCents === 0),
      expectedCents: zeilen.reduce(
        (sum, zeile) => sum + (zeile.actualCents ?? zeile.forecastCents),
        0,
      ),
    })
  }
  return rows
}

/**
 * Das nächste Quartal, für das noch nicht alles erfasst ist – ab dem
 * laufenden. Ältere Lücken zählen nicht: Die nächste Zahlung liegt vorne.
 */
export function nextOpenQuarter(rows: readonly QuarterRow[]): QuarterRow | null {
  return rows.find((row) => row.time !== 'vergangen' && !row.complete) ?? null
}

/**
 * Das Quartal, das man beim Erfassen am ehesten meint: das älteste
 * abgelaufene, für das noch etwas fehlt, sonst das laufende.
 */
export function suggestedQuarter(rows: readonly QuarterRow[]): QuarterRow | null {
  return (
    rows.find((row) => row.time === 'vergangen' && !row.complete) ??
    rows.find((row) => row.time === 'laufend') ??
    rows[rows.length - 1] ??
    null
  )
}

// ------------------------------------------------------------ Amortisation

export interface AmortizationYear {
  year: number
  /** Was in diesem Jahr fällig ist – im letzten Jahr nur noch der Rest. */
  targetCents: number
  paidCents: number
  /** Was zum Soll noch fehlt, nie negativ. */
  openCents: number
  payments: AmortizationPayment[]
}

export interface AmortizationSummary {
  /** Was über die Jahre zu amortisieren ist: Hypothek minus 1. Hypothek. */
  secondMortgageCents: number
  carriedOverCents: number
  carriedOverDate: string | null
  paidCents: number
  amortizedCents: number
  remainingCents: number
  /** Amortisierter Anteil, 0 bis 1. null, wenn nichts zu amortisieren ist. */
  ratio: number | null
  /** Jahre bis zum Ende bei der geplanten Rate, mit Nachkommastellen. */
  yearsLeft: number | null
  /** Das Jahr der voraussichtlich letzten Tranche. */
  endYear: number | null
  /** Jüngstes zuerst. */
  years: AmortizationYear[]
}

export function summarizeAmortization(daten: HypothekDaten, today: string): AmortizationSummary {
  const { settings } = daten
  const plan = settings.amortizationPerYearCents
  const heute = parseDay(today).year
  const zweite = Math.max(0, settings.mortgageTotalCents - settings.firstMortgageCents)

  const nachJahr = new Map<number, AmortizationPayment[]>()
  for (const payment of daten.amortizations) {
    nachJahr.set(payment.year, [...(nachJahr.get(payment.year) ?? []), payment])
  }
  for (const liste of nachJahr.values()) {
    liste.sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.localeCompare(b.createdAt))
  }

  // Die einzelnen Jahre beginnen nach dem Übertrag – was davor lag, steckt
  // in ihm.
  const zahlungsjahre = [...nachJahr.keys()]
  const ersterNachUebertrag =
    settings.carriedOverDate !== null ? parseDay(addDays(settings.carriedOverDate, 1)).year : null
  const erstes = ersterNachUebertrag ?? (zahlungsjahre.length > 0 ? Math.min(...zahlungsjahre) : heute)
  const letztes = Math.max(heute, erstes, ...zahlungsjahre)
  const jahre = new Set<number>(zahlungsjahre)
  for (let year = erstes; year <= letztes; year += 1) jahre.add(year)

  let bisher = settings.carriedOverCents
  const years: AmortizationYear[] = [...jahre]
    .sort((a, b) => a - b)
    .map((year) => {
      const payments = nachJahr.get(year) ?? []
      const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
      const targetCents = Math.min(plan, Math.max(0, zweite - bisher))
      bisher += paidCents
      return {
        year,
        targetCents,
        paidCents,
        openCents: Math.max(0, targetCents - paidCents),
        payments,
      }
    })

  const paidCents = daten.amortizations.reduce((sum, payment) => sum + payment.amountCents, 0)
  const amortizedCents = settings.carriedOverCents + paidCents
  const remainingCents = Math.max(0, zweite - amortizedCents)

  let endYear: number | null = null
  if (zweite > 0 && remainingCents === 0) {
    // Fertig: das Jahr der letzten Tranche, sonst das des Übertrags.
    const mitZahlung = years.filter((year) => year.paidCents > 0).map((year) => year.year)
    endYear =
      mitZahlung.length > 0
        ? Math.max(...mitZahlung)
        : settings.carriedOverDate !== null
          ? parseDay(settings.carriedOverDate).year
          : null
  } else if (remainingCents > 0 && plan > 0) {
    const ab = Math.max(heute, erstes)
    const diesesJahr = years.find((year) => year.year === ab)
    const offenDiesesJahr = diesesJahr ? diesesJahr.openCents : Math.min(plan, remainingCents)
    const rest = remainingCents - offenDiesesJahr
    endYear = rest <= 0 ? ab : ab + Math.ceil(rest / plan)
  }

  return {
    secondMortgageCents: zweite,
    carriedOverCents: settings.carriedOverCents,
    carriedOverDate: settings.carriedOverDate,
    paidCents,
    amortizedCents,
    remainingCents,
    ratio: zweite > 0 ? Math.min(1, amortizedCents / zweite) : null,
    yearsLeft: plan > 0 && remainingCents > 0 ? remainingCents / plan : null,
    endYear,
    years: years.reverse(),
  }
}

// ----------------------------------------------------------------- Jahre

export interface MortgageYear {
  year: number
  quarters: QuarterRow[]
  /** Die Summe dessen, was an Zinsen erfasst ist. */
  interestPaidCents: number
  /** Erfasstes plus Prognose für den Rest – was das Jahr voraussichtlich kostet. */
  interestExpectedCents: number
  quartersComplete: number
  quartersTotal: number
  amortization: AmortizationYear | null
}

/** Je Jahr Zinsen und Amortisation – jüngstes zuerst. */
export function mortgageYears(
  quarters: readonly QuarterRow[],
  amortization: AmortizationSummary,
): MortgageYear[] {
  const jahre = new Set<number>([
    ...quarters.map((row) => row.year),
    ...amortization.years.filter((year) => year.paidCents > 0 || year.targetCents > 0).map((year) => year.year),
  ])

  return [...jahre]
    .sort((a, b) => b - a)
    .map((year) => {
      const darin = quarters.filter((row) => row.year === year)
      return {
        year,
        quarters: darin,
        interestPaidCents: darin.reduce((sum, row) => sum + (row.actualCents ?? 0), 0),
        interestExpectedCents: darin.reduce((sum, row) => sum + row.expectedCents, 0),
        quartersComplete: darin.filter((row) => row.complete).length,
        quartersTotal: darin.length,
        amortization: amortization.years.find((entry) => entry.year === year) ?? null,
      }
    })
}

/**
 * Der Zinssatz, den ein bezahlter Betrag bedeutet: Quartalszins mal vier,
 * geteilt durch den Betrag der Hypothek – in Tausendstelprozent.
 *
 * Bei der SARON-Hypothek die einzige Stelle, an der sich ablesen lässt, wie
 * der Zins tatsächlich gewandert ist; die Grunddaten kennen nur den heutigen.
 */
export function impliedRateMillipercent(amountCents: number, quarterCents: number): number | null {
  if (amountCents <= 0) return null
  return (quarterCents * 4 * 100 * MILLIPERCENT) / amountCents
}

/**
 * Der Farbplatz jeder Hypothek, ab 0.
 *
 * Vergeben wie Plätze an einem Tisch: Wer gleichzeitig läuft, sitzt auf
 * verschiedenen Plätzen, und wer ausläuft, gibt seinen frei – die
 * Anschlusshypothek setzt sich darauf. So kommen in einem Quartal nie mehr
 * Farben zusammen, als Hypotheken gleichzeitig laufen, und die ersten Plätze
 * der Palette sind die, die sich auch nebeneinander sicher unterscheiden.
 */
export function loanSlots(loans: readonly MortgageLoan[]): Map<string, number> {
  const sortiert = [...loans].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name),
  )
  const plaetze = new Map<string, number>()
  const belegt: { ende: string | null; platz: number }[] = []

  for (const loan of sortiert) {
    const besetzt = new Set(
      belegt.filter((eintrag) => eintrag.ende === null || eintrag.ende >= loan.startDate).map((eintrag) => eintrag.platz),
    )
    let platz = 0
    while (besetzt.has(platz)) platz += 1
    plaetze.set(loan.id, platz)
    belegt.push({ ende: loan.endDate, platz })
  }
  return plaetze
}

import { z } from 'zod'

/**
 * Der Bereich Strom: Rechnungen des Energieversorgers, ausgelesen aus dem PDF,
 * und alles, was sich daraus über den Verbrauch des Hauses sagen lässt.
 *
 * Beträge stehen wie überall in der App als ganze Rappen in `…Cents`. Mengen
 * (kWh) sind ganze Zahlen – die Rechnung weist sie nie feiner aus. Ansätze
 * haben zwei Nachkommastellen ("18.50 Rp./kWh") und liegen deshalb als
 * Hundertstel vor: 18.50 → 1850. Prozentsätze stehen als Basispunkte, damit
 * 8.10 % (810) und 2.60 % (260) exakt bleiben und nicht als 0.081 herumliegen.
 */

// ------------------------------------------------------------------ Begriffe

export const BILL_KINDS = ['abrechnung', 'akonto'] as const
export type BillKind = (typeof BILL_KINDS)[number]

export const BILL_KIND_LABELS: Record<BillKind, string> = {
  abrechnung: 'Abrechnung',
  akonto: 'Akontorechnung',
}

/**
 * Die drei Blöcke, in die der Versorger jede Stromrechnung teilt. Sie stehen
 * so auf dem Papier, und weil sich an ihnen ablesen lässt, woher eine
 * Verteuerung kommt, sind sie hier fest verdrahtet statt frei benannt: Steigt
 * der Netzanteil, hilft kein Sparen an der Energie.
 */
export const COST_GROUPS = ['energie', 'netznutzung', 'abgaben'] as const
export type CostGroup = (typeof COST_GROUPS)[number]

export const COST_GROUP_LABELS: Record<CostGroup, string> = {
  energie: 'Energie',
  netznutzung: 'Netznutzung',
  abgaben: 'Abgaben & Förderbeiträge',
}

/** Kurzform für enge Stellen – Diagrammlegende, Tabellenkopf. */
export const COST_GROUP_SHORT: Record<CostGroup, string> = {
  energie: 'Energie',
  netznutzung: 'Netz',
  abgaben: 'Abgaben',
}

export const TARIFFS = ['hoch', 'nieder'] as const
export type Tariff = (typeof TARIFFS)[number]

export const TARIFF_LABELS: Record<Tariff, string> = {
  hoch: 'Hochtarif',
  nieder: 'Niedertarif',
}

// ------------------------------------------------------------------ Schemas

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')

/**
 * Eine Zeile aus der Betragsermittlung, so wie sie auf der Rechnung steht.
 *
 * Bewusst als Rohabbild und nicht als gerechnetes Ergebnis: Was der Versorger
 * verrechnet hat, soll später nachlesbar bleiben, auch wenn sich die Auswertung
 * einmal ändert. Die Kennzahlen entstehen daraus, nie umgekehrt.
 */
export const billPositionSchema = z.object({
  group: z.enum(COST_GROUPS),
  label: z.string().trim().min(1).max(120),
  /** Menge in der Einheit der Zeile – 3286 kWh, 1 Grundpreis, 133 m³. */
  quantity: z.number().min(0).max(10_000_000),
  unit: z.string().trim().max(12).default('kWh'),
  /** Ansatz mal 100: „18.50 Rp." → 1850. null, wenn die Zeile keinen ausweist. */
  rateHundredths: z.number().int().min(0).max(100_000_000).nullable().default(null),
  /** 'Rp.' oder 'Fr.' – ohne die Einheit ist der Ansatz um Faktor 100 daneben. */
  rateUnit: z.string().trim().max(6).nullable().default(null),
  /** „6 Mt." beim Grundpreis. null bei mengenabhängigen Zeilen. */
  durationMonths: z.number().int().min(0).max(120).nullable().default(null),
  /** MWST-Satz in Basispunkten: 8.10 % → 810. */
  vatBasisPoints: z.number().int().min(0).max(10_000).default(0),
  netCents: z.number().int().min(0).max(100_000_000),
  grossCents: z.number().int().min(0).max(100_000_000),
})

export type BillPosition = z.infer<typeof billPositionSchema>

/**
 * Der Zählerstand am Anfang und am Ende der Periode, je Tarif.
 *
 * Steht getrennt vom Verbrauch, obwohl sich der eine aus dem anderen ergibt:
 * Der Zählerstand ist die einzige Zahl, die man am Gerät selbst nachprüfen
 * kann. Wer wissen will, ob eine Rechnung stimmt, schaut dort nach – und nicht
 * auf eine Differenz, die die App gebildet hat.
 */
export const meterReadingSchema = z.object({
  tariff: z.enum(TARIFFS),
  /** Stand alt / Stand neu, wie auf der Rechnung. */
  startValue: z.number().int().min(0).max(100_000_000).nullable().default(null),
  endValue: z.number().int().min(0).max(100_000_000).nullable().default(null),
  /** Ausgewiesene Menge. Kann von der Differenz abweichen (Zählerwechsel). */
  kwh: z.number().int().min(0).max(10_000_000),
})

export type MeterReading = z.infer<typeof meterReadingSchema>

/**
 * Was aus einer Rechnung übernommen wird.
 *
 * Dasselbe Schema für den Import und für die Eingabe von Hand: Die Vorschau
 * nach dem Auslesen ist ein ausgefülltes Formular, kein Bericht. Was der
 * Automat falsch gelesen hat, wird an Ort und Stelle korrigiert, statt später
 * in einem zweiten Bildschirm.
 */
export const billInputSchema = z
  .object({
    kind: z.enum(BILL_KINDS),
    /** Die Nummer auf der Rechnung – sie macht jede Rechnung unverwechselbar. */
    invoiceNumber: z.string().trim().min(1).max(40),
    invoiceDate: isoDate,
    periodStart: isoDate,
    periodEnd: isoDate,
    customerNumber: z.string().trim().max(40).nullable().default(null),
    meterPoint: z.string().trim().max(60).nullable().default(null),
    meterNumber: z.string().trim().max(40).nullable().default(null),

    readings: z.array(meterReadingSchema).max(4).default([]),
    positions: z.array(billPositionSchema).max(40).default([]),

    energyCents: z.number().int().min(0).max(100_000_000),
    gridCents: z.number().int().min(0).max(100_000_000),
    leviesCents: z.number().int().min(0).max(100_000_000),
    /**
     * Zwischentotal – die Kosten der Periode, vor dem Akontoabzug.
     *
     * Das ist die Zahl, mit der gerechnet wird. Der Rechnungsbetrag darunter
     * sagt nur, wie viel davon noch offen war; wer den Strompreis daraus
     * ableitet, misst seine Abschlagszahlungen und nicht seinen Strom.
     */
    subtotalCents: z.number().int().min(0).max(100_000_000),
    /** Bereits bezahlte Akontobeträge, positiv. 0 wenn keine abgezogen wurden. */
    prepaidCents: z.number().int().min(0).max(100_000_000).default(0),
    /** Rechnungsbetrag inkl. MWST – was tatsächlich zu überweisen war. */
    totalCents: z.number().int().min(0).max(100_000_000),
    vatCents: z.number().int().min(0).max(100_000_000).default(0),

    /** Dateiname des importierten PDFs, damit die Herkunft nachvollziehbar ist. */
    sourceFile: z.string().trim().max(200).nullable().default(null),
    note: z.string().trim().max(500).default(''),
  })
  .refine((bill) => bill.periodEnd >= bill.periodStart, {
    message: 'Das Ende der Periode liegt vor ihrem Anfang',
    path: ['periodEnd'],
  })

export type BillInput = z.infer<typeof billInputSchema>

export interface ElectricityBill extends BillInput {
  id: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

// -------------------------------------------------------------- Import-Antwort

/**
 * Was beim Auslesen eines PDFs herauskommt.
 *
 * Das Ergebnis wird nicht gespeichert, sondern zurückgegeben: Erst wenn die
 * Vorschau bestätigt ist, entsteht eine Rechnung. Ein Automat, der still
 * Datensätze anlegt, ist beim ersten unbekannten Rechnungsaufbau nicht mehr
 * einzufangen.
 */
export interface ImportResult {
  /** Was gelesen wurde – null, wenn das PDF keine Stromrechnung ist. */
  bill: BillInput | null
  /**
   * Meldungen an den Menschen davor: Fehlendes, Unstimmiges, Übersprungenes.
   * Leer heisst „sauber gelesen".
   */
  hinweise: string[]
  /** Existiert diese Rechnungsnummer schon, ist es ein zweiter Anlauf. */
  bereitsVorhanden: boolean
}

// --------------------------------------------------------------- Kennzahlen

/** Tage einer Periode, beide Enden mitgezählt: 1.–31.1. sind 31 Tage. */
export function periodDays(periodStart: string, periodEnd: string): number {
  const start = Date.parse(`${periodStart}T00:00:00Z`)
  const end = Date.parse(`${periodEnd}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.round((end - start) / 86_400_000) + 1
}

/**
 * Das Jahr, dem eine Rechnung zugeschlagen wird: das der Periodenmitte.
 *
 * Nicht das Rechnungsdatum – die Abrechnung für das zweite Halbjahr 2024
 * kommt im Januar 2025 und gehört trotzdem zu 2024. Und nicht der Anfang der
 * Periode, weil eine über den Jahreswechsel laufende Periode sonst allein am
 * ersten Tag hinge.
 */
export function billYear(bill: Pick<BillInput, 'periodStart' | 'periodEnd'>): number {
  const start = Date.parse(`${bill.periodStart}T00:00:00Z`)
  const end = Date.parse(`${bill.periodEnd}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return new Date((start + end) / 2).getUTCFullYear()
}

export interface BillFigures {
  bill: ElectricityBill
  /** Länge der Periode in Tagen – die Grundlage jedes fairen Vergleichs. */
  days: number

  /** Verbrauch je Tarif und gesamt. null bei Akontorechnungen. */
  highKwh: number | null
  lowKwh: number | null
  totalKwh: number | null
  /** Anteil Hochtarif am Verbrauch, 0–1. */
  highShare: number | null

  /** Kosten der Periode, aufgeteilt – ohne den Akontoabzug. */
  energyCents: number
  gridCents: number
  leviesCents: number
  periodCostCents: number

  /**
   * Der Preis, um den es geht: Kosten der Periode je Kilowattstunde, in
   * Hundertstelrappen. 39.66 Rp./kWh → 3966.
   */
  pricePerKwhHundredths: number | null

  kwhPerDay: number | null
  costPerDayCents: number

  /** Auf ein Jahr hochgerechnet – macht Halbjahre und Quartale vergleichbar. */
  annualKwh: number | null
  annualCostCents: number
}

/** Rechnet eine einzelne Rechnung durch. */
export function computeBillFigures(bill: ElectricityBill): BillFigures {
  const days = periodDays(bill.periodStart, bill.periodEnd)
  const { highKwh, lowKwh } = tariffKwh(bill)
  const totalKwh = highKwh === null && lowKwh === null ? null : (highKwh ?? 0) + (lowKwh ?? 0)

  const periodCostCents = bill.subtotalCents

  return {
    bill,
    days,
    highKwh,
    lowKwh,
    totalKwh,
    highShare: totalKwh && totalKwh > 0 ? (highKwh ?? 0) / totalKwh : null,
    energyCents: bill.energyCents,
    gridCents: bill.gridCents,
    leviesCents: bill.leviesCents,
    periodCostCents,
    pricePerKwhHundredths:
      totalKwh && totalKwh > 0 ? Math.round((periodCostCents * 100) / totalKwh) : null,
    kwhPerDay: totalKwh !== null && days > 0 ? totalKwh / days : null,
    costPerDayCents: days > 0 ? Math.round(periodCostCents / days) : 0,
    annualKwh: totalKwh !== null && days > 0 ? Math.round((totalKwh * 365) / days) : null,
    annualCostCents: days > 0 ? Math.round((periodCostCents * 365) / days) : 0,
  }
}

/**
 * Verbrauch je Tarif.
 *
 * Zuerst aus den Zählerablesungen, weil dort der Verbrauch selbst steht. Fehlt
 * die Ablesung – bei Akontorechnungen gibt es keine –, wird ersatzweise die
 * Menge der Energie-Positionen genommen: Auch daraus geht hervor, wie viele
 * Kilowattstunden verrechnet wurden.
 */
function tariffKwh(bill: BillInput): { highKwh: number | null; lowKwh: number | null } {
  let high: number | null = null
  let low: number | null = null

  for (const reading of bill.readings) {
    if (reading.tariff === 'hoch') high = (high ?? 0) + reading.kwh
    else low = (low ?? 0) + reading.kwh
  }
  if (high !== null || low !== null) return { highKwh: high, lowKwh: low }

  for (const position of bill.positions) {
    if (position.group !== 'energie' || position.unit !== 'kWh') continue
    const label = position.label.toLowerCase()
    if (label.includes('hochtarif')) high = (high ?? 0) + Math.round(position.quantity)
    else if (label.includes('niedertarif')) low = (low ?? 0) + Math.round(position.quantity)
  }
  return { highKwh: high, lowKwh: low }
}

// --------------------------------------------------------------- Entwicklung

export type Direction = 'steigend' | 'sinkend' | 'gleich'

export interface Trend {
  /** Veränderung als Anteil: 0.052 heisst „5.2 % mehr". null ohne Vergleichswert. */
  ratio: number | null
  direction: Direction
  /** Absolute Veränderung in der Einheit der verglichenen Werte. */
  delta: number | null
}

/**
 * Vergleicht zwei Werte.
 *
 * Unter einem halben Prozent gilt als „gleich": Zwei Perioden sind nie exakt
 * gleich lang, und ein Pfeil, der bei 0.2 % Unterschied nach oben zeigt,
 * behauptet mehr als er weiss.
 */
export function trendBetween(current: number | null, previous: number | null): Trend {
  if (current === null || previous === null || previous === 0) {
    return { ratio: null, direction: 'gleich', delta: null }
  }
  const delta = current - previous
  const ratio = delta / Math.abs(previous)
  return {
    ratio,
    delta,
    direction: Math.abs(ratio) < 0.005 ? 'gleich' : ratio > 0 ? 'steigend' : 'sinkend',
  }
}

/**
 * Sucht zur Rechnung die entsprechende des Vorjahres.
 *
 * Verglichen wird über den Anfang der Periode, mit einem Fenster von 45 Tagen:
 * Die Ablesung findet nicht jedes Jahr am selben Tag statt, und ein Vergleich,
 * der bei drei Wochen Abweichung aufgibt, ist keiner. Ein Winterhalbjahr wird
 * so nie versehentlich mit einem Sommerhalbjahr verglichen.
 */
export function findPreviousYearBill(
  bills: readonly BillFigures[],
  bill: BillFigures,
): BillFigures | null {
  const target = Date.parse(`${bill.bill.periodStart}T00:00:00Z`)
  if (!Number.isFinite(target)) return null
  const wanted = target - 365 * 86_400_000

  let best: BillFigures | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of bills) {
    if (candidate.bill.id === bill.bill.id) continue
    if (candidate.bill.kind !== bill.bill.kind) continue
    const start = Date.parse(`${candidate.bill.periodStart}T00:00:00Z`)
    if (!Number.isFinite(start)) continue

    const distance = Math.abs(start - wanted)
    if (distance <= 45 * 86_400_000 && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

// ----------------------------------------------------------------- Auswertung

export interface PeriodSummary {
  /** Wie viele Abrechnungen in die Summe eingeflossen sind. */
  billCount: number
  days: number

  totalKwh: number | null
  highKwh: number | null
  lowKwh: number | null
  highShare: number | null

  energyCents: number
  gridCents: number
  leviesCents: number
  totalCostCents: number

  /** Ø Preis über alle einbezogenen Rechnungen, in Hundertstelrappen. */
  pricePerKwhHundredths: number | null
  kwhPerDay: number | null
  costPerDayCents: number | null
  annualKwh: number | null
  annualCostCents: number | null
}

export const EMPTY_SUMMARY: PeriodSummary = {
  billCount: 0,
  days: 0,
  totalKwh: null,
  highKwh: null,
  lowKwh: null,
  highShare: null,
  energyCents: 0,
  gridCents: 0,
  leviesCents: 0,
  totalCostCents: 0,
  pricePerKwhHundredths: null,
  kwhPerDay: null,
  costPerDayCents: null,
  annualKwh: null,
  annualCostCents: null,
}

/**
 * Fasst mehrere Abrechnungen zu einer Periode zusammen.
 *
 * Der Ø Preis wird aus den Summen gebildet und nicht als Mittel der einzelnen
 * Preise: Ein Halbjahr mit wenig Verbrauch soll den Jahresschnitt nicht
 * gleich stark ziehen wie eines mit viel. Das ist derselbe Preis, den man
 * erhielte, wenn der Versorger einmal jährlich abrechnete.
 */
export function summarize(figures: readonly BillFigures[]): PeriodSummary {
  if (figures.length === 0) return { ...EMPTY_SUMMARY }

  let days = 0
  let high: number | null = null
  let low: number | null = null
  let energyCents = 0
  let gridCents = 0
  let leviesCents = 0
  let totalCostCents = 0

  for (const entry of figures) {
    days += entry.days
    if (entry.highKwh !== null) high = (high ?? 0) + entry.highKwh
    if (entry.lowKwh !== null) low = (low ?? 0) + entry.lowKwh
    energyCents += entry.energyCents
    gridCents += entry.gridCents
    leviesCents += entry.leviesCents
    totalCostCents += entry.periodCostCents
  }

  const totalKwh = high === null && low === null ? null : (high ?? 0) + (low ?? 0)

  return {
    billCount: figures.length,
    days,
    totalKwh,
    highKwh: high,
    lowKwh: low,
    highShare: totalKwh && totalKwh > 0 ? (high ?? 0) / totalKwh : null,
    energyCents,
    gridCents,
    leviesCents,
    totalCostCents,
    pricePerKwhHundredths:
      totalKwh && totalKwh > 0 ? Math.round((totalCostCents * 100) / totalKwh) : null,
    kwhPerDay: totalKwh !== null && days > 0 ? totalKwh / days : null,
    costPerDayCents: days > 0 ? Math.round(totalCostCents / days) : null,
    annualKwh: totalKwh !== null && days > 0 ? Math.round((totalKwh * 365) / days) : null,
    annualCostCents: days > 0 ? Math.round((totalCostCents * 365) / days) : null,
  }
}

export interface StromAnalysis {
  /** Alle Abrechnungen, aufsteigend nach Periodenanfang. */
  abrechnungen: BillFigures[]
  /** Akontorechnungen, aufsteigend – sie tragen keinen Verbrauch. */
  akonto: BillFigures[]
  /** Die Jahre, für die etwas vorliegt, absteigend. */
  years: number[]
}

/**
 * Sortiert und trennt, was der Server geliefert hat.
 *
 * Akontorechnungen stehen bewusst neben und nicht in der Auswertung: Sie sind
 * Vorauszahlungen auf denselben Strom und würden jede Summe verdoppeln. Für
 * die Frage „habe ich zu viel oder zu wenig vorausbezahlt?" bleiben sie
 * greifbar.
 */
export function analyse(bills: readonly ElectricityBill[]): StromAnalysis {
  const sorted = [...bills].sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  const figures = sorted.map(computeBillFigures)

  const years = new Set<number>()
  for (const entry of figures) years.add(billYear(entry.bill))

  return {
    abrechnungen: figures.filter((entry) => entry.bill.kind === 'abrechnung'),
    akonto: figures.filter((entry) => entry.bill.kind === 'akonto'),
    years: [...years].sort((a, b) => b - a),
  }
}

// ------------------------------------------------------------- Darstellung

/** „39.66" aus 3966 – der Ø Preis, wie er auf dem Bildschirm steht. */
export function formatRappen(hundredths: number | null): string {
  if (hundredths === null) return '–'
  return (hundredths / 100).toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** „5'451" – Mengen ohne Nachkommastellen, mit Schweizer Tausendertrennung. */
export function formatKwh(kwh: number | null, fractionDigits = 0): string {
  if (kwh === null) return '–'
  return kwh.toLocaleString('de-CH', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/** „+5.2 %" / „−3.0 %" – mit echtem Minuszeichen, weil es besser trägt. */
export function formatPercentChange(ratio: number | null): string {
  if (ratio === null) return '–'
  const percent = ratio * 100
  const rounded = Math.abs(percent) < 10 ? percent.toFixed(1) : percent.toFixed(0)
  if (percent > 0) return `+${rounded} %`
  return `${rounded.replace('-', '−')} %`
}

/** „01.07.2024 – 31.12.2024" für Listen und Kopfzeilen. */
export function formatPeriod(periodStart: string, periodEnd: string): string {
  return `${formatDate(periodStart)} – ${formatDate(periodEnd)}`
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}.${month}.${year}`
}

/**
 * Kurzform einer Periode für die Achse eines Diagramms: „H2 24".
 *
 * Auf einem Handy ist unter einer Säule Platz für rund sechs Zeichen. Halbjahr
 * und Quartal decken ab, wie dieser Versorger abrechnet; alles andere fällt
 * auf Monat und Jahr zurück, statt abgeschnitten zu werden.
 */
export function shortPeriodLabel(periodStart: string, periodEnd: string): string {
  const start = new Date(`${periodStart}T00:00:00Z`)
  const end = new Date(`${periodEnd}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return periodStart

  const year = String(end.getUTCFullYear()).slice(2)
  const months = periodDays(periodStart, periodEnd) / 30.4

  if (months > 4.5 && months < 7.5) {
    return `${start.getUTCMonth() < 6 ? 'H1' : 'H2'} ${year}`
  }
  if (months > 1.5 && months < 4.5) {
    return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${year}`
  }
  if (months >= 10) return `${end.getUTCFullYear()}`
  return `${String(start.getUTCMonth() + 1).padStart(2, '0')}.${year}`
}

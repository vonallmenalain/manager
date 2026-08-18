import { z } from 'zod'

/**
 * Der Bereich Haus: die Rechnungen der Energie- und Wasserversorgung und
 * alles, was sich daraus über Verbrauch und Kosten des Hauses sagen lässt.
 *
 * Der Versorger stellt zwei Arten von Rechnungen: eine für den Strom und eine
 * für Wasser, Abwasser und Kehricht zusammen. Die zweite trägt also drei
 * Sparten auf einem Beleg – mit eigener Ablesung, eigenen Positionen und
 * eigenem Total je Sparte, aber einem gemeinsamen Akontoabzug und einem
 * gemeinsamen Rechnungsbetrag.
 *
 * Deshalb ist die Rechnung hier der Beleg und die Sparte die Auswertungseinheit:
 * Wer nur das Abwasser anschauen will, bekommt dessen Zeilen; wer wissen will,
 * was überwiesen wurde, bekommt die Rechnung. Beides aus derselben Zeile zu
 * lesen ginge nicht, ohne eine der beiden Fragen falsch zu beantworten.
 *
 * Beträge stehen wie überall in der App als ganze Rappen in `…Cents`. Mengen
 * (kWh, m³) sind ganze Zahlen – die Rechnung weist sie nie feiner aus. Ansätze
 * haben zwei Nachkommastellen ("18.50 Rp./kWh") und liegen deshalb als
 * Hundertstel vor: 18.50 → 1850. Prozentsätze stehen als Basispunkte, damit
 * 8.10 % (810) und 2.60 % (260) exakt bleiben.
 */

// ------------------------------------------------------------------ Sparten

export const DIVISIONS = ['strom', 'wasser', 'abwasser', 'kehricht'] as const
export type Division = (typeof DIVISIONS)[number]

export const DIVISION_LABELS: Record<Division, string> = {
  strom: 'Strom',
  wasser: 'Wasser',
  abwasser: 'Abwasser',
  kehricht: 'Kehricht',
}

/**
 * Worin eine Sparte gemessen wird – oder null, wenn sie gar nichts misst.
 *
 * Der Kehricht wird pauschal verrechnet: eine Gebühr je Wohnung und Jahr, ohne
 * Menge. Ein erfundener Verbrauch von 1 wäre keine Angabe, sondern eine
 * Behauptung, und ein Preis „je Stück" beantwortete keine Frage.
 */
export const DIVISION_UNITS: Record<Division, string | null> = {
  strom: 'kWh',
  wasser: 'm³',
  abwasser: 'm³',
  kehricht: null,
}

/**
 * Wie die Sparte auf dem Beleg heisst.
 *
 * Der Versorger überschreibt die Blöcke mit „Elektrizität" beziehungsweise
 * „Wasser", „Abwasser" und „Kehricht"; die Summenzeilen darunter lauten
 * „Total Wasser" und so fort. Beides führt hierher.
 */
export const DIVISION_KEYWORDS: Record<Division, readonly string[]> = {
  strom: ['elektrizität', 'elektrizitaet', 'strom'],
  wasser: ['wasser'],
  abwasser: ['abwasser'],
  kehricht: ['kehricht'],
}

/**
 * Die drei Blöcke, in die der Versorger den Strom teilt.
 *
 * Nur beim Strom: Wasser, Abwasser und Kehricht kennen keine solche
 * Unterteilung, dort ist die Sparte selbst schon der Block. An ihnen lässt
 * sich ablesen, woher eine Verteuerung kommt – steigt der Netzanteil, hilft
 * kein Sparen an der Energie.
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

export const BILL_KINDS = ['abrechnung', 'akonto'] as const
export type BillKind = (typeof BILL_KINDS)[number]

export const BILL_KIND_LABELS: Record<BillKind, string> = {
  abrechnung: 'Abrechnung',
  akonto: 'Akontorechnung',
}

/**
 * Der Tarif einer Ablesung. `einzel` steht für alles, was nur einen Zähler
 * hat – Wasser kennt keinen Hoch- und Niedertarif.
 */
export const TARIFFS = ['hoch', 'nieder', 'einzel'] as const
export type Tariff = (typeof TARIFFS)[number]

export const TARIFF_LABELS: Record<Tariff, string> = {
  hoch: 'Hochtarif',
  nieder: 'Niedertarif',
  einzel: 'Verbrauch',
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
  /** Nur beim Strom gesetzt – sonst ist die Sparte selbst schon der Block. */
  group: z.enum(COST_GROUPS).nullable().default(null),
  label: z.string().trim().min(1).max(120),
  /** Menge in der Einheit der Zeile – 3286 kWh, 133 m², 1 Grundgebühr. */
  quantity: z.number().min(0).max(10_000_000),
  unit: z.string().trim().max(12).default(''),
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
 * Eine Zählerablesung.
 *
 * Steht getrennt von den Beträgen, obwohl sich der eine aus dem anderen
 * ergibt: Der Zählerstand ist die einzige Zahl, die man am Gerät selbst
 * nachprüfen kann. Wer wissen will, ob eine Rechnung stimmt, schaut dort nach
 * – und nicht auf eine Differenz, die die App gebildet hat.
 */
export const meterReadingSchema = z.object({
  tariff: z.enum(TARIFFS).default('einzel'),
  /** Wie die Zeile auf der Rechnung heisst: „Wirkstrom Hochtarif", „Wasserverbrauch". */
  label: z.string().trim().max(80).default(''),
  unit: z.string().trim().max(12).default(''),
  /** Stand alt / Stand neu, wie auf der Rechnung. */
  startValue: z.number().int().min(0).max(100_000_000).nullable().default(null),
  endValue: z.number().int().min(0).max(100_000_000).nullable().default(null),
  /** Ausgewiesene Menge. Kann von der Differenz abweichen (Zählerwechsel). */
  quantity: z.number().int().min(0).max(10_000_000),
})

export type MeterReading = z.infer<typeof meterReadingSchema>

/** Eine der drei Stromsummen – Energie, Netznutzung, gesetzliche Abgaben. */
export const costGroupTotalSchema = z.object({
  group: z.enum(COST_GROUPS),
  amountCents: z.number().int().min(0).max(100_000_000),
})

export type CostGroupTotal = z.infer<typeof costGroupTotalSchema>

/**
 * Eine Sparte auf einer Rechnung – der Teil, um den es beim Auswerten geht.
 */
export const billSectionSchema = z.object({
  division: z.enum(DIVISIONS),
  /** Total dieser Sparte inkl. MWST, wie es auf der ersten Seite steht. */
  amountCents: z.number().int().min(0).max(100_000_000),
  /** Nur beim Strom gefüllt. */
  groups: z.array(costGroupTotalSchema).max(6).default([]),
  readings: z.array(meterReadingSchema).max(6).default([]),
  positions: z.array(billPositionSchema).max(40).default([]),
  meterPoint: z.string().trim().max(60).nullable().default(null),
  meterNumber: z.string().trim().max(40).nullable().default(null),
})

export type BillSection = z.infer<typeof billSectionSchema>

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

    sections: z.array(billSectionSchema).min(1).max(6),

    /**
     * Zwischentotal – die Kosten der Periode, vor dem Akontoabzug.
     *
     * Das ist die Zahl, mit der gerechnet wird. Der Rechnungsbetrag darunter
     * sagt nur, wie viel davon noch offen war; wer den Preis daraus ableitet,
     * misst seine Abschlagszahlungen und nicht seinen Verbrauch.
     */
    subtotalCents: z.number().int().min(0).max(100_000_000),
    /** Bereits bezahlte Akontobeträge, positiv. 0 wenn keine abgezogen wurden. */
    prepaidCents: z.number().int().min(0).max(100_000_000).default(0),
    /** Rechnungsbetrag inkl. MWST – was tatsächlich zu überweisen war. */
    totalCents: z.number().int().min(0).max(100_000_000),
    vatCents: z.number().int().min(0).max(100_000_000).default(0),

    /** Das abgelegte PDF in den Dokumenten, sofern eines mitkam. */
    documentId: z.string().trim().max(60).nullable().default(null),
    /** Dateiname des importierten PDFs, damit die Herkunft nachvollziehbar ist. */
    sourceFile: z.string().trim().max(200).nullable().default(null),
    note: z.string().trim().max(500).default(''),
  })
  .refine((bill) => bill.periodEnd >= bill.periodStart, {
    message: 'Das Ende der Periode liegt vor ihrem Anfang',
    path: ['periodEnd'],
  })

export type BillInput = z.infer<typeof billInputSchema>

export interface UtilityBill extends BillInput {
  id: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** Welche Sparten eine Rechnung überhaupt enthält, in fester Reihenfolge. */
export function divisionsOf(bill: Pick<BillInput, 'sections'>): Division[] {
  const vorhanden = new Set(bill.sections.map((section) => section.division))
  return DIVISIONS.filter((division) => vorhanden.has(division))
}

/** „Strom" oder „Wasser · Abwasser · Kehricht" – der Betreff einer Rechnung. */
export function billSubject(bill: Pick<BillInput, 'sections'>): string {
  const divisions = divisionsOf(bill)
  if (divisions.length === 0) return 'Rechnung'
  return divisions.map((division) => DIVISION_LABELS[division]).join(' · ')
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
  /** Was gelesen wurde – null, wenn das PDF keine Rechnung dieser Art ist. */
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

/**
 * Eine Sparte einer Rechnung, durchgerechnet – die Einheit, aus der jede
 * Auswertung besteht.
 */
export interface DivisionEntry {
  /** Eindeutig über beide: Eine Rechnung trägt jede Sparte höchstens einmal. */
  id: string
  bill: UtilityBill
  section: BillSection
  division: Division

  /** Länge der Periode in Tagen – die Grundlage jedes fairen Vergleichs. */
  days: number

  /** Verbrauch in der Einheit der Sparte. null, wo nichts gemessen wird. */
  quantity: number | null
  unit: string | null
  /** Nur beim Strom: die beiden Tarife. */
  highQuantity: number | null
  lowQuantity: number | null

  /** Kosten dieser Sparte in der Periode. */
  costCents: number
  /** Nur beim Strom: die drei Blöcke. */
  energyCents: number | null
  gridCents: number | null
  leviesCents: number | null

  /**
   * Der Preis, um den es geht: Kosten je Einheit, in Hundertstelrappen.
   * 39.66 Rp./kWh → 3966. null, wo nichts gemessen wird.
   */
  pricePerUnitHundredths: number | null
  quantityPerDay: number | null
  costPerDayCents: number
  /** Auf ein Jahr hochgerechnet – macht Halbjahre und Jahre vergleichbar. */
  annualQuantity: number | null
  annualCostCents: number
}

/** Rechnet eine Sparte einer Rechnung durch. */
export function computeDivisionEntry(bill: UtilityBill, section: BillSection): DivisionEntry {
  const days = periodDays(bill.periodStart, bill.periodEnd)
  const { high, low, total } = sectionQuantity(section)
  const costCents = section.amountCents

  const gruppe = (group: CostGroup): number | null => {
    if (section.division !== 'strom') return null
    return section.groups.find((entry) => entry.group === group)?.amountCents ?? 0
  }

  return {
    id: `${bill.id}:${section.division}`,
    bill,
    section,
    division: section.division,
    days,
    quantity: total,
    unit: DIVISION_UNITS[section.division],
    highQuantity: high,
    lowQuantity: low,
    costCents,
    energyCents: gruppe('energie'),
    gridCents: gruppe('netznutzung'),
    leviesCents: gruppe('abgaben'),
    pricePerUnitHundredths: total && total > 0 ? Math.round((costCents * 100) / total) : null,
    quantityPerDay: total !== null && days > 0 ? total / days : null,
    costPerDayCents: days > 0 ? Math.round(costCents / days) : 0,
    annualQuantity: total !== null && days > 0 ? Math.round((total * 365) / days) : null,
    annualCostCents: days > 0 ? Math.round((costCents * 365) / days) : 0,
  }
}

/**
 * Verbrauch einer Sparte.
 *
 * Zuerst aus den Zählerablesungen, weil dort der Verbrauch selbst steht. Fehlt
 * die Ablesung – bei Akontorechnungen gibt es keine –, wird ersatzweise die
 * Menge der mengenabhängigen Positionen genommen. Wo gar nichts gemessen wird,
 * bleibt es bei null: Der Kehricht hat keinen Verbrauch, und eine 0 wäre eine
 * Behauptung.
 */
function sectionQuantity(section: BillSection): {
  high: number | null
  low: number | null
  total: number | null
} {
  if (DIVISION_UNITS[section.division] === null) return { high: null, low: null, total: null }

  let high: number | null = null
  let low: number | null = null
  let einzel: number | null = null

  for (const reading of section.readings) {
    if (reading.tariff === 'hoch') high = (high ?? 0) + reading.quantity
    else if (reading.tariff === 'nieder') low = (low ?? 0) + reading.quantity
    else einzel = (einzel ?? 0) + reading.quantity
  }

  if (high !== null || low !== null || einzel !== null) {
    return { high, low, total: (high ?? 0) + (low ?? 0) + (einzel ?? 0) }
  }

  // Ersatzweise aus den Positionen: Nur Zeilen in der Einheit der Sparte
  // zählen – der Regenabwasser-Ansatz je Quadratmeter ist kein Verbrauch.
  const unit = DIVISION_UNITS[section.division]
  for (const position of section.positions) {
    if (position.unit !== unit) continue
    const label = position.label.toLowerCase()
    if (label.includes('hochtarif')) high = (high ?? 0) + Math.round(position.quantity)
    else if (label.includes('niedertarif')) low = (low ?? 0) + Math.round(position.quantity)
    else einzel = (einzel ?? 0) + Math.round(position.quantity)
  }

  if (high === null && low === null && einzel === null) return { high: null, low: null, total: null }
  return { high, low, total: (high ?? 0) + (low ?? 0) + (einzel ?? 0) }
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

export const EMPTY_TREND: Trend = { ratio: null, direction: 'gleich', delta: null }

/**
 * Sucht zum Eintrag den entsprechenden des Vorjahres.
 *
 * Verglichen wird dieselbe Sparte über den Anfang der Periode, mit einem
 * Fenster von 45 Tagen: Die Ablesung findet nicht jedes Jahr am selben Tag
 * statt, und ein Vergleich, der bei drei Wochen Abweichung aufgibt, ist
 * keiner. Ein Winterhalbjahr wird so nie versehentlich mit einem
 * Sommerhalbjahr verglichen.
 */
export function findPreviousYearEntry(
  entries: readonly DivisionEntry[],
  entry: DivisionEntry,
): DivisionEntry | null {
  const target = Date.parse(`${entry.bill.periodStart}T00:00:00Z`)
  if (!Number.isFinite(target)) return null
  const wanted = target - 365 * 86_400_000

  let best: DivisionEntry | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of entries) {
    if (candidate.id === entry.id) continue
    if (candidate.division !== entry.division) continue
    if (candidate.bill.kind !== entry.bill.kind) continue

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
  /** Wie viele Spartenabschnitte in die Summe eingeflossen sind. */
  entryCount: number
  /** Wie viele Rechnungen dahinterstehen. */
  billCount: number
  /** Abgedeckte Tage – bei mehreren Sparten die längste Spanne, nicht die Summe. */
  days: number

  totalCostCents: number
  costPerDayCents: number | null
  annualCostCents: number | null

  /**
   * Kosten und Menge je Sparte, in der Reihenfolge von DIVISIONS.
   *
   * Die Menge steht hier auch dann, wenn die Auswertung insgesamt keine
   * gemeinsame Einheit hat: „5'451 kWh und 120 m³" sind zwei Angaben, die
   * nebeneinander Sinn ergeben – nur addieren lassen sie sich nicht.
   */
  perDivision: Array<{
    division: Division
    costCents: number
    quantity: number | null
    unit: string | null
  }>

  /**
   * Menge und Preis – nur gesetzt, wenn alle einbezogenen Sparten dieselbe
   * Einheit messen. Kilowattstunden und Kubikmeter zusammenzuzählen ergäbe
   * eine Zahl, die nichts bedeutet.
   */
  unit: string | null
  quantity: number | null
  highQuantity: number | null
  lowQuantity: number | null
  pricePerUnitHundredths: number | null
  quantityPerDay: number | null

  /** Nur wenn ausschliesslich Strom einbezogen ist. */
  energyCents: number | null
  gridCents: number | null
  leviesCents: number | null
}

export const EMPTY_SUMMARY: PeriodSummary = {
  entryCount: 0,
  billCount: 0,
  days: 0,
  totalCostCents: 0,
  costPerDayCents: null,
  annualCostCents: null,
  perDivision: [],
  unit: null,
  quantity: null,
  highQuantity: null,
  lowQuantity: null,
  pricePerUnitHundredths: null,
  quantityPerDay: null,
  energyCents: null,
  gridCents: null,
  leviesCents: null,
}

/**
 * Fasst Spartenabschnitte zu einer Periode zusammen.
 *
 * Die abgedeckten Tage sind die Spanne vom frühesten Anfang bis zum spätesten
 * Ende und nicht die Summe der Perioden: Strom und Wasser laufen im selben
 * Jahr nebeneinander her: Ihre Tage zu addieren ergäbe ein doppelt so langes
 * Jahr und damit halb so hohe Kosten pro Tag.
 *
 * Der Ø Preis wird aus den Summen gebildet und nicht als Mittel der einzelnen
 * Preise: Ein Halbjahr mit wenig Verbrauch soll den Jahresschnitt nicht gleich
 * stark ziehen wie eines mit viel.
 */
export function summarize(entries: readonly DivisionEntry[]): PeriodSummary {
  if (entries.length === 0) return { ...EMPTY_SUMMARY }

  const einheiten = new Set(entries.map((entry) => entry.unit))
  const sparten = new Set(entries.map((entry) => entry.division))
  const einheitlich = einheiten.size === 1 ? ([...einheiten][0] ?? null) : null
  const nurStrom = sparten.size === 1 && sparten.has('strom')

  let totalCostCents = 0
  let high: number | null = null
  let low: number | null = null
  let menge: number | null = null
  let energyCents: number | null = nurStrom ? 0 : null
  let gridCents: number | null = nurStrom ? 0 : null
  let leviesCents: number | null = nurStrom ? 0 : null

  let von = Number.POSITIVE_INFINITY
  let bis = Number.NEGATIVE_INFINITY

  const proSparte = new Map<Division, { costCents: number; quantity: number | null }>()
  const rechnungen = new Set<string>()

  for (const entry of entries) {
    totalCostCents += entry.costCents
    const bisher = proSparte.get(entry.division) ?? { costCents: 0, quantity: null }
    proSparte.set(entry.division, {
      costCents: bisher.costCents + entry.costCents,
      quantity:
        entry.quantity === null ? bisher.quantity : (bisher.quantity ?? 0) + entry.quantity,
    })
    rechnungen.add(entry.bill.id)

    if (einheitlich !== null) {
      if (entry.quantity !== null) menge = (menge ?? 0) + entry.quantity
      if (entry.highQuantity !== null) high = (high ?? 0) + entry.highQuantity
      if (entry.lowQuantity !== null) low = (low ?? 0) + entry.lowQuantity
    }
    if (nurStrom) {
      energyCents = (energyCents ?? 0) + (entry.energyCents ?? 0)
      gridCents = (gridCents ?? 0) + (entry.gridCents ?? 0)
      leviesCents = (leviesCents ?? 0) + (entry.leviesCents ?? 0)
    }

    const start = Date.parse(`${entry.bill.periodStart}T00:00:00Z`)
    const end = Date.parse(`${entry.bill.periodEnd}T00:00:00Z`)
    if (Number.isFinite(start)) von = Math.min(von, start)
    if (Number.isFinite(end)) bis = Math.max(bis, end)
  }

  const days =
    Number.isFinite(von) && Number.isFinite(bis)
      ? Math.round((bis - von) / 86_400_000) + 1
      : 0

  return {
    entryCount: entries.length,
    billCount: rechnungen.size,
    days,
    totalCostCents,
    costPerDayCents: days > 0 ? Math.round(totalCostCents / days) : null,
    annualCostCents: days > 0 ? Math.round((totalCostCents * 365) / days) : null,
    perDivision: DIVISIONS.filter((division) => proSparte.has(division)).map((division) => ({
      division,
      costCents: proSparte.get(division)?.costCents ?? 0,
      quantity: proSparte.get(division)?.quantity ?? null,
      unit: DIVISION_UNITS[division],
    })),
    unit: einheitlich,
    quantity: menge,
    highQuantity: high,
    lowQuantity: low,
    pricePerUnitHundredths:
      menge && menge > 0 ? Math.round((totalCostCents * 100) / menge) : null,
    quantityPerDay: menge !== null && days > 0 ? menge / days : null,
    energyCents,
    gridCents,
    leviesCents,
  }
}

export interface HausAnalysis {
  /** Alle Spartenabschnitte der Abrechnungen, aufsteigend nach Periodenanfang. */
  entries: DivisionEntry[]
  /** Dieselben aus Akontorechnungen – Vorauszahlungen ohne eigenen Verbrauch. */
  akonto: DivisionEntry[]
  /** Die Jahre, für die etwas vorliegt, absteigend. */
  years: number[]
  /** Die Sparten, die überhaupt vorkommen, in fester Reihenfolge. */
  divisions: Division[]
}

/**
 * Zerlegt die Rechnungen in Spartenabschnitte und sortiert sie.
 *
 * Akontorechnungen stehen bewusst neben und nicht in der Auswertung: Sie sind
 * Vorauszahlungen auf denselben Verbrauch und würden jede Summe verdoppeln.
 * Für die Frage „habe ich zu viel oder zu wenig vorausbezahlt?" bleiben sie
 * greifbar.
 */
export function analyse(bills: readonly UtilityBill[]): HausAnalysis {
  const sorted = [...bills].sort((a, b) => a.periodStart.localeCompare(b.periodStart))

  const entries: DivisionEntry[] = []
  const akonto: DivisionEntry[] = []
  const years = new Set<number>()
  const divisions = new Set<Division>()

  for (const bill of sorted) {
    for (const section of bill.sections) {
      const entry = computeDivisionEntry(bill, section)
      if (bill.kind === 'akonto') akonto.push(entry)
      else entries.push(entry)
      divisions.add(section.division)
    }
    years.add(billYear(bill))
  }

  return {
    entries,
    akonto,
    years: [...years].sort((a, b) => b - a),
    divisions: DIVISIONS.filter((division) => divisions.has(division)),
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

/** „5'451" – Mengen mit Schweizer Tausendertrennung. */
export function formatMenge(value: number | null, fractionDigits = 0): string {
  if (value === null) return '–'
  return value.toLocaleString('de-CH', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

/**
 * Wie ein Preis je Einheit ausgeschrieben wird.
 *
 * Strom rechnet in Rappen je Kilowattstunde, Wasser in Franken je Kubikmeter –
 * so steht es auf der Rechnung, und so rechnet man auch im Kopf. „0.0125
 * Franken je Kilowattstunde" hat noch nie jemand gesagt.
 */
export function priceUnitLabel(unit: string | null): { label: string; inRappen: boolean } {
  if (unit === 'kWh') return { label: 'Rp./kWh', inRappen: true }
  if (unit === null) return { label: '', inRappen: false }
  return { label: `Fr./${unit}`, inRappen: false }
}

/** Der Preis je Einheit als Text, in der Schreibweise der Sparte. */
export function formatPricePerUnit(hundredths: number | null, unit: string | null): string {
  if (hundredths === null) return '–'
  const { inRappen } = priceUnitLabel(unit)
  if (inRappen) return formatRappen(hundredths)
  return (hundredths / 10_000).toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Der Zahlenwert des Preises in der Einheit, in der er angeschrieben wird. */
export function priceValue(hundredths: number | null, unit: string | null): number | null {
  if (hundredths === null) return null
  return priceUnitLabel(unit).inRappen ? hundredths / 100 : hundredths / 10_000
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
 * Auf einem Handy ist unter einer Säule Platz für rund sechs Zeichen. Jahr,
 * Halbjahr und Quartal decken ab, wie dieser Versorger abrechnet; alles andere
 * fällt auf Monat und Jahr zurück, statt abgeschnitten zu werden.
 */
export function shortPeriodLabel(periodStart: string, periodEnd: string): string {
  const start = new Date(`${periodStart}T00:00:00Z`)
  const end = new Date(`${periodEnd}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return periodStart

  const year = String(end.getUTCFullYear()).slice(2)
  const months = periodDays(periodStart, periodEnd) / 30.4

  if (months >= 10) return `${end.getUTCFullYear()}`
  if (months > 4.5) return `${start.getUTCMonth() < 6 ? 'H1' : 'H2'} ${year}`
  if (months > 1.5) return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${year}`
  return `${String(start.getUTCMonth() + 1).padStart(2, '0')}.${year}`
}

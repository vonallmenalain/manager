import {
  COST_GROUPS,
  DIVISION_UNITS,
  parseAmountToCents,
  TARIFF_LABELS,
  type BillInput,
  type BillKind,
  type BillSection,
  type CostGroup,
  type Division,
  type MeterReading,
} from '@manager/shared'

/**
 * Die Umrechnung zwischen einer Rechnung und dem Formular, in dem sie steht.
 *
 * Getrennt vom Formular selbst, weil hier die Rechnung durch ein Nadelöhr
 * geht: Das Formular kennt Felder, nicht Rechnungszeilen, und was kein Feld
 * hat, ist nach dem Speichern weg. Genau so verschwanden aus der Abrechnung
 * 248'619 die Zählerstände – der Parser las Tag- und Nachttarif, das Formular
 * suchte Hoch- und Niedertarif, fand nichts und speicherte eine Rechnung ohne
 * jede Ablesung. Aufgefallen ist es erst am Verbrauch: 36'540 kWh statt 5'220,
 * ersatzweise aus den Positionen zusammengezählt.
 *
 * Als eigene Datei ist dieser Weg prüfbar, ohne ein Formular zu bedienen.
 */

export interface SectionDraft {
  division: Division
  /** Nur bei Sparten ohne Blöcke: der Betrag der Sparte. */
  amount: string
  /** Nur beim Strom: seine Blöcke. */
  groups: Record<CostGroup, string>
  /** Menge je Tarif – beim Strom zwei, sonst eine. */
  quantities: Record<string, string>
  starts: Record<string, string>
  ends: Record<string, string>
  /** Wie die Ablesung auf der Rechnung hiess, je Tarif. */
  labels: Record<string, string>
  /** Was aus dem PDF kam und unverändert bleibt. */
  positions: BillSection['positions']
  meterPoint: string | null
  meterNumber: string | null
}

export interface Draft {
  kind: BillKind
  invoiceNumber: string
  invoiceDate: string
  periodStart: string
  periodEnd: string
  customerNumber: string
  akonto: string
  mwst: string
  note: string
  sections: SectionDraft[]
}

/** Welche Tarife eine Sparte kennt. Wasser hat nur einen Zähler. */
export function tariffsOf(division: Division): Array<MeterReading['tariff']> {
  if (DIVISION_UNITS[division] === null) return []
  return division === 'strom' ? ['hoch', 'nieder'] : ['einzel']
}

/** Rappen als schlichte Eingabe: „1090.15", ohne Tausendertrennung. */
function toAmountInput(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2)
}

export function readAmount(input: string): number {
  return parseAmountToCents(input) ?? 0
}

export function readCount(input: string): number | null {
  const cleaned = input.replace(/['’\s]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

/**
 * Ein leeres Feld je Block – abgeleitet aus `COST_GROUPS`, nicht aufgezählt.
 *
 * Ein hier vergessener Block hätte kein Eingabefeld, und weil das Formular
 * beim Speichern aus seinen Feldern zurückrechnet, verschwände sein Betrag
 * auch dann, wenn der Parser ihn richtig gelesen hat.
 */
function emptyGroups(): Record<CostGroup, string> {
  return Object.fromEntries(COST_GROUPS.map((group) => [group, ''])) as Record<CostGroup, string>
}

function toSectionDraft(section: BillSection): SectionDraft {
  const quantities: Record<string, string> = {}
  const starts: Record<string, string> = {}
  const ends: Record<string, string> = {}
  const labels: Record<string, string> = {}

  for (const tariff of tariffsOf(section.division)) {
    const reading = section.readings.find((entry) => entry.tariff === tariff)
    quantities[tariff] = reading ? String(reading.quantity) : ''
    starts[tariff] = reading?.startValue === null || reading?.startValue === undefined ? '' : String(reading.startValue)
    ends[tariff] = reading?.endValue === null || reading?.endValue === undefined ? '' : String(reading.endValue)
    labels[tariff] = reading?.label ?? ''
  }

  const groups = emptyGroups()
  for (const entry of section.groups) groups[entry.group] = toAmountInput(entry.amountCents)

  return {
    division: section.division,
    amount: toAmountInput(section.amountCents),
    groups,
    quantities,
    starts,
    ends,
    labels,
    positions: section.positions,
    meterPoint: section.meterPoint,
    meterNumber: section.meterNumber,
  }
}

export function neueSektion(division: Division): SectionDraft {
  const quantities: Record<string, string> = {}
  const starts: Record<string, string> = {}
  const ends: Record<string, string> = {}
  const labels: Record<string, string> = {}
  for (const tariff of tariffsOf(division)) {
    quantities[tariff] = ''
    starts[tariff] = ''
    ends[tariff] = ''
    labels[tariff] = ''
  }

  return {
    division,
    amount: '',
    groups: emptyGroups(),
    quantities,
    starts,
    ends,
    labels,
    positions: [],
    meterPoint: null,
    meterNumber: null,
  }
}

export function toDraft(bill: BillInput | null): Draft {
  return {
    kind: bill?.kind ?? 'abrechnung',
    invoiceNumber: bill?.invoiceNumber ?? '',
    invoiceDate: bill?.invoiceDate ?? '',
    periodStart: bill?.periodStart ?? '',
    periodEnd: bill?.periodEnd ?? '',
    customerNumber: bill?.customerNumber ?? '',
    akonto: toAmountInput(bill?.prepaidCents ?? 0),
    mwst: toAmountInput(bill?.vatCents ?? 0),
    note: bill?.note ?? '',
    sections: bill?.sections.map(toSectionDraft) ?? [neueSektion('strom')],
  }
}

/** Der Betrag einer Sparte: beim Strom die Summe der Blöcke, sonst das Feld. */
export function sectionCents(section: SectionDraft): number {
  if (section.division === 'strom') {
    return COST_GROUPS.reduce((sum, group) => sum + readAmount(section.groups[group]), 0)
  }
  return readAmount(section.amount)
}

export function toBill(draft: Draft, vorlage: BillInput | null): BillInput {
  const sections: BillSection[] = draft.sections.map((section) => {
    const readings: MeterReading[] = []
    for (const tariff of tariffsOf(section.division)) {
      const quantity = readCount(section.quantities[tariff] ?? '')
      if (quantity === null) continue
      readings.push({
        tariff,
        // Die Beschriftung der Rechnung behalten, wo eine kam: „Wirkstrom
        // Tagtarif" ist nachprüfbar, „Hochtarif" nur unsere Einordnung.
        label: section.labels[tariff]?.trim() || TARIFF_LABELS[tariff],
        unit: DIVISION_UNITS[section.division] ?? '',
        startValue: readCount(section.starts[tariff] ?? ''),
        endValue: readCount(section.ends[tariff] ?? ''),
        quantity,
      })
    }

    return {
      division: section.division,
      amountCents: sectionCents(section),
      groups:
        section.division === 'strom'
          ? COST_GROUPS.map((group) => ({ group, amountCents: readAmount(section.groups[group]) })).filter(
              (entry) => entry.amountCents > 0,
            )
          : [],
      readings,
      // Die einzelnen Zeilen der Rechnung kommen aus dem PDF und bleiben, wie
      // sie sind: Sie sind das Abbild des Papiers. Von Hand ändert man die Summen.
      positions: section.positions,
      meterPoint: section.meterPoint,
      meterNumber: section.meterNumber,
    }
  })

  const subtotalCents = sections.reduce((sum, section) => sum + section.amountCents, 0)
  const prepaidCents = readAmount(draft.akonto)

  return {
    kind: draft.kind,
    invoiceNumber: draft.invoiceNumber.trim(),
    invoiceDate: draft.invoiceDate,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    customerNumber: draft.customerNumber.trim() || null,
    sections,
    subtotalCents,
    prepaidCents,
    totalCents: Math.max(0, subtotalCents - prepaidCents),
    vatCents: readAmount(draft.mwst),
    documentId: vorlage?.documentId ?? null,
    sourceFile: vorlage?.sourceFile ?? null,
    note: draft.note.trim(),
  }
}

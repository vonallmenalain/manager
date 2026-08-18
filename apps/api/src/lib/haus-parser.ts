import {
  COST_GROUPS,
  DIVISIONS,
  DIVISION_UNITS,
  DIVISION_LABELS,
  type BillInput,
  type BillKind,
  type BillPosition,
  type BillSection,
  type CostGroup,
  type Division,
  type MeterReading,
  type Tariff,
} from '@manager/shared'

import type { PdfLine } from './pdf-text.js'

/**
 * Liest eine Rechnung der Energie- und Wasserversorgung aus den Zeilen, die
 * `pdf-text` aus dem PDF geholt hat.
 *
 * Der Versorger stellt zwei Arten von Rechnungen: eine für den Strom, mit den
 * drei Blöcken Energie, Netznutzung und Abgaben, und eine für Wasser, Abwasser
 * und Kehricht, die drei Sparten auf einem Beleg trägt. Beide haben denselben
 * Aufbau – Zusammenfassung auf der ersten Seite, Verbrauchs- und
 * Betragsermittlung je Sparte dahinter –, und beide laufen deshalb durch
 * denselben Parser.
 *
 * Gearbeitet wird an Beschriftungen entlang, nicht an festen Zeilennummern:
 * „Rechnungsdatum:" steht auf jeder Rechnung, die dreizehnte Zeile bedeutet auf
 * jeder etwas anderes. Bekommt der Versorger ein neues Papier, verschiebt sich
 * damit höchstens eine Angabe – statt dass alles auf einmal falsch liegt.
 *
 * Was er nicht sicher lesen kann, erfindet er nicht: Fehlendes bleibt leer und
 * wird als Hinweis gemeldet. Die Vorschau im Browser ist ein Formular, in dem
 * sich das von Hand nachtragen lässt.
 */

export interface ParseResult {
  /** Die gelesene Rechnung – null, wenn das PDF keine solche Rechnung ist. */
  bill: BillInput | null
  /** Was auffiel: Fehlendes, Unstimmiges, Übersprungenes. */
  hinweise: string[]
}

/**
 * Wie die Sparten auf dem Beleg heissen – exakt, nicht als Teilwort.
 *
 * „Abwasser" enthält „Wasser": Wer mit Teilwörtern vergleicht, bucht die
 * Abwassergebühr auf das Trinkwasser. Verglichen wird deshalb die ganze
 * Beschriftung.
 */
const DIVISION_BY_LABEL = new Map<string, Division>([
  ['elektrizität', 'strom'],
  ['elektrizitaet', 'strom'],
  ['strom', 'strom'],
  ['wasser', 'wasser'],
  ['abwasser', 'abwasser'],
  ['kehricht', 'kehricht'],
])

/**
 * Die Beschriftungen der Stromblöcke in der Zusammenfassung.
 *
 * Seit 2026 weist der Versorger die „Messung" als eigenen Block aus, statt sie
 * in der Netznutzung mitlaufen zu lassen. Ein unbekannter Block fällt hier
 * still heraus: Seine Zeile trägt eine Beschriftung, die niemand kennt, und
 * sein Betrag landet in keiner Summe. Genau daran fehlten der Rechnung
 * 248'619 die 42.15 der Messung – das Zwischentotal wies 1'833.55 aus, die
 * Sparte kam auf 1'791.40.
 */
const GROUP_BY_LABEL = new Map<string, CostGroup>([
  ['energie', 'energie'],
  ['netznutzung', 'netznutzung'],
  ['messung', 'messung'],
  ['gesetzliche abgaben und förderbeiträge', 'abgaben'],
  ['gesetzliche abgaben und foerderbeitraege', 'abgaben'],
])

/** Womit eine Summenzeile der Betragsermittlung beginnt. */
const GROUP_BY_TOTAL: ReadonlyArray<{ prefix: string; group: CostGroup }> = [
  { prefix: 'total energie', group: 'energie' },
  { prefix: 'total netznutzung', group: 'netznutzung' },
  { prefix: 'total messung', group: 'messung' },
  { prefix: 'total gesetzliche abgaben', group: 'abgaben' },
]

// ------------------------------------------------------------------ Bausteine

/**
 * Zahlen, wie sie auf der Rechnung stehen.
 *
 * Die PDFs benutzen beide Apostrophe – den geraden und den typografischen –,
 * je nachdem, welche der beiden eingebetteten Schriften eine Zeile setzt. Wer
 * nur einen davon kennt, liest aus 22’796 die Zahl 22.
 */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/['’´`\s  ]/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function isNumeric(raw: string): boolean {
  return parseNumber(raw) !== null
}

/** Beträge in Rappen – gerundet, damit aus 0.1 + 0.2 nie 0.30000000000000004 wird. */
function parseCents(raw: string): number | null {
  const value = parseNumber(raw)
  return value === null ? null : Math.round(value * 100)
}

/** „23.01.2025" → „2025-01-23". Nur echte Daten, kein Kalenderraten. */
function parseSwissDate(raw: string): string | null {
  const match = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(raw)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1990 || year > 2100) return null

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Vereinheitlicht für den Vergleich: klein geschrieben, ohne Randleerzeichen. */
function key(raw: string): string {
  return raw.trim().toLowerCase()
}

function divisionOfLabel(raw: string): Division | null {
  return DIVISION_BY_LABEL.get(key(raw)) ?? null
}

// ------------------------------------------------------------------- Parser

export function parseUtilityInvoice(
  lines: readonly PdfLine[],
  sourceFile: string | null = null,
): ParseResult {
  const hinweise: string[] = []

  const kopf = readHeader(lines)
  if (!kopf) {
    return {
      bill: null,
      hinweise: ['Auf diesem PDF steht keine Rechnungsnummer – ist es eine Rechnung?'],
    }
  }

  const invoiceDate = findLabelledDate(lines, 'rechnungsdatum')
  const periode = findPeriod(lines)

  if (!invoiceDate) hinweise.push('Kein Rechnungsdatum gefunden.')
  if (!periode) hinweise.push('Keine Abrechnungsperiode gefunden.')

  const summary = readSummary(lines)
  if (summary.sections.size === 0) {
    return {
      bill: null,
      hinweise: [
        'Auf dieser Rechnung steht keine der bekannten Sparten (Strom, Wasser, Abwasser, Kehricht).',
        'Im Bereich Haus lassen sich nur Rechnungen der Energie- und Wasserversorgung auswerten.',
      ],
    }
  }

  const details = readDetails(lines, hinweise)

  const sections: BillSection[] = DIVISIONS.filter((division) =>
    summary.sections.has(division),
  ).map((division) => {
    const detail = details.get(division)
    const gruppen = summary.groups.get(division)

    return {
      division,
      amountCents: summary.sections.get(division) ?? 0,
      groups: gruppen ? COST_GROUPS.filter((group) => gruppen.has(group)).map((group) => ({
        group,
        amountCents: gruppen.get(group) ?? 0,
      })) : [],
      readings: detail?.readings ?? [],
      positions: detail?.positions ?? [],
      meterPoint: detail?.meterPoint ?? null,
      meterNumber: detail?.meterNumber ?? null,
    }
  })

  const teile = sections.reduce((sum, section) => sum + section.amountCents, 0)
  const subtotalCents = summary.subtotalCents ?? teile
  const totalCents = summary.totalCents ?? subtotalCents - summary.prepaidCents

  pruefeSummen({ teile, summary, subtotalCents, totalCents }, hinweise)

  // Gemeldet wird nur, wo wirklich nichts steht.
  //
  // Das Abwasser hat nie eine eigene Ablesung – verrechnet wird es über den
  // Wasserzähler, und die Menge steht in seiner Position. Ein Hinweis dafür
  // wäre bei jeder Wasserrechnung derselbe und würde die echten übertönen.
  if (kopf.kind === 'abrechnung') {
    for (const section of sections) {
      if (section.readings.length > 0) continue
      if (DIVISION_UNITS[section.division] === null) continue
      const ausPositionen = section.positions.some(
        (position) => position.unit === DIVISION_UNITS[section.division],
      )
      if (ausPositionen) continue

      hinweise.push(
        `Für ${DIVISION_LABELS[section.division]} steht weder eine Ablesung noch eine Menge – der Verbrauch bleibt leer.`,
      )
    }
  }

  const bill: BillInput = {
    kind: kopf.kind,
    invoiceNumber: kopf.invoiceNumber,
    invoiceDate: invoiceDate ?? periode?.periodEnd ?? '',
    periodStart: periode?.periodStart ?? '',
    periodEnd: periode?.periodEnd ?? '',
    customerNumber: findLabelledValue(lines, 'kundennummer'),
    sections,
    subtotalCents,
    prepaidCents: summary.prepaidCents,
    totalCents,
    vatCents: summary.vatCents,
    documentId: null,
    sourceFile,
    note: '',
  }

  return { bill, hinweise }
}

// --------------------------------------------------------------------- Kopf

interface Header {
  kind: BillKind
  invoiceNumber: string
}

/**
 * „Abrechnung Nr. 231125" oder „Akontorechnung Nr. 232709".
 *
 * Die Unterscheidung trägt weit: Eine Akontorechnung ist eine Vorauszahlung
 * ohne eigenen Verbrauch. Wer sie wie eine Abrechnung zählt, hat den Verbrauch
 * eines Jahres doppelt in der Statistik.
 */
function readHeader(lines: readonly PdfLine[]): Header | null {
  for (const line of lines) {
    for (const cell of line.cells) {
      const match = /^(Akontorechnung|Abrechnung|Rechnung)\s+Nr\.?\s*([\d'’ ]+)$/i.exec(cell.trim())
      if (!match) continue

      const invoiceNumber = (match[2] as string).replace(/['’\s]/g, '')
      if (!invoiceNumber) continue

      return {
        kind: /^akonto/i.test(match[1] as string) ? 'akonto' : 'abrechnung',
        invoiceNumber,
      }
    }
  }
  return null
}

function findLabelledValue(lines: readonly PdfLine[], label: string): string | null {
  for (const line of lines) {
    const index = line.cells.findIndex((cell) => key(cell).replace(/:$/, '') === label)
    if (index < 0) continue

    const inSameCell = line.cells[index]?.includes(':') && line.cells[index]!.split(':')[1]?.trim()
    const next = line.cells[index + 1]?.trim()
    const value = next || inSameCell
    if (value) return value
  }
  return null
}

function findLabelledDate(lines: readonly PdfLine[], label: string): string | null {
  const raw = findLabelledValue(lines, label)
  return raw ? parseSwissDate(raw) : null
}

function findPeriod(lines: readonly PdfLine[]): { periodStart: string; periodEnd: string } | null {
  for (const line of lines) {
    const match = /Periode\s+vom\s+([\d.]+)\s*[-–]\s*([\d.]+)/i.exec(line.text)
    if (!match) continue

    const periodStart = parseSwissDate(match[1] as string)
    const periodEnd = parseSwissDate(match[2] as string)
    if (periodStart && periodEnd) return { periodStart, periodEnd }
  }
  return null
}

// ---------------------------------------------------------------- Beträge

interface Summary {
  /** Total je Sparte, wie es in der Zusammenfassung steht. */
  sections: Map<Division, number>
  /** Nur beim Strom: die drei Blöcke, aus denen sich die Sparte zusammensetzt. */
  groups: Map<Division, Map<CostGroup, number>>
  subtotalCents: number | null
  prepaidCents: number
  totalCents: number | null
  vatCents: number
}

/**
 * Die Zusammenfassung der ersten Seite.
 *
 * Sie ist die verlässlichste Stelle der ganzen Rechnung: Was hier steht, ist
 * das, was der Versorger als Total je Sparte ausweist. Die Detailseiten
 * dahinter liefern die Herkunft dieser Zahlen, nicht die Zahlen selbst.
 *
 * Beim Strom stehen dort statt einer Sparte die drei Blöcke – ihre Summe ist
 * das Total der Sparte. Bei Wasser stehen die drei Sparten direkt.
 */
function readSummary(lines: readonly PdfLine[]): Summary {
  const summary: Summary = {
    sections: new Map(),
    groups: new Map(),
    subtotalCents: null,
    prepaidCents: 0,
    totalCents: null,
    vatCents: 0,
  }

  const stromGruppen = new Map<CostGroup, number>()

  for (const line of lines.filter((entry) => entry.page === 1)) {
    const label = key(line.cells[0] ?? '')
    const amount = parseCents(line.cells[line.cells.length - 1] ?? '')

    if (amount !== null && line.cells.length >= 2) {
      const division = divisionOfLabel(label)
      const group = GROUP_BY_LABEL.get(label)

      if (division) summary.sections.set(division, amount)
      else if (group) stromGruppen.set(group, amount)

      if (label === 'zwischentotal') summary.subtotalCents = amount
      if (label === 'akontoabzug') summary.prepaidCents = Math.abs(amount)
      if (label.startsWith('rechnungsbetrag')) summary.totalCents = amount
    }

    // Die MWST steht in Klammern hinter der Steuernummer; bei mehreren Sätzen
    // gibt es mehrere Zeilen, die zusammen den Steuerbetrag ergeben.
    for (const match of line.text.matchAll(/MWST\s+CHF\s+([\d'’.]+)/gi)) {
      const vat = parseCents(match[1] as string)
      if (vat !== null) summary.vatCents += vat
    }
  }

  if (stromGruppen.size > 0) {
    summary.groups.set('strom', stromGruppen)
    summary.sections.set(
      'strom',
      [...stromGruppen.values()].reduce((sum, value) => sum + value, 0),
    )
  }

  return summary
}

function pruefeSummen(
  werte: { teile: number; summary: Summary; subtotalCents: number; totalCents: number },
  hinweise: string[],
): void {
  const { teile, summary, subtotalCents, totalCents } = werte

  // Ein Rappen Abweichung ist Rundung, alles darüber ein Lesefehler.
  if (summary.subtotalCents !== null && Math.abs(teile - summary.subtotalCents) > 1) {
    hinweise.push(
      `Die Sparten ergeben zusammen nicht das Zwischentotal (${format(teile)} statt ${format(summary.subtotalCents)}).`,
    )
  }

  if (Math.abs(subtotalCents - summary.prepaidCents - totalCents) > 1) {
    hinweise.push(
      `Zwischentotal minus Akontoabzug ergibt nicht den Rechnungsbetrag (${format(subtotalCents - summary.prepaidCents)} statt ${format(totalCents)}).`,
    )
  }

  if (teile === 0) hinweise.push('Keine Beträge gefunden – bitte von Hand nachtragen.')
}

function format(cents: number): string {
  return `CHF ${(cents / 100).toFixed(2)}`
}

// ------------------------------------------------------------- Detailseiten

interface Detail {
  readings: MeterReading[]
  positions: BillPosition[]
  meterPoint: string | null
  meterNumber: string | null
}

/**
 * Die Detailseiten: je Sparte Zählerablesung und Betragsermittlung.
 *
 * Ein einziger Durchgang mit zwei Merkern – welche Sparte gerade gilt und in
 * welcher Tabelle man steht. Die Alternative wäre, die Seite vorher in Blöcke
 * zu zerschneiden; das käme auf dasselbe hinaus und bräuchte eine zweite
 * Vorstellung davon, wo ein Block endet.
 *
 * Positionen werden gesammelt und erst bei ihrer Summenzeile zugeordnet: Über
 * dem Abgabenblock des Stroms steht ein zweites Mal „Netznutzung NS Haushalt",
 * die Summenzeile darunter ist dagegen eindeutig.
 */
function readDetails(lines: readonly PdfLine[], hinweise: string[]): Map<Division, Detail> {
  const details = new Map<Division, Detail>()
  const detail = (division: Division): Detail => {
    const vorhanden = details.get(division)
    if (vorhanden) return vorhanden
    const neu: Detail = { readings: [], positions: [], meterPoint: null, meterNumber: null }
    details.set(division, neu)
    return neu
  }

  let current: Division | null = null
  let mode: 'none' | 'verbrauch' | 'betrag' = 'none'
  let pending: Array<Omit<BillPosition, 'group'>> = []
  let readingLabel = ''

  for (const line of lines) {
    const first = line.cells[0]?.trim() ?? ''
    const label = key(first)

    // Ein Messpunkt gehört zur Sparte, unter der er steht.
    const messpunkt = /Messpunkt:?\s*(CH[\dA-Z]{10,40})/i.exec(line.text.replace(/\s+/g, ' '))
    if (messpunkt && current) {
      detail(current).meterPoint = (messpunkt[1] as string).toUpperCase()
      continue
    }

    // Eine Zeile, die nur aus einem Spartennamen besteht, eröffnet den Block.
    if (line.cells.length === 1) {
      const division = divisionOfLabel(label)
      if (division) {
        // Nur bei einem echten Wechsel zurücksetzen: Unter „Kehricht" steht
        // die Überschrift ein zweites Mal, mitten in der Betragsermittlung.
        if (division !== current) {
          current = division
          mode = 'none'
        }
        continue
      }
    }

    if (label === 'verbrauchsermittlung') {
      mode = 'verbrauch'
      readingLabel = ''
      continue
    }
    if (label === 'betragsermittlung') {
      mode = 'betrag'
      continue
    }

    if (label.startsWith('total ') || label === 'zwischentotal' || label === 'akontoabzug') {
      const gruppe = GROUP_BY_TOTAL.find((entry) => label.startsWith(entry.prefix))
      const sparte = gruppe ? 'strom' : divisionOfLabel(first.replace(/^total\s+/i, ''))

      if (sparte && (gruppe || sparte === current)) {
        for (const position of pending) {
          detail(sparte).positions.push({ ...position, group: gruppe?.group ?? null })
        }
      }
      pending = []
      // Die Tabellenart bleibt, wie sie war: Beim Strom stehen alle drei
      // Blöcke unter einer einzigen Überschrift „Betragsermittlung", und nach
      // „Total Energie" folgt die Netznutzung ohne neue Kopfzeile. Wer hier
      // zurücksetzt, verliert zwei Drittel der Rechnung.
      continue
    }

    if (!current) continue

    if (mode === 'verbrauch') {
      const gelesen = parseReadingRow(line.cells, readingLabel)
      if (gelesen) {
        readingLabel = gelesen.label
        addReading(detail(current), gelesen, hinweise)
      }
      continue
    }

    if (mode === 'betrag') {
      const position = parsePositionRow(line.cells)
      if (position) pending.push(position)
    }
  }

  return details
}

interface ReadingRow extends MeterReading {
  meterNumber: string | null
  /** Für die Prüfung: Stand neu minus Stand alt. */
  difference: number | null
}

/**
 * Eine Zeile der Verbrauchsermittlung.
 *
 * Gelesen wird von hinten: Die letzte Zahl ist die Menge, die beiden davor
 * sind Stand alt und Stand neu, und was noch davor steht, ist die Zählernummer.
 * So überstehen die Zeilen es, dass die Nummer nur in der ersten Zeile eines
 * Zählerwechsels steht.
 */
function parseReadingRow(cells: readonly string[], vorheriges: string): ReadingRow | null {
  const label = !isNumeric(cells[0] ?? '') && !parseSwissDate(cells[0] ?? '')
    ? (cells[0] as string).trim()
    : vorheriges
  if (!label) return null

  const zahlen = cells.filter((cell) => isNumeric(cell) && !parseSwissDate(cell))
  if (zahlen.length < 3) return null

  const quantity = parseNumber(zahlen[zahlen.length - 1] as string)
  const endValue = parseNumber(zahlen[zahlen.length - 2] as string)
  const startValue = parseNumber(zahlen[zahlen.length - 3] as string)
  if (quantity === null || endValue === null || startValue === null) return null

  // Die Einheit steht als letzte Zelle ohne Zahl: kWh, m³.
  const unit = [...cells].reverse().find((cell) => cell && !isNumeric(cell) && !parseSwissDate(cell) && cell !== '-')
  const tarif = tariffOf(label)

  return {
    tariff: tarif,
    label,
    unit: unit && unit !== label ? unit.trim() : '',
    startValue: Math.round(startValue),
    endValue: Math.round(endValue),
    quantity: Math.round(quantity),
    meterNumber: zahlen.length >= 4 ? (zahlen[zahlen.length - 4] as string).trim() : null,
    difference: Math.round(endValue) - Math.round(startValue),
  }
}

/**
 * Trägt eine Ablesung ein – und fasst zusammen, was zum selben Tarif gehört.
 *
 * Ein Zählerwechsel erzeugt zwei Zeilen: eine bis zum alten Stand, eine ab dem
 * neuen. Deshalb wird aufsummiert und nicht ersetzt, und der Anfangsstand
 * bleibt der der ersten Zeile.
 */
function addReading(detail: Detail, row: ReadingRow, hinweise: string[]): void {
  if (row.difference !== null && row.difference !== row.quantity) {
    hinweise.push(
      `Bei „${row.label}" passt die Menge nicht zu den Zählerständen (${row.startValue} → ${row.endValue} ergibt ${row.difference}, verrechnet sind ${row.quantity}).`,
    )
  }

  detail.meterNumber = detail.meterNumber ?? row.meterNumber

  const vorhanden = detail.readings.find((reading) => reading.tariff === row.tariff)
  if (vorhanden) {
    vorhanden.quantity += row.quantity
    vorhanden.endValue = row.endValue
    return
  }

  detail.readings.push({
    tariff: row.tariff,
    label: row.label,
    unit: row.unit,
    startValue: row.startValue,
    endValue: row.endValue,
    quantity: row.quantity,
  })
}

/**
 * Welcher der beiden Stromtarife eine Zeile meint.
 *
 * Der Versorger nennt sie seit 2026 „Tagtarif" und „Nachttarif"; bis dahin
 * hiessen dieselben zwei „Hochtarif" und „Niedertarif". Wer nur die alten
 * Namen kennt, wirft beide in denselben Topf `einzel` – und weil zwei
 * Ablesungen desselben Tarifs als Zählerwechsel gelten, wird aus zwei Zählern
 * einer, dessen Stand von 31'185 auf 36'553 springt. Das Formular der
 * Vorschau sucht danach nach Hoch- und Niedertarif, findet nichts und
 * speichert eine Rechnung ganz ohne Ablesung.
 */
function tariffOf(label: string): Tariff {
  const text = label.toLowerCase()
  if (text.includes('hochtarif') || text.includes('tagtarif')) return 'hoch'
  if (text.includes('niedertarif') || text.includes('nachttarif')) return 'nieder'
  return 'einzel'
}

/**
 * Eine Zeile der Betragsermittlung.
 *
 * Gelesen wird von aussen nach innen: Die drei letzten Zahlen sind immer
 * Betrag ohne MWST, Steuersatz und Betrag mit MWST – in dieser Reihenfolge,
 * unabhängig davon, ob davor eine Dauer oder eine Einheit steht. Von links
 * kommt die Beschriftung, danach Menge und Ansatz. So überstehen die Zeilen
 * es, dass der Grundpreis eine Spalte weniger belegt als der Verbrauch.
 */
function parsePositionRow(cells: readonly string[]): Omit<BillPosition, 'group'> | null {
  if (cells.length < 4) return null

  const numeric = cells
    .map((cell, index) => ({ index, value: parseNumber(cell) }))
    .filter((entry): entry is { index: number; value: number } => entry.value !== null)

  if (numeric.length < 4) return null

  const gross = numeric[numeric.length - 1]
  const vat = numeric[numeric.length - 2]
  const net = numeric[numeric.length - 3]
  if (!gross || !vat || !net) return null

  // Der Steuersatz steht in Prozent und liegt zwischen 0 und 30 – daran ist
  // die Spalte zu erkennen, wenn eine Zeile einmal anders aufgebaut ist.
  if (vat.value < 0 || vat.value > 30) return null
  if (net.value < 0 || gross.value < 0) return null

  const label = cells.slice(0, numeric[0]?.index ?? 0).join(' ').trim()
  if (!label || isNumeric(label)) return null
  if (/^(betragsermittlung|verbrauchsermittlung|menge)$/i.test(label)) return null

  const head = cells.slice(numeric[0]?.index ?? 0, net.index)
  const details = readRowDetails(head)

  return {
    label,
    quantity: details.quantity,
    unit: details.unit,
    rateHundredths: details.rateHundredths,
    rateUnit: details.rateUnit,
    durationMonths: details.durationMonths,
    vatBasisPoints: Math.round(vat.value * 100),
    netCents: Math.round(net.value * 100),
    grossCents: Math.round(gross.value * 100),
  }
}

/** Menge, Einheit, Ansatz und Dauer aus dem Mittelteil einer Zeile. */
function readRowDetails(cells: readonly string[]): {
  quantity: number
  unit: string
  rateHundredths: number | null
  rateUnit: string | null
  durationMonths: number | null
} {
  let quantity = 0
  let unit = ''
  let rateHundredths: number | null = null
  let rateUnit: string | null = null
  let durationMonths: number | null = null
  let gesehen = 0

  for (const cell of cells) {
    const text = cell.trim()

    const dauer = /^(\d+)\s*Mt\.?$/i.exec(text)
    if (dauer) {
      durationMonths = Number(dauer[1])
      continue
    }

    const zahl = parseNumber(text)
    if (zahl !== null) {
      if (gesehen === 0) quantity = zahl
      else if (gesehen === 1) rateHundredths = Math.round(zahl * 100)
      gesehen += 1
      continue
    }

    if (/^(Rp\.?|Fr\.?|CHF)$/i.test(text)) rateUnit = text
    else if (!unit) unit = text
  }

  return {
    quantity,
    unit: unit || 'Anzahl',
    rateHundredths,
    rateUnit,
    durationMonths,
  }
}

import {
  COST_GROUPS,
  type BillInput,
  type BillKind,
  type BillPosition,
  type CostGroup,
  type MeterReading,
  type Tariff,
} from '@manager/shared'

import type { PdfLine } from './pdf-text.js'

/**
 * Liest eine Rechnung der Energie- und Wasserversorgung aus den Zeilen, die
 * `pdf-text` aus dem PDF geholt hat.
 *
 * Der Parser arbeitet an Beschriftungen entlang, nicht an festen Zeilennummern:
 * „Rechnungsdatum:" steht auf jeder Rechnung, die dreizehnte Zeile bedeutet auf
 * jeder etwas anderes. Bekommt der Versorger ein neues Papier, verschiebt sich
 * damit höchstens eine Angabe – statt dass alles auf einmal falsch liegt.
 *
 * Was er nicht sicher lesen kann, erfindet er nicht: Fehlendes bleibt leer und
 * wird als Hinweis gemeldet. Die Vorschau im Browser ist ein Formular, in dem
 * sich das von Hand nachtragen lässt.
 */

export interface ParseResult {
  /** Die gelesene Rechnung – null, wenn das PDF keine Stromrechnung ist. */
  bill: BillInput | null
  /** Was auffiel: Fehlendes, Unstimmiges, Übersprungenes. */
  hinweise: string[]
}

/** Die Sparte, um die es auf der Rechnung geht. */
const ELEKTRIZITAET = 'Elektrizität'

/**
 * Die Abschlusszeilen der Betragsermittlung und die Gruppe, die sie beenden.
 *
 * Nicht die Überschriften darüber: Der Versorger schreibt über den Abgabenblock
 * ein zweites Mal „Netznutzung NS Haushalt", die Summenzeile darunter ist
 * dagegen eindeutig. Was zwischen zwei Summen steht, gehört zur zweiten.
 */
const GROUP_TOTALS: ReadonlyArray<{ prefix: string; group: CostGroup }> = [
  { prefix: 'total energie', group: 'energie' },
  { prefix: 'total netznutzung', group: 'netznutzung' },
  { prefix: 'total gesetzliche abgaben', group: 'abgaben' },
]

/** Die Beschriftungen der Zusammenfassung auf der ersten Seite. */
const SUMMARY_LABELS: ReadonlyArray<{ label: string; key: CostGroup }> = [
  { label: 'energie', key: 'energie' },
  { label: 'netznutzung', key: 'netznutzung' },
  { label: 'gesetzliche abgaben und förderbeiträge', key: 'abgaben' },
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
  const cleaned = raw.replace(/['’´`\s  ]/g, '').replace(',', '.')
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

// ------------------------------------------------------------------- Parser

export function parseElectricityInvoice(
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

  const sparte = readSubject(lines, kopf.lineIndex)
  if (sparte !== null && !sparte.includes(ELEKTRIZITAET)) {
    return {
      bill: null,
      hinweise: [
        `Diese Rechnung betrifft ${sparte} und enthält keinen Strom.`,
        'Im Bereich Strom lassen sich nur Stromrechnungen auswerten.',
      ],
    }
  }
  if (sparte === null) {
    hinweise.push('Die Sparte stand nicht auf der Rechnung – es wird Strom angenommen.')
  }

  const invoiceDate = findLabelledDate(lines, 'rechnungsdatum')
  const periode = findPeriod(lines)

  if (!invoiceDate) hinweise.push('Kein Rechnungsdatum gefunden.')
  if (!periode) hinweise.push('Keine Abrechnungsperiode gefunden.')

  const betraege = readSummary(lines)
  const readings = readMeterReadings(lines, hinweise)
  const positions = readPositions(lines)

  const subtotalCents =
    betraege.subtotalCents ?? betraege.energyCents + betraege.gridCents + betraege.leviesCents
  const totalCents = betraege.totalCents ?? subtotalCents - betraege.prepaidCents

  pruefeSummen(betraege, subtotalCents, totalCents, hinweise)

  if (kopf.kind === 'abrechnung' && readings.length === 0) {
    hinweise.push('Keine Zählerablesung gefunden – der Verbrauch wird aus den Positionen gelesen.')
  }

  const bill: BillInput = {
    kind: kopf.kind,
    invoiceNumber: kopf.invoiceNumber,
    invoiceDate: invoiceDate ?? periode?.periodEnd ?? '',
    periodStart: periode?.periodStart ?? '',
    periodEnd: periode?.periodEnd ?? '',
    customerNumber: findLabelledValue(lines, 'kundennummer'),
    meterPoint: findMeterPoint(lines),
    meterNumber: readings.find((entry) => entry.meterNumber)?.meterNumber ?? null,
    readings: readings.map(({ meterNumber: _meterNumber, ...reading }) => reading),
    positions,
    energyCents: betraege.energyCents,
    gridCents: betraege.gridCents,
    leviesCents: betraege.leviesCents,
    subtotalCents,
    prepaidCents: betraege.prepaidCents,
    totalCents,
    vatCents: betraege.vatCents,
    sourceFile,
    note: '',
  }

  return { bill, hinweise }
}

// --------------------------------------------------------------------- Kopf

interface Header {
  kind: BillKind
  invoiceNumber: string
  lineIndex: number
}

/**
 * „Abrechnung Nr. 231125" oder „Akontorechnung Nr. 232709".
 *
 * Die Unterscheidung trägt weit: Eine Akontorechnung ist eine Vorauszahlung
 * ohne eigenen Verbrauch. Wer sie wie eine Abrechnung zählt, hat den Strom
 * eines Jahres doppelt in der Statistik.
 */
function readHeader(lines: readonly PdfLine[]): Header | null {
  for (const [index, line] of lines.entries()) {
    for (const cell of line.cells) {
      const match = /^(Akontorechnung|Abrechnung|Rechnung)\s+Nr\.?\s*([\d'’ ]+)$/i.exec(cell.trim())
      if (!match) continue

      const invoiceNumber = (match[2] as string).replace(/['’\s]/g, '')
      if (!invoiceNumber) continue

      return {
        kind: /^akonto/i.test(match[1] as string) ? 'akonto' : 'abrechnung',
        invoiceNumber,
        lineIndex: index,
      }
    }
  }
  return null
}

/**
 * Die Sparte steht direkt unter der Rechnungsnummer: „Elektrizität" oder
 * „Wasser / Abwasser / Kehricht". Gesucht wird in den nächsten drei Zeilen –
 * weiter unten beginnen die Beträge, und ein Treffer dort wäre keiner.
 */
function readSubject(lines: readonly PdfLine[], from: number): string | null {
  for (const line of lines.slice(from + 1, from + 4)) {
    const text = line.cells[0]?.trim() ?? ''
    if (!text || line.cells.length > 1) continue
    if (/^periode vom/i.test(text)) break
    if (/^[A-Za-zÄÖÜäöü][A-Za-zÄÖÜäöüß /-]{2,60}$/.test(text)) return text
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

/** Die Messpunkt-Kennung („CH10716…"), egal ob mit oder ohne eigene Zelle. */
function findMeterPoint(lines: readonly PdfLine[]): string | null {
  for (const line of lines) {
    const match = /Messpunkt:?\s*(CH[\dA-Z]{10,40})/i.exec(line.text.replace(/\s+/g, ' '))
    if (match) return (match[1] as string).toUpperCase()
  }
  return null
}

// ---------------------------------------------------------------- Beträge

interface Summary {
  energyCents: number
  gridCents: number
  leviesCents: number
  subtotalCents: number | null
  prepaidCents: number
  totalCents: number | null
  vatCents: number
}

/**
 * Die Zusammenfassung der ersten Seite.
 *
 * Nur der Block zwischen der Sparte und dem Rechnungsbetrag wird gelesen. Die
 * Wörter „Energie" und „Netznutzung" stehen auf Seite zwei noch einmal als
 * Überschriften der Detailtabelle; ohne diese Grenze holte man sich von dort
 * die Summe ein zweites Mal.
 */
function readSummary(lines: readonly PdfLine[]): Summary {
  const summary: Summary = {
    energyCents: 0,
    gridCents: 0,
    leviesCents: 0,
    subtotalCents: null,
    prepaidCents: 0,
    totalCents: null,
    vatCents: 0,
  }

  const firstPage = lines.filter((line) => line.page === 1)

  for (const line of firstPage) {
    const label = key(line.cells[0] ?? '')
    const amount = parseCents(line.cells[line.cells.length - 1] ?? '')

    if (amount !== null && line.cells.length >= 2) {
      const treffer = SUMMARY_LABELS.find((entry) => label === entry.label)
      if (treffer) {
        if (treffer.key === 'energie') summary.energyCents = amount
        if (treffer.key === 'netznutzung') summary.gridCents = amount
        if (treffer.key === 'abgaben') summary.leviesCents = amount
      }

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

  return summary
}

function pruefeSummen(
  summary: Summary,
  subtotalCents: number,
  totalCents: number,
  hinweise: string[],
): void {
  const teile = summary.energyCents + summary.gridCents + summary.leviesCents

  // Ein Rappen Abweichung ist Rundung, alles darüber ein Lesefehler.
  if (summary.subtotalCents !== null && Math.abs(teile - summary.subtotalCents) > 1) {
    hinweise.push(
      `Energie, Netznutzung und Abgaben ergeben zusammen nicht das Zwischentotal (${format(teile)} statt ${format(summary.subtotalCents)}).`,
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

// ------------------------------------------------------------ Zählerstände

interface ReadingWithMeter extends MeterReading {
  meterNumber: string | null
}

/**
 * Die Verbrauchsermittlung: je Tarif eine oder mehrere Ablesungen.
 *
 * Ein Zählerwechsel erzeugt zwei Zeilen – eine bis zum alten Stand, eine ab dem
 * neuen. Deshalb wird je Tarif aufsummiert und nicht die letzte Zeile genommen:
 * Sonst fehlte der Verbrauch vor dem Wechsel.
 */
function readMeterReadings(lines: readonly PdfLine[], hinweise: string[]): ReadingWithMeter[] {
  const rows = tableRows(lines, /^verbrauchsermittlung$/i, /^betragsermittlung$/i)
  const perTariff = new Map<Tariff, ReadingWithMeter>()

  let current: Tariff | null = null

  for (const cells of rows) {
    const label = cells[0] ?? ''
    if (!isNumeric(label) && !parseSwissDate(label)) {
      const tarif = tariffOf(label)
      if (tarif) current = tarif
      else if (/verbrauch/i.test(label)) current = 'hoch'
    }
    if (!current) continue

    // Die Messperiode besteht aus zwei Daten mit einem Strich dazwischen; was
    // danach an Zahlen folgt, ist die eigentliche Ablesung.
    const zahlen = cells.filter((cell) => isNumeric(cell) && !parseSwissDate(cell))
    if (zahlen.length < 3) continue

    const menge = parseNumber(zahlen[zahlen.length - 1] as string)
    const standNeu = parseNumber(zahlen[zahlen.length - 2] as string)
    const standAlt = parseNumber(zahlen[zahlen.length - 3] as string)
    if (menge === null || standNeu === null || standAlt === null) continue

    const meterNumber = zahlen.length >= 4 ? (zahlen[zahlen.length - 4] as string).trim() : null

    if (standNeu - standAlt !== menge) {
      hinweise.push(
        `Beim ${TARIFF_TEXT[current]} passt die Menge nicht zu den Zählerständen (${standAlt} → ${standNeu} ergibt ${standNeu - standAlt}, verrechnet sind ${menge}).`,
      )
    }

    const vorhanden = perTariff.get(current)
    if (vorhanden) {
      vorhanden.kwh += Math.round(menge)
      vorhanden.endValue = Math.round(standNeu)
      vorhanden.meterNumber = vorhanden.meterNumber ?? meterNumber
    } else {
      perTariff.set(current, {
        tariff: current,
        startValue: Math.round(standAlt),
        endValue: Math.round(standNeu),
        kwh: Math.round(menge),
        meterNumber,
      })
    }
  }

  return [...perTariff.values()]
}

const TARIFF_TEXT: Record<Tariff, string> = { hoch: 'Hochtarif', nieder: 'Niedertarif' }

function tariffOf(label: string): Tariff | null {
  const text = label.toLowerCase()
  if (text.includes('hochtarif')) return 'hoch'
  if (text.includes('niedertarif')) return 'nieder'
  return null
}

// ------------------------------------------------------------- Positionen

/**
 * Die Betragsermittlung, Zeile für Zeile.
 *
 * Gelesen wird von aussen nach innen: Die drei letzten Zahlen einer Zeile sind
 * immer Betrag ohne MWST, Steuersatz und Betrag mit MWST – in dieser Reihenfolge,
 * unabhängig davon, ob davor eine Dauer oder eine Einheit steht. Von links kommt
 * die Beschriftung, danach Menge und Ansatz. So überstehen die Zeilen es, dass
 * der Grundpreis eine Spalte weniger belegt als der Verbrauch.
 */
function readPositions(lines: readonly PdfLine[]): BillPosition[] {
  const positions: BillPosition[] = []
  let pending: Array<Omit<BillPosition, 'group'>> = []

  for (const line of lines) {
    const first = key(line.cells[0] ?? '')

    const abschluss = GROUP_TOTALS.find((entry) => first.startsWith(entry.prefix))
    if (abschluss) {
      for (const position of pending) positions.push({ ...position, group: abschluss.group })
      pending = []
      continue
    }

    // „Total Wasser", „Total Objekt" und Ähnliches beenden einen Block, der
    // uns nichts angeht – das Gesammelte gehört dann zu keiner Stromgruppe.
    if (first.startsWith('total ') || first === 'zwischentotal') {
      pending = []
      continue
    }

    const position = parsePositionRow(line.cells)
    if (position) pending.push(position)
  }

  return positions
}

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

/**
 * Die Zeilen einer Tabelle: alles zwischen ihrer Überschrift und der nächsten.
 * Die Kopfzeile selbst fällt weg, sie beschreibt Spalten und keine Werte.
 */
function tableRows(
  lines: readonly PdfLine[],
  start: RegExp,
  end: RegExp,
): Array<readonly string[]> {
  const rows: Array<readonly string[]> = []
  let inside = false

  for (const line of lines) {
    const first = line.cells[0]?.trim() ?? ''

    if (start.test(first)) {
      inside = true
      continue
    }
    if (!inside) continue
    if (end.test(first)) {
      inside = false
      continue
    }
    rows.push(line.cells)
  }

  return rows
}

/** Nur für Tests und Fehlersuche: die bekannten Kostengruppen der Reihe nach. */
export const KNOWN_GROUPS = COST_GROUPS

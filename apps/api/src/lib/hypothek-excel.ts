import {
  EMPTY_MORTGAGE_SETTINGS,
  formatAmount,
  formatDate,
  hypothekImportSchema,
  LOAN_KIND_LABELS,
  quarterEnd,
  quarterOfDate,
  quarterStart,
  type HypothekImportInput,
  type LoanKind,
  type MortgageSettings,
  type Quarter,
} from '@manager/shared'

import type { Blatt, Zellwert } from '../ocr/office.js'

/**
 * Die Hypothek aus der eigenen Excel-Tabelle übernehmen.
 *
 * Gelesen wird an den Beschriftungen entlang und nicht an Zellen: „C4" ist
 * heute der Betrag der Festhypothek und morgen, nach einer eingefügten Zeile,
 * ihr Zinssatz. Erkannt wird, was in der Tabelle des Haushalts steht und in
 * ähnlich gebauten Tabellen auch:
 *
 * - eine Kopfzeile mit Quartalen („IST Q3 2024", „Q4 2025") – die Spalten
 *   der bezahlten Zinsen;
 * - je Hypothek eine Zeile mit „…hypothek" und ihrem Betrag, darunter Zinssatz
 *   oder Marge, „Laufzeit bis …" und die erste Zeile mit Quartalswerten;
 * - Liegenschaftswert, Total Hypothek, 1. Hypothek, Amortisation pro Jahr,
 *   „Bereits amortisiert (per …)" und der Leitzins, auf welchem Blatt auch
 *   immer sie stehen.
 *
 * Was nicht in der Tabelle steht, wird abgeleitet und als Hinweis genannt –
 * etwa der Beginn einer Hypothek aus ihrer ersten Zinszahlung. Gespeichert
 * wird nichts: Das Ergebnis ist eine Vorschau, die erst übernommen wird, wenn
 * jemand sie bestätigt.
 */

interface Zeile {
  /** Die Beschriftung, vereinheitlicht: klein, Umlaute als solche, einfache Leerzeichen. */
  schluessel: string
  /** So, wie sie in der Tabelle steht. */
  text: string
  /** Die erste Zahl rechts der Beschriftung, vor den Quartalsspalten. */
  wert: number | null
  /** Die Werte in den Quartalsspalten, soweit es dort Zahlen gibt. */
  quartale: Map<string, number>
}

interface QuartalsSpalte {
  year: number
  quarter: Quarter
  key: string
}

interface Gelesen {
  name: string
  kind: LoanKind
  amountCents: number
  rateMillipercent: number | null
  endDate: string | null
  note: string
  interest: Map<string, number>
}

const QUARTAL = /\bQ\s*([1-4])\s*[/.-]?\s*((?:19|20)\d{2})\b/i
const DATUM = /(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})/

/**
 * Ein Datum aus Excel: die fortlaufende Tagesnummer seit dem 30.12.1899.
 * Nur für Zahlen, die überhaupt ein Datum der letzten hundert Jahre sein können.
 */
export function excelDatum(seriennummer: number): string | null {
  if (!Number.isFinite(seriennummer) || seriennummer < 10_000 || seriennummer > 80_000) return null
  const ms = Date.UTC(1899, 11, 30) + Math.floor(seriennummer) * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function vereinheitlicht(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function datumAus(text: string): string | null {
  const treffer = DATUM.exec(text)
  if (!treffer) return null
  const [, tag = '', monat = '', jahr = ''] = treffer
  const iso = `${jahr}-${monat.padStart(2, '0')}-${tag.padStart(2, '0')}`
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso
}

/**
 * Ein Zinssatz aus einer Zelle. Excel speichert „1.13 %" als 0.0113; wer die
 * Zahl ohne Prozentformat eingetippt hat, hat 1.13 stehen. Unter 0.2 ist es
 * deshalb ein Anteil, darüber eine Prozentzahl – Hypothekarzinsen über 20 %
 * gibt es nicht.
 */
function zinsAus(wert: number): number | null {
  if (!Number.isFinite(wert) || wert < 0) return null
  if (wert < 0.2) return Math.round(wert * 100_000)
  if (wert <= 20) return Math.round(wert * 1000)
  return null
}

function rappen(wert: number): number {
  return Math.round(wert * 100)
}

/** Die Kopfzeile mit den meisten Quartalen – auf welchem Blatt sie auch steht. */
function quartalsKopf(
  blaetter: readonly Blatt[],
): { blatt: Blatt; zeile: number; spalten: Map<number, QuartalsSpalte> } | null {
  let bester: { blatt: Blatt; zeile: number; spalten: Map<number, QuartalsSpalte> } | null = null

  for (const blatt of blaetter) {
    for (const [nummer, zellen] of blatt.zeilen) {
      const spalten = new Map<number, QuartalsSpalte>()
      for (const [spalte, wert] of zellen) {
        if (typeof wert !== 'string') continue
        const treffer = QUARTAL.exec(wert)
        if (!treffer) continue
        const quarter = Number(treffer[1]) as Quarter
        const year = Number(treffer[2])
        spalten.set(spalte, { year, quarter, key: `${year}-Q${quarter}` })
      }
      if (spalten.size > (bester?.spalten.size ?? 0)) bester = { blatt, zeile: nummer, spalten }
    }
  }
  return bester
}

function zeilenVon(blatt: Blatt, quartale: Map<number, QuartalsSpalte> | null, kopfzeile: number | null): Zeile[] {
  const ersteQuartalsSpalte = quartale ? Math.min(...quartale.keys()) : Number.POSITIVE_INFINITY

  return [...blatt.zeilen.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([nummer]) => nummer !== kopfzeile)
    .flatMap(([, zellen]) => {
      const reihe = [...zellen.entries()].sort(([a], [b]) => a - b)
      const beschriftung = reihe.find(
        ([spalte, wert]) => typeof wert === 'string' && wert.trim() !== '' && spalte < ersteQuartalsSpalte,
      )
      if (!beschriftung) return []
      const [spalteText, text] = beschriftung as [number, string]

      const wert = reihe.find(
        ([spalte, zelle]: [number, Zellwert]) =>
          spalte > spalteText && spalte < ersteQuartalsSpalte && typeof zelle === 'number',
      )?.[1] as number | undefined

      const werte = new Map<string, number>()
      if (quartale) {
        for (const [spalte, zelle] of reihe) {
          const quartal = quartale.get(spalte)
          if (quartal && typeof zelle === 'number' && Number.isFinite(zelle)) werte.set(quartal.key, zelle)
        }
      }

      return [{ schluessel: vereinheitlicht(text), text: text.replace(/\s+/g, ' ').trim(), wert: wert ?? null, quartale: werte }]
    })
}

/** Beginnt hier eine Hypothek? „Neue Festhypothek 0003 | 300'000" – aber nicht „Total Kosten Festhypothek". */
function istHypothek(zeile: Zeile): boolean {
  return (
    /hypothek/.test(zeile.schluessel) &&
    !/anteil|total|kosten|amortis|^\d\.\s*hypothek|zins/.test(zeile.schluessel) &&
    zeile.wert !== null &&
    zeile.wert >= 1000
  )
}

/** Wo der Block einer Hypothek zu Ende ist – bei den Summen und der Amortisation. */
function beendetBlock(zeile: Zeile): boolean {
  return /anteil|^total|amortis/.test(zeile.schluessel)
}

function hypothekName(zeile: Zeile, kind: LoanKind): string {
  const nummer = /\b(\d{3,})\b/.exec(zeile.text)?.[1]
  if (nummer) return `${LOAN_KIND_LABELS[kind]} ${nummer}`
  return zeile.text.replace(/^(neue|übernahme|uebernahme)\s+/i, '')
}

/**
 * Ob die Beschriftung mehr sagt als Art und Nummer – „Übernahme", die Bank.
 * Das bleibt dann in der Notiz, der Name wird einheitlich.
 */
function zusatz(zeile: Zeile): boolean {
  return (
    zeile.schluessel
      .replace(/\b\d{3,}\b/g, '')
      .replace(/\b(neue|fest|festhypothek|saron|hypothek|saron-hypothek)\b/g, '')
      .replace(/[\s-]+/g, '') !== ''
  )
}

function quartalVon(key: string): { year: number; quarter: Quarter } {
  const [jahr, quartal] = key.split('-Q')
  return { year: Number(jahr), quarter: Number(quartal) as Quarter }
}

function ordnung(key: string): number {
  const { year, quarter } = quartalVon(key)
  return year * 4 + quarter
}

export function parseHypothekExcel(blaetter: readonly Blatt[]): {
  daten: HypothekImportInput | null
  hinweise: string[]
} {
  const hinweise: string[] = []
  const kopf = quartalsKopf(blaetter)

  const settings: MortgageSettings = { ...EMPTY_MORTGAGE_SETTINGS }
  const gefunden = new Set<keyof MortgageSettings>()
  const setze = <K extends keyof MortgageSettings>(feld: K, wert: MortgageSettings[K]) => {
    if (gefunden.has(feld)) return
    settings[feld] = wert
    gefunden.add(feld)
  }

  const hypotheken: Gelesen[] = []

  for (const blatt of blaetter) {
    const istZinsblatt = kopf?.blatt === blatt
    const zeilen = zeilenVon(blatt, istZinsblatt ? kopf.spalten : null, istZinsblatt ? kopf.zeile : null)
    let aktuell: Gelesen | null = null

    for (const zeile of zeilen) {
      const { schluessel, wert } = zeile

      // Was für die ganze Hypothek gilt, zählt überall – zuerst gefunden gewinnt.
      if (wert !== null) {
        if (/liegenschaftswert|verkehrswert|marktwert/.test(schluessel)) setze('propertyValueCents', rappen(wert))
        else if (/^(total hypothek|hypothek total)\b/.test(schluessel)) setze('mortgageTotalCents', rappen(wert))
        else if (/^1\.\s*hypothek/.test(schluessel)) setze('firstMortgageCents', rappen(wert))
        else if (/amortisation pro jahr|jährliche amortisation/.test(schluessel)) {
          setze('amortizationPerYearCents', rappen(wert))
        } else if (/bereits amortisiert/.test(schluessel)) {
          setze('carriedOverCents', rappen(wert))
          const per = datumAus(zeile.text)
          if (per) setze('carriedOverDate', per)
        } else if (/leitzins|referenzzins|^saron\b(?!.*hypothek)/.test(schluessel)) {
          const zins = zinsAus(wert)
          if (zins !== null) setze('referenceRateMillipercent', zins)
        }
      }

      if (!istZinsblatt) continue

      if (istHypothek(zeile)) {
        const kind: LoanKind = /saron/.test(schluessel) ? 'saron' : 'fest'
        const name = hypothekName(zeile, kind)
        aktuell = {
          name,
          kind,
          amountCents: rappen(zeile.wert ?? 0),
          rateMillipercent: null,
          endDate: null,
          note: zusatz(zeile) ? `In der Tabelle: ${zeile.text}` : '',
          interest: new Map(),
        }
        hypotheken.push(aktuell)
        continue
      }

      if (!aktuell) continue
      if (beendetBlock(zeile)) {
        aktuell = null
        continue
      }

      if (wert !== null && /marge/.test(schluessel)) {
        aktuell.rateMillipercent = zinsAus(wert)
      } else if (wert !== null && /zinssatz/.test(schluessel)) {
        // Bei der SARON-Hypothek ist der „Zinssatz" Leitzins plus Marge – die
        // Marge steht eigens darüber und gilt.
        if (aktuell.kind === 'fest' || aktuell.rateMillipercent === null) {
          aktuell.rateMillipercent = zinsAus(wert)
        }
      }

      if (/laufzeit|ablauf|fällig/.test(schluessel)) {
        aktuell.endDate = datumAus(zeile.text) ?? (wert !== null ? excelDatum(wert) : null)
      }

      if (aktuell.interest.size === 0 && zeile.quartale.size > 0) {
        for (const [key, betrag] of zeile.quartale) aktuell.interest.set(key, rappen(betrag))
      }
    }
  }

  if (hypotheken.length === 0) {
    return {
      daten: null,
      hinweise: [
        'In dieser Datei steht keine Hypothek, die sich lesen liesse – gesucht wird eine Zeile wie „Festhypothek 0003" mit ihrem Betrag daneben.',
      ],
    }
  }

  // Das jüngste Quartal, für das überhaupt etwas bezahlt ist: Wer davor
  // aufhört, ist ausgelaufen; wer bis dahin reicht, läuft noch.
  const alleQuartale = hypotheken.flatMap((hypothek) => [...hypothek.interest.keys()])
  const juengstes = alleQuartale.length > 0 ? Math.max(...alleQuartale.map(ordnung)) : null
  const fruehestesKopf = kopf
    ? [...kopf.spalten.values()].sort((a, b) => ordnung(a.key) - ordnung(b.key))[0] ?? null
    : null

  const loans = hypotheken.map((hypothek) => {
    const quartale = [...hypothek.interest.keys()].sort((a, b) => ordnung(a) - ordnung(b))
    const erstes = quartale[0]
    const letztes = quartale.at(-1)

    let startDate: string
    if (erstes) {
      const { year, quarter } = quartalVon(erstes)
      startDate = quarterStart(year, quarter)
    } else if (fruehestesKopf) {
      startDate = quarterStart(fruehestesKopf.year, fruehestesKopf.quarter)
    } else {
      startDate = new Date().toISOString().slice(0, 10)
    }

    let endDate = hypothek.endDate
    if (endDate === null && letztes && juengstes !== null && ordnung(letztes) < juengstes) {
      const { year, quarter } = quartalVon(letztes)
      endDate = quarterEnd(year, quarter)
      hinweise.push(
        `${hypothek.name}: Ende aus der letzten Zinszahlung abgeleitet (${formatDate(endDate)}).`,
      )
    }
    if (endDate !== null && endDate < startDate) endDate = null

    if (hypothek.rateMillipercent === null) {
      hinweise.push(
        `${hypothek.name}: ${hypothek.kind === 'saron' ? 'Marge' : 'Zinssatz'} nicht gefunden – bitte nach dem Übernehmen ergänzen.`,
      )
    }

    return {
      name: hypothek.name,
      kind: hypothek.kind,
      amountCents: hypothek.amountCents,
      rateMillipercent: hypothek.rateMillipercent ?? 0,
      startDate,
      endDate,
      note: hypothek.note,
      interest: quartale.map((key) => ({ ...quartalVon(key), amountCents: hypothek.interest.get(key) ?? 0 })),
    }
  })

  hinweise.unshift(
    'Der Beginn jeder Hypothek ist aus ihrer ersten Zinszahlung abgeleitet – die Tabelle nennt ihn nicht. Nach dem Übernehmen lässt er sich bei jeder Hypothek anpassen.',
  )

  if (!gefunden.has('mortgageTotalCents')) {
    const laufend = loans.filter((loan) => {
      if (loan.endDate === null || juengstes === null) return true
      const { year, quarter } = quarterOfDate(loan.endDate)
      return year * 4 + quarter >= juengstes
    })
    settings.mortgageTotalCents = laufend.reduce((sum, loan) => sum + loan.amountCents, 0)
    hinweise.push(
      `Total Hypothek nicht gefunden – angenommen sind die laufenden Hypotheken, zusammen CHF ${formatAmount(settings.mortgageTotalCents)}.`,
    )
  }
  if (!gefunden.has('firstMortgageCents') && settings.propertyValueCents > 0) {
    settings.firstMortgageCents = Math.round((settings.propertyValueCents * 2) / 3)
    hinweise.push('1. Hypothek nicht gefunden – angenommen sind zwei Drittel des Liegenschaftswerts.')
  }
  if (settings.carriedOverCents > 0) {
    hinweise.push(
      `Bereits amortisiert: CHF ${formatAmount(settings.carriedOverCents)}${
        settings.carriedOverDate ? ` per ${formatDate(settings.carriedOverDate)}` : ''
      } – wird als Übertrag geführt, die Tranchen danach erfasst du einzeln.`,
    )
  }

  const geprueft = hypothekImportSchema.safeParse({ settings, loans })
  if (!geprueft.success) {
    return {
      daten: null,
      hinweise: [
        ...hinweise,
        `Die gelesenen Werte ergeben keine gültige Hypothek (${geprueft.error.issues[0]?.message ?? 'unbekannter Fehler'}).`,
      ],
    }
  }
  return { daten: geprueft.data, hinweise }
}

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'

import { readXlsx, spaltenNummer } from '../ocr/office.ts'
import { excelDatum, parseHypothekExcel } from './hypothek-excel.ts'

/** Ein ZIP-Archiv, gepackt wie von Excel – knapp, aber mit zentralem Verzeichnis. */
function zip(teile: Record<string, string>): Buffer {
  const koepfe: Buffer[] = []
  const verzeichnis: Buffer[] = []
  let offset = 0
  for (const [name, inhalt] of Object.entries(teile)) {
    const roh = Buffer.from(inhalt, 'utf8')
    const daten = deflateRawSync(roh)
    const namensBytes = Buffer.from(name, 'utf8')

    const kopf = Buffer.alloc(30)
    kopf.writeUInt32LE(0x04034b50, 0)
    kopf.writeUInt16LE(20, 4)
    kopf.writeUInt16LE(8, 8)
    kopf.writeUInt32LE(crc32(roh), 14)
    kopf.writeUInt32LE(daten.length, 18)
    kopf.writeUInt32LE(roh.length, 22)
    kopf.writeUInt16LE(namensBytes.length, 26)
    koepfe.push(kopf, namensBytes, daten)

    const eintrag = Buffer.alloc(46)
    eintrag.writeUInt32LE(0x02014b50, 0)
    eintrag.writeUInt16LE(20, 4)
    eintrag.writeUInt16LE(20, 6)
    eintrag.writeUInt16LE(8, 10)
    eintrag.writeUInt32LE(crc32(roh), 16)
    eintrag.writeUInt32LE(daten.length, 20)
    eintrag.writeUInt32LE(roh.length, 24)
    eintrag.writeUInt16LE(namensBytes.length, 28)
    eintrag.writeUInt32LE(offset, 42)
    verzeichnis.push(eintrag, namensBytes)
    offset += 30 + namensBytes.length + daten.length
  }
  const verzeichnisBytes = Buffer.concat(verzeichnis)
  const ende = Buffer.alloc(22)
  ende.writeUInt32LE(0x06054b50, 0)
  ende.writeUInt16LE(Object.keys(teile).length, 8)
  ende.writeUInt16LE(Object.keys(teile).length, 10)
  ende.writeUInt32LE(verzeichnisBytes.length, 12)
  ende.writeUInt32LE(offset, 16)
  return Buffer.concat([...koepfe, verzeichnisBytes, ende])
}

/** Eine Zelle: Zahl, Text, oder eine Formel mit dem Wert, den Excel zuletzt gerechnet hat. */
type Zelle = number | string | { f: string; v: number | string }

/**
 * Eine Arbeitsmappe aus Blättern, gespeichert wie Excel es tut: Texte in der
 * gemeinsamen Liste, Formeln mit ihrem letzten Ergebnis, Blätter über die
 * Verweise der Mappe gefunden.
 */
function mappe(blaetter: { name: string; zellen: Record<string, Zelle> }[]): Buffer {
  const texte: string[] = []
  const textNummer = (text: string): number => {
    const vorhanden = texte.indexOf(text)
    if (vorhanden >= 0) return vorhanden
    texte.push(text)
    return texte.length - 1
  }
  const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

  const teile: Record<string, string> = {}
  blaetter.forEach((blatt, index) => {
    const zeilen = new Map<number, string[]>()
    const sortiert = Object.entries(blatt.zellen).sort(([a], [b]) => {
      const [, sa = '', za = ''] = /^([A-Z]+)(\d+)$/.exec(a) ?? []
      const [, sb = '', zb = ''] = /^([A-Z]+)(\d+)$/.exec(b) ?? []
      return Number(za) - Number(zb) || spaltenNummer(sa) - spaltenNummer(sb)
    })
    for (const [ref, zelle] of sortiert) {
      const zeile = Number(/\d+$/.exec(ref)?.[0])
      let c: string
      if (typeof zelle === 'number') c = `<c r="${ref}" s="1"><v>${zelle}</v></c>`
      else if (typeof zelle === 'string') c = `<c r="${ref}" t="s"><v>${textNummer(zelle)}</v></c>`
      else if (typeof zelle.v === 'string') c = `<c r="${ref}" t="str"><f>${xml(zelle.f)}</f><v>${xml(zelle.v)}</v></c>`
      else c = `<c r="${ref}" s="2"><f>${xml(zelle.f)}</f><v>${zelle.v}</v></c>`
      zeilen.set(zeile, [...(zeilen.get(zeile) ?? []), c])
    }
    const daten = [...zeilen.entries()]
      .map(([nummer, zellen]) => `<row r="${nummer}">${zellen.join('')}</row>`)
      .join('')
    teile[`xl/worksheets/sheet${index + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${daten}</sheetData></worksheet>`
  })

  teile['xl/workbook.xml'] =
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${blaetter
      .map((blatt, index) => `<sheet name="${xml(blatt.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join('')}</sheets></workbook>`
  teile['xl/_rels/workbook.xml.rels'] =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${blaetter
      .map(
        (_blatt, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join('')}</Relationships>`
  teile['xl/sharedStrings.xml'] =
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${texte.length}">${texte
      .map((text) => `<si><t>${xml(text)}</t></si>`)
      .join('')}</sst>`
  return zip(teile)
}

const QUARTALE = ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']

/** Eine Zeile mit Quartalswerten ab Spalte E – leere Werte bleiben leer. */
function reihe(zeile: number, werte: (number | null)[]): Record<string, Zelle> {
  const zellen: Record<string, Zelle> = {}
  werte.forEach((wert, index) => {
    if (wert !== null) zellen[`${QUARTALE[index]}${zeile}`] = wert
  })
  return zellen
}

/**
 * Die Tabelle, aus der der Haushalt seine Hypothek übernimmt – Blatt für
 * Blatt nachgebaut, samt Formeln, eines veralteten Totals („Hypothek Anteil
 * Fest") und der Summenzeilen, die keine Hypothek sind.
 */
function hypothekTabelle(): Buffer {
  return mappe([
    {
      name: 'Hypothek IST Kosten',
      zellen: {
        C1: 'Prognose',
        E1: 'IST Q3 2024',
        F1: 'IST Q4 2024',
        G1: 'IST Q1 2025',
        H1: 'IST Q2 2025',
        I1: 'IST Q3 2025',
        J1: 'IST Q4 2025',
        K1: 'IST Q1 2026',
        L1: 'IST Q2 2026',
        M1: 'IST Q3 2026',
        N1: 'IST Q4 2026',
        B2: 'Hypothek Anteil Fest',
        C2: { f: 'C4+C9', v: 420000 },
        B4: 'Übernahme Festhypothek 0004',
        C4: 120000,
        B5: 'Zinssatz',
        C5: 0.0113,
        B6: 'Monatliche Zinskosten',
        C6: { f: 'C4*C5/12', v: 113 },
        ...reihe(6, [339, 339, 339, 339, 339]),
        B7: 'Laufzeit bis 30.09.2025',
        B9: 'Neue Festhypothek 0003',
        C9: 300000,
        B10: 'Zinssatz',
        C10: 0.025,
        B11: 'Monatliche Zinskosten',
        C11: { f: 'C9*C10/12', v: 625 },
        E11: { f: 'C11*3', v: 1875 },
        ...reihe(11, [null, 1875, 1875, 1875, 1875, 1875, 1875, 1875, 1875]),
        B12: 'Laufzeit bis 01.09.2028',
        B14: 'Neue Festhypothek 0007',
        C14: 152000,
        B15: 'Zinssatz',
        C15: 0.011,
        B16: 'Monatliche Zinskosten',
        C16: { f: 'C14*C15/12', v: 139.33333333333334 },
        ...reihe(16, [null, null, null, null, null, 418, 418, 418, 418]),
        B17: 'Laufzeit bis 29.09.2028',
        B19: 'Total Kosten Festhypothek pro Monat',
        C19: { f: 'C16+C11', v: 764.3333333333334 },
        ...reihe(19, [738, 738, 738, 738, 738, 764.33, 764.33, 764.33, 764.33, 0]),
        B22: 'Hypothek Anteil Saron',
        C22: { f: 'C24+C32', v: 452000 },
        B24: 'UBS SARON Hypothek 0005',
        C24: 420000,
        B25: 'Leitzins SNB',
        C25: 0,
        B26: 'Marge Saron',
        C26: 0.006,
        B27: 'Zinssatz per 31.12.2025',
        C27: { f: 'C25+C26', v: 0.006 },
        B28: 'Monatliche Kosten',
        C28: { f: 'C24*C27/12', v: 210 },
        B29: 'Berechnung Zinsveränderung',
        ...reihe(29, [1934.25, 1558.9, 1064.4, 822.15, 644, 644, 644, 630, 644]),
        B32: 'UBS SARON Hypothek  0006',
        C32: 32000,
        B33: 'Leitzins SNB',
        C33: { f: 'C25', v: 0 },
        B34: 'Marge Saron',
        C34: 0.009,
        B35: { f: 'B27', v: 'Zinssatz per 31.12.2025' },
        C35: { f: 'C33+C34', v: 0.009 },
        B36: 'Monatliche Kosten',
        C36: { f: 'C32*C35/12', v: 24 },
        B37: 'Berechnung Zinsveränderung',
        ...reihe(37, [171.9, 143.3, 105.1, 86.9, 73.6]),
        B41: 'Total Kosten Saron pro Monat',
        C41: { f: 'C28', v: 210 },
        B44: 'Total Kosten Hypothek pro Monat',
        C44: { f: 'C41+C19', v: 974.33 },
        B48: 'Amortisation',
        B50: 'Amortisation pro Jahr',
        C50: 14000,
        ...reihe(50, [null, null, 14000, 14000, 14000, 14000, 14000, 14000, 14000, 14000]),
        B58: 'Gesamtkosten pro Monat',
        C58: { f: 'C44+C54', v: 2141 },
      },
    },
    {
      name: 'Amortisation 2. Hypothek',
      zellen: {
        B1: 'Amortisation Hypothek',
        B3: 'Liegenschaftswert',
        C3: 1090000,
        B4: 'Total Hypothek',
        C4: 872000,
        B5: '1. Hypothek',
        C5: 726667,
        B6: '2. Hypothek',
        C6: { f: 'C4-C5', v: 145333 },
        B7: 'Amortisation pro Jahr',
        C7: 14000,
        B8: 'Anzahl Jahre',
        C8: { f: 'C6/C7', v: 10.380928571428571 },
        B10: 'Bereits amortisiert (per 31.12.2025)',
        C10: { f: '4*7000', v: 28000 },
        B12: 'Restwert',
        C12: { f: 'C6-C10', v: 117333 },
      },
    },
  ])
}

// --------------------------------------------------------------------- xlsx

describe('readXlsx', () => {
  it('liest Texte, Zahlen und die Ergebnisse von Formeln', () => {
    const [ist, amortisation] = readXlsx(hypothekTabelle())

    assert.equal(ist?.name, 'Hypothek IST Kosten')
    assert.equal(amortisation?.name, 'Amortisation 2. Hypothek')
    assert.equal(ist?.zeilen.get(4)?.get(2), 'Übernahme Festhypothek 0004')
    assert.equal(ist?.zeilen.get(5)?.get(3), 0.0113)
    assert.equal(ist?.zeilen.get(11)?.get(5), 1875)
    // Eine Formel, die Text ergibt (=B27), kommt als Text.
    assert.equal(ist?.zeilen.get(35)?.get(2), 'Zinssatz per 31.12.2025')
    assert.equal(amortisation?.zeilen.get(10)?.get(3), 28000)
  })

  it('weist eine Datei ab, die kein Excel ist', () => {
    assert.throws(() => readXlsx(Buffer.from('kein zip')))
  })

  it('kennt Spalten und Excel-Daten', () => {
    assert.equal(spaltenNummer('C'), 3)
    assert.equal(spaltenNummer('AA'), 27)
    assert.equal(excelDatum(45930), '2025-09-30')
    assert.equal(excelDatum(14000), '1938-04-30')
    assert.equal(excelDatum(12), null)
  })
})

// ---------------------------------------------------------------- Hypothek

describe('parseHypothekExcel – die Tabelle des Haushalts', () => {
  const { daten, hinweise } = parseHypothekExcel(readXlsx(hypothekTabelle()))

  it('findet alle fünf Hypotheken und keine Summenzeile', () => {
    assert.deepEqual(
      daten?.loans.map((loan) => [loan.name, loan.kind, loan.amountCents, loan.rateMillipercent]),
      [
        ['Festhypothek 0004', 'fest', 12_000_000, 1130],
        ['Festhypothek 0003', 'fest', 30_000_000, 2500],
        ['Festhypothek 0007', 'fest', 15_200_000, 1100],
        ['SARON-Hypothek 0005', 'saron', 42_000_000, 600],
        ['SARON-Hypothek 0006', 'saron', 3_200_000, 900],
      ],
    )
  })

  it('übernimmt Laufzeiten und leitet fehlende aus den Zinszahlungen ab', () => {
    const laufzeit = Object.fromEntries(
      daten?.loans.map((loan) => [loan.name, [loan.startDate, loan.endDate]]) ?? [],
    )
    assert.deepEqual(laufzeit['Festhypothek 0004'], ['2024-07-01', '2025-09-30'])
    assert.deepEqual(laufzeit['Festhypothek 0003'], ['2024-07-01', '2028-09-01'])
    assert.deepEqual(laufzeit['Festhypothek 0007'], ['2025-10-01', '2028-09-29'])
    // Zahlt bis zum jüngsten Quartal – läuft noch.
    assert.deepEqual(laufzeit['SARON-Hypothek 0005'], ['2024-07-01', null])
    // Hört ein Jahr früher auf – ist in der 0007 aufgegangen.
    assert.deepEqual(laufzeit['SARON-Hypothek 0006'], ['2024-07-01', '2025-09-30'])
    assert.ok(hinweise.some((hinweis) => /SARON-Hypothek 0006: Ende aus der letzten Zinszahlung/.test(hinweis)))
  })

  it('liest die bezahlten Zinsen je Quartal', () => {
    const saron = daten?.loans.find((loan) => loan.name === 'SARON-Hypothek 0005')
    assert.equal(saron?.interest.length, 9)
    assert.deepEqual(saron?.interest[0], { year: 2024, quarter: 3, amountCents: 193_425 })
    assert.deepEqual(saron?.interest.at(-1), { year: 2026, quarter: 3, amountCents: 64_400 })

    // Der erste Wert der 0003 ist eine Formel (=C11*3) – zählt trotzdem.
    const fest = daten?.loans.find((loan) => loan.name === 'Festhypothek 0003')
    assert.equal(fest?.interest.length, 9)
    assert.ok(fest?.interest.every((entry) => entry.amountCents === 187_500))
  })

  it('übernimmt die Grunddaten von beiden Blättern', () => {
    assert.deepEqual(daten?.settings, {
      propertyValueCents: 109_000_000,
      mortgageTotalCents: 87_200_000,
      firstMortgageCents: 72_666_700,
      amortizationPerYearCents: 1_400_000,
      carriedOverCents: 2_800_000,
      carriedOverDate: '2025-12-31',
      referenceRateMillipercent: 0,
    })
  })

  it('behält, was der Name nicht mehr sagt, in der Notiz', () => {
    const notizen = Object.fromEntries(daten?.loans.map((loan) => [loan.name, loan.note]) ?? [])
    assert.equal(notizen['Festhypothek 0004'], 'In der Tabelle: Übernahme Festhypothek 0004')
    assert.equal(notizen['Festhypothek 0003'], '')
    assert.equal(notizen['SARON-Hypothek 0006'], 'In der Tabelle: UBS SARON Hypothek 0006')
  })
})

describe('parseHypothekExcel – was nicht passt', () => {
  it('meldet eine Tabelle ohne Hypothek, statt etwas zu erfinden', () => {
    const { daten, hinweise } = parseHypothekExcel(
      readXlsx(mappe([{ name: 'Budget', zellen: { B2: 'Ferien', C2: 3000 } }])),
    )
    assert.equal(daten, null)
    assert.match(hinweise[0] ?? '', /keine Hypothek/)
  })

  it('ergänzt fehlende Grunddaten und sagt es', () => {
    const { daten, hinweise } = parseHypothekExcel(
      readXlsx(
        mappe([
          {
            name: 'Hypothek',
            zellen: {
              E1: 'Q1 2026',
              F1: 'Q2 2026',
              B2: 'Liegenschaftswert',
              C2: 900000,
              B4: 'Festhypothek 1234',
              C4: 500000,
              B5: 'Zinssatz',
              C5: 1.5,
              B6: 'Zinsen',
              E6: 1875,
              F6: 1875,
            },
          },
        ]),
      ),
    )
    const [loan] = daten?.loans ?? []
    // 1.5 ohne Prozentformat ist 1.5 %, nicht 150 %.
    assert.equal(loan?.rateMillipercent, 1500)
    assert.equal(daten?.settings.mortgageTotalCents, 50_000_000)
    assert.equal(daten?.settings.firstMortgageCents, 60_000_000)
    assert.ok(hinweise.some((hinweis) => /Total Hypothek nicht gefunden/.test(hinweis)))
    assert.ok(hinweise.some((hinweis) => /zwei Drittel/.test(hinweis)))
  })
})

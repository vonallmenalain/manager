import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  analyse,
  billSubject,
  billYear,
  computeDivisionEntry,
  divisionsOf,
  findPreviousYearEntry,
  formatPercentChange,
  formatPricePerUnit,
  formatRappen,
  periodDays,
  priceUnitLabel,
  shortPeriodLabel,
  summarize,
  trendBetween,
  type BillSection,
  type UtilityBill,
} from '@manager/shared'

/** Eine Sparte, knapp gehalten – die Tests setzen nur, worauf es ankommt. */
function section(overrides: Partial<BillSection> & { division: BillSection['division'] }): BillSection {
  return {
    amountCents: 0,
    groups: [],
    readings: [],
    positions: [],
    meterPoint: null,
    meterNumber: null,
    ...overrides,
  }
}

/**
 * Die echte Stromabrechnung für das zweite Halbjahr 2024. Sie ist der
 * Prüfstein: Dieselben Werte stehen in der Tabelle, mit der der Haushalt
 * seinen Strompreis bisher von Hand gerechnet hat.
 */
function stromrechnung(overrides: Partial<UtilityBill> = {}): UtilityBill {
  return {
    id: overrides.id ?? 'h2-2024',
    kind: 'abrechnung',
    invoiceNumber: overrides.invoiceNumber ?? '231125',
    invoiceDate: '2025-01-23',
    periodStart: '2024-07-01',
    periodEnd: '2024-12-31',
    customerNumber: '18444 / 4086',
    sections: [
      section({
        division: 'strom',
        amountCents: 216_205,
        groups: [
          { group: 'energie', amountCents: 109_015 },
          { group: 'netznutzung', amountCents: 75_080 },
          { group: 'abgaben', amountCents: 32_110 },
        ],
        readings: [
          { tariff: 'hoch', label: 'Hochtarif', unit: 'kWh', startValue: 22_796, endValue: 26_082, quantity: 3286 },
          { tariff: 'nieder', label: 'Niedertarif', unit: 'kWh', startValue: 27_441, endValue: 29_606, quantity: 2165 },
        ],
      }),
    ],
    subtotalCents: 216_205,
    prepaidCents: 62_000,
    totalCents: 154_205,
    vatCents: 11_550,
    documentId: null,
    sourceFile: null,
    note: '',
    createdBy: 'alain',
    createdAt: '2025-01-24T10:00:00.000Z',
    updatedAt: '2025-01-24T10:00:00.000Z',
    ...overrides,
  }
}

/** Die echte Wasserrechnung für 2025 – drei Sparten auf einem Beleg. */
function wasserrechnung(overrides: Partial<UtilityBill> = {}): UtilityBill {
  return {
    id: overrides.id ?? 'wasser-2025',
    kind: 'abrechnung',
    invoiceNumber: overrides.invoiceNumber ?? '242738',
    invoiceDate: '2026-01-21',
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    customerNumber: '18444 / 4086',
    sections: [
      section({
        division: 'wasser',
        amountCents: 42_475,
        readings: [
          { tariff: 'einzel', label: 'Wasserverbrauch', unit: 'm³', startValue: 971, endValue: 1091, quantity: 120 },
        ],
      }),
      section({
        division: 'abwasser',
        amountCents: 39_900,
        positions: [
          {
            group: null, label: 'Abwasserverbrauch', quantity: 120, unit: 'm³',
            rateHundredths: 155, rateUnit: 'Fr.', durationMonths: null,
            vatBasisPoints: 810, netCents: 18_600, grossCents: 20_105,
          },
          {
            group: null, label: 'Regenabwasser', quantity: 133, unit: 'm²',
            rateHundredths: 7000, rateUnit: 'Rp.', durationMonths: 12,
            vatBasisPoints: 810, netCents: 9310, grossCents: 10_065,
          },
        ],
      }),
      section({ division: 'kehricht', amountCents: 10_000 }),
    ],
    subtotalCents: 92_375,
    prepaidCents: 46_000,
    totalCents: 46_375,
    vatCents: 2355,
    documentId: null,
    sourceFile: null,
    note: '',
    createdBy: 'alain',
    createdAt: '2026-01-22T10:00:00.000Z',
    updatedAt: '2026-01-22T10:00:00.000Z',
    ...overrides,
  }
}

describe('periodDays und billYear', () => {
  it('zählt beide Enden mit', () => {
    assert.equal(periodDays('2024-07-01', '2024-12-31'), 184)
    assert.equal(periodDays('2024-01-01', '2024-01-01'), 1)
    assert.equal(periodDays('2024-12-31', '2024-07-01'), 0)
  })

  it('nimmt das Jahr der Periodenmitte, nicht das der Rechnung', () => {
    // Die Abrechnung kommt im Januar 2025 und gehört trotzdem zu 2024.
    assert.equal(billYear({ periodStart: '2024-07-01', periodEnd: '2024-12-31' }), 2024)
    assert.equal(billYear({ periodStart: '2024-11-01', periodEnd: '2025-04-30' }), 2025)
  })
})

describe('divisionsOf und billSubject', () => {
  it('nennt die Sparten einer Rechnung in fester Reihenfolge', () => {
    assert.deepEqual(divisionsOf(wasserrechnung()), ['wasser', 'abwasser', 'kehricht'])
    assert.equal(billSubject(wasserrechnung()), 'Wasser · Abwasser · Kehricht')
    assert.equal(billSubject(stromrechnung()), 'Strom')
  })
})

describe('computeDivisionEntry – Strom', () => {
  const entry = computeDivisionEntry(stromrechnung(), stromrechnung().sections[0] as BillSection)

  it('summiert den Verbrauch über beide Tarife', () => {
    assert.equal(entry.quantity, 5451)
    assert.equal(entry.highQuantity, 3286)
    assert.equal(entry.lowQuantity, 2165)
    assert.equal(entry.unit, 'kWh')
  })

  it('rechnet den Preis je Kilowattstunde aus dem Total der Sparte', () => {
    // 2'162.05 / 5'451 = 0.39663 CHF – genau der Wert aus der Tabelle des
    // Haushalts. Der Rechnungsbetrag (nach Akontoabzug) wäre der falsche
    // Zähler: Er misst die Vorauszahlungen, nicht den Strom.
    assert.equal(entry.pricePerUnitHundredths, 3966)
    assert.equal(formatPricePerUnit(entry.pricePerUnitHundredths, 'kWh'), '39.66')
    assert.equal(priceUnitLabel('kWh').label, 'Rp./kWh')
  })

  it('reicht die drei Blöcke durch', () => {
    assert.equal(entry.energyCents, 109_015)
    assert.equal(entry.gridCents, 75_080)
    assert.equal(entry.leviesCents, 32_110)
  })

  it('rechnet auf Tag und Jahr um, damit sich ungleiche Perioden vergleichen lassen', () => {
    assert.equal(entry.days, 184)
    assert.equal(entry.annualQuantity, 10_813)
    assert.equal(entry.annualCostCents, 428_885)
  })
})

describe('computeDivisionEntry – Wasser, Abwasser, Kehricht', () => {
  const bill = wasserrechnung()
  const [wasser, abwasser, kehricht] = bill.sections.map((s) => computeDivisionEntry(bill, s))

  it('rechnet Wasser in Franken je Kubikmeter', () => {
    assert.equal(wasser?.quantity, 120)
    assert.equal(wasser?.unit, 'm³')
    // 424.75 / 120 = 3.54 Fr./m³ – nicht in Rappen, so steht es auf der Rechnung.
    assert.equal(wasser?.pricePerUnitHundredths, 35_396)
    assert.equal(formatPricePerUnit(wasser?.pricePerUnitHundredths ?? null, 'm³'), '3.54')
    assert.equal(priceUnitLabel('m³').label, 'Fr./m³')
  })

  it('holt die Abwassermenge aus den Positionen – eine eigene Ablesung gibt es nie', () => {
    // 133 m² Regenabwasser sind kein Verbrauch: Nur Zeilen in der Einheit der
    // Sparte zählen, sonst käme 253 heraus.
    assert.equal(abwasser?.quantity, 120)
    assert.equal(abwasser?.pricePerUnitHundredths, 33_250)
  })

  it('behauptet beim Kehricht keinen Verbrauch', () => {
    assert.equal(kehricht?.quantity, null)
    assert.equal(kehricht?.unit, null)
    assert.equal(kehricht?.pricePerUnitHundredths, null)
    assert.equal(kehricht?.costCents, 10_000)
  })

  it('lässt die Stromblöcke bei fremden Sparten leer, statt 0 zu behaupten', () => {
    assert.equal(wasser?.energyCents, null)
    assert.equal(kehricht?.gridCents, null)
  })
})

describe('summarize', () => {
  const { entries } = analyse([stromrechnung(), wasserrechnung()])

  it('zählt über Sparten hinweg nur die Kosten zusammen', () => {
    const alles = summarize(entries)

    assert.equal(alles.totalCostCents, 216_205 + 92_375)
    // Die Menge steht je Sparte auch dann, wenn es keine gemeinsame Einheit
    // gibt: „5'451 kWh und 120 m³" sind zwei Angaben nebeneinander.
    assert.deepEqual(alles.perDivision, [
      { division: 'strom', costCents: 216_205, quantity: 5451, unit: 'kWh' },
      { division: 'wasser', costCents: 42_475, quantity: 120, unit: 'm³' },
      { division: 'abwasser', costCents: 39_900, quantity: 120, unit: 'm³' },
      { division: 'kehricht', costCents: 10_000, quantity: null, unit: null },
    ])
    // Kilowattstunden und Kubikmeter zusammenzuzählen ergäbe eine Zahl, die
    // nichts bedeutet – also gibt es sie nicht.
    assert.equal(alles.unit, null)
    assert.equal(alles.quantity, null)
    assert.equal(alles.pricePerUnitHundredths, null)
  })

  it('nimmt bei gleicher Einheit Menge und Preis mit', () => {
    const nurStrom = summarize(entries.filter((entry) => entry.division === 'strom'))

    assert.equal(nurStrom.unit, 'kWh')
    assert.equal(nurStrom.quantity, 5451)
    assert.equal(nurStrom.pricePerUnitHundredths, 3966)
    assert.equal(nurStrom.energyCents, 109_015)
  })

  it('misst die abgedeckte Zeit als Spanne und nicht als Summe der Perioden', () => {
    // Strom (2. Halbjahr 2024) und Wasser (ganzes 2025) laufen nacheinander:
    // 01.07.2024 bis 31.12.2025 sind 549 Tage. Addiert wären es 549 ebenfalls –
    // deshalb hier zusätzlich der Fall, in dem sich zwei Sparten überlappen.
    const gleichzeitig = summarize([
      ...entries.filter((entry) => entry.division === 'wasser'),
      ...entries.filter((entry) => entry.division === 'abwasser'),
    ])

    assert.equal(gleichzeitig.days, 365)
    assert.equal(gleichzeitig.totalCostCents, 42_475 + 39_900)
  })

  it('gibt für nichts eine leere Auswertung statt einer Division durch null', () => {
    const leer = summarize([])

    assert.equal(leer.entryCount, 0)
    assert.equal(leer.totalCostCents, 0)
    assert.equal(leer.pricePerUnitHundredths, null)
  })
})

describe('trendBetween', () => {
  it('nennt Richtung und Anteil der Veränderung', () => {
    assert.deepEqual(trendBetween(110, 100), { ratio: 0.1, delta: 10, direction: 'steigend' })
    assert.equal(trendBetween(90, 100).direction, 'sinkend')
  })

  it('nennt winzige Unterschiede „gleich", statt einen Pfeil zu zeichnen', () => {
    assert.equal(trendBetween(100.2, 100).direction, 'gleich')
  })

  it('behauptet ohne Vergleichswert nichts', () => {
    assert.equal(trendBetween(100, null).ratio, null)
    assert.equal(trendBetween(100, 0).ratio, null)
  })
})

describe('findPreviousYearEntry', () => {
  it('findet dieselbe Sparte in derselben Jahreszeit des Vorjahres', () => {
    const { entries } = analyse([
      wasserrechnung(),
      wasserrechnung({
        id: 'wasser-2024',
        invoiceNumber: '231187',
        periodStart: '2024-01-01',
        periodEnd: '2024-12-31',
      }),
    ])

    const jetzt = entries.find((e) => e.bill.id === 'wasser-2025' && e.division === 'abwasser')
    assert.ok(jetzt)
    assert.equal(findPreviousYearEntry(entries, jetzt)?.bill.id, 'wasser-2024')
  })

  it('vergleicht nie über Sparten hinweg', () => {
    const { entries } = analyse([
      stromrechnung({ id: 'strom-2024', periodStart: '2024-01-01', periodEnd: '2024-12-31' }),
      wasserrechnung(),
    ])

    const wasser = entries.find((entry) => entry.division === 'wasser')
    assert.ok(wasser)
    assert.equal(findPreviousYearEntry(entries, wasser), null)
  })

  it('vergleicht kein Winterhalbjahr mit einem Sommerhalbjahr', () => {
    const { entries } = analyse([
      stromrechnung(),
      stromrechnung({ id: 'h1', invoiceNumber: '221126', periodStart: '2024-01-01', periodEnd: '2024-06-30' }),
    ])

    const h2 = entries.find((entry) => entry.bill.id === 'h2-2024')
    assert.ok(h2)
    assert.equal(findPreviousYearEntry(entries, h2), null)
  })
})

describe('analyse', () => {
  it('zerlegt Rechnungen in Sparten und trennt die Vorauszahlungen ab', () => {
    const ergebnis = analyse([
      wasserrechnung(),
      stromrechnung(),
      stromrechnung({ id: 'akonto', invoiceNumber: '232709', kind: 'akonto' }),
    ])

    // Strom (2. Halbjahr 2024) vor Wasser (2025); die drei Wassersparten
    // stehen einzeln.
    assert.deepEqual(
      ergebnis.entries.map((entry) => `${entry.bill.id}:${entry.division}`),
      ['h2-2024:strom', 'akonto:strom', 'wasser-2025:wasser', 'wasser-2025:abwasser', 'wasser-2025:kehricht'].filter(
        (id) => !id.startsWith('akonto'),
      ),
    )
    assert.deepEqual(ergebnis.akonto.map((entry) => entry.division), ['strom'])
    assert.deepEqual(ergebnis.divisions, ['strom', 'wasser', 'abwasser', 'kehricht'])
    assert.deepEqual(ergebnis.years, [2025, 2024])
  })
})

describe('Darstellung', () => {
  it('schreibt Veränderungen mit Vorzeichen und echtem Minus', () => {
    assert.equal(formatPercentChange(0.052), '+5.2 %')
    assert.equal(formatPercentChange(-0.03), '−3.0 %')
    assert.equal(formatPercentChange(null), '–')
  })

  it('kürzt Perioden für die Achse eines Diagramms', () => {
    assert.equal(shortPeriodLabel('2024-07-01', '2024-12-31'), 'H2 24')
    assert.equal(shortPeriodLabel('2024-01-01', '2024-06-30'), 'H1 24')
    assert.equal(shortPeriodLabel('2025-01-01', '2025-03-31'), 'Q1 25')
    assert.equal(shortPeriodLabel('2025-01-01', '2025-12-31'), '2025')
  })

  it('schreibt Rappen mit zwei Stellen', () => {
    assert.equal(formatRappen(3966), '39.66')
    assert.equal(formatRappen(null), '–')
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  analyse,
  billYear,
  computeBillFigures,
  findPreviousYearBill,
  formatPercentChange,
  formatRappen,
  periodDays,
  shortPeriodLabel,
  summarize,
  trendBetween,
  type ElectricityBill,
} from '@manager/shared'

/**
 * Eine Rechnung mit den Zahlen der echten Abrechnung für das zweite Halbjahr
 * 2024. Sie ist der Prüfstein: Dieselben Werte stehen in der Tabelle, mit der
 * der Haushalt seinen Strompreis bisher von Hand gerechnet hat.
 */
function bill(overrides: Partial<ElectricityBill> = {}): ElectricityBill {
  return {
    id: overrides.id ?? 'h2-2024',
    kind: 'abrechnung',
    invoiceNumber: overrides.invoiceNumber ?? '231125',
    invoiceDate: '2025-01-23',
    periodStart: '2024-07-01',
    periodEnd: '2024-12-31',
    customerNumber: '18444 / 4086',
    meterPoint: null,
    meterNumber: null,
    readings: [
      { tariff: 'hoch', startValue: 22_796, endValue: 26_082, kwh: 3286 },
      { tariff: 'nieder', startValue: 27_441, endValue: 29_606, kwh: 2165 },
    ],
    positions: [],
    energyCents: 109_015,
    gridCents: 75_080,
    leviesCents: 32_110,
    subtotalCents: 216_205,
    prepaidCents: 62_000,
    totalCents: 154_205,
    vatCents: 11_550,
    sourceFile: null,
    note: '',
    createdBy: 'alain',
    createdAt: '2025-01-24T10:00:00.000Z',
    updatedAt: '2025-01-24T10:00:00.000Z',
    ...overrides,
  }
}

describe('periodDays', () => {
  it('zählt beide Enden mit', () => {
    assert.equal(periodDays('2024-07-01', '2024-12-31'), 184)
    assert.equal(periodDays('2024-01-01', '2024-01-01'), 1)
  })

  it('gibt 0, wenn die Periode verkehrt herum steht', () => {
    assert.equal(periodDays('2024-12-31', '2024-07-01'), 0)
  })
})

describe('billYear', () => {
  it('nimmt das Jahr der Periodenmitte, nicht das der Rechnung', () => {
    // Die Abrechnung kommt im Januar 2025 und gehört trotzdem zu 2024.
    assert.equal(billYear({ periodStart: '2024-07-01', periodEnd: '2024-12-31' }), 2024)
  })

  it('ordnet eine Periode über den Jahreswechsel dem überwiegenden Jahr zu', () => {
    assert.equal(billYear({ periodStart: '2024-11-01', periodEnd: '2025-04-30' }), 2025)
  })
})

describe('computeBillFigures', () => {
  const figures = computeBillFigures(bill())

  it('summiert den Verbrauch über beide Tarife', () => {
    assert.equal(figures.totalKwh, 5451)
    assert.equal(figures.highKwh, 3286)
    assert.equal(figures.lowKwh, 2165)
  })

  it('rechnet den Preis je Kilowattstunde aus dem Zwischentotal', () => {
    // 2'162.05 / 5'451 = 0.39663 CHF – genau der Wert aus der Tabelle des
    // Haushalts. Der Rechnungsbetrag (nach Akontoabzug) wäre der falsche
    // Zähler: Er misst die Vorauszahlungen, nicht den Strom.
    assert.equal(figures.pricePerKwhHundredths, 3966)
    assert.equal(formatRappen(figures.pricePerKwhHundredths), '39.66')
  })

  it('rechnet auf Tag und Jahr um, damit sich ungleiche Perioden vergleichen lassen', () => {
    assert.equal(figures.days, 184)
    assert.equal(Math.round((figures.kwhPerDay ?? 0) * 100), 2963)
    assert.equal(figures.annualKwh, 10_813)
    assert.equal(figures.annualCostCents, 428_885)
  })

  it('liest den Verbrauch aus den Positionen, wenn die Ablesung fehlt', () => {
    const ohneAblesung = computeBillFigures(
      bill({
        readings: [],
        positions: [
          {
            group: 'energie',
            label: 'Wirkstrom Hochtarif',
            quantity: 3286,
            unit: 'kWh',
            rateHundredths: 1850,
            rateUnit: 'Rp.',
            durationMonths: null,
            vatBasisPoints: 810,
            netCents: 60_790,
            grossCents: 65_715,
          },
        ],
      }),
    )

    assert.equal(ohneAblesung.highKwh, 3286)
    assert.equal(ohneAblesung.totalKwh, 3286)
  })

  it('lässt den Verbrauch einer Akontorechnung leer, statt 0 zu behaupten', () => {
    const akonto = computeBillFigures(bill({ kind: 'akonto', readings: [], positions: [] }))

    assert.equal(akonto.totalKwh, null)
    assert.equal(akonto.pricePerKwhHundredths, null)
  })
})

describe('summarize', () => {
  it('bildet den Ø Preis aus den Summen und nicht aus dem Mittel der Preise', () => {
    // Ein Halbjahr mit wenig Verbrauch darf den Jahresschnitt nicht gleich
    // stark ziehen wie eines mit viel.
    const viel = computeBillFigures(bill({ id: 'a' }))
    const wenig = computeBillFigures(
      bill({
        id: 'b',
        invoiceNumber: '231126',
        periodStart: '2025-01-01',
        periodEnd: '2025-06-30',
        readings: [{ tariff: 'hoch', startValue: 0, endValue: 1000, kwh: 1000 }],
        subtotalCents: 50_000,
        energyCents: 25_000,
        gridCents: 15_000,
        leviesCents: 10_000,
      }),
    )

    const summe = summarize([viel, wenig])

    assert.equal(summe.billCount, 2)
    assert.equal(summe.totalKwh, 6451)
    assert.equal(summe.totalCostCents, 266_205)
    assert.equal(summe.pricePerKwhHundredths, Math.round((266_205 * 100) / 6451))
  })

  it('gibt für nichts eine leere Auswertung statt einer Division durch null', () => {
    const leer = summarize([])

    assert.equal(leer.billCount, 0)
    assert.equal(leer.pricePerKwhHundredths, null)
    assert.equal(leer.totalKwh, null)
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

describe('findPreviousYearBill', () => {
  it('findet die Rechnung derselben Jahreszeit im Vorjahr', () => {
    const vorjahr = computeBillFigures(
      bill({ id: 'v', invoiceNumber: '221125', periodStart: '2023-07-03', periodEnd: '2023-12-31' }),
    )
    const jetzt = computeBillFigures(bill())

    assert.equal(findPreviousYearBill([vorjahr, jetzt], jetzt)?.bill.id, 'v')
  })

  it('vergleicht kein Winterhalbjahr mit einem Sommerhalbjahr', () => {
    const halbesJahrDaneben = computeBillFigures(
      bill({ id: 'x', invoiceNumber: '221126', periodStart: '2024-01-01', periodEnd: '2024-06-30' }),
    )
    const jetzt = computeBillFigures(bill())

    assert.equal(findPreviousYearBill([halbesJahrDaneben, jetzt], jetzt), null)
  })
})

describe('analyse', () => {
  it('trennt Abrechnungen von Vorauszahlungen und sortiert nach Periode', () => {
    const ergebnis = analyse([
      bill({ id: 'spaet', invoiceNumber: '2', periodStart: '2025-01-01', periodEnd: '2025-06-30' }),
      bill({ id: 'frueh', invoiceNumber: '1' }),
      bill({ id: 'akonto', invoiceNumber: '3', kind: 'akonto' }),
    ])

    assert.deepEqual(
      ergebnis.abrechnungen.map((entry) => entry.bill.id),
      ['frueh', 'spaet'],
    )
    assert.deepEqual(ergebnis.akonto.map((entry) => entry.bill.id), ['akonto'])
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
    assert.equal(shortPeriodLabel('2024-01-01', '2024-12-31'), '2024')
  })
})

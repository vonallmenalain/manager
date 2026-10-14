import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildQuarters,
  days360,
  effectiveRate,
  formatMonths,
  formatRate,
  impliedRateMillipercent,
  loanForecastCents,
  loanSlots,
  loanStatus,
  mortgageStatus,
  mortgageYears,
  nextOpenQuarter,
  parseRate,
  quarterEnd,
  quarterOfDate,
  quarterStart,
  suggestedQuarter,
  summarizeAmortization,
  type AmortizationPayment,
  type HypothekDaten,
  type InterestPayment,
  type MortgageLoan,
} from '@manager/shared'

/**
 * Die Hypothek des Haushalts, wie sie in der eigenen Tabelle stand – der
 * Prüfstein dieser Tests. Was dort gerechnet wurde (Quartalszinsen,
 * „Gesamtkosten pro Monat", Restwert der 2. Hypothek), muss hier wieder
 * herauskommen.
 */
function loan(overrides: Partial<MortgageLoan> & Pick<MortgageLoan, 'id' | 'name'>): MortgageLoan {
  return {
    kind: 'fest',
    amountCents: 0,
    rateMillipercent: 0,
    startDate: '2024-07-01',
    endDate: null,
    note: '',
    createdAt: '2024-07-01T00:00:00.000Z',
    updatedAt: '2024-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const FEST_0004 = loan({
  id: 'f4',
  name: 'Festhypothek 0004',
  amountCents: 12_000_000,
  rateMillipercent: 1130,
  endDate: '2025-09-30',
})
const FEST_0003 = loan({
  id: 'f3',
  name: 'Festhypothek 0003',
  amountCents: 30_000_000,
  rateMillipercent: 2500,
  endDate: '2028-09-01',
})
const FEST_0007 = loan({
  id: 'f7',
  name: 'Festhypothek 0007',
  amountCents: 15_200_000,
  rateMillipercent: 1100,
  startDate: '2025-10-01',
  endDate: '2028-09-29',
})
const SARON_0005 = loan({
  id: 's5',
  name: 'SARON-Hypothek 0005',
  kind: 'saron',
  amountCents: 42_000_000,
  rateMillipercent: 600,
})
const SARON_0006 = loan({
  id: 's6',
  name: 'SARON-Hypothek 0006',
  kind: 'saron',
  amountCents: 3_200_000,
  rateMillipercent: 900,
  endDate: '2025-09-30',
})

/** Die bezahlten Zinsen aus der Tabelle, Q3 2024 bis Q3 2026. */
function zinsen(): InterestPayment[] {
  const reihe = (loanId: string, ab: [number, 1 | 2 | 3 | 4], betraege: number[]) => {
    let [year, quarter] = ab
    return betraege.map((amountCents) => {
      const entry: InterestPayment = { loanId, year, quarter, amountCents }
      quarter = (quarter === 4 ? 1 : quarter + 1) as 1 | 2 | 3 | 4
      if (quarter === 1) year += 1
      return entry
    })
  }
  return [
    ...reihe('f4', [2024, 3], [33_900, 33_900, 33_900, 33_900, 33_900]),
    ...reihe('f3', [2024, 3], [187_500, 187_500, 187_500, 187_500, 187_500, 187_500, 187_500, 187_500, 187_500]),
    ...reihe('f7', [2025, 4], [41_800, 41_800, 41_800, 41_800]),
    ...reihe('s5', [2024, 3], [193_425, 155_890, 106_440, 82_215, 64_400, 64_400, 64_400, 63_000, 64_400]),
    ...reihe('s6', [2024, 3], [17_190, 14_330, 10_510, 8_690, 7_360]),
  ]
}

function daten(overrides: Partial<HypothekDaten> = {}): HypothekDaten {
  return {
    settings: {
      propertyValueCents: 109_000_000,
      mortgageTotalCents: 87_200_000,
      firstMortgageCents: 72_666_700,
      amortizationPerYearCents: 1_400_000,
      carriedOverCents: 2_800_000,
      carriedOverDate: '2025-12-31',
      referenceRateMillipercent: 0,
    },
    loans: [FEST_0004, FEST_0003, FEST_0007, SARON_0005, SARON_0006],
    interest: zinsen(),
    amortizations: [],
    ...overrides,
  }
}

function tranche(overrides: Partial<AmortizationPayment>): AmortizationPayment {
  return {
    id: 'a',
    year: 2026,
    paidOn: '2026-03-31',
    amountCents: 700_000,
    note: '',
    createdBy: 'u',
    createdAt: '2026-03-31T00:00:00.000Z',
    ...overrides,
  }
}

// ------------------------------------------------------------- Zinssätze

describe('parseRate / formatRate', () => {
  it('liest, was man von einer Offerte abschreibt', () => {
    assert.equal(parseRate('1.13'), 1130)
    assert.equal(parseRate('1,13 %'), 1130)
    assert.equal(parseRate('0.625'), 625)
    assert.equal(parseRate('2.5'), 2500)
    assert.equal(parseRate('0'), 0)
  })

  it('weist Unsinn ab, statt einen Zins zu erfinden', () => {
    assert.equal(parseRate(''), null)
    assert.equal(parseRate('abc'), null)
    assert.equal(parseRate('-1'), null)
    assert.equal(parseRate('45'), null)
  })

  it('schreibt zwei Nachkommastellen und die dritte nur, wenn es sie gibt', () => {
    assert.equal(formatRate(1130), '1.13')
    assert.equal(formatRate(2500), '2.50')
    assert.equal(formatRate(625), '0.625')
    assert.equal(formatRate(null), '–')
  })
})

describe('effectiveRate', () => {
  it('rechnet bei SARON den Referenzzins zur Marge', () => {
    assert.equal(effectiveRate(SARON_0005, { referenceRateMillipercent: 0 }), 600)
    assert.equal(effectiveRate(SARON_0005, { referenceRateMillipercent: 250 }), 850)
  })

  it('lässt die Festhypothek vom Referenzzins unberührt', () => {
    assert.equal(effectiveRate(FEST_0003, { referenceRateMillipercent: 250 }), 2500)
  })
})

// ---------------------------------------------------------------- Kalender

describe('Quartale', () => {
  it('kennt Anfang und Ende', () => {
    assert.equal(quarterStart(2026, 3), '2026-07-01')
    assert.equal(quarterEnd(2026, 3), '2026-09-30')
    assert.equal(quarterEnd(2026, 4), '2026-12-31')
    assert.equal(quarterEnd(2024, 1), '2024-03-31')
    assert.deepEqual(quarterOfDate('2026-10-14'), { year: 2026, quarter: 4 })
  })
})

describe('days360', () => {
  it('gibt jedem Quartal 90 Tage, auch dem mit dem Februar', () => {
    assert.equal(days360('2026-01-01', '2026-04-01'), 90)
    assert.equal(days360('2026-07-01', '2026-10-01'), 90)
    assert.equal(days360('2026-10-01', '2027-01-01'), 90)
  })

  it('zählt den 31. wie den 30.', () => {
    assert.equal(days360('2026-01-31', '2026-04-01'), 61)
    assert.equal(days360('2025-09-30', '2025-10-01'), 1)
  })
})

// ---------------------------------------------------------------- Prognose

describe('loanForecastCents', () => {
  const settings = daten().settings

  it('trifft die Quartalszinsen der Festhypotheken auf den Rappen', () => {
    assert.equal(loanForecastCents(FEST_0003, settings, 2026, 3), 187_500)
    assert.equal(loanForecastCents(FEST_0004, settings, 2025, 1), 33_900)
    assert.equal(loanForecastCents(FEST_0007, settings, 2026, 1), 41_800)
  })

  it('rechnet die SARON-Hypothek mit dem heutigen Referenzzins', () => {
    assert.equal(loanForecastCents(SARON_0005, settings, 2026, 2), 63_000)
    assert.equal(
      loanForecastCents(SARON_0005, { referenceRateMillipercent: 500 }, 2026, 2),
      115_500,
    )
  })

  it('verrechnet nur die Tage, an denen die Hypothek läuft', () => {
    // Läuft am 30.09. aus – im vierten Quartal kostet sie nichts mehr.
    assert.equal(loanForecastCents(FEST_0004, settings, 2025, 4), 0)
    // Beginnt erst im vierten Quartal.
    assert.equal(loanForecastCents(FEST_0007, settings, 2025, 3), 0)
    // Endet am 01.09.2028: zwei Monate und ein Tag des dritten Quartals.
    assert.equal(loanForecastCents(FEST_0003, settings, 2028, 3), Math.round((30_000_000 * 0.025 * 61) / 360))
  })
})

// ---------------------------------------------------------------- Stand

describe('mortgageStatus', () => {
  const stand = mortgageStatus(daten(), '2026-10-14')

  it('zählt nur, was heute läuft', () => {
    assert.deepEqual(
      stand.active.map((status) => status.loan.id),
      ['f3', 's5', 'f7'],
    )
    assert.equal(stand.totalCents, 87_200_000)
  })

  it('ergibt die „Gesamtkosten pro Monat" der Tabelle', () => {
    // Zins 974.33 + Amortisation 1'166.67 = 2'141.00
    assert.equal(Math.round(stand.monthlyInterestCents), 97_433)
    assert.equal(Math.round(stand.monthlyAmortizationCents), 116_667)
    assert.equal(Math.round(stand.monthlyInterestCents + stand.monthlyAmortizationCents), 214_100)
  })

  it('gewichtet den Ø Zinssatz nach Betrag', () => {
    // (300'000 × 2.5 + 152'000 × 1.1 + 420'000 × 0.6) / 872'000 = 1.341 %
    assert.equal(stand.averageRateMillipercent, 1341)
    assert.equal(stand.loanToValue, 0.8)
  })
})

describe('loanStatus', () => {
  it('nennt die Restlaufzeit und wie viel davon verstrichen ist', () => {
    const status = loanStatus(FEST_0007, daten().settings, '2026-10-14')
    assert.equal(status.state, 'aktiv')
    assert.equal(status.monthsLeft, 23)
    assert.equal(formatMonths(status.monthsLeft ?? 0), '1 J. 11 Mt.')
    assert.ok(status.elapsed !== null && status.elapsed > 0.3 && status.elapsed < 0.4)
  })

  it('erkennt Abgelaufenes und SARON ohne Ende', () => {
    assert.equal(loanStatus(FEST_0004, daten().settings, '2026-10-14').state, 'abgelaufen')
    const saron = loanStatus(SARON_0005, daten().settings, '2026-10-14')
    assert.equal(saron.monthsLeft, null)
    assert.equal(saron.elapsed, null)
  })
})

// ---------------------------------------------------------------- Quartale

describe('buildQuarters', () => {
  const rows = buildQuarters(daten(), '2026-10-14')

  it('reicht vom ersten Zins bis ans Ende des laufenden Jahres', () => {
    assert.equal(rows[0]?.label, 'Q3 2024')
    assert.equal(rows.at(-1)?.label, 'Q4 2026')
    assert.equal(rows.length, 10)
  })

  it('ergibt die Quartalstotale der Tabelle', () => {
    const q32024 = rows.find((row) => row.key === '2024-Q3')
    assert.equal(q32024?.actualCents, 432_015)
    assert.equal(q32024?.complete, true)

    const q22026 = rows.find((row) => row.key === '2026-Q2')
    assert.equal(q22026?.actualCents, 292_300)
  })

  it('führt abgelaufene Hypotheken danach nicht mehr auf', () => {
    const q12026 = rows.find((row) => row.key === '2026-Q1')
    assert.deepEqual(
      q12026?.loans.map((zeile) => zeile.loan.id),
      ['f3', 's5', 'f7'],
    )
  })

  it('setzt im offenen Quartal die Prognose ein', () => {
    const q42026 = rows.find((row) => row.key === '2026-Q4')
    assert.equal(q42026?.time, 'laufend')
    assert.equal(q42026?.actualCents, null)
    assert.equal(q42026?.complete, false)
    assert.equal(q42026?.expectedCents, 187_500 + 63_000 + 41_800)
    assert.equal(nextOpenQuarter(rows)?.key, '2026-Q4')
    assert.equal(suggestedQuarter(rows)?.key, '2026-Q4')
  })

  it('schlägt zum Erfassen zuerst eine Lücke in der Vergangenheit vor', () => {
    const ohneQ2 = daten({
      interest: zinsen().filter((entry) => !(entry.year === 2026 && entry.quarter === 2)),
    })
    assert.equal(suggestedQuarter(buildQuarters(ohneQ2, '2026-10-14'))?.key, '2026-Q2')
  })

  it('ist leer ohne Hypothek', () => {
    assert.deepEqual(buildQuarters(daten({ loans: [], interest: [] }), '2026-10-14'), [])
  })
})

describe('impliedRateMillipercent', () => {
  it('zeigt, wie der SARON-Zins gesunken ist', () => {
    // 1'934.25 × 4 / 420'000 = 1.842 %, später 644 × 4 / 420'000 = 0.613 %
    assert.equal(Math.round(impliedRateMillipercent(42_000_000, 193_425) ?? 0), 1842)
    assert.equal(Math.round(impliedRateMillipercent(42_000_000, 64_400) ?? 0), 613)
    assert.equal(impliedRateMillipercent(0, 100), null)
  })
})

// ------------------------------------------------------------ Amortisation

describe('summarizeAmortization', () => {
  it('ergibt den Restwert der Tabelle', () => {
    const summe = summarizeAmortization(daten(), '2026-10-14')
    assert.equal(summe.secondMortgageCents, 14_533_300)
    assert.equal(summe.amortizedCents, 2_800_000)
    assert.equal(summe.remainingCents, 11_733_300)
    // 117'333 / 14'000 = 8.38 Jahre – 2026 ganz, dann noch acht weitere.
    assert.equal(summe.endYear, 2034)
    assert.ok(Math.abs((summe.yearsLeft ?? 0) - 8.381) < 0.001)
  })

  it('beginnt die Jahre nach dem Übertrag und zählt Tranchen zusammen', () => {
    const summe = summarizeAmortization(
      daten({
        amortizations: [
          tranche({ id: 'a', paidOn: '2026-03-31', amountCents: 500_000 }),
          tranche({ id: 'b', paidOn: '2026-09-30', amountCents: 200_000 }),
        ],
      }),
      '2026-10-14',
    )
    assert.deepEqual(
      summe.years.map((year) => [year.year, year.targetCents, year.paidCents, year.openCents]),
      [[2026, 1_400_000, 700_000, 700_000]],
    )
    assert.deepEqual(
      summe.years[0]?.payments.map((payment) => payment.id),
      ['a', 'b'],
    )
    assert.equal(summe.remainingCents, 11_033_300)
  })

  it('verlangt im letzten Jahr nur noch den Rest', () => {
    const fastFertig = daten({
      settings: { ...daten().settings, carriedOverCents: 14_000_000 },
    })
    const summe = summarizeAmortization(fastFertig, '2026-10-14')
    assert.equal(summe.years[0]?.targetCents, 533_300)
    assert.equal(summe.endYear, 2026)
  })

  it('kommt ohne Übertrag und ohne Plan aus', () => {
    const leer = daten({
      settings: { ...daten().settings, carriedOverCents: 0, carriedOverDate: null, amortizationPerYearCents: 0 },
    })
    const summe = summarizeAmortization(leer, '2026-10-14')
    assert.deepEqual(summe.years.map((year) => year.year), [2026])
    assert.equal(summe.years[0]?.targetCents, 0)
    assert.equal(summe.endYear, null)
    assert.equal(summe.yearsLeft, null)
  })
})

describe('mortgageYears', () => {
  it('stellt je Jahr Zinsen und Amortisation nebeneinander', () => {
    const d = daten({ amortizations: [tranche({ amountCents: 1_400_000 })] })
    const jahre = mortgageYears(buildQuarters(d, '2026-10-14'), summarizeAmortization(d, '2026-10-14'))

    assert.deepEqual(jahre.map((jahr) => jahr.year), [2026, 2025, 2024])
    const j2026 = jahre[0]
    assert.equal(j2026?.interestPaidCents, 293_700 + 293_700 + 292_300)
    assert.equal(j2026?.interestExpectedCents, 293_700 + 293_700 + 292_300 + 292_300)
    assert.equal(j2026?.quartersComplete, 3)
    assert.equal(j2026?.quartersTotal, 4)
    assert.equal(j2026?.amortization?.paidCents, 1_400_000)
  })
})

describe('loanSlots', () => {
  it('gibt der Anschlusshypothek den Platz der ausgelaufenen', () => {
    const plaetze = loanSlots(daten().loans)
    assert.equal(plaetze.get('f3'), 0)
    assert.equal(plaetze.get('f4'), 1)
    assert.equal(plaetze.get('s5'), 2)
    assert.equal(plaetze.get('s6'), 3)
    // Beginnt am 01.10.2025, als 0004 und 0006 schon ausgelaufen sind.
    assert.equal(plaetze.get('f7'), 1)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  computeYear,
  DEFAULT_FINANCE_SETTINGS,
  formatAmount,
  monthlyTotals,
  parseAmountToCents,
  sumDonations,
  type Donation,
  type FinanceSettings,
  type IncomeEntry,
} from '@manager/shared'

/** Kürzel, damit die Testfälle lesbar bleiben. */
function income(perMonth: Record<number, number | number[]>): IncomeEntry[] {
  const entries: IncomeEntry[] = []
  for (const [month, amounts] of Object.entries(perMonth)) {
    for (const [index, amount] of (Array.isArray(amounts) ? amounts : [amounts]).entries()) {
      entries.push({
        id: `${month}-${index}`,
        year: 2026,
        month: Number(month),
        userId: index === 0 ? 'alain' : 'partnerin',
        label: '',
        amountCents: amount,
      })
    }
  }
  return entries
}

function settings(overrides: Partial<FinanceSettings> = {}): FinanceSettings {
  return { ...DEFAULT_FINANCE_SETTINGS, ...overrides }
}

function payment(overrides: Partial<Donation> = {}): Donation {
  return {
    id: 'z1',
    year: 2026,
    kind: 'zehnten',
    amountCents: 0,
    paidOn: '2026-03-01',
    note: '',
    coversThroughMonth: null,
    taxAppliedCents: 0,
    createdBy: 'alain',
    createdAt: '2026-03-01T10:00:00Z',
    ...overrides,
  }
}

const CHF = (francs: number) => francs * 100

describe('Zehnten-Berechnung', () => {
  it('nimmt ein Zehntel des erfassten Einkommens', () => {
    const figures = computeYear(income({ 1: CHF(8000), 2: CHF(8000) }), [], settings())

    assert.equal(figures.totalIncomeCents, CHF(16_000))
    assert.equal(figures.owedTithingCents, CHF(1600))
    assert.equal(figures.openTithingCents, CHF(1600))
  })

  it('zählt mehrere Einnahmen desselben Monats zusammen', () => {
    // Zwei Löhne plus ein Bonus – der Monat ist die Einheit, nicht die Person.
    const figures = computeYear(income({ 1: [CHF(5000), CHF(3000)] }), [], settings())

    assert.equal(figures.months[0]?.incomeCents, CHF(8000))
    assert.equal(figures.months[0]?.tithingCents, CHF(800))
  })

  it('die Monatswerte summieren sich auf den Zehnten vor Steuerabzug', () => {
    const figures = computeYear(
      income({ 1: CHF(7333.33), 2: CHF(4111.11), 3: CHF(9500.5) }),
      [],
      settings(),
    )

    const summe = figures.months.reduce((total, month) => total + month.tithingCents, 0)
    // Ohne verrechnete Steuern ist der geschuldete Zehnte genau diese Summe.
    assert.equal(summe, figures.owedTithingCents)
  })

  it('rechnet nichts an für Monate, die noch nicht erfasst sind', () => {
    const figures = computeYear(income({ 1: CHF(8000) }), [], settings())

    assert.equal(figures.lastEnteredMonth, 1)
    assert.equal(figures.months[5]?.entered, false)
    assert.equal(figures.months[5]?.tithingCents, 0)
  })

  it('gibt für ein leeres Jahr überall Null zurück', () => {
    const figures = computeYear([], [], settings({ taxCents: CHF(9000) }))

    assert.equal(figures.lastEnteredMonth, 0)
    assert.equal(figures.owedTithingCents, 0)
    assert.equal(figures.openTithingCents, 0)
    assert.equal(figures.months.length, 12)
  })
})

describe('Verrechnete Steuern', () => {
  it('zieht die verrechneten Steuern von der Basis ab', () => {
    const figures = computeYear(
      income({ 1: CHF(8000), 2: CHF(8000) }),
      [payment({ amountCents: CHF(500), taxAppliedCents: CHF(4000) })],
      settings({ taxCents: CHF(12_000) }),
    )

    assert.equal(figures.taxAppliedCents, CHF(4000))
    assert.equal(figures.baseCents, CHF(12_000))
    assert.equal(figures.owedTithingCents, CHF(1200))
    assert.equal(figures.paidTithingCents, CHF(500))
    assert.equal(figures.openTithingCents, CHF(700))
  })

  it('sagt, wie viel der Jahressteuer noch nicht verrechnet ist', () => {
    const figures = computeYear(
      income({ 1: CHF(8000) }),
      [payment({ taxAppliedCents: CHF(3000) })],
      settings({ taxCents: CHF(12_000) }),
    )

    assert.equal(figures.taxTotalCents, CHF(12_000))
    assert.equal(figures.taxOpenCents, CHF(9000))
  })

  it('wird nie negativ, wenn mehr Steuern verrechnet werden als Einkommen da ist', () => {
    const figures = computeYear(
      income({ 1: CHF(3000) }),
      [payment({ taxAppliedCents: CHF(9000) })],
      settings({ taxCents: CHF(9000) }),
    )

    assert.equal(figures.baseCents, 0)
    assert.equal(figures.owedTithingCents, 0)
    assert.equal(figures.openTithingCents, 0)
  })

  it('meldet nichts Offenes, wenn mehr bezahlt wurde als geschuldet', () => {
    // Aufgerundet einbezahlt: Das ist kein Fehler und darf keinen negativen
    // offenen Betrag ergeben.
    const figures = computeYear(
      income({ 1: CHF(8000) }),
      [payment({ amountCents: CHF(900) })],
      settings(),
    )

    assert.equal(figures.openTithingCents, 0)
  })
})

describe('Abrechnungsstand', () => {
  const drei = income({ 1: CHF(8000), 2: CHF(8000), 3: CHF(8000) })

  it('folgt der Zahlung, die am weitesten reicht', () => {
    const figures = computeYear(
      drei,
      [
        payment({ id: 'a', amountCents: CHF(800), coversThroughMonth: 1 }),
        payment({ id: 'b', amountCents: CHF(800), coversThroughMonth: 2 }),
      ],
      settings(),
    )

    assert.equal(figures.settledThroughMonth, 2)
    assert.deepEqual(figures.openMonths, [3])
  })

  it('lässt sich von einer späteren Zahlung mit kleinerem Monat nicht zurückstellen', () => {
    // Ein nachgetragener alter Beleg darf den Stand nicht zurückdrehen.
    const figures = computeYear(
      drei,
      [
        payment({ id: 'a', amountCents: CHF(2400), coversThroughMonth: 3 }),
        payment({ id: 'b', amountCents: CHF(100), coversThroughMonth: 1 }),
      ],
      settings(),
    )

    assert.equal(figures.settledThroughMonth, 3)
    assert.deepEqual(figures.openMonths, [])
  })

  it('steht ohne Zahlung bei null', () => {
    const figures = computeYear(drei, [], settings())

    assert.equal(figures.settledThroughMonth, 0)
    assert.deepEqual(figures.openMonths, [1, 2, 3])
  })

  it('verkraftet eine Zahlung, die weiter reicht als das Erfasste', () => {
    const figures = computeYear(
      income({ 1: CHF(8000) }),
      [payment({ amountCents: CHF(800), coversThroughMonth: 12 })],
      settings(),
    )

    assert.equal(figures.settledThroughMonth, 12)
    assert.deepEqual(figures.openMonths, [])
  })

  it('zählt das Fastopfer getrennt und nicht an den Zehnten', () => {
    const figures = computeYear(
      income({ 1: CHF(8000) }),
      [
        payment({ id: 'z', amountCents: CHF(800) }),
        payment({ id: 'f', kind: 'fastopfer', amountCents: CHF(200) }),
      ],
      settings(),
    )

    assert.equal(figures.paidTithingCents, CHF(800))
    assert.equal(figures.paidFastOfferingCents, CHF(200))
    assert.equal(figures.openTithingCents, 0)
  })
})

describe('Monatssummen und Spenden', () => {
  it('fasst die Einträge zu zwölf Monatssummen zusammen', () => {
    const totals = monthlyTotals(income({ 1: [CHF(100), CHF(50)], 3: CHF(200) }))

    assert.equal(totals[0], CHF(150))
    assert.equal(totals[1], 0)
    assert.equal(totals[2], CHF(200))
    assert.equal(totals.length, 12)
  })

  it('summiert je Spendenart getrennt', () => {
    const paid = [
      payment({ id: '1', amountCents: CHF(800) }),
      payment({ id: '2', kind: 'fastopfer', amountCents: CHF(100) }),
      payment({ id: '3', kind: 'fastopfer', amountCents: CHF(50) }),
    ]

    assert.equal(sumDonations(paid, 'zehnten'), CHF(800))
    assert.equal(sumDonations(paid, 'fastopfer'), CHF(150))
    assert.equal(sumDonations(paid, 'andere'), 0)
  })

  it('liest die Beträge so, wie man sie in der Schweiz schreibt', () => {
    assert.equal(parseAmountToCents("8'450.00"), CHF(8450))
    assert.equal(parseAmountToCents('8450'), CHF(8450))
    assert.equal(parseAmountToCents('8450,50'), CHF(8450.5))
  })

  it('formatiert Beträge mit zwei Nachkommastellen', () => {
    assert.equal(formatAmount(CHF(8450)), "8'450.00")
    assert.equal(formatAmount(0), '0.00')
  })
})

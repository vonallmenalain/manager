import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  computePayment,
  computeYear,
  DEFAULT_FINANCE_SETTINGS,
  formatAmount,
  monthListLabel,
  monthlyTotals,
  parseAmountToCents,
  sumDonations,
  taxCreditFor,
  type Donation,
  type FinanceSettings,
  type IncomeEntry,
  type PaymentDraft,
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
    coversMonths: [],
    taxAppliedCents: 0,
    createdBy: 'alain',
    createdAt: '2026-03-01T10:00:00Z',
    ...overrides,
  }
}

/** Ein leerer Zahlungsentwurf, in dem nur das Nötige steht. */
function leer(overrides: Partial<PaymentDraft> = {}): PaymentDraft {
  return { months: [], fastOfferingPerMonthCents: 0, taxAppliedCents: 0, ...overrides }
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
  it('gibt von einem Steuerbetrag genau ein Zehntel zum Verrechnen frei', () => {
    // Der springende Punkt: CHF 15'000 Steuern mindern den Zehnten um
    // CHF 1'500 – nicht um die ganze Summe.
    assert.equal(taxCreditFor(CHF(15_000)), CHF(1500))

    const figures = computeYear([], [], settings({ taxCents: CHF(15_000) }))

    assert.equal(figures.taxTotalCents, CHF(15_000))
    assert.equal(figures.taxCreditTotalCents, CHF(1500))
    assert.equal(figures.taxCreditOpenCents, CHF(1500))
  })

  it('zieht das verrechnete Guthaben vom geschuldeten Zehnten ab', () => {
    const figures = computeYear(
      income({ 1: CHF(8000), 2: CHF(8000) }),
      [payment({ amountCents: CHF(500), taxAppliedCents: CHF(400) })],
      settings({ taxCents: CHF(12_000) }),
    )

    assert.equal(figures.owedTithingCents, CHF(1600))
    assert.equal(figures.taxCreditAppliedCents, CHF(400))
    assert.equal(figures.paidTithingCents, CHF(500))
    assert.equal(figures.openTithingCents, CHF(700))
  })

  it('sagt, wie viel des Guthabens noch nicht verrechnet ist', () => {
    const figures = computeYear(
      income({ 1: CHF(8000) }),
      [payment({ taxAppliedCents: CHF(300) })],
      settings({ taxCents: CHF(12_000) }),
    )

    assert.equal(figures.taxCreditTotalCents, CHF(1200))
    assert.equal(figures.taxCreditOpenCents, CHF(900))
  })

  it('wird nie negativ, wenn mehr verrechnet wurde als Zehnter anfällt', () => {
    const figures = computeYear(
      income({ 1: CHF(3000) }),
      [payment({ taxAppliedCents: CHF(900) })],
      settings({ taxCents: CHF(9000) }),
    )

    assert.equal(figures.owedTithingCents, CHF(300))
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

  it('hakt genau die Monate ab, die eine Zahlung abrechnet', () => {
    const figures = computeYear(
      drei,
      [
        payment({ id: 'a', amountCents: CHF(800), coversMonths: [1] }),
        payment({ id: 'b', amountCents: CHF(800), coversMonths: [2] }),
      ],
      settings(),
    )

    assert.deepEqual(figures.settledMonths, [1, 2])
    assert.deepEqual(figures.openMonths, [3])
  })

  it('lässt einzelne Monate offen, wenn eine Zahlung sie überspringt', () => {
    // Wer im Januar nichts verdient hat und den Monat später abrechnen will,
    // soll ihn nicht durch eine spätere Zahlung verlieren.
    const figures = computeYear(
      drei,
      [payment({ amountCents: CHF(1600), coversMonths: [2, 3] })],
      settings(),
    )

    assert.deepEqual(figures.settledMonths, [2, 3])
    assert.deepEqual(figures.openMonths, [1])
  })

  it('steht ohne Zahlung bei nichts Abgerechnetem', () => {
    const figures = computeYear(drei, [], settings())

    assert.deepEqual(figures.settledMonths, [])
    assert.deepEqual(figures.openMonths, [1, 2, 3])
  })

  it('verkraftet eine Zahlung, die weiter reicht als das Erfasste', () => {
    const figures = computeYear(
      income({ 1: CHF(8000) }),
      [payment({ amountCents: CHF(800), coversMonths: [1, 2, 3] })],
      settings(),
    )

    assert.deepEqual(figures.settledMonths, [1, 2, 3])
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

describe('Zahlung erfassen', () => {
  const vier = income({ 1: CHF(5000), 2: CHF(5000), 3: CHF(5000), 4: CHF(5000) })

  it('rechnet den Zehnten aus den angehakten Monaten', () => {
    const rechnung = computePayment(vier, leer({ months: [1, 2, 3] }), 0)

    assert.equal(rechnung.incomeCents, CHF(15_000))
    assert.equal(rechnung.tithingCents, CHF(1500))
    assert.equal(rechnung.totalCents, CHF(1500))
  })

  it('nimmt das Fastopfer mal Anzahl Monate', () => {
    // Vier Monate zu CHF 50 sind CHF 200 – das Beispiel aus dem Alltag.
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2, 3, 4], fastOfferingPerMonthCents: CHF(50) }),
      0,
    )

    assert.equal(rechnung.fastOfferingCents, CHF(200))
    assert.equal(rechnung.totalCents, CHF(2000) + CHF(200))
  })

  it('zieht das verrechnete Steuerguthaben vom Zehnten ab', () => {
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2], taxAppliedCents: CHF(300) }),
      taxCreditFor(CHF(15_000)),
    )

    assert.equal(rechnung.tithingCents, CHF(1000))
    assert.equal(rechnung.taxAppliedCents, CHF(300))
    assert.equal(rechnung.netTithingCents, CHF(700))
    assert.equal(rechnung.totalCents, CHF(700))
  })

  it('verrechnet höchstens das, was an Guthaben noch da ist', () => {
    const rechnung = computePayment(vier, leer({ months: [1, 2], taxAppliedCents: CHF(900) }), CHF(400))

    assert.equal(rechnung.maxTaxCreditCents, CHF(400))
    assert.equal(rechnung.taxAppliedCents, CHF(400))
  })

  it('verrechnet höchstens so viel, wie diese Zahlung an Zehnten trägt', () => {
    // Der Rest bleibt stehen – ein Beleg über einen negativen Betrag wäre
    // keine Zahlung.
    const rechnung = computePayment(vier, leer({ months: [1], taxAppliedCents: CHF(900) }), CHF(1500))

    assert.equal(rechnung.tithingCents, CHF(500))
    assert.equal(rechnung.maxTaxCreditCents, CHF(500))
    assert.equal(rechnung.taxAppliedCents, CHF(500))
    assert.equal(rechnung.totalCents, 0)
  })

  it('ordnet die Monate und wirft Doppelte weg', () => {
    const rechnung = computePayment(vier, leer({ months: [3, 1, 3] }), 0)

    assert.deepEqual(rechnung.months, [1, 3])
    assert.equal(rechnung.incomeCents, CHF(10_000))
  })

  it('nennt zusammenhängende Monate als Strecke', () => {
    assert.equal(monthListLabel([1, 2, 3, 6]), 'Januar–März, Juni')
    assert.equal(monthListLabel([5]), 'Mai')
    assert.equal(monthListLabel([]), '')
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

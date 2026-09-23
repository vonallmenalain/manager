import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  computePayment,
  computeTaxYears,
  computeYear,
  formatAmount,
  monthListLabel,
  monthlyTotals,
  parseAmountToCents,
  sumDonations,
  taxCreditFor,
  type Donation,
  type IncomeEntry,
  type PaymentDraft,
  type TaxYearFigures,
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

/** Ein Steuerjahr mit einem einzigen Betrag, davon schon verrechnet: `appliedCents`. */
function steuerjahr(year: number, taxCents: number, appliedCents = 0): TaxYearFigures {
  const [figures] = computeTaxYears(
    [{ year, label: '', amountCents: taxCents }],
    appliedCents > 0 ? [{ taxYear: year, amountCents: appliedCents }] : [],
  )
  assert.ok(figures)
  return figures
}

/** Was je Steuerjahr noch offen ist – so, wie `computePayment` es braucht. */
function offen(perYear: Record<number, number>): { year: number; openCents: number }[] {
  return Object.entries(perYear).map(([year, openCents]) => ({ year: Number(year), openCents }))
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
    taxCredits: [],
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
    const figures = computeYear(income({ 1: CHF(8000), 2: CHF(8000) }), [])

    assert.equal(figures.totalIncomeCents, CHF(16_000))
    assert.equal(figures.owedTithingCents, CHF(1600))
    assert.equal(figures.openTithingCents, CHF(1600))
  })

  it('zählt mehrere Einnahmen desselben Monats zusammen', () => {
    // Zwei Löhne plus ein Bonus – der Monat ist die Einheit, nicht die Person.
    const figures = computeYear(income({ 1: [CHF(5000), CHF(3000)] }), [])

    assert.equal(figures.months[0]?.incomeCents, CHF(8000))
    assert.equal(figures.months[0]?.tithingCents, CHF(800))
  })

  it('die Monatswerte summieren sich auf den Zehnten vor Steuerabzug', () => {
    const figures = computeYear(income({ 1: CHF(7333.33), 2: CHF(4111.11), 3: CHF(9500.5) }), [])

    const summe = figures.months.reduce((total, month) => total + month.tithingCents, 0)
    // Ohne verrechnete Steuern ist der geschuldete Zehnte genau diese Summe.
    assert.equal(summe, figures.owedTithingCents)
  })

  it('rechnet nichts an für Monate, die noch nicht erfasst sind', () => {
    const figures = computeYear(income({ 1: CHF(8000) }), [])

    assert.equal(figures.lastEnteredMonth, 1)
    assert.equal(figures.months[5]?.entered, false)
    assert.equal(figures.months[5]?.tithingCents, 0)
  })

  it('gibt für ein leeres Jahr überall Null zurück', () => {
    const figures = computeYear([], [], steuerjahr(2026, CHF(9000)))

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

    const figures = computeYear([], [], steuerjahr(2026, CHF(15_000)))

    assert.equal(figures.taxTotalCents, CHF(15_000))
    assert.equal(figures.taxCreditTotalCents, CHF(1500))
    assert.equal(figures.taxCreditOpenCents, CHF(1500))
  })

  it('zieht das verrechnete Guthaben vom geschuldeten Zehnten ab', () => {
    const figures = computeYear(
      income({ 1: CHF(8000), 2: CHF(8000) }),
      [payment({ amountCents: CHF(500), taxAppliedCents: CHF(400) })],
      steuerjahr(2026, CHF(12_000), CHF(400)),
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
      steuerjahr(2026, CHF(12_000), CHF(300)),
    )

    assert.equal(figures.taxCreditTotalCents, CHF(1200))
    assert.equal(figures.taxCreditOpenCents, CHF(900))
  })

  it('wird nie negativ, wenn mehr verrechnet wurde als Zehnter anfällt', () => {
    const figures = computeYear(
      income({ 1: CHF(3000) }),
      [payment({ taxAppliedCents: CHF(900) })],
      steuerjahr(2026, CHF(9000), CHF(900)),
    )

    assert.equal(figures.owedTithingCents, CHF(300))
    assert.equal(figures.openTithingCents, 0)
  })

  it('meldet nichts Offenes, wenn mehr bezahlt wurde als geschuldet', () => {
    // Aufgerundet einbezahlt: Das ist kein Fehler und darf keinen negativen
    // offenen Betrag ergeben.
    const figures = computeYear(income({ 1: CHF(8000) }), [payment({ amountCents: CHF(900) })])

    assert.equal(figures.openTithingCents, 0)
  })

  it('mindert den Zehnten auch mit Guthaben aus einem anderen Steuerjahr', () => {
    // Die Steuern 2025 stehen erst 2026 fest und werden mit einer Zahlung
    // von 2026 verrechnet. Das mindert den Zehnten 2026 – das Guthaben der
    // Steuern 2026 bleibt davon unberührt.
    const figures = computeYear(
      income({ 1: CHF(8000), 2: CHF(8000) }),
      [
        payment({
          amountCents: CHF(400),
          taxAppliedCents: CHF(1200),
          taxCredits: [{ taxYear: 2025, amountCents: CHF(1200) }],
        }),
      ],
      steuerjahr(2026, CHF(15_000)),
    )

    assert.equal(figures.taxCreditAppliedCents, CHF(1200))
    assert.equal(figures.openTithingCents, 0)
    assert.equal(figures.taxCreditOpenCents, CHF(1500))
  })
})

describe('Steuerjahre', () => {
  it('zählt mehrere Beträge eines Jahres zusammen', () => {
    const [jahr] = computeTaxYears(
      [
        { year: 2025, label: 'Bundessteuer', amountCents: CHF(2000) },
        { year: 2025, label: 'Staats- und Gemeindesteuer', amountCents: CHF(13_000) },
      ],
      [],
    )

    assert.equal(jahr?.taxCents, CHF(15_000))
    assert.equal(jahr?.creditCents, CHF(1500))
    assert.equal(jahr?.openCents, CHF(1500))
    assert.deepEqual(jahr?.labels, ['Bundessteuer', 'Staats- und Gemeindesteuer'])
  })

  it('nimmt ein Zehntel der Summe, nicht die Summe der Zehntel', () => {
    // Je 5 Rappen ergäben einzeln gerundet je 1 Rappen Guthaben, zusammen 2.
    // Die Beträge sind aber Teile einer Rechnung: 10 Rappen, davon 1.
    const [jahr] = computeTaxYears(
      [
        { year: 2025, label: 'Bund', amountCents: 5 },
        { year: 2025, label: 'Kanton', amountCents: 5 },
      ],
      [],
    )

    assert.equal(jahr?.creditCents, 1)
  })

  it('zieht ab, was Zahlungen daraus verrechnet haben', () => {
    const [jahr] = computeTaxYears(
      [{ year: 2025, label: '', amountCents: CHF(15_000) }],
      [
        { taxYear: 2025, amountCents: CHF(600) },
        { taxYear: 2025, amountCents: CHF(500) },
      ],
    )

    assert.equal(jahr?.appliedCents, CHF(1100))
    assert.equal(jahr?.openCents, CHF(400))
  })

  it('wird nie negativ, wenn ein Betrag nach dem Verrechnen sinkt', () => {
    // Die Zahlungen sind geschehen; ein nachträglich kleinerer Steuerbetrag
    // macht sie nicht rückgängig, lässt aber auch nichts Negatives offen.
    const [jahr] = computeTaxYears(
      [{ year: 2025, label: '', amountCents: CHF(10_000) }],
      [{ taxYear: 2025, amountCents: CHF(1500) }],
    )

    assert.equal(jahr?.creditCents, CHF(1000))
    assert.equal(jahr?.openCents, 0)
  })

  it('führt ein Jahr ohne Einträge, aus dem schon verrechnet wurde', () => {
    const jahre = computeTaxYears([], [{ taxYear: 2024, amountCents: CHF(300) }])

    assert.deepEqual(jahre, [
      { year: 2024, taxCents: 0, creditCents: 0, appliedCents: CHF(300), openCents: 0, labels: [] },
    ])
  })

  it('ordnet die Jahre aufsteigend und lässt leere Bezeichnungen weg', () => {
    const jahre = computeTaxYears(
      [
        { year: 2026, label: 'Bundessteuer', amountCents: CHF(1000) },
        { year: 2024, label: '  ', amountCents: CHF(1000) },
        { year: 2025, label: '', amountCents: CHF(1000) },
      ],
      [],
    )

    assert.deepEqual(
      jahre.map((jahr) => jahr.year),
      [2024, 2025, 2026],
    )
    assert.deepEqual(jahre[0]?.labels, [])
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
    )

    assert.deepEqual(figures.settledMonths, [1, 2])
    assert.deepEqual(figures.openMonths, [3])
  })

  it('lässt einzelne Monate offen, wenn eine Zahlung sie überspringt', () => {
    // Wer im Januar nichts verdient hat und den Monat später abrechnen will,
    // soll ihn nicht durch eine spätere Zahlung verlieren.
    const figures = computeYear(drei, [payment({ amountCents: CHF(1600), coversMonths: [2, 3] })])

    assert.deepEqual(figures.settledMonths, [2, 3])
    assert.deepEqual(figures.openMonths, [1])
  })

  it('steht ohne Zahlung bei nichts Abgerechnetem', () => {
    const figures = computeYear(drei, [])

    assert.deepEqual(figures.settledMonths, [])
    assert.deepEqual(figures.openMonths, [1, 2, 3])
  })

  it('verkraftet eine Zahlung, die weiter reicht als das Erfasste', () => {
    const figures = computeYear(
      income({ 1: CHF(8000) }),
      [payment({ amountCents: CHF(800), coversMonths: [1, 2, 3] })],
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
    )

    assert.equal(figures.paidTithingCents, CHF(800))
    assert.equal(figures.paidFastOfferingCents, CHF(200))
    assert.equal(figures.openTithingCents, 0)
  })
})

describe('Zahlung erfassen', () => {
  const vier = income({ 1: CHF(5000), 2: CHF(5000), 3: CHF(5000), 4: CHF(5000) })

  it('rechnet den Zehnten aus den angehakten Monaten', () => {
    const rechnung = computePayment(vier, leer({ months: [1, 2, 3] }), [])

    assert.equal(rechnung.incomeCents, CHF(15_000))
    assert.equal(rechnung.tithingCents, CHF(1500))
    assert.equal(rechnung.totalCents, CHF(1500))
  })

  it('nimmt das Fastopfer mal Anzahl Monate', () => {
    // Vier Monate zu CHF 50 sind CHF 200 – das Beispiel aus dem Alltag.
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2, 3, 4], fastOfferingPerMonthCents: CHF(50) }),
      [],
    )

    assert.equal(rechnung.fastOfferingCents, CHF(200))
    assert.equal(rechnung.totalCents, CHF(2000) + CHF(200))
  })

  it('zieht das verrechnete Steuerguthaben vom Zehnten ab', () => {
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2], taxAppliedCents: CHF(300) }),
      offen({ 2026: taxCreditFor(CHF(15_000)) }),
    )

    assert.equal(rechnung.tithingCents, CHF(1000))
    assert.equal(rechnung.taxAppliedCents, CHF(300))
    assert.equal(rechnung.netTithingCents, CHF(700))
    assert.equal(rechnung.totalCents, CHF(700))
  })

  it('verrechnet höchstens das, was an Guthaben noch da ist', () => {
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2], taxAppliedCents: CHF(900) }),
      offen({ 2026: CHF(400) }),
    )

    assert.equal(rechnung.maxTaxCreditCents, CHF(400))
    assert.equal(rechnung.taxAppliedCents, CHF(400))
  })

  it('verrechnet höchstens so viel, wie diese Zahlung an Zehnten trägt', () => {
    // Der Rest bleibt stehen – ein Beleg über einen negativen Betrag wäre
    // keine Zahlung.
    const rechnung = computePayment(
      vier,
      leer({ months: [1], taxAppliedCents: CHF(900) }),
      offen({ 2026: CHF(1500) }),
    )

    assert.equal(rechnung.tithingCents, CHF(500))
    assert.equal(rechnung.maxTaxCreditCents, CHF(500))
    assert.equal(rechnung.taxAppliedCents, CHF(500))
    assert.equal(rechnung.totalCents, 0)
  })

  it('ordnet die Monate und wirft Doppelte weg', () => {
    const rechnung = computePayment(vier, leer({ months: [3, 1, 3] }), [])

    assert.deepEqual(rechnung.months, [1, 3])
    assert.equal(rechnung.incomeCents, CHF(10_000))
  })

  it('nennt zusammenhängende Monate als Strecke', () => {
    assert.equal(monthListLabel([1, 2, 3, 6]), 'Januar–März, Juni')
    assert.equal(monthListLabel([5]), 'Mai')
    assert.equal(monthListLabel([]), '')
  })
})

describe('Steuern je Steuerjahr verrechnen', () => {
  const vier = income({ 1: CHF(5000), 2: CHF(5000), 3: CHF(5000), 4: CHF(5000) })
  const zweiJahre = offen({ 2024: CHF(300), 2025: CHF(1200) })

  it('verrechnet ein angehaktes Jahr ganz', () => {
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2, 3, 4], taxYears: [2025], taxAppliedCents: CHF(1200) }),
      zweiJahre,
    )

    assert.equal(rechnung.taxAppliedCents, CHF(1200))
    assert.deepEqual(rechnung.taxCredits, [{ taxYear: 2025, amountCents: CHF(1200) }])
    assert.equal(rechnung.netTithingCents, CHF(800))
  })

  it('nimmt einen Betrag von Hand aus dem ältesten Jahr zuerst', () => {
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2, 3, 4], taxAppliedCents: CHF(500) }),
      zweiJahre,
    )

    assert.deepEqual(rechnung.taxCredits, [
      { taxYear: 2024, amountCents: CHF(300) },
      { taxYear: 2025, amountCents: CHF(200) },
    ])
  })

  it('lässt ein Jahr unberührt, das nicht angehakt ist', () => {
    // 2024 ist älter, aber nicht gewählt – der Betrag kommt ganz aus 2025.
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2, 3, 4], taxYears: [2025], taxAppliedCents: CHF(500) }),
      zweiJahre,
    )

    assert.deepEqual(rechnung.taxCredits, [{ taxYear: 2025, amountCents: CHF(500) }])
  })

  it('deckelt auf das, was in den angehakten Jahren offen ist', () => {
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2, 3, 4], taxYears: [2025], taxAppliedCents: CHF(2000) }),
      zweiJahre,
    )

    assert.equal(rechnung.availableTaxCreditCents, CHF(1200))
    assert.equal(rechnung.taxAppliedCents, CHF(1200))
    assert.deepEqual(rechnung.taxCredits, [{ taxYear: 2025, amountCents: CHF(1200) }])
  })

  it('weicht nicht auf andere Jahre aus, wenn die angehakten nichts mehr haben', () => {
    // Wer 2023 anhakt, will nicht still aus 2025 verrechnen – auch wenn 2023
    // inzwischen von einer anderen Zahlung aufgebraucht ist.
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2, 3, 4], taxYears: [2023], taxAppliedCents: CHF(500) }),
      [...zweiJahre, { year: 2023, openCents: 0 }],
    )

    assert.equal(rechnung.availableTaxCreditCents, 0)
    assert.equal(rechnung.taxAppliedCents, 0)
    assert.deepEqual(rechnung.taxCredits, [])
  })

  it('teilt auf die angehakten Jahre auf, wenn die Zahlung nicht alles trägt', () => {
    // Ein Monat trägt CHF 500 Zehnten – mehr lässt sich nicht verrechnen.
    const rechnung = computePayment(
      vier,
      leer({ months: [1], taxYears: [2024, 2025], taxAppliedCents: CHF(1500) }),
      zweiJahre,
    )

    assert.equal(rechnung.maxTaxCreditCents, CHF(500))
    assert.deepEqual(rechnung.taxCredits, [
      { taxYear: 2024, amountCents: CHF(300) },
      { taxYear: 2025, amountCents: CHF(200) },
    ])
    assert.equal(rechnung.totalCents, 0)
  })

  it('ein ganz verrechnetes Jahr ist danach nicht mehr offen', () => {
    const steuern = [
      { year: 2025, label: 'Bundessteuer', amountCents: CHF(2000) },
      { year: 2025, label: 'Staatssteuer', amountCents: CHF(13_000) },
    ]
    const vorher = computeTaxYears(steuern, [])
    const rechnung = computePayment(
      vier,
      leer({ months: [1, 2, 3, 4], taxYears: [2025], taxAppliedCents: CHF(1500) }),
      vorher,
    )
    const nachher = computeTaxYears(steuern, rechnung.taxCredits)

    assert.equal(rechnung.taxAppliedCents, CHF(1500))
    assert.equal(nachher[0]?.openCents, 0)
  })

  it('die Aufteilung ergibt immer genau den verrechneten Betrag', () => {
    const jahre = offen({ 2022: CHF(80), 2023: 0, 2024: CHF(300), 2025: CHF(1200) })

    for (const months of [[1], [1, 2], [1, 2, 3, 4]]) {
      for (const taxYears of [[], [2022], [2023, 2025], [2022, 2024, 2025]]) {
        for (const wunsch of [0, 1, CHF(79.99), CHF(250), CHF(1580), CHF(5000)]) {
          const rechnung = computePayment(
            vier,
            leer({ months, taxYears, taxAppliedCents: wunsch }),
            jahre,
          )
          const summe = rechnung.taxCredits.reduce((total, credit) => total + credit.amountCents, 0)

          assert.equal(summe, rechnung.taxAppliedCents)
          assert.ok(rechnung.taxAppliedCents <= rechnung.maxTaxCreditCents)
          assert.ok(rechnung.taxCredits.every((credit) => credit.amountCents > 0))
        }
      }
    }
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

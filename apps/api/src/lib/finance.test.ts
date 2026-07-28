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

const CHF = (francs: number) => francs * 100

describe('Zehnten-Berechnung', () => {
  it('rechnet das Beispiel aus dem Konzept', () => {
    // Einkommen 9 000 im Juli, Steuern 12 000 im Jahr, gleichmässig verteilt:
    // 9 000 − 1 000 = 8 000 Basis, davon 10 % = 800.
    const jahr = computeYear(
      income({ 1: CHF(9000), 2: CHF(9000), 3: CHF(9000), 4: CHF(9000), 5: CHF(9000), 6: CHF(9000), 7: CHF(9000) }),
      settings({ taxCents: CHF(12_000) }),
    )

    const juli = jahr.months[6]
    assert.equal(juli?.incomeCents, CHF(9000))
    assert.equal(juli?.taxShareCents, CHF(1000))
    assert.equal(juli?.baseCents, CHF(8000))
    assert.equal(juli?.tithingCents, CHF(800))
    assert.equal(jahr.totalTithingCents, CHF(5600), '7 × 800')
  })

  it('die Monatswerte summieren sich exakt auf den Jahreswert', () => {
    // Krumme Zahlen, damit die Rundung wirklich geprüft wird.
    const entries = income({
      1: [733_37, 512_19], 2: [733_37, 0], 3: [1_204_91, 512_19],
      4: [733_37, 512_19], 5: [899_03, 0], 6: [733_37, 512_19],
      7: [733_37, 512_19], 8: [733_37, 1_988_44], 9: [733_37, 512_19],
      10: [733_37, 512_19], 11: [733_37, 512_19], 12: [4_101_88, 512_19],
    })
    const jahr = computeYear(entries, settings({ taxCents: 987_65 }))

    const summeDerMonate = jahr.months.reduce((sum, m) => sum + m.tithingCents, 0)
    assert.equal(summeDerMonate, jahr.totalTithingCents)

    // Und dieser Jahreswert ist genau das, was am Jahresende zählt.
    const jahreseinkommen = entries.reduce((sum, e) => sum + e.amountCents, 0)
    assert.equal(jahr.totalIncomeCents, jahreseinkommen)
    assert.equal(jahr.totalTithingCents, Math.round((jahreseinkommen - 987_65) * 0.1))

    // Auch die Steueranteile gehen genau auf.
    assert.equal(jahr.months.reduce((sum, m) => sum + m.taxShareCents, 0), 987_65)
  })

  it('verrechnet einen Monat ohne Einkommen mit den übrigen', () => {
    const jahr = computeYear(
      income({ 1: CHF(6000), 2: 0, 3: CHF(6000) }),
      settings({ taxCents: CHF(12_000) }),
    )

    const februar = jahr.months[1]
    assert.equal(februar?.entered, true, 'ein erfasster Nullmonat zählt mit')
    assert.equal(februar?.taxShareCents, CHF(1000))
    assert.ok((februar?.tithingCents ?? 0) < 0, 'negativ, weil der Steueranteil trotzdem läuft')

    // Über die drei Monate: 12 000 Einkommen − 3 000 Steueranteil = 9 000 → 900.
    assert.equal(jahr.totalTithingCents, CHF(900))
    assert.equal(jahr.months.reduce((sum, m) => sum + m.tithingCents, 0), CHF(900))
  })

  it('rechnet nichts an für Monate, die noch nicht erfasst sind', () => {
    const jahr = computeYear(income({ 1: CHF(5000), 2: CHF(5000) }), settings({ taxCents: CHF(12_000) }))

    assert.equal(jahr.lastEnteredMonth, 2)
    for (const monat of jahr.months.slice(2)) {
      assert.equal(monat.entered, false)
      assert.equal(monat.taxShareCents, 0, `Monat ${monat.month} darf keinen Steueranteil tragen`)
      assert.equal(monat.tithingCents, 0)
    }
    // 10 000 − 2 000 (zwei Zwölftel) = 8 000 → 800.
    assert.equal(jahr.totalTithingCents, CHF(800))
  })

  it('wird nie negativ, wenn die Steuer höher ist als das Einkommen', () => {
    const jahr = computeYear(income({ 1: CHF(500), 2: CHF(500) }), settings({ taxCents: CHF(60_000) }))

    assert.equal(jahr.totalTithingCents, 0)
    assert.equal(jahr.openTithingCents, 0)
    for (const monat of jahr.months) {
      assert.ok(monat.tithingCents >= 0, `Monat ${monat.month} ist negativ`)
    }
  })

  it('lässt den Steuerabzug weg, wenn er abgeschaltet ist', () => {
    const jahr = computeYear(
      income({ 1: CHF(9000) }),
      settings({ taxCents: CHF(12_000), deductTax: false }),
    )

    assert.equal(jahr.months[0]?.taxShareCents, 0)
    assert.equal(jahr.totalTithingCents, CHF(900))
  })

  it('nimmt einen anderen Satz, wenn einer gesetzt ist', () => {
    const jahr = computeYear(income({ 1: CHF(1000) }), settings({ rateBasisPoints: 500 }))
    assert.equal(jahr.totalTithingCents, CHF(50))
  })

  it('gibt für ein leeres Jahr überall Null zurück', () => {
    const jahr = computeYear([], settings({ taxCents: CHF(12_000) }))

    assert.equal(jahr.lastEnteredMonth, 0)
    assert.equal(jahr.totalIncomeCents, 0)
    assert.equal(jahr.totalTithingCents, 0)
    assert.equal(jahr.openTithingCents, 0)
    assert.deepEqual(jahr.openMonths, [])
    assert.equal(jahr.months.length, 12)
  })
})

describe('Abrechnungsstand', () => {
  const entries = income({
    1: CHF(8000), 2: CHF(8000), 3: CHF(8000), 4: CHF(8000),
    5: CHF(8000), 6: CHF(8000), 7: CHF(8000),
  })

  it('zeigt, was nach dem abgerechneten Monat noch offen ist', () => {
    const jahr = computeYear(entries, settings({ taxCents: CHF(12_000), settledThroughMonth: 5 }))

    // Pro Monat: 8 000 − 1 000 = 7 000 → 700. Fünf abgerechnet, zwei offen.
    assert.equal(jahr.settledTithingCents, CHF(3500))
    assert.equal(jahr.openTithingCents, CHF(1400))
    assert.deepEqual(jahr.openMonths, [6, 7])
  })

  it('meldet nichts Offenes, wenn alles Erfasste abgerechnet ist', () => {
    const jahr = computeYear(entries, settings({ taxCents: CHF(12_000), settledThroughMonth: 7 }))

    assert.equal(jahr.openTithingCents, 0)
    assert.deepEqual(jahr.openMonths, [])
  })

  it('verkraftet einen Abrechnungsstand jenseits des Erfassten', () => {
    // Kann vorkommen, wenn im Voraus bezahlt und danach ein Monat gelöscht wird.
    const jahr = computeYear(entries, settings({ taxCents: CHF(12_000), settledThroughMonth: 12 }))

    assert.equal(jahr.openTithingCents, 0)
    assert.deepEqual(jahr.openMonths, [])
    assert.equal(jahr.settledTithingCents, jahr.totalTithingCents)
  })

  it('rechnet nichts als abgerechnet, solange der Stand bei null steht', () => {
    const jahr = computeYear(entries, settings({ taxCents: CHF(12_000) }))

    assert.equal(jahr.settledTithingCents, 0)
    assert.equal(jahr.openTithingCents, jahr.totalTithingCents)
    assert.deepEqual(jahr.openMonths, [1, 2, 3, 4, 5, 6, 7])
  })
})

describe('Monatssummen und Spenden', () => {
  it('zählt mehrere Einnahmen desselben Monats zusammen', () => {
    const totals = monthlyTotals(income({ 3: [CHF(5000), CHF(3200)] }))
    assert.equal(totals[2], CHF(8200))
    assert.equal(totals.length, 12)
  })

  it('summiert je Spendenart getrennt', () => {
    const spenden: Donation[] = [
      { id: '1', year: 2026, kind: 'zehnten', amountCents: CHF(700), paidOn: '2026-02-01', note: '', coversThroughMonth: 1, createdBy: 'a', createdAt: '' },
      { id: '2', year: 2026, kind: 'fastopfer', amountCents: CHF(50), paidOn: '2026-02-01', note: '', coversThroughMonth: null, createdBy: 'a', createdAt: '' },
      { id: '3', year: 2026, kind: 'fastopfer', amountCents: CHF(60), paidOn: '2026-03-01', note: '', coversThroughMonth: null, createdBy: 'a', createdAt: '' },
    ]

    assert.equal(sumDonations(spenden, 'zehnten'), CHF(700))
    assert.equal(sumDonations(spenden, 'fastopfer'), CHF(110))
    assert.equal(sumDonations(spenden, 'andere'), 0)
  })

  it('liest die Beträge so, wie man sie in der Schweiz schreibt', () => {
    // Dasselbe Feld wie bei den Dokumenten – hier zählt es besonders, weil
    // ein falsch gelesener Lohn die ganze Abrechnung verschiebt.
    assert.equal(parseAmountToCents("8'450.00"), CHF(8450))
    assert.equal(parseAmountToCents('8’450'), CHF(8450))
    assert.equal(parseAmountToCents('8450,50'), 845_050)
    assert.equal(parseAmountToCents(formatAmount(CHF(8450))), CHF(8450))
  })
})

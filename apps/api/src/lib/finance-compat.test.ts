import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { legacyTaxEntries, taxYearsOfPayment } from './finance-compat.ts'

describe('Steuern speichern aus einer alten App', () => {
  it('schreibt nichts, wenn die Summe schon stimmt', () => {
    // Die alte App kennt nur die Summe. Schickt sie dieselbe zurück, bleibt
    // die Aufteilung aus der neuen App stehen.
    const bestehend = [
      { label: 'Bundessteuer', amountCents: 200_000 },
      { label: 'Staats- und Gemeindesteuer', amountCents: 1_300_000 },
    ]

    assert.equal(legacyTaxEntries(bestehend, 1_500_000), 'unverändert')
    assert.equal(legacyTaxEntries([], 0), 'unverändert')
  })

  it('legt den ersten Betrag eines Jahres an', () => {
    assert.deepEqual(legacyTaxEntries([], 1_500_000), [{ label: '', amountCents: 1_500_000 }])
  })

  it('ändert einen einzelnen Betrag und behält seine Bezeichnung', () => {
    assert.deepEqual(legacyTaxEntries([{ label: 'Bundessteuer', amountCents: 200_000 }], 250_000), [
      { label: 'Bundessteuer', amountCents: 250_000 },
    ])
  })

  it('entfernt den Betrag, wenn die alte App 0 schickt', () => {
    assert.deepEqual(legacyTaxEntries([{ label: '', amountCents: 200_000 }], 0), [])
  })

  it('rührt ein Jahr mit mehreren Beträgen nicht an', () => {
    // Welcher Betrag sich ändern soll, weiss nur, wer die Beträge sieht.
    const bestehend = [
      { label: 'Bundessteuer', amountCents: 200_000 },
      { label: 'Staats- und Gemeindesteuer', amountCents: 1_300_000 },
    ]

    assert.equal(legacyTaxEntries(bestehend, 1_600_000), 'mehrdeutig')
  })
})

describe('Steuerjahre einer Zahlung', () => {
  it('nimmt bei einer alten App das Jahr der Zahlung', () => {
    assert.deepEqual(taxYearsOfPayment(undefined, 2026), [2026])
  })

  it('übernimmt, was die neue App schickt – auch keine Auswahl', () => {
    // Leer heisst bei der neuen App: aus allen Jahren, das älteste zuerst.
    assert.deepEqual(taxYearsOfPayment([], 2026), [])
    assert.deepEqual(taxYearsOfPayment([2024, 2025], 2026), [2024, 2025])
  })
})

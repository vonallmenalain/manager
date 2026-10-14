import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  abrechnungsstand,
  analyse,
  gleicherZeitraumVorjahr,
  kurzerZeitraum,
  monateDesJahres,
  offenesAkonto,
  proRata,
  summarize,
  ungedeckt,
  type BillSection,
  type UtilityBill,
} from '@manager/shared'

/**
 * Die Stromrechnungen, wie sie im Haushalt vorliegen: Abrechnungen je
 * Halbjahr, dazu eine Akontorechnung für das dritte Quartal 2026, das noch
 * keine Abrechnung kennt.
 */
function rechnung(
  id: string,
  kind: UtilityBill['kind'],
  periodStart: string,
  periodEnd: string,
  section: Partial<BillSection> & Pick<BillSection, 'division' | 'amountCents'>,
): UtilityBill {
  return {
    id,
    kind,
    invoiceNumber: id,
    invoiceDate: periodEnd,
    periodStart,
    periodEnd,
    customerNumber: null,
    sections: [{ groups: [], readings: [], positions: [], meterPoint: null, meterNumber: null, ...section }],
    subtotalCents: section.amountCents,
    prepaidCents: 0,
    totalCents: section.amountCents,
    vatCents: 0,
    documentId: null,
    sourceFile: null,
    note: '',
    createdBy: 'u',
    createdAt: `${periodEnd}T00:00:00.000Z`,
    updatedAt: `${periodEnd}T00:00:00.000Z`,
  }
}

const strom = (amountCents: number, hoch: number, nieder: number): Partial<BillSection> & Pick<BillSection, 'division' | 'amountCents'> => ({
  division: 'strom',
  amountCents,
  groups: [
    { group: 'energie', amountCents: Math.round(amountCents * 0.5) },
    { group: 'netznutzung', amountCents: amountCents - Math.round(amountCents * 0.5) },
  ],
  readings: [
    { tariff: 'hoch', label: '', unit: 'kWh', startValue: null, endValue: null, quantity: hoch },
    { tariff: 'nieder', label: '', unit: 'kWh', startValue: null, endValue: null, quantity: nieder },
  ],
})

const RECHNUNGEN: UtilityBill[] = [
  rechnung('h1-2025', 'abrechnung', '2025-01-01', '2025-06-30', strom(181_000, 2500, 2300)),
  rechnung('h2-2025', 'abrechnung', '2025-07-01', '2025-12-31', strom(184_000, 2600, 2400)),
  rechnung('h1-2026', 'abrechnung', '2026-01-01', '2026-06-30', strom(183_355, 2760, 2460)),
  // Das Akonto des ersten Quartals ist in der Halbjahresabrechnung aufgegangen …
  rechnung('ak-q1-2026', 'akonto', '2026-01-01', '2026-03-31', { division: 'strom', amountCents: 62_000 }),
  // … das des dritten noch nicht.
  rechnung('ak-q3-2026', 'akonto', '2026-07-01', '2026-09-30', { division: 'strom', amountCents: 92_000 }),
]

const { entries, akonto } = analyse(RECHNUNGEN)

describe('proRata', () => {
  it('teilt Kosten, Mengen und Blöcke nach Tagen', () => {
    const h1 = entries.find((entry) => entry.bill.id === 'h1-2026')
    const januar = h1 ? proRata(h1, '2026-01-01', '2026-01-31') : null
    assert.equal(januar?.days, 31)
    assert.ok(Math.abs((januar?.costCents ?? 0) - (183_355 * 31) / 181) < 1e-6)
    assert.ok(Math.abs((januar?.highQuantity ?? 0) - (2760 * 31) / 181) < 1e-9)
    // Der Preis je Einheit bleibt – gleichmässig verteilt gilt er für jeden Tag.
    assert.equal(januar?.pricePerUnitHundredths, h1?.pricePerUnitHundredths)
  })

  it('gibt nichts zurück, was ausserhalb liegt', () => {
    const h1 = entries.find((entry) => entry.bill.id === 'h1-2026')
    assert.equal(h1 ? proRata(h1, '2026-07-01', '2026-07-31') : 'fehlt', null)
  })
})

describe('ungedeckt', () => {
  it('schneidet die gedeckten Tage heraus', () => {
    assert.deepEqual(
      ungedeckt({ von: '2026-01-01', bis: '2026-12-31' }, [
        { von: '2026-01-01', bis: '2026-06-30' },
        { von: '2026-09-01', bis: '2026-09-30' },
      ]),
      [
        { von: '2026-07-01', bis: '2026-08-31' },
        { von: '2026-10-01', bis: '2026-12-31' },
      ],
    )
    assert.deepEqual(ungedeckt({ von: '2026-01-01', bis: '2026-03-31' }, [{ von: '2025-07-01', bis: '2026-06-30' }]), [])
  })
})

describe('offenesAkonto', () => {
  it('lässt nur das Akonto stehen, das noch keine Abrechnung kennt', () => {
    const offen = offenesAkonto(akonto, entries)
    assert.deepEqual(
      offen.map((entry) => [entry.bill.id, entry.bill.periodStart, entry.bill.periodEnd, entry.costCents]),
      [['ak-q3-2026', '2026-07-01', '2026-09-30', 92_000]],
    )
  })
})

describe('monateDesJahres', () => {
  const monate = monateDesJahres(2026, entries, offenesAkonto(akonto, entries))

  it('verteilt das abgerechnete Halbjahr und ergibt wieder die Rechnung', () => {
    const halbjahr = monate.slice(0, 6).reduce((sum, monat) => sum + summarize(monat.entries).totalCostCents, 0)
    assert.ok(Math.abs(halbjahr - 183_355) < 1e-6)
    assert.equal(monate[6]?.entries.length, 0)
  })

  it('setzt das offene Akonto in seine Monate', () => {
    assert.deepEqual(
      monate.map((monat) => Math.round(monat.akonto.reduce((sum, entry) => sum + entry.costCents, 0))),
      [0, 0, 0, 0, 0, 0, 31_000, 31_000, 30_000, 0, 0, 0],
    )
  })

  it('zeigt je Monat, was abgerechnet, vorausbezahlt und offen ist', () => {
    const [stand] = abrechnungsstand(monate, ['strom'])
    assert.deepEqual(
      stand?.monate.map((monat) => (monat.abgerechnet === monat.tage ? 'A' : monat.akonto === monat.tage ? 'K' : '–')).join(''),
      'AAAAAAKKK–––',
    )
  })
})

describe('gleicherZeitraumVorjahr', () => {
  it('vergleicht das erste Halbjahr mit dem ersten Halbjahr', () => {
    const gewaehlt = entries.filter((entry) => entry.bill.id === 'h1-2026')
    const vergleich = gleicherZeitraumVorjahr(gewaehlt, entries)
    assert.equal(vergleich?.von, '2025-01-01')
    assert.equal(vergleich?.bis, '2025-06-30')
    assert.equal(Math.round(summarize(vergleich?.entries ?? []).totalCostCents), 181_000)
    assert.equal(kurzerZeitraum(vergleich?.von ?? '', vergleich?.bis ?? ''), 'Jan–Jun 2025')
  })

  it('verzichtet, wenn das Vorjahr die Tage nicht deckt', () => {
    const gewaehlt = entries.filter((entry) => entry.bill.id === 'h1-2025')
    assert.equal(gleicherZeitraumVorjahr(gewaehlt, entries), null)
  })
})

describe('kurzerZeitraum', () => {
  it('schreibt Monate, Jahre und krumme Tage', () => {
    assert.equal(kurzerZeitraum('2025-01-01', '2025-12-31'), '2025')
    assert.equal(kurzerZeitraum('2026-07-01', '2026-09-30'), 'Jul–Sep 2026')
    assert.equal(kurzerZeitraum('2026-03-01', '2026-03-31'), 'Mär 2026')
    assert.equal(kurzerZeitraum('2025-01-03', '2025-06-30'), '03.01.–30.06.2025')
    assert.equal(kurzerZeitraum('2024-07-01', '2025-06-30'), 'Jul 2024 – Jun 2025')
  })
})

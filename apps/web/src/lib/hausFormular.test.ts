import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { BillInput, BillSection } from '@manager/shared'

import { neueSektion, sectionCents, toBill, toDraft } from './hausFormular.ts'

/**
 * Die Stromabrechnung 248'619 (1. Halbjahr 2026), wie der Parser sie aus dem
 * PDF liest – der Stand, in dem sie im Formular der Vorschau landet.
 *
 * Das Formular ist das Nadelöhr zwischen Auslesen und Speichern: Was hier
 * kein Feld hat, ist nach dem Bestätigen weg. Diese Tests führen die Rechnung
 * hin und zurück und vergleichen, was ankommt.
 */
function gelesen(): BillInput {
  return {
    kind: 'abrechnung',
    invoiceNumber: '248619',
    invoiceDate: '2026-07-14',
    periodStart: '2026-01-01',
    periodEnd: '2026-06-30',
    customerNumber: '18444 / 4086',
    sections: [
      {
        division: 'strom',
        amountCents: 183_355,
        groups: [
          { group: 'energie', amountCents: 85_490 },
          { group: 'netznutzung', amountCents: 69_785 },
          { group: 'abgaben', amountCents: 23_865 },
          { group: 'messung', amountCents: 4215 },
        ],
        readings: [
          {
            tariff: 'hoch',
            label: 'Wirkstrom Tagtarif',
            unit: 'kWh',
            startValue: 31_185,
            endValue: 33_945,
            quantity: 2760,
          },
          {
            tariff: 'nieder',
            label: 'Wirkstrom Nachttarif',
            unit: 'kWh',
            startValue: 34_093,
            endValue: 36_553,
            quantity: 2460,
          },
        ],
        positions: [],
        meterPoint: 'CH1071601234500000000000000000919',
        meterNumber: '3760',
      },
    ],
    subtotalCents: 183_355,
    prepaidCents: 87_000,
    totalCents: 96_355,
    vatCents: 7210,
    documentId: null,
    sourceFile: 'rechnung.pdf',
    note: '',
  }
}

describe('Formular – hin und zurück', () => {
  const zurueck = toBill(toDraft(gelesen()), gelesen())
  const strom = zurueck.sections[0] as BillSection

  it('behält die Ablesungen, statt sie stillschweigend zu verlieren', () => {
    // Das Formular sucht seine Felder nach Tarif. Ordnet der Parser Tag- und
    // Nachttarif nicht `hoch` und `nieder` zu, findet es nichts und speichert
    // eine Rechnung ohne Ablesung – der Verbrauch wird danach ersatzweise aus
    // den Positionen geschätzt und ist um ein Vielfaches zu hoch.
    assert.equal(strom.readings.length, 2)
    assert.deepEqual(
      strom.readings.map((reading) => [reading.tariff, reading.quantity]),
      [
        ['hoch', 2760],
        ['nieder', 2460],
      ],
    )
    assert.equal(strom.readings[0]?.startValue, 31_185)
    assert.equal(strom.readings[1]?.endValue, 36_553)
  })

  it('behält die Beschriftung der Rechnung, statt sie umzubenennen', () => {
    assert.deepEqual(
      strom.readings.map((reading) => reading.label),
      ['Wirkstrom Tagtarif', 'Wirkstrom Nachttarif'],
    )
  })

  it('behält jeden Block – auch den, den es 2025 noch nicht gab', () => {
    assert.deepEqual(strom.groups, gelesen().sections[0]?.groups)
    assert.equal(strom.amountCents, 183_355)
  })

  it('rechnet Zwischentotal und Rechnungsbetrag aus den Blöcken zurück', () => {
    // Fehlt ein Block im Formular, stimmt hier nichts mehr: 1'791.40 statt
    // 1'833.55, und ein Rechnungsbetrag von 921.40 statt 963.55.
    assert.equal(zurueck.subtotalCents, 183_355)
    assert.equal(zurueck.prepaidCents, 87_000)
    assert.equal(zurueck.totalCents, 96_355)
    assert.equal(zurueck.vatCents, 7210)
  })

  it('lässt Kopfdaten und Herkunft unverändert', () => {
    assert.equal(zurueck.invoiceNumber, '248619')
    assert.equal(zurueck.invoiceDate, '2026-07-14')
    assert.equal(zurueck.periodStart, '2026-01-01')
    assert.equal(zurueck.periodEnd, '2026-06-30')
    assert.equal(zurueck.customerNumber, '18444 / 4086')
    assert.equal(zurueck.sourceFile, 'rechnung.pdf')
    assert.equal(strom.meterPoint, 'CH1071601234500000000000000000919')
  })
})

describe('Formular – von Hand', () => {
  it('legt eine leere Sparte mit einem Feld je Block an', () => {
    const draft = neueSektion('strom')

    // Ein Block ohne Feld wäre ein Betrag, den niemand nachtragen kann.
    assert.deepEqual(Object.keys(draft.groups).sort(), ['abgaben', 'energie', 'messung', 'netznutzung'])
    assert.equal(sectionCents(draft), 0)
  })

  it('summiert die Blöcke zum Betrag der Sparte', () => {
    const draft = neueSektion('strom')
    draft.groups.energie = '854.90'
    draft.groups.netznutzung = '697.85'
    draft.groups.messung = '42.15'
    draft.groups.abgaben = '238.65'

    assert.equal(sectionCents(draft), 183_355)
  })

  it('nimmt beim Wasser den Betrag der Sparte statt der Blöcke', () => {
    const draft = neueSektion('wasser')
    draft.amount = '424.75'

    assert.equal(sectionCents(draft), 42_475)
  })
})

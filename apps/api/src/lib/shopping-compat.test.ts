import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ShoppingSection } from '@manager/shared'

import { legacySectionId, legacySectionInput, legacySectionName } from './shopping-compat.ts'

/** Die Erstausstattung, so wie sie nach der Umstellung in der Datenbank steht. */
const ABTEILUNGEN: ShoppingSection[] = [
  { id: 'fruechte-gemuese', name: 'Früchte & Gemüse', sortOrder: 10 },
  { id: 'molkerei', name: 'Molkerei', sortOrder: 30 },
  { id: 'getraenke', name: 'Getränke', sortOrder: 70 },
  { id: 'sonstiges', name: 'Sonstiges', sortOrder: 90 },
]

describe('Abteilungsname für eine alte App', () => {
  it('nennt die Abteilungen, die sie kennt, beim Namen', () => {
    assert.equal(legacySectionName(ABTEILUNGEN, 'molkerei'), 'Molkerei')
    assert.equal(legacySectionName(ABTEILUNGEN, 'fruechte-gemuese'), 'Früchte & Gemüse')
  })

  it('legt eine selbst angelegte Abteilung unter „Sonstiges“', () => {
    // Eine alte App kennt nur die neun Namen aus ihrem Programmtext. „Hofladen“
    // wäre für sie eine Gruppe, die es nicht gibt – und der Eintrag darin wäre
    // auf ihrem Bildschirm nicht mehr auffindbar.
    const mitHofladen = [...ABTEILUNGEN, { id: 'hofladen', name: 'Hofladen', sortOrder: 100 }]
    assert.equal(legacySectionName(mitHofladen, 'hofladen'), 'Sonstiges')
  })

  it('legt eine umbenannte Abteilung unter „Sonstiges“', () => {
    const umbenannt = [{ id: 'molkerei', name: 'Kühlregal', sortOrder: 30 }]
    assert.equal(legacySectionName(umbenannt, 'molkerei'), 'Sonstiges')
  })

  it('lässt auch einen Eintrag ohne bekannte Abteilung nicht verschwinden', () => {
    // Der schlimmste Fall: eine Kennung, zu der es keine Zeile mehr gibt. Ein
    // leerer Name wäre in der alten App eine Gruppe ohne Überschrift – und die
    // fiele durch ihren Filter.
    assert.equal(legacySectionName(ABTEILUNGEN, 'gibt-es-nicht'), 'Sonstiges')
    assert.equal(legacySectionName([], 'molkerei'), 'Sonstiges')
  })
})

describe('Abteilung, die eine alte App mitschickt', () => {
  it('liest den Namen aus der Anfrage', () => {
    assert.equal(legacySectionInput({ section: 'Molkerei' }), 'Molkerei')
    assert.equal(legacySectionInput({ section: '  Molkerei  ' }), 'Molkerei')
  })

  it('übergeht alles, was keine Abteilung ist', () => {
    assert.equal(legacySectionInput({ sectionId: 'molkerei' }), null)
    assert.equal(legacySectionInput({ section: '' }), null)
    assert.equal(legacySectionInput({ section: 42 }), null)
    assert.equal(legacySectionInput(null), null)
    assert.equal(legacySectionInput('Molkerei'), null)
  })

  it('findet die Kennung zum Namen, auch anders geschrieben', () => {
    assert.equal(legacySectionId(ABTEILUNGEN, 'Molkerei'), 'molkerei')
    assert.equal(legacySectionId(ABTEILUNGEN, 'getraenke'), 'getraenke')
    assert.equal(legacySectionId(ABTEILUNGEN, 'Getränke'), 'getraenke')
  })

  it('antwortet mit nichts, wenn es die Abteilung nicht mehr gibt', () => {
    // Dann bleibt der Eintrag stehen, wo er ist – besser als ein Fehler, den
    // die alte App an dieser Stelle gar nicht anzeigt.
    assert.equal(legacySectionId(ABTEILUNGEN, 'Tiefkühl'), undefined)
  })
})

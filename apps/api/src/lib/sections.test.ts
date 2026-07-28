import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { guessSection, normalizeForSearch, SECTION_KEYWORDS } from '@manager/shared'

describe('Abteilung eines neuen Eintrags', () => {
  it('erkennt gängige Einkäufe so, wie man sie eintippt', () => {
    // Absichtlich mit Umlauten und Grossschreibung – so kommt es aus der
    // Tastatur. Der Abgleich passiert auf der ausgeschriebenen Form, und
    // genau dort ging „Rüebli“ (→ rueebli) zuerst daneben.
    for (const [eingabe, abteilung] of [
      ['Rüebli', 'Früchte & Gemüse'],
      ['Rübli', 'Früchte & Gemüse'],
      ['Bananen', 'Früchte & Gemüse'],
      ['Zucchetti', 'Früchte & Gemüse'],
      ['Ruchbrot', 'Brot & Backwaren'],
      ['Brötchen', 'Brot & Backwaren'],
      ['Vollmilch', 'Molkerei'],
      ['Käse', 'Molkerei'],
      ['Poulet', 'Fleisch & Fisch'],
      ['Müesli', 'Vorrat'],
      ['Öl', 'Vorrat'],
      ['Tiefkühlpizza', 'Tiefkühl'],
      ['Mineralwasser', 'Getränke'],
      ['Waschmittel', 'Haushalt'],
    ] as const) {
      assert.equal(guessSection(eingabe), abteilung, `${eingabe} landet falsch`)
    }
  })

  it('legt Unbekanntes unter Sonstiges ab', () => {
    assert.equal(guessSection('Schrauben'), 'Sonstiges')
    assert.equal(guessSection(''), 'Sonstiges')
  })

  it('hält alle Stichwörter in der Form, in der verglichen wird', () => {
    // Ein Stichwort mit Umlaut oder Grossbuchstaben könnte nie treffen, weil
    // der Vergleich auf normalizeForSearch() läuft. Das fällt sonst niemandem
    // auf – der Eintrag landet einfach still unter „Sonstiges“.
    for (const keyword of Object.keys(SECTION_KEYWORDS)) {
      assert.equal(
        normalizeForSearch(keyword),
        keyword,
        `Stichwort '${keyword}' kann so nie treffen`,
      )
    }
  })
})

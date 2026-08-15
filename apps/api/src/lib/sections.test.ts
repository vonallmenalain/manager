import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  catchAllSection,
  guessSection,
  nextSectionSortOrder,
  normalizeForSearch,
  sameSectionName,
  SECTION_KEYWORDS,
  type ShoppingSection,
} from '@manager/shared'

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

const ABTEILUNGEN: ShoppingSection[] = [
  { id: 'molkerei', name: 'Molkerei', sortOrder: 10 },
  { id: 'vorrat', name: 'Vorrat', sortOrder: 20 },
  { id: 'sonstiges', name: 'Sonstiges', sortOrder: 30 },
]

describe('Der Sammelposten der Einkaufsliste', () => {
  it('ist „Sonstiges", egal an welcher Stelle es steht', () => {
    const verdreht = [...ABTEILUNGEN].reverse()
    assert.equal(catchAllSection(verdreht)?.id, 'sonstiges')
  })

  it('weicht auf die letzte Abteilung aus, wenn „Sonstiges" gerade gelöscht wird', () => {
    // Der Fall, in dem der Sammelposten selbst verschwindet: Seine Einträge
    // brauchen trotzdem einen Ort, und am Ende des Rundgangs stehen sie am
    // wenigsten im Weg.
    assert.equal(catchAllSection(ABTEILUNGEN, 'sonstiges')?.name, 'Vorrat')
  })

  it('gibt nichts zurück, wenn die letzte Abteilung gelöscht würde', () => {
    // Die Antwort, an der die Route das Löschen abbricht – ein Eintrag ohne
    // Abteilung wäre ein Eintrag, den die Liste nicht mehr anzeigen kann.
    assert.equal(catchAllSection([ABTEILUNGEN[2] as ShoppingSection], 'sonstiges'), undefined)
    assert.equal(catchAllSection([]), undefined)
  })
})

describe('Platz einer neuen Abteilung', () => {
  it('hängt sie hinten an, mit Abstand zur letzten', () => {
    assert.equal(nextSectionSortOrder(ABTEILUNGEN), 40)
  })

  it('beginnt bei der ersten Abteilung überhaupt nicht bei null', () => {
    // Bei 0 hätte die erste Abteilung keinen Platz mehr über sich, in den
    // etwas geschoben werden könnte.
    assert.ok(nextSectionSortOrder([]) > 0)
  })
})

describe('Gleiche Abteilungsnamen', () => {
  it('erkennt Schreibweisen desselben Namens', () => {
    // Zwei Zeilen für die Datenbank, in der Auswahl aber zweimal derselbe
    // Knopf – man träfe nie verlässlich denselben.
    assert.ok(sameSectionName('Getränke', 'getraenke'))
    assert.ok(sameSectionName('Brot & Backwaren', 'brot & backwaren'))
    assert.ok(!sameSectionName('Molkerei', 'Metzgerei'))
  })
})

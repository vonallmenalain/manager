import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ShoppingItem, ShoppingSection } from '@manager/shared'

import { erledigtAm, nachAbteilung, OHNE_ABTEILUNG } from './einkauf.ts'

const ABTEILUNGEN: ShoppingSection[] = [
  { id: 'molkerei', name: 'Molkerei', sortOrder: 10 },
  { id: 'vorrat', name: 'Vorrat', sortOrder: 20 },
  { id: 'sonstiges', name: 'Sonstiges', sortOrder: 30 },
]

function eintrag(id: string, sectionId: string, text = id): ShoppingItem {
  return {
    id,
    text,
    sectionId,
    done: false,
    createdBy: 'u1',
    doneBy: null,
    createdAt: '2026-08-15T08:00:00.000Z',
    doneAt: null,
  }
}

describe('Einträge nach Abteilung', () => {
  it('folgt der Reihenfolge der Abteilungen und lässt leere weg', () => {
    const gruppen = nachAbteilung(
      [eintrag('a', 'sonstiges'), eintrag('b', 'molkerei')],
      ABTEILUNGEN,
    )

    assert.deepEqual(
      gruppen.map((gruppe) => gruppe.title),
      ['Molkerei', 'Sonstiges'],
    )
  })

  it('zeigt Einträge auch dann, wenn ihre Abteilung noch unbekannt ist', () => {
    // Der frisch getippte Eintrag: Welche Abteilung es wird, weiss nur der
    // Server. Bis seine Antwort da ist, darf der Eintrag nicht verschwinden.
    const gruppen = nachAbteilung(
      [eintrag('a', 'molkerei'), eintrag('vorlaeufig-1', ''), eintrag('c', 'ganz-neu')],
      ABTEILUNGEN,
    )

    const letzte = gruppen[gruppen.length - 1]
    assert.equal(letzte?.title, OHNE_ABTEILUNG)
    assert.deepEqual(
      letzte?.items.map((item) => item.id),
      ['vorlaeufig-1', 'c'],
    )
  })

  it('kommt ohne Abteilungen aus, solange sie noch geladen werden', () => {
    const gruppen = nachAbteilung([eintrag('a', 'molkerei')], [])
    assert.equal(gruppen.length, 1)
    assert.equal(gruppen[0]?.title, OHNE_ABTEILUNG)
  })
})

describe('Zeitpunkt des Abhakens', () => {
  const jetzt = new Date(2026, 7, 15, 18, 30)

  it('zeigt heute nur die Uhrzeit', () => {
    assert.equal(erledigtAm(new Date(2026, 7, 15, 9, 5).toISOString(), jetzt), '09:05')
  })

  it('nennt gestern beim Namen – auch kurz nach Mitternacht', () => {
    // Der Fall, an dem eine Rechnung über 24 Stunden scheitert: keine zwölf
    // Stunden her und trotzdem ein anderer Tag.
    assert.equal(erledigtAm(new Date(2026, 7, 14, 23, 50).toISOString(), jetzt), 'gestern 23:50')
  })

  it('zeigt bei Älterem den Tag, das Jahr nur wenn es ein anderes ist', () => {
    assert.equal(erledigtAm(new Date(2026, 7, 2, 17, 20).toISOString(), jetzt), '02.08.')
    assert.match(erledigtAm(new Date(2025, 11, 24, 10, 0).toISOString(), jetzt), /24\.12\.2025/)
  })

  it('schweigt bei einem unlesbaren Zeitstempel', () => {
    assert.equal(erledigtAm('irgendwas', jetzt), '')
  })
})

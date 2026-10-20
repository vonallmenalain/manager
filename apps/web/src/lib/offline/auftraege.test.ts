import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Note, ShoppingItem, UpsertNoteInput } from '@manager/shared'

import {
  einkaufMit,
  notizenMit,
  zusammenfassen,
  type Auftrag,
  type AuftragsInhalt,
} from './auftraege.ts'

/*
 * Was die wartenden Änderungen mit einer Liste anstellen. Läuft über jede
 * Antwort des Servers – ein Fehler hier hiesse: Der Haken, den man im
 * Funkloch gesetzt hat, verschwindet beim nächsten Nachladen wieder.
 */

let nr = 0
function auftrag(inhalt: AuftragsInhalt, zeit = '2026-10-20T10:00:00.000Z'): Auftrag {
  nr += 1
  return { ...inhalt, nr: `a${nr}`, zeit }
}

function eintrag(id: string, done = false): ShoppingItem {
  return {
    id,
    text: id,
    sectionId: 'molkerei',
    done,
    createdBy: 'u1',
    doneBy: done ? 'u1' : null,
    createdAt: '2026-10-01T08:00:00.000Z',
    doneAt: done ? '2026-10-01T09:00:00.000Z' : null,
  }
}

function notiz(id: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    body: '',
    bodyRich: null,
    kind: 'text',
    bereich: 'manager',
    categoryId: null,
    pinned: false,
    sortOrder: 0,
    shared: false,
    color: 'default',
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...extra,
  }
}

function entwurf(title: string, extra: Partial<UpsertNoteInput> = {}): UpsertNoteInput {
  return {
    title,
    body: 'Text',
    bodyRich: null,
    kind: 'text',
    bereich: 'manager',
    categoryId: null,
    pinned: false,
    shared: false,
    color: 'default',
    ...extra,
  }
}

describe('Wartende Änderungen auf der Einkaufsliste', () => {
  it('zeigt einen neuen Eintrag in der vermuteten Abteilung', () => {
    const liste = einkaufMit(
      [eintrag('milch')],
      [auftrag({ art: 'einkauf.neu', id: 'brot', text: 'Brot', abteilung: 'brot', von: 'u2' })],
    )
    assert.deepEqual(
      liste.map((item) => [item.id, item.sectionId, item.createdBy]),
      [
        ['milch', 'molkerei', 'u1'],
        ['brot', 'brot', 'u2'],
      ],
    )
  })

  it('setzt einen Haken samt wer und wann – und nimmt ihn wieder weg', () => {
    const zeit = '2026-10-20T11:00:00.000Z'
    const [abgehakt] = einkaufMit(
      [eintrag('milch')],
      [auftrag({ art: 'einkauf.aendern', id: 'milch', changes: { done: true }, von: 'u2' }, zeit)],
    )
    assert.equal(abgehakt?.done, true)
    assert.equal(abgehakt?.doneBy, 'u2')
    assert.equal(abgehakt?.doneAt, zeit)

    const [offen] = einkaufMit(
      [eintrag('milch', true)],
      [auftrag({ art: 'einkauf.aendern', id: 'milch', changes: { done: false }, von: 'u2' })],
    )
    assert.equal(offen?.done, false)
    assert.equal(offen?.doneBy, null)
  })

  it('räumt nur weg, was beim Aufräumen erledigt dastand', () => {
    // „brot" hat die andere Person erst danach abgehakt – es bleibt.
    const liste = einkaufMit(
      [eintrag('milch', true), eintrag('brot', true), eintrag('eier')],
      [auftrag({ art: 'einkauf.aufraeumen', ids: ['milch', 'eier'] })],
    )
    assert.deepEqual(
      liste.map((item) => item.id),
      ['brot', 'eier'],
    )
  })

  it('löscht und holt zurück, ohne zu verdoppeln', () => {
    const milch = eintrag('milch')
    const liste = einkaufMit(
      [milch, eintrag('eier')],
      [
        auftrag({ art: 'einkauf.loeschen', id: 'milch' }),
        auftrag({ art: 'einkauf.zurueck', items: [milch] }),
        auftrag({ art: 'einkauf.zurueck', items: [milch] }),
      ],
    )
    assert.deepEqual(
      liste.map((item) => item.id),
      ['eier', 'milch'],
    )
  })
})

describe('Wartende Änderungen an Notizen', () => {
  it('schreibt eine bestehende Notiz weiter, an ihrem Platz', () => {
    const liste = notizenMit(
      [notiz('a', { sortOrder: 10 }), notiz('b', { sortOrder: 20 })],
      [
        auftrag({
          art: 'notiz.speichern',
          id: 'b',
          neu: false,
          note: entwurf('Neuer Titel'),
          von: 'u2',
        }),
      ],
      {},
    )
    assert.equal(liste[1]?.title, 'Neuer Titel')
    assert.equal(liste[1]?.sortOrder, 20)
    assert.equal(liste[1]?.createdBy, 'u1')
    assert.equal(liste[1]?.updatedBy, 'u2')
  })

  it('stellt eine neue Notiz oben hin – nur in Listen, zu denen sie passt', () => {
    const neu = auftrag({
      art: 'notiz.speichern',
      id: 'n',
      neu: true,
      note: entwurf('Zügeltermin'),
      von: 'u1',
    })
    const haushalt = notizenMit([notiz('a', { sortOrder: -10 })], [neu], {})
    assert.deepEqual(
      haushalt.map((note) => [note.id, note.sortOrder]),
      [
        ['n', -20],
        ['a', -10],
      ],
    )

    assert.equal(notizenMit([], [neu], { bereich: 'docbase' }).length, 0)
    assert.equal(notizenMit([], [neu], { q: 'zuegel' }).length, 1)
    assert.equal(notizenMit([], [neu], { q: 'milch' }).length, 0)
  })

  it('macht eine Notiz der DocBase immer geteilt, wie der Server', () => {
    const [docbase] = notizenMit(
      [],
      [
        auftrag({
          art: 'notiz.speichern',
          id: 'd',
          neu: true,
          note: entwurf('Studie', { bereich: 'docbase', shared: false }),
          von: 'u1',
        }),
      ],
      { bereich: 'docbase' },
    )
    assert.equal(docbase?.shared, true)
  })

  it('löscht und holt mit dem aufbewahrten Stand zurück', () => {
    const a = notiz('a')
    const liste = notizenMit(
      [a, notiz('b')],
      [
        auftrag({ art: 'notiz.loeschen', id: 'a' }),
        auftrag({ art: 'notiz.zurueck', id: 'a', notiz: a }),
      ],
      {},
    )
    assert.deepEqual(
      liste.map((note) => note.id),
      ['a', 'b'],
    )
  })

  it('verschiebt wie der Server', () => {
    const liste = notizenMit(
      [notiz('a', { sortOrder: 10 }), notiz('b', { sortOrder: 20 }), notiz('c', { sortOrder: 30 })],
      [auftrag({ art: 'notiz.reihenfolge', bereich: 'manager', ids: ['c', 'a'] })],
      {},
    )
    assert.deepEqual(Object.fromEntries(liste.map((note) => [note.id, note.sortOrder])), {
      c: 10,
      b: 20,
      a: 30,
    })
  })
})

describe('Aufträge zusammenfassen', () => {
  it('behält von vielen Fassungen derselben Notiz nur die letzte – und dass sie neu ist', () => {
    const erste = auftrag({
      art: 'notiz.speichern',
      id: 'n',
      neu: true,
      note: entwurf('A'),
      von: 'u1',
    })
    const zweite = auftrag({
      art: 'notiz.speichern',
      id: 'n',
      neu: false,
      note: entwurf('AB'),
      von: 'u1',
    })
    const zusammen = zusammenfassen(erste, zweite)
    assert.ok(zusammen && zusammen.art === 'notiz.speichern')
    assert.equal(zusammen.neu, true)
    assert.equal(zusammen.note.title, 'AB')
    assert.equal(zusammen.nr, erste.nr)
  })

  it('fasst nur zusammen, was dasselbe betrifft', () => {
    const a = auftrag({
      art: 'notiz.speichern',
      id: 'a',
      neu: false,
      note: entwurf('A'),
      von: 'u1',
    })
    const b = auftrag({
      art: 'notiz.speichern',
      id: 'b',
      neu: false,
      note: entwurf('B'),
      von: 'u1',
    })
    assert.equal(zusammenfassen(a, b), null)
    assert.equal(zusammenfassen(a, auftrag({ art: 'notiz.loeschen', id: 'a' })), null)
  })

  it('legt Änderungen am selben Eintrag zusammen', () => {
    const zusammen = zusammenfassen(
      auftrag({ art: 'einkauf.aendern', id: 'm', changes: { done: true }, von: 'u1' }),
      auftrag({ art: 'einkauf.aendern', id: 'm', changes: { text: 'Vollmilch' }, von: 'u1' }),
    )
    assert.ok(zusammen && zusammen.art === 'einkauf.aendern')
    assert.deepEqual(zusammen.changes, { done: true, text: 'Vollmilch' })
  })
})

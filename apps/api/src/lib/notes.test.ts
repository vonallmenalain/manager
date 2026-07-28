import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { checklistToText, parseChecklist, serializeChecklist } from '@manager/shared'

describe('parseChecklist', () => {
  it('liest offene und erledigte Einträge', () => {
    assert.deepEqual(parseChecklist('[ ] Milch\n[x] Brot'), [
      { text: 'Milch', done: false },
      { text: 'Brot', done: true },
    ])
  })

  it('nimmt auch ein grosses X und einen Listenstrich davor', () => {
    // Beides entsteht beim Hineinkopieren aus einer anderen App.
    assert.deepEqual(parseChecklist('- [X] Termin\n* [ ] Anruf'), [
      { text: 'Termin', done: true },
      { text: 'Anruf', done: false },
    ])
  })

  it('macht aus einer Zeile ohne Kästchen einen offenen Eintrag', () => {
    // Der Weg von der Textnotiz zur Checkliste – jede Zeile wird ein Punkt.
    assert.deepEqual(parseChecklist('Zahnarzt anrufen\nPass verlängern'), [
      { text: 'Zahnarzt anrufen', done: false },
      { text: 'Pass verlängern', done: false },
    ])
  })

  it('lässt leere Zeilen und leere Kästchen weg', () => {
    assert.deepEqual(parseChecklist('[ ] Milch\n\n[ ]   \n[x] Brot'), [
      { text: 'Milch', done: false },
      { text: 'Brot', done: true },
    ])
  })

  it('kommt mit einer leeren Notiz aus', () => {
    assert.deepEqual(parseChecklist(''), [])
  })
})

describe('serializeChecklist', () => {
  it('schreibt je Eintrag eine Zeile mit Kästchen', () => {
    const body = serializeChecklist([
      { text: 'Milch', done: false },
      { text: 'Brot', done: true },
    ])
    assert.equal(body, '[ ] Milch\n[x] Brot')
  })

  it('wirft den Eintrag weg, der gerade erst begonnen wurde', () => {
    // Die leere Zeile am Ende der Liste ist die nächste Eingabe, kein Inhalt.
    assert.equal(serializeChecklist([{ text: 'Milch', done: false }, { text: '', done: false }]), '[ ] Milch')
  })

  it('übersteht den Weg hin und zurück unverändert', () => {
    const body = '[x] Erledigt\n[ ] Offen'
    assert.equal(serializeChecklist(parseChecklist(body)), body)
  })
})

describe('checklistToText', () => {
  it('lässt die Kästchen weg', () => {
    assert.equal(checklistToText('[x] Milch\n[ ] Brot'), 'Milch\nBrot')
  })
})

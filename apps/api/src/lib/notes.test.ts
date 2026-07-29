import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseChecklist, serializeChecklist, sortChecklist, splitLinks } from '@manager/shared'

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

describe('sortChecklist', () => {
  it('stellt Erledigtes ans Ende', () => {
    const sortiert = sortChecklist([
      { text: 'Milch', done: true },
      { text: 'Brot', done: false },
      { text: 'Butter', done: true },
      { text: 'Eier', done: false },
    ])
    assert.deepEqual(
      sortiert.map((item) => item.text),
      ['Brot', 'Eier', 'Milch', 'Butter'],
    )
  })

  it('behält die Reihenfolge innerhalb der beiden Gruppen', () => {
    // Wer seine Liste in der Reihenfolge des Ladens schreibt, findet sie so
    // wieder – abgehakt wird von unten aufgefüllt, nicht durchmischt.
    const sortiert = sortChecklist([
      { text: 'A', done: false },
      { text: 'B', done: false },
      { text: 'C', done: false },
    ])
    assert.deepEqual(
      sortiert.map((item) => item.text),
      ['A', 'B', 'C'],
    )
  })

  it('ändert nichts, wenn schon alles sortiert ist', () => {
    const items = [
      { text: 'Offen', done: false },
      { text: 'Erledigt', done: true },
    ]
    assert.deepEqual(sortChecklist(items), items)
  })
})

describe('splitLinks', () => {
  it('macht aus einer Adresse einen Verweis', () => {
    assert.deepEqual(splitLinks('Siehe https://sbb.ch für Zeiten'), [
      { text: 'Siehe ' },
      { text: 'https://sbb.ch', href: 'https://sbb.ch' },
      { text: ' für Zeiten' },
    ])
  })

  it('ergänzt bei www. das fehlende Schema, ohne den Text zu ändern', () => {
    assert.deepEqual(splitLinks('www.sbb.ch'), [
      { text: 'www.sbb.ch', href: 'https://www.sbb.ch' },
    ])
  })

  it('erkennt E-Mail-Adressen', () => {
    assert.deepEqual(splitLinks('Schreib an post@example.ch!'), [
      { text: 'Schreib an ' },
      { text: 'post@example.ch', href: 'mailto:post@example.ch' },
      { text: '!' },
    ])
  })

  it('lässt Satzzeichen am Ende beim Satz', () => {
    // „Siehe https://sbb.ch." – der Punkt gehört nicht zur Adresse.
    const teile = splitLinks('Siehe https://sbb.ch.')
    assert.equal(teile[1]?.href, 'https://sbb.ch')
    assert.equal(teile[2]?.text, '.')
  })

  it('behält eine Klammer, die zur Adresse gehört', () => {
    const teile = splitLinks('https://de.wikipedia.org/wiki/Zehnt_(Abgabe)')
    assert.equal(teile[0]?.href, 'https://de.wikipedia.org/wiki/Zehnt_(Abgabe)')
    assert.equal(teile.length, 1)
  })

  it('hält Preise und Abkürzungen für gewöhnlichen Text', () => {
    assert.deepEqual(splitLinks('Das kostet 12.50 pro Person, z.B. am Montag'), [
      { text: 'Das kostet 12.50 pro Person, z.B. am Montag' },
    ])
  })

  it('gibt leeren Text unverändert zurück', () => {
    assert.deepEqual(splitLinks(''), [])
  })

  it('findet mehrere Verweise in einer Zeile', () => {
    const teile = splitLinks('a www.eins.ch b https://zwei.ch c')
    assert.deepEqual(
      teile.filter((teil) => teil.href).map((teil) => teil.text),
      ['www.eins.ch', 'https://zwei.ch'],
    )
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  applyMark,
  autoListBlock,
  changeIndent,
  clearMarks,
  docFromPlain,
  docOfValue,
  editLengthOf,
  editTextOf,
  isPlainDoc,
  listStateAt,
  marksAt,
  normalizeDoc,
  normalizeRich,
  parseRichJson,
  plainTextOf,
  replaceRange,
  richDocFor,
  serializeDoc,
  toggleList,
  toRichValue,
  upsertNoteSchema,
  wordRangeAt,
  type RichDoc,
} from '@manager/shared'

/*
 * Der formatierte Text lebt von einer einzigen Zusage: Die Projektion des
 * Formatfelds entspricht Zeichen für Zeichen dem gespeicherten Text – sonst
 * wird unformatiert gezeigt. Diese Tests prüfen die Zusage und die Werkzeuge,
 * die auf ihr rechnen (Bereiche, Marken, Listen): alles reine Rechnerei ohne
 * Browser, und genau die Art Code, bei der ein Ein-Zeichen-Fehler still
 * Formatierungen verwerfen würde.
 */

const doc = (input: RichDoc) => normalizeDoc(input)

/** Die Läufe eines Blocks – mit dem Hinweis, wenn es ihn nicht gibt. */
function runsOf(value: RichDoc, index: number) {
  const block = value.blocks[index]
  assert.ok(block, `Block ${index} fehlt`)
  return block.runs
}

describe('Formatierter Text: Projektion und Speicherform', () => {
  it('schreibt Listenpunkte mit Zeichen und Einzug in den Text', () => {
    const value: RichDoc = {
      blocks: [
        { runs: [{ t: 'Titel' }] },
        { list: 1, runs: [{ t: 'Milch' }] },
        { list: 2, runs: [{ t: 'Butter' }] },
        { list: 2, runs: [] },
        { runs: [] },
      ],
    }
    assert.equal(plainTextOf(value), 'Titel\n• Milch\n  ◦ Butter\n  ◦\n')
    assert.equal(editTextOf(value), 'Titel\nMilch\nButter\n\n')
    assert.equal(editLengthOf(value), editTextOf(value).length)
  })

  it('übersteht die Rundreise durch JSON unverändert', () => {
    const value = doc({
      blocks: [
        { runs: [{ t: 'Hallo ' }, { t: 'Welt', b: true, color: 'red' }] },
        { runs: [{ t: 'kursiv', i: true }, { t: ' und ' }, { t: 'unterstrichen', u: true }] },
        {
          runs: [
            { t: 'gross', size: 'xl' },
            { t: ' klein', size: 's' },
          ],
        },
        { list: 1, runs: [{ t: 'Punkt', bg: 'yellow' }] },
      ],
    })
    const back = parseRichJson(serializeDoc(value))
    assert.ok(back)
    assert.deepEqual(back, value)
    assert.equal(plainTextOf(back), plainTextOf(value))
  })

  it('zeigt den Text allein, sobald er nicht mehr zum Formatfeld passt', () => {
    const json = serializeDoc(doc({ blocks: [{ runs: [{ t: 'Hallo', b: true }] }] }))
    assert.ok(richDocFor(json, 'Hallo'))
    assert.equal(richDocFor(json, 'Hallo!'), null)
    assert.equal(richDocFor(null, 'Hallo'), null)
    assert.equal(richDocFor('kaputt{', 'Hallo'), null)
  })

  it('lässt Unbekanntes im Kleinen fallen und im Grossen alles', () => {
    assert.equal(parseRichJson(JSON.stringify({ v: 99, blocks: [] })), null)

    const fremdeFarbe = parseRichJson(
      JSON.stringify({
        v: 1,
        blocks: [{ runs: [{ t: 'Hi', color: 'neon', bg: 'yellow', size: '99', x: 1 }] }],
      }),
    )
    assert.ok(fremdeFarbe)
    assert.deepEqual(runsOf(fremdeFarbe, 0), [{ t: 'Hi', bg: 'yellow' }])
  })

  it('speichert für Unformatiertes kein Formatfeld', () => {
    const plain = toRichValue(docFromPlain('Zeile 1\nZeile 2'))
    assert.equal(plain.rich, null)
    assert.equal(plain.text, 'Zeile 1\nZeile 2')

    const formatiert = toRichValue(doc({ blocks: [{ runs: [{ t: 'Fett', b: true }] }] }))
    assert.ok(formatiert.rich)
    assert.equal(formatiert.text, 'Fett')
    assert.ok(richDocFor(formatiert.rich, formatiert.text))
  })

  it('nimmt ein gültiges Formatfeld und fällt sonst auf den Text zurück', () => {
    const value = toRichValue(doc({ blocks: [{ runs: [{ t: 'Bunt', color: 'blue' }] }] }))
    assert.equal(isPlainDoc(docOfValue(value)), false)

    const veraltet = docOfValue({ text: 'Anderer Text', rich: value.rich })
    assert.ok(isPlainDoc(veraltet))
    assert.equal(editTextOf(veraltet), 'Anderer Text')
  })
})

describe('Formatierter Text: Werkzeuge des Editors', () => {
  it('setzt und entfernt eine Marke über Zeilengrenzen hinweg', () => {
    const base = docFromPlain('Hallo Welt\nZweite Zeile')
    // „Welt\nZwei" fett: Zeichen 6–15
    const fett = applyMark(base, 6, 15, 'b', true)
    assert.equal(plainTextOf(fett), 'Hallo Welt\nZweite Zeile')
    assert.deepEqual(runsOf(fett, 0), [{ t: 'Hallo ' }, { t: 'Welt', b: true }])
    assert.deepEqual(runsOf(fett, 1), [{ t: 'Zwei', b: true }, { t: 'te Zeile' }])
    assert.deepEqual(marksAt(fett, 8, 8), { b: true })

    const wieder = applyMark(fett, 0, editLengthOf(fett), 'b', null)
    assert.ok(isPlainDoc(wieder))
  })

  it('nimmt beim Entfernen alle Marken und lässt die Liste stehen', () => {
    const base = doc({ blocks: [{ list: 2, runs: [{ t: 'Bunt', color: 'red', bg: 'yellow' }] }] })
    assert.deepEqual(clearMarks(base, 0, 4).blocks[0], { list: 2, runs: [{ t: 'Bunt' }] })
  })

  it('macht aus Absätzen Punkte und rückt sie ein und aus', () => {
    const base = docFromPlain('Eins\nZwei')
    const liste = toggleList(base, 0, editLengthOf(base))
    assert.deepEqual(
      liste.blocks.map((block) => block.list),
      [1, 1],
    )
    assert.equal(plainTextOf(liste), '• Eins\n• Zwei')

    const tiefer = changeIndent(liste, 5, 5, 1)
    assert.deepEqual(
      tiefer.blocks.map((block) => block.list),
      [1, 2],
    )
    assert.equal(listStateAt(tiefer, 5, 5).level, 2)

    // Ausrücken auf Ebene 1 macht wieder einen Absatz.
    const flach = changeIndent(changeIndent(tiefer, 5, 5, -1), 5, 5, -1)
    assert.equal(flach.blocks[1]?.list, undefined)

    // Zurückschalten nimmt die Listenform ganz weg.
    const aus = toggleList(liste, 0, editLengthOf(liste))
    assert.ok(aus.blocks.every((block) => !block.list))
  })

  it('fügt Text mit den Marken und der Listenebene der Einfügestelle ein', () => {
    const base = doc({ blocks: [{ list: 1, runs: [{ t: 'Hallo ', b: true }, { t: 'Welt' }] }] })
    const { doc: next, caret } = replaceRange(base, 6, 6, 'schöne ')
    assert.equal(editTextOf(next), 'Hallo schöne Welt')
    assert.equal(caret, 13)
    // Eingesetzt mit den Marken des Zeichens davor – fett.
    assert.deepEqual(runsOf(next, 0)[0], { t: 'Hallo schöne ', b: true })

    const mehrzeilig = replaceRange(base, 6, 10, 'A\nB')
    assert.equal(editTextOf(mehrzeilig.doc), 'Hallo A\nB')
    assert.deepEqual(
      mehrzeilig.doc.blocks.map((block) => block.list),
      [1, 1],
    )
  })

  it('macht aus „- " am Zeilenanfang einen Listenpunkt', () => {
    // „- Milch", Cursor hinter dem Leerschlag (Zeile 2, Stelle 5+2).
    const base = docFromPlain('Kopf\n- Milch')
    const auto = autoListBlock(base, 7)
    assert.ok(auto)
    assert.equal(editTextOf(auto.doc), 'Kopf\nMilch')
    assert.equal(auto.doc.blocks[1]?.list, 1)
    assert.equal(auto.caret, 5)

    // Nur unmittelbar hinter dem „- ": mitten im Wort nicht …
    assert.equal(autoListBlock(base, 9), null)
    // … und nicht in einer bestehenden Liste.
    assert.equal(autoListBlock(doc({ blocks: [{ list: 1, runs: [{ t: '- x' }] }] }), 2), null)
    assert.equal(autoListBlock(docFromPlain('ab'), 2), null)
  })

  it('findet das Wort unter dem Cursor', () => {
    assert.deepEqual(wordRangeAt('Hallo Welt', 7), { start: 6, end: 10 })
    assert.deepEqual(wordRangeAt('Hallo Welt', 5), { start: 0, end: 5 })
    assert.equal(wordRangeAt('Hallo  Welt', 6), null)
  })
})

describe('Formatierung beim Speichern einer Notiz', () => {
  const fett = serializeDoc(doc({ blocks: [{ runs: [{ t: 'Milch', b: true }] }] }))

  it('legt ein passendes Formatfeld aufgeräumt ab', () => {
    // Zwei gleiche Läufe nebeneinander sind ein Lauf – so steht es dann auch da.
    const zerstueckelt = JSON.stringify({
      v: 1,
      blocks: [
        {
          runs: [
            { t: 'Mil', b: true },
            { t: 'ch', b: true },
          ],
        },
      ],
    })
    assert.equal(normalizeRich('Milch', zerstueckelt), fett)
  })

  it('verwirft ein Formatfeld, das nicht zum Text passt', () => {
    assert.equal(normalizeRich('Milch und Brot', fett), null)
    assert.equal(normalizeRich('Milch', 'kein JSON'), null)
  })

  it('legt für Unformatiertes kein Formatfeld ab', () => {
    const nackt = serializeDoc(docFromPlain('Milch'))
    assert.equal(normalizeRich('Milch', nackt), null)
  })

  it('prüft das Formatfeld schon beim Annehmen der Notiz', () => {
    assert.equal(upsertNoteSchema.parse({ body: 'Milch', bodyRich: fett }).bodyRich, fett)
    assert.equal(upsertNoteSchema.parse({ body: 'Milch!', bodyRich: fett }).bodyRich, null)
  })

  it('gibt einer Checkliste keine Formatierung', () => {
    const notiz = upsertNoteSchema.parse({ body: 'Milch', bodyRich: fett, kind: 'liste' })
    assert.equal(notiz.bodyRich, null)
  })

  it('unterscheidet ein fehlendes Feld von einem leeren', () => {
    // Fehlt das Feld, kommt die Anfrage von einer App ohne Formatierung – die
    // Route entscheidet dann anhand dessen, was schon gespeichert ist.
    assert.equal(upsertNoteSchema.parse({ body: 'Milch' }).bodyRich, undefined)
    assert.equal(upsertNoteSchema.parse({ body: 'Milch', bodyRich: null }).bodyRich, null)
  })
})

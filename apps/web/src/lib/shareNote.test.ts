import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hatText, noteFromShare } from './shareNote.ts'

/**
 * Die geprüften Fälle sind keine erfundenen: Es sind die Formen, in denen
 * Android tatsächlich teilt. Chrome schickt Titel und Adresse getrennt,
 * manche Apps schreiben die Adresse in beide Felder, aus einer Textauswahl
 * kommt gar kein Titel. Ginge eine dieser Formen verloren, sähe man es erst
 * an der leeren Notiz auf dem Handy.
 */
describe('Notiz aus einem geteilten Verweis', () => {
  it('nimmt den Seitentitel als Titel und die Adresse in den Text', () => {
    const draft = noteFromShare({
      title: 'Fahrplan – SBB',
      text: 'https://www.sbb.ch/fahrplan',
      url: '',
    })

    assert.equal(draft.title, 'Fahrplan – SBB')
    assert.equal(draft.body, 'https://www.sbb.ch/fahrplan')
  })

  it('schreibt eine Adresse nicht zweimal, wenn sie in text und url steht', () => {
    const draft = noteFromShare({
      title: 'Fahrplan – SBB',
      text: 'https://www.sbb.ch/fahrplan',
      url: 'https://www.sbb.ch/fahrplan',
    })

    assert.equal(draft.body, 'https://www.sbb.ch/fahrplan')
  })

  it('behält Text und Adresse, wenn beides verschieden ist', () => {
    const draft = noteFromShare({
      title: 'Rezept',
      text: 'Zwei Zwiebeln, drei Eier',
      url: 'https://beispiel.ch/rezept',
    })

    assert.equal(draft.body, 'Zwei Zwiebeln, drei Eier\nhttps://beispiel.ch/rezept')
  })

  it('wiederholt den Titel nicht im Text', () => {
    // Manche Apps schicken denselben Wortlaut als Titel und als Text.
    const draft = noteFromShare({ title: 'Einkaufen', text: 'Einkaufen', url: '' })

    assert.equal(draft.title, 'Einkaufen')
    assert.equal(draft.body, '')
  })

  it('nimmt bei fehlendem Titel den Gastgeber der Adresse', () => {
    const draft = noteFromShare({ title: '', text: 'https://www.srf.ch/news/xy', url: '' })

    assert.equal(draft.title, 'srf.ch')
    assert.equal(draft.body, 'https://www.srf.ch/news/xy')
  })

  it('lässt den Titel leer, wenn der Text keine Adresse ist', () => {
    // Sonst stünde dieselbe Zeile zweimal in der Notiz.
    const draft = noteFromShare({ title: '', text: 'Am Montag anrufen', url: '' })

    assert.equal(draft.title, '')
    assert.equal(draft.body, 'Am Montag anrufen')
  })

  it('hält Titel und Text innerhalb dessen, was der Server annimmt', () => {
    const draft = noteFromShare({ title: 'T'.repeat(200), text: 'x'.repeat(25_000), url: '' })

    assert.equal(draft.title.length, 120)
    assert.equal(draft.body.length, 20_000)
  })
})

describe('Erkennen, ob eine Notiz entstehen kann', () => {
  it('erkennt ein Teilen ohne Text', () => {
    // Ein PDF aus der Mail bringt keine Felder mit – „Notizen" ist dann kein
    // mögliches Ziel und darf nicht angeboten werden.
    assert.equal(hatText({ title: '', text: '', url: '' }), false)
    assert.equal(hatText({ title: '   ', text: '\n', url: ' ' }), false)
  })

  it('erkennt einen geteilten Verweis', () => {
    assert.equal(hatText({ title: '', text: '', url: 'https://beispiel.ch' }), true)
  })
})

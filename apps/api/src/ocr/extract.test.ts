import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { privateUseShare } from './extract.ts'

describe('privateUseShare', () => {
  it('erkennt eine Textebene, die nur aus privaten Zeichen besteht', () => {
    // Genau das liefert pdftotext bei den Rechnungen der Energie- und
    // Wasserversorgung: lesbar aussehende Länge, unlesbarer Inhalt.
    assert.equal(privateUseShare(''), 1)
  })

  it('lässt gewöhnlichen Text unbehelligt', () => {
    assert.equal(privateUseShare('Rechnung Nr. 231125 über CHF 1’542.05'), 0)
  })

  it('zählt Leerzeichen und Umbrüche nicht mit', () => {
    assert.equal(privateUseShare('   \n\n\t  '), 0)
  })

  it('misst den Anteil, nicht das Vorkommen', () => {
    assert.equal(privateUseShare('abcd'), 0.2)
  })
})

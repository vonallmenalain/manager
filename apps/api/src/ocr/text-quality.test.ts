import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isUsableTextLayer, privateUseShare } from './text-quality.ts'

/** Zeichen aus dem privaten Unicode-Bereich, wie pdftotext sie ausgibt. */
function privat(anzahl: number): string {
  return Array.from({ length: anzahl }, (_, index) =>
    String.fromCharCode(0xe000 + (index % 100)),
  ).join('')
}

describe('privateUseShare', () => {
  it('erkennt eine Textebene, die nur aus privaten Zeichen besteht', () => {
    // Genau das liefert pdftotext bei den Rechnungen der Energie- und
    // Wasserversorgung: lesbar aussehende Länge, unlesbarer Inhalt.
    assert.equal(privateUseShare(privat(40)), 1)
  })

  it('lässt gewöhnlichen Text unbehelligt', () => {
    assert.equal(privateUseShare('Rechnung Nr. 231125 über CHF 1’542.05'), 0)
  })

  it('zählt Leerzeichen und Umbrüche nicht mit', () => {
    assert.equal(privateUseShare('   \n\n\t  '), 0)
  })

  it('misst den Anteil, nicht das Vorkommen', () => {
    assert.equal(privateUseShare(`abcd${privat(1)}`), 0.2)
  })
})

describe('isUsableTextLayer', () => {
  const lang = 'Rechnung der Energie- und Wasserversorgung Oberburg für den Haushalt. '.repeat(3)

  it('nimmt langen, lesbaren Text an', () => {
    assert.equal(isUsableTextLayer(lang), true)
  })

  it('weist eine Kopfzeile ab, aus der sich nichts finden lässt', () => {
    assert.equal(isUsableTextLayer('Rechnung'), false)
  })

  it('weist Zeichensalat ab, auch wenn er lang genug ist', () => {
    const salat = privat(200)
    assert.ok(salat.length > 120)
    assert.equal(isUsableTextLayer(salat), false)
  })
})

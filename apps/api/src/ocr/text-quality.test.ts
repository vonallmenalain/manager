import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CONTROL_CHARS, isUsableTextLayer, unreadableShare } from './text-quality.ts'

/** Zeichen aus dem privaten Unicode-Bereich, wie pdftotext sie ausgibt. */
function privat(anzahl: number): string {
  return Array.from({ length: anzahl }, (_, index) =>
    String.fromCharCode(0xe000 + (index % 100)),
  ).join('')
}

describe('unreadableShare', () => {
  it('erkennt eine Textebene, die nur aus privaten Zeichen besteht', () => {
    // Genau das liefert pdftotext bei den Rechnungen der Energie- und
    // Wasserversorgung: lesbar aussehende Länge, unlesbarer Inhalt.
    assert.equal(unreadableShare(privat(40)), 1)
  })

  it('lässt gewöhnlichen Text unbehelligt', () => {
    assert.equal(unreadableShare('Rechnung Nr. 231125 über CHF 1’542.05'), 0)
  })

  it('zählt Leerzeichen und Umbrüche nicht mit', () => {
    assert.equal(unreadableShare('   \n\n\t  '), 0)
  })

  it('misst den Anteil, nicht das Vorkommen', () => {
    assert.equal(unreadableShare(`abcd${privat(1)}`), 0.2)
  })

  it('zählt Nullzeichen als unlesbar', () => {
    // So kommt der Text eines PDFs aus dem Browser aus dem eigenen Leser:
    // zwei Bytes je Zeichen, das erste davon null.
    assert.equal(unreadableShare('\0R\0e\0c\0h\0n\0u\0n\0g'), 0.5)
  })

  it('lässt Tabulator, Umbruch und Seitenvorschub unbehelligt', () => {
    assert.equal(unreadableShare('Seite 1\tSumme\r\n\fSeite 2'), 0)
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

  it('weist Text ab, in dem jedes zweite Zeichen ein Nullzeichen ist', () => {
    // Die Nullzeichen machen einen kurzen Text scheinbar lang genug – dann
    // soll die Erkennung trotzdem über die Rasterung gehen.
    const kurz = 'Rechnung Zahnarzt, Betrag: CHF 245.50 fällig am 30. Oktober'
    const durchsetzt = [...kurz.repeat(2)].map((char) => `\0${char}`).join('')
    assert.ok(durchsetzt.trim().length > 120)
    assert.equal(isUsableTextLayer(durchsetzt), false)
  })
})

describe('CONTROL_CHARS', () => {
  it('trifft Nullzeichen, aber keine Umbrüche', () => {
    assert.equal('\0R\0e\u0007\n\t\f'.replace(CONTROL_CHARS, ''), 'Re\n\t\f')
  })
})

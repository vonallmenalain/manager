import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { extractPdfLines, extractPdfText, PdfTextError } from './pdf-text.ts'

/**
 * Baut ein winziges, ungepacktes PDF – gerade genug, um die Auslesung zu
 * prüfen, ohne eine echte Rechnung im Verzeichnis abzulegen.
 *
 * Nachgebildet ist die Eigenheit, an der fertige Werkzeuge scheitern: Die
 * Schrift bildet ihre Zeichen über `/Differences` ab, und eine zusätzliche
 * `/ToUnicode`-Tabelle behauptet gleichzeitig etwas anderes – nämlich den
 * privaten Unicode-Bereich, aus dem sich kein Wort lesen lässt.
 */
function buildPdf(options: { withPrivateUseToUnicode?: boolean } = {}): Buffer {
  const content = [
    'BT /F1 10 Tf 1 0 0 1 50 700 Tm (DEFGHIJ) Tj ET',
    "BT /F1 10 Tf 1 0 0 1 300 700 Tm (1'090.15) Tj ET",
    'BT /F1 10 Tf 1 0 0 1 50 680 Tm (KFLMNOPQRST) Tj ET',
    'BT /F1 10 Tf 1 0 0 1 300 680 Tm (750.80) Tj ET',
  ].join('\n')

  // Codes ab 68 stehen für die Buchstaben von 'Energie' und 'Netznutzung'.
  const differences =
    '[68 /E /n /e /r /g /i /e /N /t /z /n /u /t /z /u /n /g]'

  const toUnicode = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 beginbfchar <44> <E04D> endbfchar',
    'endcmap end end',
  ].join('\n')

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /TrueType /BaseFont /AOYREB+ArialMT /Encoding 6 0 R${
      options.withPrivateUseToUnicode ? ' /ToUnicode 7 0 R' : ''
    } >>`,
    `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ${differences} >>`,
    `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
  ]

  const body = objects
    .map((object, index) => `${index + 1} 0 obj\n${object}\nendobj\n`)
    .join('')

  return Buffer.from(`%PDF-1.7\n${body}trailer\n<< /Root 1 0 R /Size 8 >>\n%%EOF\n`, 'latin1')
}

describe('extractPdfLines', () => {
  it('löst die Zeichen über die Glyphennamen der Schrift auf', () => {
    const zeilen = extractPdfLines(buildPdf())

    assert.equal(zeilen.length, 2)
    assert.deepEqual(zeilen[0]?.cells, ['Energie', "1'090.15"])
    assert.deepEqual(zeilen[1]?.cells, ['Netznutzung', '750.80'])
  })

  it('fasst Textstücke gleicher Höhe zu einer Zeile zusammen, von links nach rechts', () => {
    const zeilen = extractPdfLines(buildPdf())

    // Die zweite Spalte steht weiter rechts und gehört trotzdem zur ersten Zeile.
    assert.equal(zeilen[0]?.text, "Energie 1'090.15")
    // Weiter oben zuerst: 700 vor 680.
    assert.ok((zeilen[0]?.y ?? 0) > (zeilen[1]?.y ?? 0))
  })

  it('verwirft eine ToUnicode-Tabelle, die in den privaten Bereich zeigt', () => {
    // Genau daran scheitert pdftotext bei diesen Rechnungen: Es glaubt der
    // Tabelle und gibt unlesbare Zeichen aus. Die Glyphennamen müssen gewinnen.
    const zeilen = extractPdfLines(buildPdf({ withPrivateUseToUnicode: true }))

    assert.equal(zeilen[0]?.cells[0], 'Energie')
  })

  it('liefert den ganzen Text zeilenweise', () => {
    assert.equal(extractPdfText(buildPdf()), "Energie 1'090.15\nNetznutzung 750.80")
  })

  it('weist zurück, was kein PDF ist', () => {
    assert.throws(() => extractPdfLines(Buffer.from('Guten Tag')), PdfTextError)
  })

  it('weist ein PDF ohne lesbare Seite zurück', () => {
    const leer = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1')
    assert.throws(() => extractPdfLines(leer), PdfTextError)
  })
})

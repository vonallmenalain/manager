import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildPdfFromJpegs, readJpegInfo } from './pdf.ts'

/**
 * Ein JPEG mit gültigen Kopfdaten und erfundenen Bilddaten.
 *
 * Für die beiden geprüften Aufgaben – Grösse auslesen und Bytes unverändert
 * einbetten – ist der Inhalt ohne Bedeutung. Ein echtes Foto im Test wäre ein
 * Megabyte Beiwerk.
 */
function fakeJpeg(width: number, height: number, components = 3): Uint8Array {
  const bytes: number[] = [0xff, 0xd8]

  // APP0/JFIF – steht in jedem Kamerabild vor der Grössenangabe und muss
  // übersprungen werden.
  bytes.push(0xff, 0xe0, 0x00, 0x10)
  bytes.push(0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)

  // SOF0 mit der Bildgrösse.
  bytes.push(0xff, 0xc0, 0x00, 8 + 3 * components, 0x08)
  bytes.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, components)
  for (let id = 1; id <= components; id += 1) bytes.push(id, 0x11, 0x00)

  bytes.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00)
  bytes.push(0x12, 0x34, 0x56, 0x78)
  bytes.push(0xff, 0xd9)

  return new Uint8Array(bytes)
}

function asText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
}

describe('readJpegInfo', () => {
  it('liest Grösse und Farbkanäle hinter den Kopfsegmenten', () => {
    assert.deepEqual(readJpegInfo(fakeJpeg(1600, 2400)), {
      width: 1600,
      height: 2400,
      components: 3,
    })
  })

  it('erkennt ein Graustufenbild', () => {
    assert.equal(readJpegInfo(fakeJpeg(800, 600, 1))?.components, 1)
  })

  it('lässt sich von Füllbytes vor einem Markierer nicht stören', () => {
    const original = fakeJpeg(300, 200)
    // Vor dem SOF0 zusätzliche 0xFF einschieben – laut Norm erlaubt.
    const padded = new Uint8Array(original.length + 2)
    padded.set(original.subarray(0, 20), 0)
    padded.set([0xff, 0xff], 20)
    padded.set(original.subarray(20), 22)

    assert.deepEqual(readJpegInfo(padded), { width: 300, height: 200, components: 3 })
  })

  it('gibt null zurück, wenn es kein JPEG ist', () => {
    assert.equal(readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null)
    assert.equal(readJpegInfo(new Uint8Array()), null)
  })
})

describe('buildPdfFromJpegs', () => {
  it('legt jede Seite als eigenes Blatt an', () => {
    const pdf = buildPdfFromJpegs([fakeJpeg(1200, 1600), fakeJpeg(1600, 1200)])
    const text = asText(pdf)

    assert.ok(text.startsWith('%PDF-1.4\n'), 'Kein PDF-Kopf')
    assert.ok(text.includes('/Count 2'), 'Falsche Seitenzahl')
    assert.ok(text.includes('/Kids [3 0 R 6 0 R]'), 'Seiten hängen nicht am Baum')
    assert.equal(text.match(/\/Type \/Page[^s]/g)?.length, 2)
    assert.ok(text.endsWith('%%EOF\n'))
  })

  it('gibt der Seite das Format des Papiers, nicht die Bildpunktzahl', () => {
    // Hochformat 3:4 – die lange Kante bekommt die Höhe von A4, die kurze
    // ergibt sich daraus. Ohne diese Umrechnung wäre eine Seite aus einer
    // 12-Megapixel-Kamera mehrere Meter gross.
    const text = asText(buildPdfFromJpegs([fakeJpeg(1200, 1600)]))
    assert.ok(text.includes('/MediaBox [0 0 631.42 841.89]'), 'Falsches Seitenformat')
  })

  it('bettet die Bilddaten unverändert ein', () => {
    const jpeg = fakeJpeg(400, 300)
    const pdf = buildPdfFromJpegs([jpeg])

    assert.ok(asText(pdf).includes('/Filter /DCTDecode'))
    assert.ok(asText(pdf).includes(`/Length ${jpeg.length}`))
    assert.ok(Buffer.from(pdf).includes(Buffer.from(jpeg)), 'Die Bilddaten fehlen')
  })

  it('trägt in die Tabelle die Positionen ein, an denen die Objekte wirklich stehen', () => {
    // Der heikle Teil: Stimmt hier ein Byte nicht, öffnet die Datei nirgends.
    const pdf = buildPdfFromJpegs([fakeJpeg(400, 300), fakeJpeg(300, 400), fakeJpeg(200, 200)])
    const text = asText(pdf)

    const startxref = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split('\n')[0])
    assert.ok(text.startsWith('xref\n', startxref), 'startxref zeigt nicht auf die Tabelle')

    const objectCount = 2 + 3 * 3
    const table = text.slice(startxref)
    assert.ok(table.startsWith(`xref\n0 ${objectCount + 1}\n`))

    // Zeile 0 ist 'xref', Zeile 1 der Bereich, Zeile 2 das freie Objekt 0.
    const entries = table.split('\n').slice(3, 3 + objectCount)
    assert.equal(entries.length, objectCount)

    entries.forEach((entry, index) => {
      // Jeder Eintrag ist exakt zwanzig Bytes lang, Zeilenende eingerechnet.
      assert.equal(entry.length, 19, `Eintrag ${index + 1} hat die falsche Länge`)
      const offset = Number(entry.slice(0, 10))
      assert.ok(
        text.startsWith(`${index + 1} 0 obj`, offset),
        `Objekt ${index + 1} steht nicht bei ${offset}`,
      )
    })

    assert.ok(text.includes(`/Size ${objectCount + 1}`))
  })

  it('verweigert einen leeren Stapel', () => {
    assert.throws(() => buildPdfFromJpegs([]), /keine? Seiten|Ohne Seiten/i)
  })

  it('verweigert eine Seite, die sich nicht lesen lässt', () => {
    assert.throws(() => buildPdfFromJpegs([new Uint8Array([1, 2, 3])]), /nicht lesen/)
  })
})

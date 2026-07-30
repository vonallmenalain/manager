import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { detectPageQuad, otsuThreshold, toGrayscale } from './detect.ts'
import type { Point, Quad, Raster } from './geometry.ts'

function raster(width: number, height: number, gray: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = gray
    data[i * 4 + 1] = gray
    data[i * 4 + 2] = gray
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

function contains(quad: Quad, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = 3; i < 4; j = i, i += 1) {
    const a = quad[i] as Point
    const b = quad[j] as Point
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

function paint(image: Raster, quad: Quad, gray: number): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!contains(quad, x + 0.5, y + 0.5)) continue
      const offset = (y * image.width + x) * 4
      image.data[offset] = gray
      image.data[offset + 1] = gray
      image.data[offset + 2] = gray
    }
  }
}

/** Ein schräg fotografiertes Blatt, wie es typisch im Sucher liegt. */
const sheet: Quad = [
  { x: 34, y: 18 },
  { x: 206, y: 30 },
  { x: 198, y: 162 },
  { x: 26, y: 150 },
]

function assertNearSheet(quad: Quad | null, tolerance = 4) {
  assert.ok(quad, 'kein Viereck erkannt')
  for (let i = 0; i < 4; i += 1) {
    const found = quad[i] as Point
    const expected = sheet[i] as Point
    assert.ok(
      Math.hypot(found.x - expected.x, found.y - expected.y) <= tolerance,
      `Ecke ${i} liegt bei ${found.x}/${found.y} statt ${expected.x}/${expected.y}`,
    )
  }
}

describe('otsuThreshold', () => {
  it('legt die Schwelle zwischen die beiden Helligkeiten', () => {
    const values = new Uint8Array(1000)
    values.fill(40, 0, 500)
    values.fill(200, 500)

    const threshold = otsuThreshold(values)
    assert.ok(threshold >= 40 && threshold < 200, `Schwelle ${threshold} liegt nicht dazwischen`)
  })
})

describe('toGrayscale', () => {
  it('gewichtet Grün am stärksten, wie das Auge', () => {
    const image: Raster = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
      width: 2,
      height: 1,
    }
    const gray = toGrayscale(image)
    assert.equal(gray[0], 76)
    assert.equal(gray[1], 150)
  })
})

describe('detectPageQuad', () => {
  it('findet helles Papier auf dunklem Untergrund', () => {
    const image = raster(240, 180, 55)
    paint(image, sheet, 215)
    assertNearSheet(detectPageQuad(image))
  })

  it('findet auch den dunklen Prospekt auf der hellen Ablage', () => {
    // Ohne diesen Fall bliebe jedes Dokument auf einer weissen Küchenablage
    // unerkannt – und das ist genau die Ablage, auf der fotografiert wird.
    const image = raster(240, 180, 225)
    paint(image, sheet, 70)
    assertNearSheet(detectPageQuad(image))
  })

  it('gibt bei einer gleichmässigen Fläche auf', () => {
    assert.equal(detectPageQuad(raster(240, 180, 128)), null)
  })

  it('lässt keine Ecke neben dem Bild liegen', () => {
    // Ein Blatt, das über den Sucher hinausragt: Die Erkennung rechnet die
    // abgeschnittene Ecke dorthin zurück, wo das Papier sie hätte – ausserhalb
    // des Fotos. Dort gibt es keine Bildpunkte zum Entzerren, und der Griff zum
    // Verschieben läge neben der Anzeige, wo niemand mehr hinkommt.
    const image = raster(240, 180, 55)
    paint(
      image,
      [
        { x: -8, y: -6 },
        { x: 205, y: 20 },
        { x: 195, y: 165 },
        { x: 20, y: 150 },
      ],
      215,
    )

    const quad = detectPageQuad(image)
    assert.ok(quad, 'kein Viereck erkannt')
    for (const [index, point] of quad.entries()) {
      assert.ok(
        point.x >= 0 && point.x <= 240 && point.y >= 0 && point.y <= 180,
        `Ecke ${index} liegt bei ${point.x}/${point.y} ausserhalb des Bildes`,
      )
    }
  })

  it('gibt auf, wenn das Blatt den Untergrund völlig verdeckt', () => {
    // Kein sichtbarer Rand heisst: kein Beschnitt, den man erkennen könnte.
    // Der Aufrufer zeigt dann den vollen Ausschnitt an.
    const image = raster(240, 180, 40)
    paint(
      image,
      [
        { x: 1, y: 1 },
        { x: 239, y: 1 },
        { x: 239, y: 179 },
        { x: 1, y: 179 },
      ],
      230,
    )
    assert.equal(detectPageQuad(image), null)
  })
})

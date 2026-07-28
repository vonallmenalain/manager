import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Quad, Raster } from './geometry.ts'
import { warpToRect } from './warp.ts'

function raster(width: number, height: number, color: (x: number, y: number) => number[]): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = color(x, y) as [number, number, number]
      const offset = (y * width + x) * 4
      data[offset] = red
      data[offset + 1] = green
      data[offset + 2] = blue
      data[offset + 3] = 255
    }
  }
  return { data, width, height }
}

function pixel(image: Raster, x: number, y: number): [number, number, number] {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset] as number,
    image.data[offset + 1] as number,
    image.data[offset + 2] as number,
  ]
}

/** Vier farbige Viertel – so lässt sich jede Drehung und Spiegelung ablesen. */
const quarters = raster(200, 200, (x, y) =>
  y < 100 ? (x < 100 ? [255, 0, 0] : [0, 255, 0]) : x < 100 ? [0, 0, 255] : [255, 255, 0],
)

describe('warpToRect', () => {
  it('behält die Lage bei, wenn das Viereck der ganze Bildausschnitt ist', () => {
    const full: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]

    const result = warpToRect(quarters, full, 40, 40)
    assert.ok(result)
    assert.deepEqual(pixel(result, 10, 10), [255, 0, 0])
    assert.deepEqual(pixel(result, 30, 10), [0, 255, 0])
    assert.deepEqual(pixel(result, 10, 30), [0, 0, 255])
    assert.deepEqual(pixel(result, 30, 30), [255, 255, 0])
  })

  it('dreht mit, wenn die Seite quer im Bild liegt', () => {
    // Als „oben links" wird die untere linke Ecke des Fotos bezeichnet – so
    // sieht es aus, wenn das Blatt um 90 Grad gedreht auf dem Tisch liegt.
    const sideways: Quad = [
      { x: 0, y: 200 },
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
    ]

    const result = warpToRect(quarters, sideways, 40, 40)
    assert.ok(result)
    // Aus dem blauen Viertel unten links wird oben links.
    assert.deepEqual(pixel(result, 10, 10), [0, 0, 255])
    assert.deepEqual(pixel(result, 30, 10), [255, 0, 0])
    assert.deepEqual(pixel(result, 10, 30), [255, 255, 0])
    assert.deepEqual(pixel(result, 30, 30), [0, 255, 0])
  })

  it('schneidet den gewählten Ausschnitt heraus', () => {
    const topLeftQuarter: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]

    const result = warpToRect(quarters, topLeftQuarter, 20, 20)
    assert.ok(result)
    for (const [x, y] of [
      [1, 1],
      [18, 1],
      [1, 18],
      [18, 18],
    ] as Array<[number, number]>) {
      assert.deepEqual(pixel(result, x, y), [255, 0, 0])
    }
  })

  it('mittelt zwischen den Bildpunkten statt zu springen', () => {
    // Ein Verlauf, auf doppelte Breite gezogen: Zwischen zwei Quellpunkten
    // muss ein Zwischenwert stehen. Ohne diese Mittelung bekäme jede
    // gedrehte Kante im Ergebnis eine sichtbare Treppe.
    const ramp = raster(4, 1, (x) => [x * 60, x * 60, x * 60])
    const result = warpToRect(
      ramp,
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 1 },
        { x: 0, y: 1 },
      ],
      8,
      1,
    )

    assert.ok(result)
    const values = Array.from({ length: 8 }, (_, x) => pixel(result, x, 0)[0])
    for (let x = 1; x < 8; x += 1) {
      assert.ok(
        (values[x] as number) >= (values[x - 1] as number),
        `Der Verlauf springt bei ${x} zurück`,
      )
    }
    assert.ok(new Set(values).size > 4, 'Es entstehen keine Zwischenwerte')
  })

  it('gibt null zurück, wenn das Viereck keine Fläche hat', () => {
    const collapsed: Quad = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ]
    assert.equal(warpToRect(quarters, collapsed, 20, 20), null)
  })
})

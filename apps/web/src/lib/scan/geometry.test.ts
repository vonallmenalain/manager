import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  applyHomography,
  convexHull,
  isPlausibleQuad,
  orderCorners,
  outputSize,
  polygonArea,
  pruneCollinear,
  reduceToQuad,
  solveHomography,
  type Point,
  type Quad,
} from './geometry.ts'

const square: Quad = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

function closeTo(actual: number, expected: number, tolerance: number, what: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: ${actual} weicht um mehr als ${tolerance} von ${expected} ab`,
  )
}

describe('convexHull', () => {
  it('lässt Punkte im Inneren weg', () => {
    const hull = convexHull([...square, { x: 50, y: 50 }, { x: 20, y: 80 }])
    assert.equal(hull.length, 4)
    assert.equal(polygonArea(hull), 10_000)
  })

  it('umschliesst eine ausgefranste Kante', () => {
    // So sieht der Rand einer erkannten Fläche aus: eine Treppe aus Bildpunkten.
    const staircase: Point[] = []
    for (let y = 0; y <= 100; y += 5) staircase.push({ x: y % 10 === 0 ? 0 : 1, y })

    const hull = convexHull([...staircase, { x: 100, y: 0 }, { x: 100, y: 100 }])
    assert.ok(hull.some((point) => point.x === 0 && point.y === 0))
    assert.ok(hull.some((point) => point.x === 0 && point.y === 100))
    // Der Punkt bei x = 1 liegt innerhalb und darf nicht in der Hülle stehen.
    assert.ok(!hull.some((point) => point.x === 1))
  })
})

describe('pruneCollinear', () => {
  it('dünnt Zwischenpunkte auf einer Geraden aus', () => {
    const polygon: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0.4 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    assert.equal(pruneCollinear(polygon, 1).length, 4)
  })

  it('lässt echte Ecken stehen', () => {
    const polygon: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 30 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    assert.equal(pruneCollinear(polygon, 1).length, 5)
  })
})

describe('reduceToQuad', () => {
  it('findet die vier Ecken einer gedrehten Seite wieder', () => {
    const corners: Quad = [
      { x: 30, y: 12 },
      { x: 190, y: 40 },
      { x: 176, y: 230 },
      { x: 16, y: 200 },
    ]

    // Zwischenpunkte auf den Kanten, wie sie eine Randverfolgung liefert.
    const outline: Point[] = []
    for (let i = 0; i < 4; i += 1) {
      const from = corners[i] as Point
      const to = corners[(i + 1) % 4] as Point
      for (let step = 0; step < 8; step += 1) {
        outline.push({
          x: from.x + ((to.x - from.x) * step) / 8,
          y: from.y + ((to.y - from.y) * step) / 8,
        })
      }
    }

    const quad = reduceToQuad(pruneCollinear(convexHull(outline), 3), 100)
    assert.ok(quad)

    for (let i = 0; i < 4; i += 1) {
      const found = quad[i] as Point
      const expected = corners[i] as Point
      closeTo(found.x, expected.x, 2, `Ecke ${i} x`)
      closeTo(found.y, expected.y, 2, `Ecke ${i} y`)
    }
  })

  it('gibt bei zu wenigen Punkten auf', () => {
    assert.equal(reduceToQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }], 10), null)
  })
})

describe('orderCorners', () => {
  it('beginnt oben links und läuft im Uhrzeigersinn', () => {
    const shuffled: Point[] = [
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    assert.deepEqual(orderCorners(shuffled), square)
  })
})

describe('isPlausibleQuad', () => {
  it('nimmt eine perspektivisch verzerrte Seite an', () => {
    const tilted: Quad = [
      { x: 20, y: 10 },
      { x: 180, y: 30 },
      { x: 170, y: 190 },
      { x: 10, y: 160 },
    ]
    assert.equal(isPlausibleQuad(tilted, 200, 200), true)
  })

  it('lehnt einen kleinen Fleck ab', () => {
    const speck: Quad = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ]
    assert.equal(isPlausibleQuad(speck, 200, 200), false)
  })

  it('lehnt eine eingedellte Form ab', () => {
    // Nicht konvex: Ein Blatt Papier sieht so nicht aus, eine Erkennung, die
    // an einem Schatten hängengeblieben ist, schon.
    const dented: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 200 },
    ]
    assert.equal(isPlausibleQuad(dented, 200, 200), false)
  })
})

describe('outputSize', () => {
  it('nimmt je Richtung die längere der beiden Kanten', () => {
    const trapeze: Quad = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 300, y: 600 },
      { x: 100, y: 600 },
    ]
    assert.deepEqual(outputSize(trapeze, 2000), { width: 400, height: 608 })
  })

  it('verkleinert auf die zulässige Kantenlänge, ohne das Verhältnis zu ändern', () => {
    const large: Quad = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 4000 },
      { x: 0, y: 4000 },
    ]
    assert.deepEqual(outputSize(large, 2000), { width: 1500, height: 2000 })
  })
})

describe('solveHomography', () => {
  it('bildet die vier Ecken genau aufeinander ab', () => {
    const target: Quad = [
      { x: 12, y: 30 },
      { x: 400, y: 5 },
      { x: 380, y: 500 },
      { x: 40, y: 460 },
    ]

    const homography = solveHomography(square, target)
    assert.ok(homography)

    for (let i = 0; i < 4; i += 1) {
      const mapped = applyHomography(homography, square[i] as Point)
      const expected = target[i] as Point
      closeTo(mapped.x, expected.x, 1e-6, `Ecke ${i} x`)
      closeTo(mapped.y, expected.y, 1e-6, `Ecke ${i} y`)
    }
  })

  it('behält die Mitte in der Mitte, wenn nichts verzerrt wird', () => {
    const scaled: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]
    const homography = solveHomography(square, scaled)
    assert.ok(homography)

    const middle = applyHomography(homography, { x: 50, y: 50 })
    closeTo(middle.x, 100, 1e-6, 'Mitte x')
    closeTo(middle.y, 100, 1e-6, 'Mitte y')
  })

  it('gibt null zurück, wenn zwei Ecken aufeinanderliegen', () => {
    // Passiert beim Zurechtziehen von Hand: Zwei Griffe landen übereinander.
    // Dafür gibt es keine Abbildung, und ein Ergebnis mit Unendlich darin
    // würde die Entzerrung in eine Endlosschleife aus NaN schicken.
    const collapsed: Quad = [
      { x: 20, y: 20 },
      { x: 20, y: 20 },
      { x: 100, y: 100 },
      { x: 20, y: 100 },
    ]
    assert.equal(solveHomography(collapsed, square), null)
  })
})

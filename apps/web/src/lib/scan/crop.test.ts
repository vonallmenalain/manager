import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  cornerPoint,
  cropPixels,
  FULL_CROP,
  isFullCrop,
  MIN_CROP_SIDE,
  moveCorner,
  moveCrop,
  nearestCropCorner,
  type CropRect,
} from './crop.ts'

/**
 * Anteile entstehen aus Divisionen und Additionen – 0.2 + 0.1 ist in
 * Gleitkomma nicht genau 0.3. Verglichen wird deshalb auf Bildpunktgenauigkeit
 * und nicht auf das letzte Bit: Alles Feinere hat auf keinem Bild eine
 * Entsprechung.
 */
function assertRect(actual: CropRect, expected: CropRect): void {
  for (const kante of ['left', 'top', 'right', 'bottom'] as const) {
    assert.ok(
      Math.abs(actual[kante] - expected[kante]) < 1e-9,
      `${kante}: ${actual[kante]} statt ${expected[kante]}`,
    )
  }
}

describe('moveCorner', () => {
  it('zieht die angefasste Ecke und lässt die gegenüberliegende stehen', () => {
    assertRect(moveCorner(FULL_CROP, 'nw', 0.2, 0.1), {
      left: 0.2,
      top: 0.1,
      right: 1,
      bottom: 1,
    })
  })

  it('lässt das Rechteck nicht umstülpen', () => {
    // Die obere Kante über die untere hinaus wäre ein Bild mit negativer Höhe –
    // beim Zuschneiden käme nichts heraus, und zwar erst nach dem Speichern.
    const rect = moveCorner(FULL_CROP, 'nw', 1.5, 1.5)
    assert.ok(Math.abs(rect.right - rect.left - MIN_CROP_SIDE) < 1e-9)
    assert.ok(Math.abs(rect.bottom - rect.top - MIN_CROP_SIDE) < 1e-9)
  })

  it('hält die Ecke im Bild, auch wenn der Finger daneben liegt', () => {
    const rect = moveCorner(FULL_CROP, 'se', -3, -3)
    assert.equal(rect.left, 0)
    assert.equal(rect.top, 0)
    assert.equal(rect.right, MIN_CROP_SIDE)
    assert.equal(rect.bottom, MIN_CROP_SIDE)
  })
})

describe('moveCrop', () => {
  it('verschiebt den ganzen Ausschnitt', () => {
    assertRect(moveCrop({ left: 0.2, top: 0.2, right: 0.6, bottom: 0.6 }, 0.1, -0.1), {
      left: 0.3,
      top: 0.1,
      right: 0.7,
      bottom: 0.5,
    })
  })

  it('bleibt am Bildrand stehen, ohne kleiner zu werden', () => {
    // Ein Ausschnitt, der beim Anstossen schrumpft, macht den eben gesetzten
    // Beschnitt wieder kaputt.
    const start = { left: 0.2, top: 0.2, right: 0.6, bottom: 0.6 }
    assertRect(moveCrop(start, -1, -1), { left: 0, top: 0, right: 0.4, bottom: 0.4 })
  })
})

describe('nearestCropCorner', () => {
  const rect = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 }

  it('findet die Ecke in Reichweite', () => {
    assert.equal(nearestCropCorner(rect, 0.22, 0.21, 0.1), 'nw')
    assert.equal(nearestCropCorner(rect, 0.79, 0.82, 0.1), 'se')
  })

  it('meldet nichts, wenn keine Ecke nah genug ist', () => {
    // Eine Berührung in der Mitte ist ein Verschieben, kein Ziehen.
    assert.equal(nearestCropCorner(rect, 0.5, 0.5, 0.1), null)
  })
})

describe('cornerPoint', () => {
  it('gibt jede Ecke an ihrer Kante zurück', () => {
    const rect = { left: 0.1, top: 0.2, right: 0.7, bottom: 0.9 }
    assert.deepEqual(cornerPoint(rect, 'nw'), { x: 0.1, y: 0.2 })
    assert.deepEqual(cornerPoint(rect, 'ne'), { x: 0.7, y: 0.2 })
    assert.deepEqual(cornerPoint(rect, 'se'), { x: 0.7, y: 0.9 })
    assert.deepEqual(cornerPoint(rect, 'sw'), { x: 0.1, y: 0.9 })
  })
})

describe('cropPixels', () => {
  it('rechnet Anteile in Bildpunkte um', () => {
    assert.deepEqual(cropPixels({ left: 0.25, top: 0.5, right: 0.75, bottom: 1 }, 800, 600), {
      x: 200,
      y: 300,
      width: 400,
      height: 300,
    })
  })

  it('liefert nie eine Kante von null', () => {
    // Ein Canvas ohne Breite lässt sich nicht kodieren – bei einem schmalen
    // Ausschnitt auf einem kleinen Vorschaubild käme genau das heraus.
    const rect = cropPixels({ left: 0.5, top: 0.5, right: 0.5001, bottom: 0.5001 }, 100, 100)
    assert.equal(rect.width, 1)
    assert.equal(rect.height, 1)
  })

  it('gibt beim vollen Ausschnitt das ganze Bild zurück', () => {
    assert.deepEqual(cropPixels(FULL_CROP, 1200, 1600), {
      x: 0,
      y: 0,
      width: 1200,
      height: 1600,
    })
    assert.ok(isFullCrop(FULL_CROP))
    assert.ok(!isFullCrop({ ...FULL_CROP, left: 0.1 }))
  })
})

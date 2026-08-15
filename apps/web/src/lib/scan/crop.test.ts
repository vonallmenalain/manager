import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  containsPoint,
  cropPixels,
  fitInside,
  FULL_CROP,
  handlePoint,
  isFullCrop,
  MIN_CROP_SIDE,
  moveCrop,
  moveHandle,
  nearestCropHandle,
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

describe('moveHandle', () => {
  it('zieht die angefasste Ecke und lässt die gegenüberliegende stehen', () => {
    assertRect(moveHandle(FULL_CROP, 'nw', 0.2, 0.1), {
      left: 0.2,
      top: 0.1,
      right: 1,
      bottom: 1,
    })
  })

  it('rührt bei einem Kantengriff nur diese eine Kante an', () => {
    // „Unten die Fusszeile weg" darf die Breite nicht verändern – sonst muss
    // man sie danach wieder geradeziehen.
    assertRect(moveHandle(FULL_CROP, 's', 0.42, 0.8), {
      left: 0,
      top: 0,
      right: 1,
      bottom: 0.8,
    })
    assertRect(moveHandle(FULL_CROP, 'w', 0.3, 0.42), {
      left: 0.3,
      top: 0,
      right: 1,
      bottom: 1,
    })
  })

  it('lässt das Rechteck nicht umstülpen', () => {
    // Die obere Kante über die untere hinaus wäre ein Bild mit negativer Höhe –
    // beim Zuschneiden käme nichts heraus, und zwar erst nach dem Speichern.
    const rect = moveHandle(FULL_CROP, 'nw', 1.5, 1.5)
    assert.ok(Math.abs(rect.right - rect.left - MIN_CROP_SIDE) < 1e-9)
    assert.ok(Math.abs(rect.bottom - rect.top - MIN_CROP_SIDE) < 1e-9)
  })

  it('hält den Griff im Bild, auch wenn der Finger daneben liegt', () => {
    const rect = moveHandle(FULL_CROP, 'se', -3, -3)
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

describe('handlePoint', () => {
  const rect = { left: 0.1, top: 0.2, right: 0.7, bottom: 0.9 }

  it('setzt die Ecken auf ihre Kanten', () => {
    assert.deepEqual(handlePoint(rect, 'nw'), { x: 0.1, y: 0.2 })
    assert.deepEqual(handlePoint(rect, 'ne'), { x: 0.7, y: 0.2 })
    assert.deepEqual(handlePoint(rect, 'se'), { x: 0.7, y: 0.9 })
    assert.deepEqual(handlePoint(rect, 'sw'), { x: 0.1, y: 0.9 })
  })

  it('setzt die Kantengriffe in die Mitte ihrer Kante', () => {
    const nah = (actual: { x: number; y: number }, x: number, y: number) => {
      assert.ok(Math.abs(actual.x - x) < 1e-9, `x: ${actual.x} statt ${x}`)
      assert.ok(Math.abs(actual.y - y) < 1e-9, `y: ${actual.y} statt ${y}`)
    }

    nah(handlePoint(rect, 'n'), 0.4, 0.2)
    nah(handlePoint(rect, 's'), 0.4, 0.9)
    nah(handlePoint(rect, 'w'), 0.1, 0.55)
    nah(handlePoint(rect, 'e'), 0.7, 0.55)
  })
})

describe('nearestCropHandle', () => {
  const rect = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 }
  // Ein hochkantes Bild: derselbe Anteil bedeutet auf den beiden Achsen
  // Verschiedenes. Genau daran scheiterte das Greifen vorher.
  const hochkant = { width: 400, height: 1200 }

  it('misst in Bildschirmpunkten und nicht in Anteilen', () => {
    // 0.02 Anteil sind senkrecht 24 Punkte, waagrecht nur 8 – beides liegt
    // innerhalb von 44 Punkten und muss die Ecke treffen.
    assert.equal(nearestCropHandle(rect, { x: 0.22, y: 0.22 }, hochkant, 44), 'nw')

    // 0.06 Anteil sind auf dieser Höhe 72 Punkte: zu weit weg. In Anteilen
    // gerechnet wäre das fälschlich ein Treffer gewesen.
    assert.equal(nearestCropHandle(rect, { x: 0.2, y: 0.26 }, hochkant, 44), null)
  })

  it('findet den Kantengriff zwischen den Ecken', () => {
    assert.equal(nearestCropHandle(rect, { x: 0.5, y: 0.79 }, { width: 800, height: 800 }, 44), 's')
  })

  it('liefert mit unbegrenztem Radius immer einen Griff', () => {
    // Der Fall „daneben getippt": Ein Tippen, das gar nichts bewirkt, fühlt
    // sich kaputt an – ausserhalb des Ausschnitts gibt es nichts anderes zu
    // tun, als die nächste Kante dorthin zu ziehen.
    assert.equal(
      nearestCropHandle(rect, { x: 0.02, y: 0.02 }, { width: 800, height: 800 }, Infinity),
      'nw',
    )
  })
})

describe('containsPoint', () => {
  const rect = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 }

  it('erkennt drinnen und draussen', () => {
    assert.ok(containsPoint(rect, { x: 0.5, y: 0.5 }))
    assert.ok(!containsPoint(rect, { x: 0.5, y: 0.9 }))
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

describe('fitInside', () => {
  it('legt ein hochauflösendes Bild vollständig in die Fläche', () => {
    // Der eigentliche Fehler auf dem Desktop: Das Bild stand in voller Grösse
    // da, ragte unten heraus und legte sich über die Knöpfe.
    const box = fitInside({ width: 4000, height: 3000 }, { width: 800, height: 600 })
    assert.equal(box.width, 800)
    assert.equal(box.height, 600)
    assert.equal(box.left, 0)
    assert.equal(box.top, 0)
  })

  it('zentriert und hält den Rand für die Griffe frei', () => {
    const box = fitInside({ width: 1000, height: 1000 }, { width: 800, height: 600 }, 20)
    assert.equal(box.width, 560)
    assert.equal(box.height, 560)
    assert.equal(box.left, 120)
    assert.equal(box.top, 20)
  })

  it('behält das Seitenverhältnis bei', () => {
    const box = fitInside({ width: 1000, height: 2000 }, { width: 900, height: 900 })
    assert.ok(Math.abs(box.width / box.height - 0.5) < 1e-9)
    assert.ok(box.height <= 900)
  })

  it('kommt mit einer noch ungemessenen Fläche aus', () => {
    // Beim ersten Bild steht die Grösse der Fläche noch nicht fest; eine
    // Division durch null darf daraus keine NaN-Koordinaten machen.
    const box = fitInside({ width: 1000, height: 1000 }, { width: 0, height: 0 })
    assert.ok(Number.isFinite(box.width) && Number.isFinite(box.left))
  })
})

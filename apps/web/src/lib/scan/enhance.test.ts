import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { enhance } from './enhance.ts'
import type { Raster } from './geometry.ts'

const WIDTH = 200
const HEIGHT = 150

/** Textzeilen, über das ganze Blatt verteilt – auch dorthin, wo es dunkel ist. */
const LINES = [
  { x: 20, y: 20 },
  { x: 120, y: 30 },
  { x: 30, y: 70 },
  { x: 130, y: 80 },
  { x: 25, y: 120 },
  { x: 125, y: 125 },
]

const LINE_WIDTH = 50
const LINE_HEIGHT = 6

function isText(x: number, y: number): boolean {
  return LINES.some(
    (line) => x >= line.x && x < line.x + LINE_WIDTH && y >= line.y && y < line.y + LINE_HEIGHT,
  )
}

/**
 * Ein Blatt, wie es vom Handy kommt: Links fällt Schatten, rechts ist es hell –
 * ein Unterschied von fast dem Dreifachen quer über die Seite. Die Schrift ist
 * überall gleich dunkel *relativ zum Papier*, in Zahlen aber nicht: Der
 * Buchstabe links ist heller als das Papier rechts.
 */
function litSheet(): Raster {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const paper = 85 + (150 * x) / WIDTH
      const value = isText(x, y) ? paper * 0.3 : paper
      const offset = (y * WIDTH + x) * 4
      data[offset] = value
      data[offset + 1] = value
      data[offset + 2] = value
      data[offset + 3] = 255
    }
  }

  return { data, width: WIDTH, height: HEIGHT }
}

function samples(image: Raster, wanted: 'text' | 'papier'): number[] {
  const values: number[] = []
  for (let y = 2; y < HEIGHT - 2; y += 3) {
    for (let x = 2; x < WIDTH - 2; x += 3) {
      // Der Rand einer Textzeile liegt zwischen beiden Welten – dort wird
      // nichts gemessen, sonst prüft der Test die Kantenglättung.
      const text = isText(x, y)
      const onEdge = [-2, 2].some((offset) => isText(x + offset, y) !== text || isText(x, y + offset) !== text)
      if (onEdge || text !== (wanted === 'text')) continue
      values.push(image.data[(y * WIDTH + x) * 4] as number)
    }
  }
  return values
}

describe('enhance', () => {
  it('gleicht den Helligkeitsverlauf aus, statt nur den Kontrast zu drehen', () => {
    // Der eigentliche Punkt der ganzen Übung: Nach der Aufbereitung ist das
    // Papier überall weiss – auch in der Ecke, die auf dem Foto grau war.
    // Ein Kontrastregler kann das nicht, er kennt nur einen Wert fürs ganze
    // Bild und würde die dunkle Ecke schwarz und die helle weiss machen.
    const result = enhance(litSheet(), 'grau')

    const paper = samples(result, 'papier')
    const text = samples(result, 'text')
    assert.ok(paper.length > 100 && text.length > 20, 'zu wenige Messpunkte')

    assert.ok(
      Math.min(...paper) >= 225,
      `Das dunkelste Papier ist ${Math.min(...paper)} statt nahezu weiss`,
    )
    assert.ok(
      Math.max(...text) <= 120,
      `Die hellste Schrift ist ${Math.max(...text)} statt deutlich dunkel`,
    )
  })

  it('macht aus Graustufen wirklich Graustufen', () => {
    const result = enhance(litSheet(), 'grau')
    const offset = (25 * WIDTH + 170) * 4

    assert.equal(result.data[offset], result.data[offset + 1])
    assert.equal(result.data[offset + 1], result.data[offset + 2])
  })

  it('behält Farben, statt sie auszubleichen', () => {
    // Der rote Briefkopf einer Rechnung soll rot bleiben. Ein Weissabgleich je
    // Farbkanal würde ihn grau rechnen – deshalb wirkt der Ausgleich auf allen
    // drei Kanälen gleich.
    const image = litSheet()
    for (let y = 10; y < 40; y += 1) {
      for (let x = 150; x < 190; x += 1) {
        const offset = (y * WIDTH + x) * 4
        image.data[offset] = 200
        image.data[offset + 1] = 40
        image.data[offset + 2] = 40
      }
    }

    const result = enhance(image, 'farbe')
    const offset = (25 * WIDTH + 170) * 4
    const red = result.data[offset] as number
    const green = result.data[offset + 1] as number

    assert.ok(red > green + 80, `Rot (${red}) hebt sich nicht mehr von Grün (${green}) ab`)
  })

  it('lässt Grösse und Deckkraft unangetastet', () => {
    const result = enhance(litSheet(), 'grau')
    assert.equal(result.width, WIDTH)
    assert.equal(result.height, HEIGHT)
    assert.equal(result.data[3], 255)
  })
})

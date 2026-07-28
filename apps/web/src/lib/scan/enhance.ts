/**
 * Aufbereitung: aus dem Foto wird etwas, das wie ein Scan aussieht.
 *
 * Der grösste Unterschied zwischen Handyfoto und Scanner ist nicht die
 * Auflösung, sondern das Licht. Auf dem Foto ist eine Ecke der Seite hell und
 * die gegenüberliegende grau, weil der eigene Kopf das Zimmerlicht abschattet.
 * Kein einfacher Kontrastregler bekommt das weg – er macht die helle Ecke
 * weiss und die dunkle schwarz.
 *
 * Deshalb wird zuerst der Helligkeitsverlauf geschätzt (grob, in Kacheln) und
 * herausgerechnet: Jeder Bildpunkt wird durch die Helligkeit des Papiers an
 * genau seiner Stelle geteilt. Danach ist das Blatt gleichmässig weiss, und
 * erst dann lohnt sich der Kontrast.
 */
import type { Raster } from './geometry.ts'

export const SCAN_FILTERS = ['farbe', 'grau', 'sw'] as const
export type ScanFilter = (typeof SCAN_FILTERS)[number]

export const SCAN_FILTER_LABELS: Record<ScanFilter, string> = {
  farbe: 'Farbe',
  grau: 'Graustufen',
  sw: 'Schwarz-Weiss',
}

/** Kachelgrösse für die Helligkeitsschätzung, in Bildpunkten. */
const TILE_TARGET = 24

/**
 * Welcher Helligkeitswert einer Kachel als „Papier" gilt.
 *
 * Nicht der Mittelwert: In einer Kachel voller Text zöge die Schrift ihn nach
 * unten, das Papier würde beim Teilen überstrahlt und die Schrift mit ihm.
 * Nicht das Maximum: Ein einzelner Glanzpunkt oder ein Ausreisser im Rauschen
 * bestimmte sonst die ganze Kachel. Das obere Achtel trifft beides nicht.
 */
const PAPER_PERCENTILE = 0.875

interface Grid {
  values: Float32Array
  columns: number
  rows: number
}

/** Schätzt je Kachel die Helligkeit des unbedruckten Papiers. */
function paperBrightness(gray: Uint8Array, width: number, height: number): Grid {
  const tile = Math.max(8, Math.ceil(Math.max(width, height) / TILE_TARGET))
  const columns = Math.max(1, Math.ceil(width / tile))
  const rows = Math.max(1, Math.ceil(height / tile))
  const values = new Float32Array(columns * rows)
  const histogram = new Uint32Array(256)

  for (let row = 0; row < rows; row += 1) {
    const fromY = row * tile
    const toY = Math.min(height, fromY + tile)

    for (let column = 0; column < columns; column += 1) {
      const fromX = column * tile
      const toX = Math.min(width, fromX + tile)

      histogram.fill(0)
      let count = 0
      for (let y = fromY; y < toY; y += 1) {
        const offset = y * width
        for (let x = fromX; x < toX; x += 1) {
          const value = gray[offset + x] as number
          histogram[value] = (histogram[value] as number) + 1
          count += 1
        }
      }

      let seen = 0
      let level = 255
      const wanted = Math.max(1, Math.round(count * PAPER_PERCENTILE))
      for (let value = 0; value < 256; value += 1) {
        seen += histogram[value] as number
        if (seen >= wanted) {
          level = value
          break
        }
      }

      values[row * columns + column] = level
    }
  }

  return smoothGrid({ values, columns, rows })
}

/**
 * Glättet das Kachelraster.
 *
 * Ohne diesen Schritt zeichnen sich die Kacheln im Ergebnis als Karomuster ab:
 * Eine Kachel, die zufällig ganz auf einem schwarzen Balken liegt, meldet eine
 * viel zu dunkle Papierhelligkeit. Der Mittelwert mit den Nachbarn fängt das ab.
 */
function smoothGrid(grid: Grid): Grid {
  const { columns, rows } = grid
  const smoothed = new Float32Array(columns * rows)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const y = row + dy
        if (y < 0 || y >= rows) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = column + dx
          if (x < 0 || x >= columns) continue
          sum += grid.values[y * columns + x] as number
          count += 1
        }
      }
      smoothed[row * columns + column] = sum / count
    }
  }

  return { values: smoothed, columns, rows }
}

/** Liest das Kachelraster an einer Bildposition, bilinear zwischen den Kacheln. */
function sampleGrid(grid: Grid, x: number, y: number, width: number, height: number): number {
  const { values, columns, rows } = grid
  const gx = columns === 1 ? 0 : Math.min(columns - 1, Math.max(0, (x / width) * columns - 0.5))
  const gy = rows === 1 ? 0 : Math.min(rows - 1, Math.max(0, (y / height) * rows - 0.5))

  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(x0 + 1, columns - 1)
  const y1 = Math.min(y0 + 1, rows - 1)
  const fx = gx - x0
  const fy = gy - y0

  const topLeft = values[y0 * columns + x0] as number
  const topRight = values[y0 * columns + x1] as number
  const bottomLeft = values[y1 * columns + x0] as number
  const bottomRight = values[y1 * columns + x1] as number

  const top = topLeft + (topRight - topLeft) * fx
  const bottom = bottomLeft + (bottomRight - bottomLeft) * fx
  return top + (bottom - top) * fy
}

/**
 * Grenzen für die Kontrastspreizung.
 *
 * Gesucht wird der Wert, unter dem nur noch ein Prozent der Bildpunkte liegen –
 * das ist die Schrift. Er wird auf Schwarz gezogen, das Papier auf Weiss.
 * Die Deckelung bei 150 verhindert den Unfall bei einer fast leeren Seite:
 * Dort läge das untere Prozent selbst noch im hellen Grau, und das Blatt
 * würde ohne sie zur schmutzigen Fläche gespreizt.
 */
function contrastRange(values: Uint8Array): { low: number; high: number } {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number
    histogram[value] = (histogram[value] as number) + 1
  }

  const total = values.length
  const lowTarget = total * 0.01
  const highTarget = total * 0.995

  let seen = 0
  let low = 0
  let high = 255
  for (let value = 0; value < 256; value += 1) {
    const before = seen
    seen += histogram[value] as number
    if (before < lowTarget && seen >= lowTarget) low = value
    if (before < highTarget && seen >= highTarget) {
      high = value
      break
    }
  }

  return { low: Math.min(low, 150), high: Math.max(high, Math.min(low, 150) + 24) }
}

function stretch(value: number, low: number, high: number): number {
  return ((value - low) * 255) / (high - low)
}

/**
 * Bereitet ein entzerrtes Bild auf und gibt ein neues Raster zurück.
 *
 * Die Rechnung läuft im Haupt-Thread und braucht auf einem Handy für ein
 * Bild in Scangrösse einige hundert Millisekunden. Der Aufrufer zeigt so
 * lange einen Hinweis – ein Worker wäre die sauberere Bühne, aber er müsste
 * dieselben Bilddaten hin und zurück reichen.
 */
export function enhance(image: Raster, filter: ScanFilter): Raster {
  const { width, height } = image
  const source = image.data
  const pixels = width * height

  const gray = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 4
    gray[i] = Math.round(
      0.299 * (source[offset] as number) +
        0.587 * (source[offset + 1] as number) +
        0.114 * (source[offset + 2] as number),
    )
  }

  const brightness = paperBrightness(gray, width, height)

  // Erst das Licht herausrechnen, dann die Grenzen für den Kontrast bestimmen:
  // Auf den Rohwerten gemessen, beschriebe die Spanne vor allem den
  // Helligkeitsverlauf und nicht den Unterschied zwischen Schrift und Papier.
  const corrected = new Uint8Array(pixels)
  const gains = new Float32Array(pixels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const paper = Math.max(24, sampleGrid(brightness, x + 0.5, y + 0.5, width, height))
      const gain = 255 / paper
      gains[index] = gain
      const value = (gray[index] as number) * gain
      corrected[index] = value > 255 ? 255 : value
    }
  }

  const { low, high } = contrastRange(corrected)

  const output = new Uint8ClampedArray(pixels * 4)

  if (filter === 'sw') {
    // Schwellwert in der Mitte der gespreizten Spanne, mit einem schmalen
    // Übergang: Ein harter Schnitt lässt dünne Linien und kleine Schrift
    // ausfransen, und genau die soll die Texterkennung noch lesen können.
    const middle = 128
    const ramp = 16
    for (let i = 0; i < pixels; i += 1) {
      const value = stretch(corrected[i] as number, low, high)
      const blended =
        value <= middle - ramp
          ? 0
          : value >= middle + ramp
            ? 255
            : ((value - (middle - ramp)) / (2 * ramp)) * 255
      const offset = i * 4
      output[offset] = blended
      output[offset + 1] = blended
      output[offset + 2] = blended
      output[offset + 3] = 255
    }
    return { data: output, width, height }
  }

  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 4

    if (filter === 'grau') {
      const value = stretch(corrected[i] as number, low, high)
      output[offset] = value
      output[offset + 1] = value
      output[offset + 2] = value
      output[offset + 3] = 255
      continue
    }

    // Farbe: derselbe Helligkeitsausgleich auf allen drei Kanälen. Kanalweise
    // gerechnet, wäre es zugleich ein Weissabgleich – der aber jeden farbigen
    // Briefkopf ausbleichen würde.
    const gain = gains[i] as number
    output[offset] = stretch((source[offset] as number) * gain, low, high)
    output[offset + 1] = stretch((source[offset + 1] as number) * gain, low, high)
    output[offset + 2] = stretch((source[offset + 2] as number) * gain, low, high)
    output[offset + 3] = 255
  }

  return { data: output, width, height }
}

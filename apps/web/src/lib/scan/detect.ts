/**
 * Automatische Randerkennung: Wo liegt auf dem Foto das Blatt Papier?
 *
 * Der Weg dorthin in vier Schritten:
 *
 *   1. Graustufen und Otsu-Schwelle – trennt das Bild in „hell" und „dunkel"
 *   2. Zusammenhängende Fläche in der Bildmitte – dort hält man das Dokument
 *   3. Konvexe Hülle ihrer Randpunkte, ausgedünnt
 *   4. Zurückführen auf vier Ecken und auf Plausibilität prüfen
 *
 * Beide Helligkeitsrichtungen werden versucht: helles Papier auf dunklem Tisch
 * ist der Normalfall, der dunkle Prospekt auf der hellen Küchenablage kommt
 * aber oft genug vor, dass er nicht durchfallen darf.
 *
 * Das Ergebnis ist ein Vorschlag, kein Urteil – die Ecken lassen sich in der
 * Vorschau von Hand verschieben. Deshalb darf die Erkennung auch aufgeben und
 * null zurückgeben, statt zu raten.
 */
import {
  convexHull,
  isPlausibleQuad,
  pruneCollinear,
  reduceToQuad,
  type Quad,
  type Raster,
} from './geometry.ts'

/**
 * Kantenlänge, auf die das Bild vor der Erkennung verkleinert wird.
 *
 * Auf 480 Bildpunkten ist eine A4-Seite immer noch über hundert Punkte breit –
 * mehr als genug, um ihre Kanten zu finden. Auf dem vollen 12-Megapixel-Foto
 * würde dieselbe Rechnung ein Vielfaches dauern, ohne die Ecken nennenswert
 * genauer zu treffen.
 */
export const DETECT_EDGE = 480

/** Otsu: die Schwelle, die helle und dunkle Bildpunkte am besten trennt. */
export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0)
  for (let i = 0; i < gray.length; i += 1) {
    const value = gray[i] as number
    histogram[value] = (histogram[value] as number) + 1
  }

  const total = gray.length
  if (total === 0) return 128

  let sum = 0
  for (let value = 0; value < 256; value += 1) sum += value * (histogram[value] as number)

  let backgroundWeight = 0
  let backgroundSum = 0
  let best = 128
  let bestVariance = -1

  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value] as number
    if (backgroundWeight === 0) continue

    const foregroundWeight = total - backgroundWeight
    if (foregroundWeight === 0) break

    backgroundSum += value * (histogram[value] as number)
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (sum - backgroundSum) / foregroundWeight
    const between =
      backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2

    if (between > bestVariance) {
      bestVariance = between
      best = value
    }
  }

  return best
}

/** Wahrgenommene Helligkeit je Bildpunkt. */
export function toGrayscale(image: Raster): Uint8Array {
  const gray = new Uint8Array(image.width * image.height)
  const data = image.data
  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4
    gray[i] = Math.round(
      0.299 * (data[offset] as number) +
        0.587 * (data[offset + 1] as number) +
        0.114 * (data[offset + 2] as number),
    )
  }
  return gray
}

interface Region {
  /** Je Zeile der kleinste und grösste x-Wert der Fläche, oder -1. */
  extremes: Int32Array
  size: number
}

/**
 * Die zusammenhängende Fläche, die den Startpunkt enthält.
 *
 * Gespeichert wird nicht die Fläche selbst, sondern je Bildzeile ihr linker
 * und rechter Rand. Für die konvexe Hülle genügt das vollständig – sie kann
 * nur durch Randpunkte verlaufen – und aus Hunderttausenden Bildpunkten
 * werden ein paar hundert Koordinaten.
 */
function floodFill(
  mask: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
): Region | null {
  const start = startY * width + startX
  if (mask[start] !== 1) return null

  const extremes = new Int32Array(height * 2).fill(-1)
  const visited = new Uint8Array(width * height)
  const stack: number[] = [start]
  visited[start] = 1
  let size = 0

  while (stack.length > 0) {
    const index = stack.pop() as number
    const x = index % width
    const y = (index - x) / width

    size += 1
    const left = extremes[y * 2] as number
    const right = extremes[y * 2 + 1] as number
    if (left === -1 || x < left) extremes[y * 2] = x
    if (right === -1 || x > right) extremes[y * 2 + 1] = x

    if (x > 0 && mask[index - 1] === 1 && visited[index - 1] === 0) {
      visited[index - 1] = 1
      stack.push(index - 1)
    }
    if (x < width - 1 && mask[index + 1] === 1 && visited[index + 1] === 0) {
      visited[index + 1] = 1
      stack.push(index + 1)
    }
    if (y > 0 && mask[index - width] === 1 && visited[index - width] === 0) {
      visited[index - width] = 1
      stack.push(index - width)
    }
    if (y < height - 1 && mask[index + width] === 1 && visited[index + width] === 0) {
      visited[index + width] = 1
      stack.push(index + width)
    }
  }

  return { extremes, size }
}

/**
 * Sucht die Fläche, auf der das Dokument liegt.
 *
 * Der Startpunkt ist die Bildmitte: Wer ein Dokument fotografiert, hält es in
 * die Mitte des Suchers. Trifft die Mitte nicht, wird ringförmig weiter aussen
 * weitergesucht – bei einem Beleg mit grossem Loch im Kontrast rettet das die
 * Erkennung.
 */
function regionAroundCenter(
  mask: Uint8Array,
  width: number,
  height: number,
): Region | null {
  const centerX = Math.floor(width / 2)
  const centerY = Math.floor(height / 2)
  const steps = [0, 0.08, 0.16, 0.24]

  for (const step of steps) {
    const offsetX = Math.round(width * step)
    const offsetY = Math.round(height * step)
    const candidates: Array<[number, number]> =
      step === 0
        ? [[centerX, centerY]]
        : [
            [centerX - offsetX, centerY],
            [centerX + offsetX, centerY],
            [centerX, centerY - offsetY],
            [centerX, centerY + offsetY],
          ]

    for (const [x, y] of candidates) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const region = floodFill(mask, width, height, x, y)
      if (region) return region
    }
  }

  return null
}

function quadFromRegion(region: Region, width: number, height: number): Quad | null {
  const points: Array<{ x: number; y: number }> = []
  for (let y = 0; y < height; y += 1) {
    const left = region.extremes[y * 2] as number
    const right = region.extremes[y * 2 + 1] as number
    if (left === -1) continue
    points.push({ x: left, y })
    if (right !== left) points.push({ x: right, y })
  }

  if (points.length < 4) return null

  const diagonal = Math.hypot(width, height)
  const hull = convexHull(points)
  const pruned = pruneCollinear(hull, diagonal * 0.012)
  const quad = reduceToQuad(pruned, diagonal * 0.35)

  return quad && isPlausibleQuad(quad, width, height) ? quad : null
}

/**
 * Findet die Ecken der Seite im übergebenen (verkleinerten) Bild.
 *
 * Koordinaten beziehen sich auf dieses Bild; für das Original müssen sie mit
 * scaleQuad hochgerechnet werden.
 */
export function detectPageQuad(image: Raster): Quad | null {
  const { width, height } = image
  if (width < 16 || height < 16) return null

  const gray = toGrayscale(image)
  const threshold = otsuThreshold(gray)
  const total = width * height
  const mask = new Uint8Array(total)

  let best: Quad | null = null
  let bestSize = 0

  for (const bright of [true, false]) {
    for (let i = 0; i < total; i += 1) {
      const value = gray[i] as number
      mask[i] = (bright ? value > threshold : value <= threshold) ? 1 : 0
    }

    const region = regionAroundCenter(mask, width, height)
    if (!region) continue

    // Füllt die Fläche fast das ganze Bild, war der Untergrund genauso hell
    // wie das Papier – dann ist der gefundene Rand der Bildrand und sagt
    // nichts über die Seite aus.
    if (region.size > total * 0.94) continue
    if (region.size <= bestSize) continue

    const quad = quadFromRegion(region, width, height)
    if (quad) {
      best = quad
      bestSize = region.size
    }
  }

  return best
}

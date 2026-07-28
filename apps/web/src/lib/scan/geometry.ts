/**
 * Geometrie des Dokumentenscanners: Ecken finden, ordnen, entzerren.
 *
 * Bewusst ohne Bibliothek. Eine Bildverarbeitungs-Bibliothek wie OpenCV.js
 * wiegt mehrere Megabyte – das ist mehr als die ganze App und würde den ersten
 * Aufruf über Mobilfunk spürbar verlangsamen. Gebraucht wird davon hier nur
 * ein knappes Dutzend Formeln.
 *
 * Alle Funktionen sind rein und rechnen in Bildpunkten des Ausgangsbildes.
 * Die Module in diesem Ordner importieren einander mit `.ts`-Endung, damit
 * `node --test` sie ohne Bündler direkt ausführen kann.
 */

export interface Point {
  x: number
  y: number
}

/** Die vier Ecken einer Seite, im Uhrzeigersinn ab oben links. */
export type Quad = [Point, Point, Point, Point]

/**
 * Ein Bild als reine Daten – strukturgleich zu `ImageData`, aber ohne DOM.
 *
 * Damit laufen Erkennung, Entzerrung und Aufbereitung im Test unter Node,
 * wo es kein `ImageData` gibt. Im Browser lässt sich ein echtes `ImageData`
 * ohne Umweg übergeben.
 */
export interface Raster {
  // Der Puffer ist festgelegt (kein SharedArrayBuffer) – nur so nimmt der
  // Browser die Daten am Ende ohne Umkopieren als ImageData entgegen.
  data: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Fläche eines einfachen Polygons (Gauss'sche Trapezformel), immer positiv. */
export function polygonArea(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i] as Point
    const next = points[(i + 1) % points.length] as Point
    sum += current.x * next.y - next.x * current.y
  }
  return Math.abs(sum) / 2
}

/**
 * Konvexe Hülle nach Andrew's monotone chain.
 *
 * Die Randpunkte einer erkannten Fläche sind ausgefranst; die Hülle glättet
 * das auf einen Umriss, der die vier Seitenkanten enthält.
 */
export function convexHull(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points]

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const build = (input: readonly Point[]): Point[] => {
    const chain: Point[] = []
    for (const point of input) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2] as Point, chain[chain.length - 1] as Point, point) <= 0
      ) {
        chain.pop()
      }
      chain.push(point)
    }
    chain.pop()
    return chain
  }

  const hull = [...build(sorted), ...build([...sorted].reverse())]
  return hull.length >= 3 ? hull : [...points]
}

/** Abstand eines Punktes zur Geraden durch a und b. */
export function pointLineDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return distance(point, a)
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length
}

/**
 * Entfernt Ecken, die praktisch auf der Verbindung ihrer Nachbarn liegen.
 *
 * Eine fotografierte Kante ist nie eine gerade Linie, sondern eine Treppe aus
 * Bildpunkten. Ohne dieses Ausdünnen bestünde die Hülle einer A4-Seite aus
 * Hunderten Ecken, und die Suche nach den vier echten würde an der Treppe
 * hängenbleiben statt an den Kanten.
 */
export function pruneCollinear(polygon: readonly Point[], tolerance: number): Point[] {
  const result = [...polygon]

  while (result.length > 4) {
    let flattest = -1
    let flattestDistance = Infinity

    for (let i = 0; i < result.length; i += 1) {
      const previous = result[(i - 1 + result.length) % result.length] as Point
      const next = result[(i + 1) % result.length] as Point
      const deviation = pointLineDistance(result[i] as Point, previous, next)
      if (deviation < flattestDistance) {
        flattestDistance = deviation
        flattest = i
      }
    }

    if (flattest === -1 || flattestDistance > tolerance) break
    result.splice(flattest, 1)
  }

  return result
}

/** Schnittpunkt der Geraden durch a–b und c–d, oder null bei Parallelität. */
export function lineIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const cdx = d.x - c.x
  const cdy = d.y - c.y

  const denominator = abx * cdy - aby * cdx
  if (Math.abs(denominator) < 1e-9) return null

  const t = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / denominator
  return { x: a.x + t * abx, y: a.y + t * aby }
}

/**
 * Führt ein Vieleck auf vier Ecken zurück.
 *
 * Es wird immer die kürzeste Kante aufgelöst: Ihre beiden Endpunkte weichen
 * dem Schnittpunkt der benachbarten Kanten. Bei einer abgerundeten oder
 * eingerissenen Papierecke ist genau diese kurze Kante die Störung, und die
 * beiden langen Nachbarkanten treffen sich dort, wo die Ecke ohne Beschädigung
 * läge.
 *
 * `maxDrift` begrenzt, wie weit dieser Schnittpunkt von der aufgelösten Kante
 * entfernt liegen darf. Zwei fast parallele Kanten schneiden sich weit
 * ausserhalb des Bildes – dort gehört keine Ecke hin, dann bleibt es beim
 * Mittelpunkt der Kante.
 */
export function reduceToQuad(polygon: readonly Point[], maxDrift: number): Quad | null {
  if (polygon.length < 4) return null

  let current = [...polygon]

  while (current.length > 4) {
    const count = current.length
    let shortest = 0
    let shortestLength = Infinity

    for (let i = 0; i < count; i += 1) {
      const length = distance(current[i] as Point, current[(i + 1) % count] as Point)
      if (length < shortestLength) {
        shortestLength = length
        shortest = i
      }
    }

    const before = current[(shortest - 1 + count) % count] as Point
    const from = current[shortest] as Point
    const to = current[(shortest + 1) % count] as Point
    const after = current[(shortest + 2) % count] as Point

    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
    const crossing = lineIntersection(before, from, to, after)
    const corner = crossing && distance(crossing, middle) <= maxDrift ? crossing : middle

    const dropped = (shortest + 1) % count
    const next: Point[] = []
    for (let i = 0; i < count; i += 1) {
      if (i === shortest) next.push(corner)
      else if (i !== dropped) next.push(current[i] as Point)
    }
    current = next
  }

  return orderCorners(current)
}

/**
 * Bringt vier Punkte in die Reihenfolge oben links → oben rechts → unten
 * rechts → unten links.
 *
 * Ohne feste Reihenfolge wäre das entzerrte Bild je nach Erkennung gedreht
 * oder gespiegelt.
 */
export function orderCorners(points: readonly Point[]): Quad | null {
  if (points.length !== 4) return null

  const centerX = points.reduce((sum, point) => sum + point.x, 0) / 4
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / 4

  // Bildkoordinaten zeigen nach unten – aufsteigender Winkel läuft daher im
  // Uhrzeigersinn, wie es die Reihenfolge verlangt.
  const clockwise = [...points].sort(
    (a, b) => Math.atan2(a.y - centerY, a.x - centerX) - Math.atan2(b.y - centerY, b.x - centerX),
  )

  let topLeft = 0
  for (let i = 1; i < 4; i += 1) {
    const candidate = clockwise[i] as Point
    const best = clockwise[topLeft] as Point
    if (candidate.x + candidate.y < best.x + best.y) topLeft = i
  }

  return [
    clockwise[topLeft] as Point,
    clockwise[(topLeft + 1) % 4] as Point,
    clockwise[(topLeft + 2) % 4] as Point,
    clockwise[(topLeft + 3) % 4] as Point,
  ]
}

/**
 * Prüft, ob ein Viereck als Seite durchgehen kann.
 *
 * Lieber gar keine Erkennung als eine falsche: Ein unplausibles Viereck
 * verwirft der Aufrufer und zeigt stattdessen den vollen Bildausschnitt, den
 * man von Hand anpassen kann.
 */
export function isPlausibleQuad(quad: Quad, width: number, height: number): boolean {
  if (quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false

  // Deutlich kleiner als ein Zwölftel des Bildes ist eher ein Fleck auf dem
  // Tisch als eine Seite.
  if (polygonArea(quad) < 0.08 * width * height) return false

  const shortestSide = Math.min(
    ...quad.map((point, index) => distance(point, quad[(index + 1) % 4] as Point)),
  )
  if (shortestSide < 0.1 * Math.min(width, height)) return false

  let sign = 0
  for (let i = 0; i < 4; i += 1) {
    const previous = quad[(i + 3) % 4] as Point
    const corner = quad[i] as Point
    const next = quad[(i + 1) % 4] as Point

    const ax = corner.x - previous.x
    const ay = corner.y - previous.y
    const bx = next.x - corner.x
    const by = next.y - corner.y

    // Konvex: alle Kreuzprodukte zeigen in dieselbe Richtung.
    const cross = ax * by - ay * bx
    if (cross === 0) return false
    const currentSign = Math.sign(cross)
    if (sign === 0) sign = currentSign
    else if (currentSign !== sign) return false

    // Perspektive verzerrt rechte Winkel, aber nicht beliebig weit. Was
    // deutlich spitzer als 45° ist, war nie ein Blatt Papier.
    const angle = Math.abs(
      Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * (180 / Math.PI),
    )
    if (angle < 40 || angle > 140) return false
  }

  return true
}

/** Der volle Bildausschnitt, leicht eingerückt – der Rückfall ohne Erkennung. */
export function fullFrameQuad(width: number, height: number, inset = 0.04): Quad {
  const x = width * inset
  const y = height * inset
  return [
    { x, y },
    { x: width - x, y },
    { x: width - x, y: height - y },
    { x, y: height - y },
  ]
}

/**
 * Grösse des entzerrten Bildes.
 *
 * Aus den beiden gegenüberliegenden Kantenpaaren wird jeweils die längere
 * genommen: Die weiter entfernte Kante ist perspektivisch gestaucht, und
 * herunterrechnen kostet Schärfe, hochrechnen bringt keine zurück.
 */
export function outputSize(quad: Quad, maxEdge: number): { width: number; height: number } {
  const top = distance(quad[0], quad[1])
  const bottom = distance(quad[3], quad[2])
  const left = distance(quad[0], quad[3])
  const right = distance(quad[1], quad[2])

  const width = Math.max(top, bottom)
  const height = Math.max(left, right)
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1))

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Projektive Abbildung, die `from` auf `to` legt – acht Unbekannte aus vier
 * Punktpaaren, gelöst per Gauss-Elimination mit Spaltenpivotierung.
 *
 * Zurück kommen neun Werte (die neunte ist fest 1), zeilenweise gelesen.
 */
export function solveHomography(from: Quad, to: Quad): number[] | null {
  const matrix: number[][] = []

  for (let i = 0; i < 4; i += 1) {
    const source = from[i] as Point
    const target = to[i] as Point
    matrix.push([
      source.x, source.y, 1, 0, 0, 0,
      -target.x * source.x, -target.x * source.y, target.x,
    ])
    matrix.push([
      0, 0, 0, source.x, source.y, 1,
      -target.y * source.x, -target.y * source.y, target.y,
    ])
  }

  for (let column = 0; column < 8; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs((matrix[row] as number[])[column] as number) >
          Math.abs((matrix[pivot] as number[])[column] as number)) {
        pivot = row
      }
    }

    const pivotRow = matrix[pivot] as number[]
    const pivotValue = pivotRow[column] as number
    // Entartete Lage – etwa drei Ecken auf einer Geraden. Dafür gibt es keine
    // eindeutige Abbildung, und ein Ergebnis mit Unendlich darin wäre schlimmer
    // als keines.
    if (Math.abs(pivotValue) < 1e-10) return null

    matrix[pivot] = matrix[column] as number[]
    matrix[column] = pivotRow

    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue
      const target = matrix[row] as number[]
      const factor = (target[column] as number) / pivotValue
      if (factor === 0) continue
      for (let k = column; k < 9; k += 1) {
        target[k] = (target[k] as number) - factor * (pivotRow[k] as number)
      }
    }
  }

  const solution: number[] = []
  for (let row = 0; row < 8; row += 1) {
    const line = matrix[row] as number[]
    solution.push((line[8] as number) / (line[row] as number))
  }
  solution.push(1)

  return solution.every((value) => Number.isFinite(value)) ? solution : null
}

/** Wendet eine mit solveHomography gefundene Abbildung auf einen Punkt an. */
export function applyHomography(homography: readonly number[], point: Point): Point {
  const denominator =
    (homography[6] as number) * point.x + (homography[7] as number) * point.y + 1
  return {
    x:
      ((homography[0] as number) * point.x +
        (homography[1] as number) * point.y +
        (homography[2] as number)) /
      denominator,
    y:
      ((homography[3] as number) * point.x +
        (homography[4] as number) * point.y +
        (homography[5] as number)) /
      denominator,
  }
}

/** Rechnet ein Viereck von einer Bildgrösse auf eine andere um. */
export function scaleQuad(quad: Quad, factorX: number, factorY: number): Quad {
  const scale = (point: Point): Point => ({ x: point.x * factorX, y: point.y * factorY })
  return [scale(quad[0]), scale(quad[1]), scale(quad[2]), scale(quad[3])]
}

/**
 * Der nachträgliche Beschnitt – als reine Rechnung, ohne Browser.
 *
 * Anders als beim Scannen geht es hier nicht um vier frei stehende Ecken,
 * sondern um ein achsenparalleles Rechteck. Das ist kein Rückschritt, sondern
 * die andere Frage: Beim Scannen liegt ein schiefes Blatt im Bild und muss
 * geradegezogen werden; hier ist das Bild bereits gerade und hat nur zu viel
 * Rand – eine Fusszeile, ein Stück Tisch, der Daumen am unteren Bildrand.
 *
 * Gerechnet wird in Anteilen von 0 bis 1 und nicht in Bildpunkten. Damit gilt
 * derselbe Ausschnitt für die Vorschau auf dem Bildschirm, für das Original in
 * voller Auflösung und – bei einem mehrseitigen PDF – für jede weitere Seite,
 * ohne dass irgendwo eine Umrechnung mitgeführt werden muss.
 */

export interface CropRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Der ganze Ausschnitt – der Anfangszustand, bevor jemand zieht. */
export const FULL_CROP: CropRect = { left: 0, top: 0, right: 1, bottom: 1 }

/**
 * Wie klein ein Ausschnitt höchstens werden darf, je Kante.
 *
 * Fünf Prozent sind bei einer A4-Seite gut ein Zentimeter. Weniger ist kein
 * Beschnitt mehr, sondern ein Versehen – und ein Rechteck, das auf null
 * zusammenfällt, liesse sich mit dem Finger nicht wieder aufziehen.
 */
export const MIN_CROP_SIDE = 0.05

export const CROP_CORNERS = ['nw', 'ne', 'se', 'sw'] as const
export type CropCorner = (typeof CROP_CORNERS)[number]

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function isFullCrop(rect: CropRect): boolean {
  return (
    rect.left === 0 && rect.top === 0 && rect.right === 1 && rect.bottom === 1
  )
}

/** Die Lage einer Ecke in Anteilen – für die Griffe und fürs Anfassen. */
export function cornerPoint(rect: CropRect, corner: CropCorner): { x: number; y: number } {
  return {
    x: corner === 'nw' || corner === 'sw' ? rect.left : rect.right,
    y: corner === 'nw' || corner === 'ne' ? rect.top : rect.bottom,
  }
}

/**
 * Verschiebt eine Ecke, ohne dass das Rechteck sich selbst überholt.
 *
 * Die gegenüberliegende Kante bleibt stehen und begrenzt die gezogene: Wer die
 * obere Kante über die untere hinauszieht, bekommt kein umgestülptes Rechteck,
 * sondern eines von der Mindesthöhe. Ein umgestülptes wäre beim Zuschneiden
 * ein leeres Bild – und der Fehler fiele erst danach auf.
 */
export function moveCorner(
  rect: CropRect,
  corner: CropCorner,
  x: number,
  y: number,
): CropRect {
  const next = { ...rect }
  const px = clamp01(x)
  const py = clamp01(y)

  if (corner === 'nw' || corner === 'sw') next.left = Math.min(px, rect.right - MIN_CROP_SIDE)
  else next.right = Math.max(px, rect.left + MIN_CROP_SIDE)

  if (corner === 'nw' || corner === 'ne') next.top = Math.min(py, rect.bottom - MIN_CROP_SIDE)
  else next.bottom = Math.max(py, rect.top + MIN_CROP_SIDE)

  return next
}

/**
 * Verschiebt den ganzen Ausschnitt. Stösst er an den Bildrand, bleibt er
 * dort stehen und wird nicht kleiner – ein Rechteck, das beim Verschieben
 * schrumpft, macht den mühsam gesetzten Beschnitt wieder kaputt.
 */
export function moveCrop(rect: CropRect, dx: number, dy: number): CropRect {
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  const left = Math.min(Math.max(rect.left + dx, 0), 1 - width)
  const top = Math.min(Math.max(rect.top + dy, 0), 1 - height)

  return { left, top, right: left + width, bottom: top + height }
}

/**
 * Die Ecke, die dieser Berührung am nächsten liegt – oder null, wenn keine
 * nah genug ist. Dann ist die Berührung ein Verschieben und kein Ziehen.
 */
export function nearestCropCorner(
  rect: CropRect,
  x: number,
  y: number,
  radius: number,
): CropCorner | null {
  let best: CropCorner | null = null
  let bestDistance = radius

  for (const corner of CROP_CORNERS) {
    const point = cornerPoint(rect, corner)
    const distance = Math.hypot(point.x - x, point.y - y)
    if (distance <= bestDistance) {
      best = corner
      bestDistance = distance
    }
  }

  return best
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Rechnet den Ausschnitt auf ein Bild dieser Grösse um.
 *
 * Gerundet wird auf ganze Bildpunkte, und die Breite ist mindestens eins:
 * Ein Canvas der Breite null lässt sich nicht kodieren, und genau das käme
 * bei einem sehr schmalen Ausschnitt auf einem kleinen Bild heraus.
 */
export function cropPixels(rect: CropRect, width: number, height: number): PixelRect {
  const x = Math.round(clamp01(rect.left) * width)
  const y = Math.round(clamp01(rect.top) * height)

  return {
    x,
    y,
    width: Math.max(1, Math.round(clamp01(rect.right) * width) - x),
    height: Math.max(1, Math.round(clamp01(rect.bottom) * height) - y),
  }
}

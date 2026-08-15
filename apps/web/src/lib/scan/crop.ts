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
 *
 * Die eine Ausnahme ist das Anfassen: Wie nah ein Finger an einem Griff ist,
 * ist eine Frage in Bildschirmpunkten, nicht in Anteilen. Ein hochkantes Bild
 * ist doppelt so hoch wie breit – derselbe Anteil bedeutet auf den beiden
 * Achsen dann Verschiedenes, und Griffe, die sich „mal treffen lassen und mal
 * nicht", kommen genau daher. `nearestCropHandle` bekommt deshalb die
 * angezeigte Grösse mit.
 */

// Derselbe Punkt wie beim Scannen: Zwei Namen für {x, y} nebeneinander wären
// zwei Begriffe für dieselbe Sache.
import type { Point } from './geometry.ts'

export type { Point }

export interface Size {
  width: number
  height: number
}

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

/**
 * Acht Griffe: vier Ecken und vier Kanten.
 *
 * Die Kanten sind nicht Zierde. „Unten die Fusszeile weg" ist der häufigste
 * Beschnitt überhaupt, und mit blossen Ecken muss man ihn aus zwei Bewegungen
 * zusammensetzen, von denen jede die Breite versehentlich mitverändert.
 */
export const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type CropHandle = (typeof CROP_HANDLES)[number]

const AN_LINKS: readonly CropHandle[] = ['nw', 'w', 'sw']
const AN_RECHTS: readonly CropHandle[] = ['ne', 'e', 'se']
const AN_OBEN: readonly CropHandle[] = ['nw', 'n', 'ne']
const AN_UNTEN: readonly CropHandle[] = ['sw', 's', 'se']

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function isFullCrop(rect: CropRect): boolean {
  return rect.left === 0 && rect.top === 0 && rect.right === 1 && rect.bottom === 1
}

/** Liegt dieser Punkt im Ausschnitt? Dann heisst Ziehen „verschieben". */
export function containsPoint(rect: CropRect, point: Point): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  )
}

/**
 * Wo ein Griff sitzt, in Anteilen. Kantengriffe sitzen in der Mitte ihrer
 * Kante – dort, wo man sie sucht.
 */
export function handlePoint(rect: CropRect, handle: CropHandle): Point {
  const x = AN_LINKS.includes(handle)
    ? rect.left
    : AN_RECHTS.includes(handle)
      ? rect.right
      : (rect.left + rect.right) / 2

  const y = AN_OBEN.includes(handle)
    ? rect.top
    : AN_UNTEN.includes(handle)
      ? rect.bottom
      : (rect.top + rect.bottom) / 2

  return { x, y }
}

/**
 * Verschiebt einen Griff, ohne dass das Rechteck sich selbst überholt.
 *
 * Die gegenüberliegende Kante bleibt stehen und begrenzt die gezogene: Wer die
 * obere Kante über die untere hinauszieht, bekommt kein umgestülptes Rechteck,
 * sondern eines von der Mindesthöhe. Ein umgestülptes wäre beim Zuschneiden
 * ein leeres Bild – und der Fehler fiele erst danach auf.
 *
 * Ein Kantengriff rührt nur seine Kante an: Die Breite bleibt, wenn man unten
 * etwas wegnimmt.
 */
export function moveHandle(
  rect: CropRect,
  handle: CropHandle,
  x: number,
  y: number,
): CropRect {
  const next = { ...rect }
  const px = clamp01(x)
  const py = clamp01(y)

  if (AN_LINKS.includes(handle)) next.left = Math.min(px, rect.right - MIN_CROP_SIDE)
  else if (AN_RECHTS.includes(handle)) next.right = Math.max(px, rect.left + MIN_CROP_SIDE)

  if (AN_OBEN.includes(handle)) next.top = Math.min(py, rect.bottom - MIN_CROP_SIDE)
  else if (AN_UNTEN.includes(handle)) next.bottom = Math.max(py, rect.top + MIN_CROP_SIDE)

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
 * Der Griff, der dieser Berührung am nächsten liegt – oder null, wenn keiner
 * in Reichweite ist.
 *
 * Gemessen wird in Bildschirmpunkten: `point` ist in Anteilen, `size` die
 * angezeigte Grösse des Bildes, `radius` der Greifradius in Punkten. Erst
 * dadurch ist ein Griff auf einem hochkanten Bild waagrecht wie senkrecht
 * gleich gut zu treffen.
 *
 * `radius` darf Infinity sein – dann kommt immer ein Griff zurück. Das ist der
 * Fall „daneben getippt": Ausserhalb des Ausschnitts gibt es nichts anderes zu
 * tun, als die nächste Kante hierher zu ziehen, und ein Tippen, das gar nichts
 * bewirkt, fühlt sich kaputt an.
 */
export function nearestCropHandle(
  rect: CropRect,
  point: Point,
  size: Size,
  radius: number,
): CropHandle | null {
  let best: CropHandle | null = null
  let bestDistance = radius

  for (const handle of CROP_HANDLES) {
    const at = handlePoint(rect, handle)
    const distance = Math.hypot(
      (at.x - point.x) * size.width,
      (at.y - point.y) * size.height,
    )
    if (distance <= bestDistance) {
      best = handle
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

export interface Box extends Size {
  left: number
  top: number
}

/**
 * Wo ein Bild dieser Grösse in dieser Fläche zu liegen kommt – mittig, ganz
 * sichtbar, mit einem Rand ringsum.
 *
 * Ausgerechnet und nicht dem Browser überlassen, und das ist der Kern der
 * Sache: `max-height: 100%` an einem Bild taugt hier nicht, weil sein
 * Elternteil seine Höhe erst vom Bild bekommt – ein Zirkelschluss, den der
 * Browser auflöst, indem er die Begrenzung fallen lässt. Ein hochauflösendes
 * Foto stand danach in voller Grösse da, ragte unten aus der Fläche heraus und
 * legte sich über die Knöpfe, die man als Nächstes drücken wollte.
 *
 * Mit einer ausgerechneten Grösse hat die Anzeige dieselben Masse wie die
 * Bedienfläche darüber, und beide dieselben wie die Rechnung dahinter.
 *
 * Der Rand ist kein Zierstreifen: Auf ihm liegt die äussere Hälfte jedes
 * Griffs, der auf der Bildkante sitzt. Ohne ihn wäre eine Ecke nur von innen
 * zu fassen – auf dem Handy genau dort, wo das Wischen vom Rand die Bewegung
 * übernimmt, bevor die Seite sie zu sehen bekommt.
 */
export function fitInside(natural: Size, frame: Size, margin = 0): Box {
  const verfuegbar = {
    width: Math.max(1, frame.width - 2 * margin),
    height: Math.max(1, frame.height - 2 * margin),
  }

  const scale = Math.min(
    verfuegbar.width / Math.max(1, natural.width),
    verfuegbar.height / Math.max(1, natural.height),
  )

  const width = natural.width * scale
  const height = natural.height * scale

  return {
    left: (frame.width - width) / 2,
    top: (frame.height - height) / 2,
    width,
    height,
  }
}

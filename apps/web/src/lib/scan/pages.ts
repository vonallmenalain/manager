/**
 * Die Brücke zwischen Browser und Rechnung: Canvas, Blobs, Dateinamen.
 *
 * Alles, was hier steht, braucht ein DOM. Die eigentliche Bildverarbeitung
 * liegt bewusst daneben in reinen Modulen, damit sie ohne Browser prüfbar
 * bleibt.
 */
import { cropPixels, type CropRect } from './crop.ts'
import { DETECT_EDGE, detectPageQuad } from './detect.ts'
import { enhance, type ScanFilter } from './enhance.ts'
import {
  clampQuad,
  fullFrameQuad,
  outputSize,
  scaleQuad,
  type Quad,
  type Raster,
} from './geometry.ts'
import { buildPdfFromJpegs } from './pdf.ts'
import { warpToRect } from './warp.ts'

/**
 * Längste Kante einer fertigen Seite.
 *
 * 2000 Bildpunkte sind bei A4 gut 170 dpi – die Grenze, ab der Tesseract
 * zuverlässig liest, liegt bei etwa 150. Mehr würde die Datei vergrössern,
 * ohne dass mehr Text erkannt wird.
 */
const SCAN_MAX_EDGE = 2000

/** Fotos aus der Kamera-App bleiben etwas grösser – sie sind nicht beschnitten. */
const PHOTO_MAX_EDGE = 2400

/**
 * 0.82 ist der Punkt, an dem bei Text nichts Sichtbares mehr verlorengeht.
 * Darüber wächst nur die Datei, darunter fransen Buchstabenkanten aus.
 */
const JPEG_QUALITY = 0.82

export interface ScanPage {
  id: string
  blob: Blob
  /** blob:-Adresse für die Vorschau – muss beim Entfernen freigegeben werden. */
  url: string
}

/**
 * Ob der eingebaute Scanner überhaupt eine Chance hat.
 *
 * Fehlt getUserMedia, ist die Seite entweder nicht über HTTPS ausgeliefert
 * oder der Browser zu alt. Beides sagt nichts über die Kamera-App des Systems
 * aus – die bleibt der Rückweg.
 */
export function cameraAvailable(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

export function createPage(blob: Blob): ScanPage {
  return { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) }
}

/** Gibt die Vorschau-Adresse frei. Ohne das bleibt jede Seite bis zum Neuladen im Speicher. */
export function releasePage(page: ScanPage): void {
  URL.revokeObjectURL(page.url)
}

function context2d(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', options)
  if (!context) throw new Error('Die Bildverarbeitung ist in diesem Browser nicht verfügbar.')
  return context
}

/**
 * Lädt eine Datei als Bild und gibt sie nach Gebrauch wieder frei.
 *
 * Bewusst über ein <img> und nicht über createImageBitmap: Ein <img> dreht
 * das Bild von sich aus so, wie die Kamera es im EXIF vermerkt hat. Ohne das
 * läge jedes im Hochformat aufgenommene Foto quer – auf dem Bildschirm wie in
 * der Texterkennung.
 */
async function withImage<T>(
  source: Blob,
  use: (image: HTMLImageElement) => T | Promise<T>,
): Promise<T> {
  const url = URL.createObjectURL(source)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return await use(image)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Wie lange auf das Standbild gewartet wird, bevor das Live-Bild einspringt.
 *
 * Auf einem Gerät, das die Aufnahme sauber beantwortet, dauert sie einen
 * Bruchteil davon. Es gibt aber Kameras, die auf takePhoto gar nicht antworten –
 * und ein Auslöser, der nichts tut, ist das Schlimmste, was hier passieren kann.
 */
const PHOTO_TIMEOUT_MS = 5000

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), milliseconds)),
  ])
}

/**
 * Nimmt ein Standbild in der vollen Auflösung des Sensors auf.
 *
 * Das Live-Bild ist ein Videostrom, und ein Videostrom ist selten mehr als
 * 1920 Zeilen breit – bei einer A4-Seite, die zwei Drittel des Suchers füllt,
 * bleiben davon keine 150 dpi übrig, und genau dort wird die Texterkennung
 * unzuverlässig. `takePhoto` fragt stattdessen die Fotofunktion der Kamera an
 * und liefert, was sie hergibt: auf heutigen Geräten oft das Vierfache.
 *
 * Nicht jedes Gerät kann das. Deshalb gibt jeder Fehlschlag null zurück, und
 * der Aufrufer bleibt beim Bild aus dem Videostrom – lieber ein Scan mit
 * weniger Auflösung als ein Auslöser, der nichts tut.
 */
export async function capturePhoto(
  track: MediaStreamTrack,
  maxEdge: number,
  /** Unterhalb dieser Bildpunktzahl lohnt sich das Standbild nicht. */
  minPixels: number,
): Promise<HTMLCanvasElement | null> {
  // typeof auf einen unbekannten Namen ist erlaubt und wirft nicht – anders
  // als der Zugriff darauf.
  if (typeof ImageCapture !== 'function') return null

  let capture: ImageCapture
  try {
    capture = new ImageCapture(track)
  } catch {
    return null
  }

  let settings: PhotoSettings | undefined
  try {
    // Ohne Wunschgrösse liefert Chrome nicht zwingend die höchste Auflösung,
    // sondern eine, die zum Videostrom passt.
    const largest = (await capture.getPhotoCapabilities()).imageWidth?.max
    if (typeof largest === 'number' && largest > 0) settings = { imageWidth: largest }
  } catch {
    // Ohne Angaben über die Fotofunktion wird ohne Wunschgrösse ausgelöst.
  }

  let photo: Blob | null = null
  try {
    photo = await withTimeout(capture.takePhoto(settings), PHOTO_TIMEOUT_MS)
  } catch {
    // Manche Geräte lehnen die Wunschgrösse ab, lösen ohne sie aber aus.
    if (!settings) return null
    try {
      photo = await withTimeout(capture.takePhoto(), PHOTO_TIMEOUT_MS)
    } catch {
      return null
    }
  }

  if (!photo) return null

  try {
    return await withImage(photo, (image) => {
      const pixels = image.naturalWidth * image.naturalHeight
      // Kommt weniger heraus als das Live-Bild ohnehin liefert, war der
      // Umweg umsonst.
      if (pixels < minPixels) return null
      return drawToCanvas(image, image.naturalWidth, image.naturalHeight, maxEdge)
    })
  } catch {
    return null
  }
}

/** Zeichnet eine Bildquelle verkleinert auf einen neuen Canvas. */
export function drawToCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight, 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))

  const context = context2d(canvas, { willReadFrequently: true })
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Das Bild liess sich nicht sichern.'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Sucht die Ecken der Seite. Findet sie sich nicht, kommt der volle
 * Bildausschnitt zurück – von Hand verschieben lässt er sich ohnehin.
 */
export function findCorners(canvas: HTMLCanvasElement): Quad {
  const scale = Math.min(1, DETECT_EDGE / Math.max(canvas.width, canvas.height, 1))
  const small = document.createElement('canvas')
  small.width = Math.max(16, Math.round(canvas.width * scale))
  small.height = Math.max(16, Math.round(canvas.height * scale))

  const context = context2d(small, { willReadFrequently: true })
  context.drawImage(canvas, 0, 0, small.width, small.height)

  const quad = detectPageQuad(context.getImageData(0, 0, small.width, small.height))
  if (!quad) return fullFrameQuad(canvas.width, canvas.height)

  // Nochmals ins Bild geholt: Das Hochrechnen auf die volle Auflösung kann eine
  // Ecke, die am Rand des verkleinerten Bildes klebte, um Bruchteile eines
  // Bildpunktes darüber hinausschieben.
  return clampQuad(
    scaleQuad(quad, canvas.width / small.width, canvas.height / small.height),
    canvas.width,
    canvas.height,
  )
}

/** Entzerrt den gewählten Ausschnitt, bereitet ihn auf und gibt ein JPEG zurück. */
export async function renderScan(
  canvas: HTMLCanvasElement,
  quad: Quad,
  filter: ScanFilter,
): Promise<Blob> {
  const size = outputSize(quad, SCAN_MAX_EDGE)
  const context = context2d(canvas, { willReadFrequently: true })
  const source: Raster = context.getImageData(0, 0, canvas.width, canvas.height)

  const warped = warpToRect(source, quad, size.width, size.height)
  if (!warped) throw new Error('Die gewählten Ecken ergeben keine Seite.')

  const finished = enhance(warped, filter)

  const target = document.createElement('canvas')
  target.width = finished.width
  target.height = finished.height
  context2d(target).putImageData(
    new ImageData(finished.data, finished.width, finished.height),
    0,
    0,
  )

  return canvasToJpeg(target)
}

/**
 * Nimmt ein Foto aus der Kamera-App als Seite auf.
 *
 * Es wird neu kodiert statt einfach durchgereicht, und zwar aus zwei Gründen:
 * Die Drehung aus dem EXIF wird dabei fest ins Bild geschrieben, und ein
 * 12-Megapixel-Foto schrumpft von mehreren Megabyte auf ein paar hundert
 * Kilobyte. Bei zehn Seiten ist das der Unterschied zwischen „geht durch" und
 * „über der Obergrenze".
 *
 * Aufbereitet wird es bewusst nicht: Wer die Kamera-App nimmt, hat womöglich
 * gerade deren eigenen Dokumentenmodus benutzt. Zweimal nachbessern macht
 * kein Bild besser.
 */
export async function pageFromFile(file: File): Promise<ScanPage> {
  const blob = await withImage(file, (image) =>
    canvasToJpeg(drawToCanvas(image, image.naturalWidth, image.naturalHeight, PHOTO_MAX_EDGE)),
  )
  return createPage(blob)
}

/**
 * Dreht eine Seite um eine Vierteldrehung im Uhrzeigersinn.
 *
 * Nötig, weil in einem mehrseitigen Brief gern eine einzelne Seite quer liegt
 * – eine Tabelle, ein Plan – und ein Stapel, in dem eine Seite auf der Seite
 * steht, später niemand mehr gerade rückt.
 *
 * Gedreht wird das Bild selbst und nicht bloss die Anzeige: Was in die PDF
 * eingebettet wird, ist genau diese Datei, und ein Vermerk „bitte gedreht
 * lesen" überlebt den Weg dorthin nicht. Der Preis ist ein erneutes Kodieren
 * je Drehung; bei den ein, zwei Griffen, um die es geht, sieht man das nicht.
 */
export async function rotatePage(page: ScanPage): Promise<ScanPage> {
  const blob = await withImage(page.blob, (image) => {
    const canvas = document.createElement('canvas')
    // Hoch wird breit: Die Seitenlängen tauschen den Platz.
    canvas.width = image.naturalHeight
    canvas.height = image.naturalWidth

    const context = context2d(canvas)
    context.imageSmoothingQuality = 'high'
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(Math.PI / 2)
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)

    return canvasToJpeg(canvas)
  })

  // Dieselbe Kennung, damit die Seite an ihrer Stelle im Stapel bleibt; die
  // alte Vorschau-Adresse gibt der Aufrufer frei.
  return { id: page.id, blob, url: URL.createObjectURL(blob) }
}

/**
 * „Scan 28.07.2026 14.32" – der Titel, wenn keiner eingegeben wird.
 *
 * Mit Uhrzeit, weil an einem Tag mehr als ein Brief ankommt und die Liste
 * sonst mehrfach denselben Eintrag zeigte.
 */
export function defaultScanTitle(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
  return `Scan ${date} ${pad(now.getHours())}.${pad(now.getMinutes())}`
}

/**
 * Macht aus den gesammelten Seiten die Datei für den Upload.
 *
 * Eine einzelne Seite bleibt ein JPEG: Der Browser zeigt sie ohne Umweg an,
 * und der Server muss für die Vorschau nichts rastern. Ab zwei Seiten führt
 * kein Weg an einem PDF vorbei – und genau darum geht es beim Sammeln.
 */
export async function buildUpload(pages: readonly ScanPage[], title: string): Promise<File> {
  return fileFromJpegs(
    pages.map((page) => page.blob),
    title,
  )
}

/**
 * Eine Datei aus fertigen JPEG-Seiten – eine Seite bleibt ein Bild, mehrere
 * werden ein PDF.
 *
 * Getrennt von buildUpload, weil auch das nachträgliche Zuschneiden hier
 * herauskommt: Dort liegen die Seiten nicht als Stapel vor, sondern als das,
 * was gerade zugeschnitten wurde. Die Regel, wann ein PDF entsteht, soll
 * trotzdem an einer Stelle stehen.
 */
export async function fileFromJpegs(
  pages: readonly Blob[],
  title: string,
): Promise<File> {
  const first = pages[0]
  if (!first) throw new Error('Es sind keine Seiten vorhanden.')

  // Der Dateiname ist nur noch der Name beim Herunterladen; den Titel im
  // Archiv bestimmt das Feld, das daneben mitgeschickt wird.
  const name = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Scan'

  if (pages.length === 1) {
    return new File([first], `${name}.jpg`, { type: 'image/jpeg' })
  }

  const jpegs = await Promise.all(
    pages.map(async (page) => new Uint8Array(await page.arrayBuffer())),
  )
  return new File([buildPdfFromJpegs(jpegs)], `${name}.pdf`, { type: 'application/pdf' })
}

/**
 * Schneidet ein Bild auf den gewählten Ausschnitt zu.
 *
 * Gerechnet wird in der Auflösung, in der das Bild ankommt: Bei einem Foto ist
 * das das Original, bei einer PDF-Seite die gerasterte Vorschau. Der Ausschnitt
 * selbst ist in Anteilen angegeben und passt deshalb auf beides.
 */
export async function cropToJpeg(source: Blob, rect: CropRect): Promise<Blob> {
  return withImage(source, (image) => {
    const cut = cropPixels(rect, image.naturalWidth, image.naturalHeight)

    const canvas = document.createElement('canvas')
    canvas.width = cut.width
    canvas.height = cut.height

    const context = context2d(canvas)
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      image,
      cut.x,
      cut.y,
      cut.width,
      cut.height,
      0,
      0,
      cut.width,
      cut.height,
    )

    return canvasToJpeg(canvas)
  })
}

export { nearestCorner } from './geometry.ts'
export type { Point, Quad } from './geometry.ts'
export {
  containsPoint,
  CROP_HANDLES,
  cropPixels,
  fitInside,
  FULL_CROP,
  handlePoint,
  isFullCrop,
  moveCrop,
  moveHandle,
  nearestCropHandle,
  type Box,
  type CropHandle,
  type CropRect,
  type Size,
} from './crop.ts'
export {
  DEFAULT_SCAN_FILTER,
  SCAN_FILTERS,
  SCAN_FILTER_LABELS,
  type ScanFilter,
} from './enhance.ts'

/**
 * Seitenvorschau für PDFs.
 *
 * Der Browser ist hier kein verlässlicher Partner: Chrome auf Android bringt
 * keinen eingebauten PDF-Betrachter mit, und in einer installierten PWA öffnet
 * ein PDF-Link bestenfalls eine fremde App. Ein <object> oder <iframe> bleibt
 * dort leer – genau das war vorher zu sehen.
 *
 * Also rastert der Server die Seite zu einem JPEG. Das Werkzeug dafür
 * (pdftoppm aus poppler-utils) liegt ohnehin im Image, weil die Texterkennung
 * gescannte PDFs damit aufbereitet – die Vorschau kostet also keine einzige
 * zusätzliche Abhängigkeit. Und ein Bild zeigt jeder Browser an.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

import type { Bereich } from '@manager/shared'

import {
  parsePageCount,
  PREVIEW_DIR,
  previewPagePath,
  previewThumbnailPath,
} from './preview-paths.js'
import { resolveInStorage } from './storage.js'

const run = promisify(execFile)

// Die reine Logik liegt in preview-paths.ts und wird hier weitergereicht,
// damit Aufrufer nur ein Modul kennen muessen.
export {
  PREVIEW_MAX_PAGES,
  parsePageCount,
  previewPagePath,
  previewThumbnailPath,
} from './preview-paths.js'

/**
 * Längste Kante der gerasterten Seite.
 *
 * 1400 Pixel sind auf einem Handy-Display auch beim Hineinzoomen noch scharf
 * und bleiben als JPEG meist unter 200 KB – ein Vielfaches weniger als das
 * PDF selbst, das sonst über die Mobilfunkverbindung müsste.
 */
const PREVIEW_LONGEST_EDGE = 1400

/**
 * Längste Kante des Vorschaubildes für die Kachelansicht.
 *
 * 520 Punkte reichen für eine Kachel auch auf einem Bildschirm mit doppelter
 * Punktdichte – bei vier Kacheln pro Reihe ist eine keine 200 Punkte breit.
 * Als JPEG bleiben davon rund 40 KB, und erst das macht eine Ansicht, die
 * zwanzig Dokumente auf einmal zeigt, über Mobilfunk erträglich.
 */
const THUMBNAIL_LONGEST_EDGE = 520

const PDFINFO_TIMEOUT_MS = 10_000
const PDFTOPPM_TIMEOUT_MS = 30_000

export class PreviewError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PreviewError'
  }
}

/** Seitenzahl eines PDFs, oder 0 wenn sie sich nicht ermitteln lässt. */
export async function countPdfPages(absolutePath: string): Promise<number> {
  try {
    const { stdout } = await run('pdfinfo', [absolutePath], { timeout: PDFINFO_TIMEOUT_MS })
    return parsePageCount(stdout)
  } catch {
    // Beschädigt, passwortgeschützt oder poppler fehlt: Ohne Seitenzahl gibt es
    // keine Vorschau, aber das Dokument selbst bleibt herunterladbar.
    return 0
  }
}

async function isFile(absolutePath: string): Promise<boolean> {
  try {
    const info = await stat(absolutePath)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

/**
 * Rastert eine PDF-Seite und gibt den absoluten Pfad des Bildes zurück.
 *
 * Das Ergebnis bleibt neben der Ablage liegen: Blättert jemand durch ein
 * fünfseitiges Dokument und öffnet es morgen erneut, rechnet der Server kein
 * zweites Mal. Der Ordner beginnt mit einem Punkt und steht damit in einer
 * Dateifreigabe nicht im Weg.
 */
export async function renderPdfPage(
  bereich: Bereich,
  documentId: string,
  absolutePdfPath: string,
  page: number,
): Promise<string> {
  return rasterize({
    bereich,
    documentId,
    absolutePdfPath,
    page,
    longestEdge: PREVIEW_LONGEST_EDGE,
    targetPath: previewPagePath(documentId, page),
  })
}

/**
 * Rastert die erste Seite klein – das Bild für eine Kachel.
 *
 * Bewusst dieselbe Zwischenablage wie die Seitenvorschau: Beim Löschen und
 * beim Ersetzen der Datei verschwindet mit dem Ordner des Dokuments beides
 * zugleich, und niemand muss daran denken, ein zweites Verzeichnis mit
 * aufzuräumen.
 */
export async function renderPdfThumbnail(
  bereich: Bereich,
  documentId: string,
  absolutePdfPath: string,
): Promise<string> {
  return rasterize({
    bereich,
    documentId,
    absolutePdfPath,
    page: 1,
    longestEdge: THUMBNAIL_LONGEST_EDGE,
    targetPath: previewThumbnailPath(documentId),
  })
}

async function rasterize({
  bereich,
  documentId,
  absolutePdfPath,
  page,
  longestEdge,
  targetPath,
}: {
  bereich: Bereich
  documentId: string
  absolutePdfPath: string
  page: number
  longestEdge: number
  targetPath: string
}): Promise<string> {
  const cached = resolveInStorage(bereich, targetPath)
  if (await isFile(cached)) return cached

  await mkdir(dirname(cached), { recursive: true })

  // Erst unter einem Zufallsnamen rastern, dann umbenennen: Fragen zwei
  // Geräte gleichzeitig dieselbe Seite an, sieht keines von beiden eine halb
  // geschriebene Datei.
  const stagingPrefix = resolveInStorage(
    bereich,
    `${PREVIEW_DIR}/${documentId}/.s${page}-${randomUUID()}`,
  )
  const staged = `${stagingPrefix}.jpg`

  try {
    await run(
      'pdftoppm',
      [
        '-jpeg',
        '-jpegopt',
        'quality=80',
        '-scale-to',
        String(longestEdge),
        '-f',
        String(page),
        '-l',
        String(page),
        // Ohne -singlefile hängt pdftoppm eine Seitennummer an den Namen, und
        // wie viele Stellen sie hat, richtet sich nach der Gesamtseitenzahl.
        '-singlefile',
        absolutePdfPath,
        stagingPrefix,
      ],
      { timeout: PDFTOPPM_TIMEOUT_MS },
    )

    if (!(await isFile(staged))) {
      throw new PreviewError('pdftoppm hat kein Bild geschrieben')
    }

    await rename(staged, cached)
    return cached
  } catch (error) {
    await rm(staged, { force: true })
    if (error instanceof PreviewError) throw error
    throw new PreviewError('Die Seite liess sich nicht darstellen', { cause: error })
  }
}

/**
 * Wirft die zwischengespeicherten Seiten eines Dokuments weg.
 *
 * Beim Löschen aufgerufen – sonst blieben Bilder eines Dokuments liegen, das
 * im Papierkorb längst nicht mehr sichtbar ist.
 */
export async function removePreviews(bereich: Bereich, documentId: string): Promise<void> {
  await rm(resolveInStorage(bereich, `${PREVIEW_DIR}/${documentId}`), {
    recursive: true,
    force: true,
  })
}

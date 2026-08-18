import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { extractPdfText } from '../lib/pdf-text.js'
import { isUsableTextLayer } from './text-quality.js'

const run = promisify(execFile)

/** Mehr Seiten braucht kein Haushaltsdokument – und begrenzt die Laufzeit. */
const MAX_PAGES = 25

const PDFTOTEXT_TIMEOUT_MS = 30_000
const RASTER_TIMEOUT_MS = 120_000
const TESSERACT_TIMEOUT_MS = 120_000

export type ExtractionMethod = 'textebene' | 'ocr'

export interface ExtractionResult {
  text: string
  method: ExtractionMethod
  /** Bei gescannten Dokumenten: wie viele Seiten durch die Erkennung liefen. */
  pages?: number
}

export class ExtractionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExtractionError'
  }
}

/**
 * Ermittelt, welche Sprachen Tesseract tatsächlich mitbringt.
 *
 * Wichtig, weil Tesseract mit einer nicht installierten Sprache nicht etwa
 * diese überspringt, sondern komplett abbricht. Ohne diese Prüfung würde eine
 * Konfiguration wie 'deu+fra+eng' auf einem Image ohne Französisch jede
 * einzelne Erkennung scheitern lassen – und zwar stumm im Hintergrund.
 */
export async function resolveLanguages(requested: string): Promise<string> {
  let available: Set<string>
  try {
    const { stdout } = await run('tesseract', ['--list-langs'], { timeout: 10_000 })
    available = new Set(
      stdout
        .split('\n')
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean),
    )
  } catch (error) {
    throw new ExtractionError('Tesseract ist nicht verfügbar', { cause: error })
  }

  const wanted = requested.split('+').map((entry) => entry.trim()).filter(Boolean)
  const usable = wanted.filter((language) => available.has(language))

  if (usable.length > 0) return usable.join('+')
  if (available.has('eng')) return 'eng'
  throw new ExtractionError(
    `Keine der gewünschten Sprachen (${requested}) ist installiert. Vorhanden: ${[...available].join(', ') || 'keine'}`,
  )
}

/** Liest eine bereits vorhandene Textebene aus einem PDF. */
async function readTextLayer(file: string): Promise<string> {
  const { stdout } = await run(
    'pdftotext',
    ['-layout', '-enc', 'UTF-8', '-f', '1', '-l', String(MAX_PAGES), file, '-'],
    { timeout: PDFTOTEXT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
  )
  return stdout
}

async function recognizeImage(file: string, languages: string): Promise<string> {
  const { stdout } = await run('tesseract', [file, 'stdout', '-l', languages], {
    timeout: TESSERACT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
}

/**
 * Gescanntes PDF: Seiten zu Bildern rastern, jede Seite einzeln erkennen.
 *
 * 200 dpi ist der Punkt, an dem Tesseract zuverlässig arbeitet, ohne dass die
 * Bilder auf einem NAS-Prozessor unnötig gross werden.
 */
async function recognizePdfPages(file: string, languages: string): Promise<ExtractionResult> {
  const workDir = await mkdtemp(join(tmpdir(), 'manager-ocr-'))
  try {
    await run(
      'pdftoppm',
      ['-r', '200', '-png', '-f', '1', '-l', String(MAX_PAGES), file, join(workDir, 'seite')],
      { timeout: RASTER_TIMEOUT_MS },
    )

    const pages = (await readdir(workDir)).filter((name) => name.endsWith('.png')).sort()
    if (pages.length === 0) {
      throw new ExtractionError('Aus dem PDF liess sich keine Seite darstellen')
    }

    const texts: string[] = []
    for (const page of pages) {
      texts.push(await recognizeImage(join(workDir, page), languages))
    }

    return { text: texts.join('\n\n'), method: 'ocr', pages: pages.length }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/**
 * Holt den Text aus einer Datei – über den jeweils günstigsten Weg.
 *
 * Der Reihe nach:
 *   1. PDF mit Textebene → pdftotext, praktisch ohne Rechenaufwand. Das trifft
 *      auf die Mehrheit der Dokumente aus E-Mails zu.
 *   2. PDF, dessen Textebene pdftotext nicht deuten kann → der eigene Leser,
 *      der das Encoding der Schrift auswertet. Immer noch ohne Rasterung.
 *   3. PDF ohne Textebene (eingescannt) → Seiten rastern, dann Tesseract.
 *   4. Bild → direkt Tesseract.
 */
export async function extractText(
  absolutePath: string,
  mimeType: string,
  languages: string,
): Promise<ExtractionResult> {
  if (mimeType === 'application/pdf') {
    let layer = ''
    try {
      layer = await readTextLayer(absolutePath)
    } catch (error) {
      // Ein beschädigtes PDF soll nicht hier enden – die Wege darunter kommen
      // manchmal trotzdem noch zu einem Ergebnis.
      layer = ''
      void error
    }

    if (isUsableTextLayer(layer)) return { text: layer, method: 'textebene' }

    // Zweiter Anlauf mit dem eigenen Leser.
    //
    // Er kennt das Encoding der Schrift (`/Differences`) und kommt damit an
    // Text heran, den pdftotext nur als Zeichen aus dem privaten Bereich
    // ausgibt – genau der Fall bei den Rechnungen des Energieversorgers. Für
    // ein echtes, nie fotografiertes PDF ist das der richtige Weg: Er liefert
    // den Text buchstabengetreu, während die Rasterung ihn nur nachbildet.
    try {
      const eigener = extractPdfText(await readFile(absolutePath))
      if (isUsableTextLayer(eigener)) return { text: eigener, method: 'textebene' }
    } catch (error) {
      // Kein PDF, das sich zerlegen lässt – dann eben rastern.
      void error
    }

    return recognizePdfPages(absolutePath, languages)
  }

  if (mimeType.startsWith('image/')) {
    return { text: await recognizeImage(absolutePath, languages), method: 'ocr', pages: 1 }
  }

  throw new ExtractionError(`Aus ${mimeType} lässt sich kein Text gewinnen`)
}

/**
 * Räumt den erkannten Text auf, bevor er gespeichert wird.
 *
 * Texterkennung hinterlässt viel Leerraum – bei einer eingescannten Rechnung
 * schnell mehr Leerzeichen als Buchstaben. Ungefiltert bläht das die Datenbank
 * auf und macht die Textausschnitte in den Suchergebnissen unlesbar.
 */
export function tidyText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

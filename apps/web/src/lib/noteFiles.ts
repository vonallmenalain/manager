import {
  blocksFromText,
  editLengthOf,
  fileBlocks,
  insertBlocksAt,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  normalizeDoc,
  plainTextOf,
  withWritingLines,
  type Bereich,
  type RichBlock,
  type RichDoc,
  type RichFile,
} from '@manager/shared'
import { useQuery } from '@tanstack/react-query'

import { api, API_BASE } from './api'
import { useObjectUrl } from './documents'

/**
 * Dateien in Notizen: anzeigen, öffnen, einfügen.
 *
 * Eine Datei steht als eigener Block im Text der Notiz (siehe `richtext` im
 * geteilten Paket) und liegt auf dem Server in `note_files`. Hier stehen die
 * Wege dazwischen – für den gelesenen Text, den Editor, den Betrachter und
 * das Teilen aus anderen Apps.
 */

/** Adresse der Datei für den Browser selbst – Öffnen im Betrachter des Systems. */
export function noteFileUrl(id: string, download = false): string {
  return `${API_BASE}/api/notes/files/${id}/datei${download ? '?download=1' : ''}`
}

/* ------------------------------------------------------------------ */
/* Vorschaubilder                                                      */
/* ------------------------------------------------------------------ */

/**
 * Die Vorschaubilder, einmal geholt und für die Dauer der Sitzung behalten.
 *
 * Gelesener Text und Editor zeigen dieselben Bilder, und zwischen beiden wird
 * bei jedem Antippen gewechselt. Ohne gemeinsamen Speicher flackerte jede
 * Datei beim Wechsel auf, weil sie neu geladen würde. Die Bilder sind klein
 * (ein Foto kommt zwar in voller Grösse, eine Notiz trägt aber selten mehr als
 * eine Handvoll davon).
 *
 * Als blob:-Adresse und nicht direkt von der API: Ein <img> auf die Adresse der
 * API verwirft die Sicherheitsrichtlinie der Seite (siehe `requestBlob`).
 */
const thumbnails = new Map<string, Promise<string>>()

export function thumbnailUrl(id: string): Promise<string> {
  let entry = thumbnails.get(id)
  if (!entry) {
    entry = api.noteFileThumbnail(id).then((blob) => URL.createObjectURL(blob))
    // Ein Fehlschlag bleibt nicht liegen – beim nächsten Zeichnen neuer Versuch.
    entry.catch(() => thumbnails.delete(id))
    thumbnails.set(id, entry)
  }
  return entry
}

export function useNoteThumbnail(id: string): { url: string | null; failed: boolean } {
  const query = useQuery({
    queryKey: ['note-thumbnail', id],
    queryFn: () => thumbnailUrl(id),
    staleTime: Infinity,
    retry: false,
  })
  return { url: query.data ?? null, failed: query.isError }
}

/* ------------------------------------------------------------------ */
/* Betrachter                                                          */
/* ------------------------------------------------------------------ */

export function useNoteFilePreview(id: string) {
  return useQuery({
    queryKey: ['note-file-preview', id],
    queryFn: () => api.noteFilePreview(id),
    staleTime: Infinity,
  })
}

/** Das ganze Bild – für den Betrachter, nicht für die Notiz. */
export function useNoteFileImage(id: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ['note-file', id],
    queryFn: ({ signal }) => api.noteFile(id, signal),
    enabled,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    retry: false,
  })
  return { url: useObjectUrl(query.data), isError: query.isError }
}

/** Eine gerasterte PDF-Seite. */
export function useNoteFilePage(id: string, page: number, enabled: boolean) {
  const query = useQuery({
    queryKey: ['note-file-page', id, page],
    queryFn: () => api.noteFilePreviewPage(id, page),
    enabled,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    retry: false,
  })
  return { url: useObjectUrl(query.data), isError: query.isError }
}

/* ------------------------------------------------------------------ */
/* Einfügen                                                            */
/* ------------------------------------------------------------------ */

/** Wie eine Datei in die Notiz kommt: als Datei oder als ihr Text. */
export type EinfuegeArt = 'datei' | 'text'

const NACHFRAGE_MS = 1500
/** Ein gescanntes PDF mit vielen Seiten braucht auf dem NAS ein paar Minuten. */
const HOECHSTENS_MS = 5 * 60 * 1000

function warten(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abbrechen)
      resolve()
    }, ms)
    function abbrechen() {
      window.clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abbrechen, { once: true })
  })
}

/**
 * Der Text einer Datei – über einen Auftrag auf dem Server.
 *
 * Nicht in einem Aufruf, der auf das Ergebnis wartet: Ein Foto braucht schnell
 * eine halbe Minute, und so lange hält die Verbindung über Cloudflare nicht
 * zuverlässig. Deshalb hinschicken und nachfragen, bis der Text da ist.
 */
export async function texterkennen(file: File, signal?: AbortSignal): Promise<string> {
  let auftrag = await api.startTexterkennung(file, signal)
  const ende = Date.now() + HOECHSTENS_MS
  while (auftrag.status === 'wartet' || auftrag.status === 'laeuft') {
    if (Date.now() > ende) {
      throw new Error('Die Texterkennung dauert zu lange. Bitte später nochmals versuchen.')
    }
    await warten(NACHFRAGE_MS, signal)
    auftrag = await api.texterkennung(auftrag.id, signal)
  }
  if (auftrag.status === 'fehler') {
    throw new Error(auftrag.message ?? 'Der Text liess sich nicht erkennen.')
  }
  return auftrag.text ?? ''
}

export interface Fortschritt {
  art: EinfuegeArt
  /** Die wievielte Datei gerade dran ist (ab 1). */
  schritt: number
  von: number
}

/**
 * Aus gewählten oder geteilten Dateien die Blöcke für den Text einer Notiz:
 * hochgeladen als Dateien – oder gelesen, und dann nur ihr Text.
 *
 * Nacheinander, nicht gleichzeitig: Die Reihenfolge im Text ist die der
 * Auswahl, und der Server liest ohnehin eine Datei nach der anderen.
 */
export async function dateienAlsBloecke(
  files: readonly File[],
  art: EinfuegeArt,
  bereich: Bereich,
  {
    signal,
    onFortschritt,
  }: { signal?: AbortSignal; onFortschritt?: (fortschritt: Fortschritt) => void } = {},
): Promise<RichBlock[]> {
  if (art === 'datei') {
    const hochgeladen: RichFile[] = []
    for (const [index, file] of files.entries()) {
      signal?.throwIfAborted()
      onFortschritt?.({ art, schritt: index + 1, von: files.length })
      const { file: rich } = await api.uploadNoteFile(file, bereich, signal)
      hochgeladen.push(rich)
    }
    signal?.throwIfAborted()
    return fileBlocks(hochgeladen)
  }

  const texte: string[] = []
  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted()
    onFortschritt?.({ art, schritt: index + 1, von: files.length })
    const text = (await texterkennen(file, signal)).trim()
    if (text) texte.push(text)
  }
  signal?.throwIfAborted()
  if (texte.length === 0) {
    throw new Error(
      files.length === 1
        ? 'In der Datei wurde kein Text gefunden.'
        : 'In den Dateien wurde kein Text gefunden.',
    )
  }
  return blocksFromText(texte.join('\n\n'))
}

/**
 * Blöcke in eine Notiz setzen – an die Stelle des Cursors oder ans Ende –,
 * ohne die Längengrenze des Servers zu sprengen. Ohne Notiz (`doc` null)
 * werden die Blöcke der Text einer neuen.
 *
 * Erkannter Text wird notfalls gekürzt: Ein gescanntes Buchkapitel hat mehr
 * Zeichen, als eine Notiz fassen darf, und abgewiesen würde sonst die ganze
 * Notiz, samt dem, was schon drinstand. Eine Datei lässt sich nicht kürzen –
 * reicht der Platz nicht einmal für ihre Zeile, gibt es eine Meldung.
 */
export function inNotizEinsetzen(
  doc: RichDoc | null,
  stelle: number | null,
  bloecke: RichBlock[],
): { doc: RichDoc; caret: number; gekuerzt: boolean } {
  const normal = doc ? normalizeDoc(doc) : null
  const bauen = (inhalt: RichBlock[]): { doc: RichDoc; caret: number } => {
    if (!normal) {
      // Eine neue Notiz beginnt mit dem Geteilten selbst – eine leere Zeile
      // steht nur dort, wo eine Datei sonst keinen Platz zum Schreiben liesse.
      const neu = withWritingLines(normalizeDoc({ blocks: inhalt }))
      return { doc: neu, caret: editLengthOf(neu) }
    }
    return insertBlocksAt(normal, stelle ?? editLengthOf(normal), inhalt)
  }

  const versuch = bauen(bloecke)
  const laenge = plainTextOf(versuch.doc).length
  if (laenge <= NOTE_BODY_MAX) return { ...versuch, gekuerzt: false }

  if (bloecke.some((block) => block.file)) {
    throw new Error('Die Notiz ist zu lang für eine weitere Datei. Bitte eine neue Notiz beginnen.')
  }
  const text = bloecke.map((block) => block.runs.map((run) => run.t).join('')).join('\n')
  const platz = text.length - (laenge - NOTE_BODY_MAX)
  if (platz <= 0) {
    throw new Error('Die Notiz ist voll – für den erkannten Text ist kein Platz mehr.')
  }
  return { ...bauen(blocksFromText(text.slice(0, platz))), gekuerzt: true }
}

/** „Rechnung_März.pdf" → „Rechnung März" – der Titel einer Notiz aus einer Datei. */
export function titelAusDateiname(name: string): string {
  return name
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_TITLE_MAX)
}

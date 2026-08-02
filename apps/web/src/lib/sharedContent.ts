/**
 * Gegenstück zum Service Worker: holt das beim Teilen zwischengelagerte
 * Material wieder heraus.
 *
 * Der Ablauf beim Teilen aus einer anderen App:
 *   Android → POST /share-target → Service Worker legt ab → Weiterleitung
 *   → /teilen lädt → liest hier mit → Ziel wählen → ablegen und aufräumen
 *
 * Gelesen und geräumt wird getrennt: Die Auswahlseite muss zeigen können, was
 * angekommen ist, bevor entschieden ist, wohin es geht. Weggeräumt wird erst,
 * wenn es angekommen ist – sonst wäre ein Verweis nach einem Fehlversuch weg.
 */

import {
  SHARE_CACHE,
  SHARE_FILENAME_HEADER,
  SHARE_FILE_PREFIX,
  SHARE_TEXT_KEY,
} from './shareConstants'
import type { SharedText } from './shareNote'

export interface SharedContent extends SharedText {
  files: File[]
}

export const LEER: SharedContent = { files: [], title: '', text: '', url: '' }

/** Ist überhaupt etwas angekommen? */
export function istLeer(content: SharedContent): boolean {
  return (
    content.files.length === 0 && content.title === '' && content.text === '' && content.url === ''
  )
}

/**
 * Liest das Geteilte, ohne es zu verbrauchen.
 *
 * Bleibt etwas liegen, weil jemand die Auswahl abbricht, ist das kein Schaden:
 * Der Worker leert den Zwischenspeicher zu Beginn jedes neuen Teilens.
 */
export async function readSharedContent(): Promise<SharedContent> {
  const cache = await oeffnen()
  if (!cache) return LEER

  const files: File[] = []
  let text: SharedText = { title: '', text: '', url: '' }

  for (const key of await cache.keys()) {
    const response = await cache.match(key)
    if (!response) continue

    const { pathname } = new URL(key.url)

    if (pathname === SHARE_TEXT_KEY) {
      text = await lesenAlsText(response)
      continue
    }

    if (!pathname.startsWith(SHARE_FILE_PREFIX)) continue
    files.push(await lesenAlsDatei(response))
  }

  return { files, ...text }
}

/**
 * Die geteilten Dateien – und danach ist der Zwischenspeicher leer.
 *
 * Wird von der Dokumentenseite gerufen, sobald „Dokumente" gewählt wurde. Das
 * Aufräumen gehört hierher: Bliebe etwas liegen, tauchte es beim nächsten
 * Öffnen der App unerwartet wieder auf.
 */
export async function collectSharedFiles(): Promise<File[]> {
  const { files } = await readSharedContent()
  await discardSharedContent()
  return files
}

/**
 * Leert das Zwischenlager, ohne das Geteilte zu verwenden – nach dem Ablegen,
 * oder wenn jemand die Auswahl verwirft.
 */
export async function discardSharedContent(): Promise<void> {
  if (!('caches' in globalThis)) return
  try {
    await caches.delete(SHARE_CACHE)
  } catch {
    // Kein Cache vorhanden – nichts zu tun.
  }
}

async function oeffnen(): Promise<Cache | null> {
  if (!('caches' in globalThis)) return null
  try {
    return await caches.open(SHARE_CACHE)
  } catch {
    return null
  }
}

async function lesenAlsDatei(response: Response): Promise<File> {
  const blob = await response.blob()
  const encodedName = response.headers.get(SHARE_FILENAME_HEADER)
  const name = encodedName ? decodeURIComponent(encodedName) : 'Geteiltes Dokument'
  return new File([blob], name, { type: blob.type })
}

async function lesenAlsText(response: Response): Promise<SharedText> {
  try {
    const roh = (await response.json()) as Partial<SharedText>
    return {
      title: typeof roh.title === 'string' ? roh.title : '',
      text: typeof roh.text === 'string' ? roh.text : '',
      url: typeof roh.url === 'string' ? roh.url : '',
    }
  } catch {
    // Unlesbar abgelegt: lieber ohne Text weitermachen, als das ganze Teilen
    // an einer kaputten Zeile scheitern zu lassen.
    return { title: '', text: '', url: '' }
  }
}

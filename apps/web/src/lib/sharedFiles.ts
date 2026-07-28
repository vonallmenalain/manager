/**
 * Gegenstück zum Service Worker: holt die beim Teilen zwischengelagerten
 * Dateien wieder heraus.
 *
 * Der Ablauf beim Teilen aus einer anderen App:
 *   Android → POST /share-target → Service Worker legt ab → Weiterleitung
 *   → diese Seite lädt → holt hier ab → lädt hoch → räumt auf
 */

import { SHARE_CACHE, SHARE_FILENAME_HEADER } from './shareConstants'

export async function collectSharedFiles(): Promise<File[]> {
  if (!('caches' in globalThis)) return []

  let cache: Cache
  try {
    cache = await caches.open(SHARE_CACHE)
  } catch {
    return []
  }

  const keys = await cache.keys()
  const files: File[] = []

  for (const key of keys) {
    const response = await cache.match(key)
    if (!response) continue

    const blob = await response.blob()
    const encodedName = response.headers.get(SHARE_FILENAME_HEADER)
    const name = encodedName ? decodeURIComponent(encodedName) : 'Geteiltes Dokument'

    files.push(new File([blob], name, { type: blob.type }))
    // Sofort nach dem Auslesen entfernen: Bleibt etwas liegen, taucht es beim
    // nächsten Öffnen der App unerwartet wieder auf.
    await cache.delete(key)
  }

  return files
}

/**
 * Leert das Zwischenlager, ohne die Dateien zu verwenden – etwa wenn der
 * Upload endgültig fehlgeschlagen ist und ein zweiter Versuch nur denselben
 * Fehler brächte.
 */
export async function discardSharedFiles(): Promise<void> {
  if (!('caches' in globalThis)) return
  try {
    await caches.delete(SHARE_CACHE)
  } catch {
    // Kein Cache vorhanden – nichts zu tun.
  }
}

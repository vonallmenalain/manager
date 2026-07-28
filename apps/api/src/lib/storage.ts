import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { env } from '../env.js'
import { resolveWithin } from './storage-paths.js'

// Die reine Pfad-Logik liegt in storage-paths.ts und wird hier
// weitergereicht, damit Aufrufer nur ein Modul kennen muessen.
export {
  buildStoragePath,
  extensionFor,
  slugify,
  type StoragePathParts,
} from './storage-paths.js'

export const STORAGE_ROOT = resolve(env.STORAGE_DIR)
const TMP_DIR = join(STORAGE_ROOT, '.tmp')
const TRASH_DIR = join(STORAGE_ROOT, '.trash')

/** Wie resolveWithin, aber fest auf die konfigurierte Ablage gebunden. */
export function resolveInStorage(relativePath: string): string {
  return resolveWithin(STORAGE_ROOT, relativePath)
}

export interface StoredUpload {
  tempPath: string
  sha256: string
  sizeBytes: number
}

/**
 * Schreibt den Upload zunächst in einen temporären Ordner und berechnet dabei
 * im selben Durchgang die Prüfsumme. Erst wenn Grösse und Typ stimmen und kein
 * Duplikat vorliegt, wandert die Datei an ihren endgültigen Platz – ein
 * abgebrochener Upload hinterlässt so nie eine halbe Datei in der Ablage.
 */
export async function storeTemporarily(
  source: Readable,
  uploadId: string,
): Promise<StoredUpload> {
  await mkdir(TMP_DIR, { recursive: true })
  const tempPath = join(TMP_DIR, uploadId)

  const hash = createHash('sha256')
  source.on('data', (chunk: Buffer) => hash.update(chunk))

  await pipeline(source, createWriteStream(tempPath))

  const { size } = await stat(tempPath)
  return { tempPath, sha256: hash.digest('hex'), sizeBytes: size }
}

export async function commitUpload(tempPath: string, relativePath: string): Promise<void> {
  const target = resolveInStorage(relativePath)
  await mkdir(dirname(target), { recursive: true })
  await rename(tempPath, target)
}

export async function discardUpload(tempPath: string): Promise<void> {
  await rm(tempPath, { force: true })
}

/**
 * Benennt die Datei um, wenn sich Titel, Kategorie oder Datum geändert haben.
 * Gibt zurück, ob tatsächlich verschoben wurde – der Aufrufer schreibt dann
 * den neuen Pfad in die Datenbank.
 */
export async function moveWithinStorage(from: string, to: string): Promise<boolean> {
  if (from === to) return false

  const source = resolveInStorage(from)
  const target = resolveInStorage(to)

  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
  return true
}

/**
 * Verschiebt in den Papierkorb statt zu löschen. Der ursprüngliche Pfad bleibt
 * als Unterordner erhalten, damit eine Wiederherstellung von Hand möglich ist,
 * auch ohne die Datenbank.
 */
export async function moveToTrash(relativePath: string): Promise<string> {
  const trashRelative = join('.trash', relativePath)
  const target = join(TRASH_DIR, relativePath)

  await mkdir(dirname(target), { recursive: true })
  await rename(resolveInStorage(relativePath), target)
  return trashRelative
}

export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await stat(resolveInStorage(relativePath))
    return true
  } catch {
    return false
  }
}

/** Räumt Reste ab, die ein abgebrochener Upload hinterlassen haben könnte. */
export async function cleanStaleTemporaryFiles(maxAgeMs: number): Promise<number> {
  let removed = 0
  try {
    const entries = await readdir(TMP_DIR)
    for (const entry of entries) {
      const path = join(TMP_DIR, entry)
      const info = await stat(path)
      if (Date.now() - info.mtimeMs > maxAgeMs) {
        await rm(path, { force: true })
        removed += 1
      }
    }
  } catch {
    // Der Ordner entsteht erst beim ersten Upload – sein Fehlen ist normal.
  }
  return removed
}

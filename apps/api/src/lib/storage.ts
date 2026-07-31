import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { BEREICHE, DOCBASE_DIR, type Bereich } from '@manager/shared'

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

/**
 * Jeder Bereich hat seinen eigenen Wurzelordner.
 *
 * Die DocBase liegt als Unterordner in derselben Freigabe – ein zweites
 * Volume wäre eine zweite Sache, die beim Einrichten schiefgehen kann. Ihre
 * Pfade in der Datenbank sind relativ zu diesem Ordner, nicht zur Freigabe:
 * So bleibt jede Ablage-Funktion dieselbe wie vorher, und `.trash` wie
 * `.previews` entstehen je Bereich dort, wo sie hingehören.
 */
const ROOTS: Record<Bereich, string> = {
  manager: STORAGE_ROOT,
  docbase: join(STORAGE_ROOT, DOCBASE_DIR),
}

export function storageRoot(bereich: Bereich): string {
  return ROOTS[bereich]
}

/** Wie resolveWithin, aber fest auf die Ablage des Bereichs gebunden. */
export function resolveInStorage(bereich: Bereich, relativePath: string): string {
  return resolveWithin(ROOTS[bereich], relativePath)
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
  bereich: Bereich,
  source: Readable,
  uploadId: string,
): Promise<StoredUpload> {
  // Der Zwischenspeicher liegt im selben Bereich wie das Ziel: Ein Umbenennen
  // über eine Ordnergrenze hinweg wäre kein Umbenennen mehr, sondern ein
  // Kopieren – und über Dateisystemgrenzen scheitert es ganz.
  const tmpDir = join(ROOTS[bereich], '.tmp')
  await mkdir(tmpDir, { recursive: true })
  const tempPath = join(tmpDir, uploadId)

  const hash = createHash('sha256')
  source.on('data', (chunk: Buffer) => hash.update(chunk))

  await pipeline(source, createWriteStream(tempPath))

  const { size } = await stat(tempPath)
  return { tempPath, sha256: hash.digest('hex'), sizeBytes: size }
}

export async function commitUpload(
  bereich: Bereich,
  tempPath: string,
  relativePath: string,
): Promise<void> {
  const target = resolveInStorage(bereich, relativePath)
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
export async function moveWithinStorage(
  bereich: Bereich,
  from: string,
  to: string,
): Promise<boolean> {
  if (from === to) return false

  const source = resolveInStorage(bereich, from)
  const target = resolveInStorage(bereich, to)

  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)
  return true
}

/**
 * Räumt ein Verzeichnis weg, wenn nichts mehr darin liegt.
 *
 * Gedacht für den Ordner einer Kategorie, die es nicht mehr gibt: Bliebe er
 * leer stehen, sähe es in der Freigabe aus, als wäre die Umstellung nur halb
 * passiert. `rmdir` scheitert von sich aus, sobald noch etwas darin liegt –
 * eine zusätzliche Prüfung wäre nur ein Zeitfenster für Fehler.
 */
export async function removeEmptyDirectory(
  bereich: Bereich,
  relativePath: string,
): Promise<boolean> {
  // Der Wurzelordner der Ablage bleibt immer stehen.
  if (!relativePath || relativePath === '.' || relativePath === '/') return false

  try {
    await rmdir(resolveInStorage(bereich, relativePath))
    return true
  } catch {
    return false
  }
}

/**
 * Verschiebt in den Papierkorb statt zu löschen. Der ursprüngliche Pfad bleibt
 * als Unterordner erhalten, damit eine Wiederherstellung von Hand möglich ist,
 * auch ohne die Datenbank.
 */
export async function moveToTrash(bereich: Bereich, relativePath: string): Promise<string> {
  const trashRelative = join('.trash', relativePath)
  const target = join(ROOTS[bereich], trashRelative)

  await mkdir(dirname(target), { recursive: true })
  await rename(resolveInStorage(bereich, relativePath), target)
  return trashRelative
}

export async function fileExists(bereich: Bereich, relativePath: string): Promise<boolean> {
  try {
    await stat(resolveInStorage(bereich, relativePath))
    return true
  } catch {
    return false
  }
}

/** Räumt Reste ab, die ein abgebrochener Upload hinterlassen haben könnte. */
export async function cleanStaleTemporaryFiles(maxAgeMs: number): Promise<number> {
  let removed = 0
  for (const bereich of BEREICHE) {
    const tmpDir = join(ROOTS[bereich], '.tmp')
    try {
      const entries = await readdir(tmpDir)
      for (const entry of entries) {
        const path = join(tmpDir, entry)
        const info = await stat(path)
        if (Date.now() - info.mtimeMs > maxAgeMs) {
          await rm(path, { force: true })
          removed += 1
        }
      }
    } catch {
      // Der Ordner entsteht erst beim ersten Upload – sein Fehlen ist normal.
    }
  }
  return removed
}

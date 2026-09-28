import { fileIdsOf, parseRichJson, type Bereich } from '@manager/shared'
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'

import { db } from '../db/index.js'
import { noteFiles, notes, type NoteFileRow } from '../db/schema.js'
import { removePreviews } from './preview.js'
import { removeFromStorage } from './storage.js'

/**
 * Die Dateien in den Notizen – wer sie sehen darf, wann sie einer Notiz
 * gehören und wann sie wieder verschwinden.
 */

/**
 * Eine Datei, sofern sie diese Person sehen darf.
 *
 * Wer sie hochgeladen hat, sieht sie immer – auch bevor die Notiz gespeichert
 * ist, in die sie gehört. Danach gilt, was für die Notiz gilt: Ist sie
 * geteilt, sehen sie alle, sonst nur, wer sie angelegt hat. Eine private Notiz
 * soll nicht über die Kennung ihrer Beilage lesbar werden.
 */
export async function findVisibleNoteFile(
  id: string,
  userId: string,
): Promise<NoteFileRow | undefined> {
  const rows = await db
    .select({ file: noteFiles })
    .from(noteFiles)
    .leftJoin(notes, eq(noteFiles.noteId, notes.id))
    .where(
      and(
        eq(noteFiles.id, id),
        or(eq(noteFiles.createdBy, userId), eq(notes.createdBy, userId), eq(notes.shared, true)),
      ),
    )
    .limit(1)

  return rows[0]?.file
}

/**
 * Ordnet die Dateien, die der Text einer Notiz nennt, dieser Notiz zu.
 *
 * Nur eigene, noch freie und aus demselben Bereich: Eine fremde Kennung im
 * Formatfeld macht die Datei dahinter nicht zur Beilage dieser Notiz, und
 * eine Datei aus der Ablage des Haushalts wird nicht zur Beilage einer
 * DocBase-Notiz – sie läge sonst in der falschen Ablage. Eine solche Datei
 * bleibt frei und wird nach einem Tag weggeräumt. Umgekehrt wird hier nichts
 * gelöst – wer eine Datei aus dem Text nimmt, lässt sie bei der Notiz liegen,
 * bis diese gelöscht wird. So kostet auch ein Speichern aus einer älteren App,
 * die das Formatfeld nicht kennt, keine Datei.
 */
export async function linkNoteFiles(
  noteId: string,
  userId: string,
  bereich: Bereich,
  bodyRich: string | null,
): Promise<void> {
  const doc = bodyRich ? parseRichJson(bodyRich) : null
  const ids = doc ? fileIdsOf(doc) : []
  if (ids.length === 0) return

  await db
    .update(noteFiles)
    .set({ noteId })
    .where(
      and(
        inArray(noteFiles.id, ids),
        isNull(noteFiles.noteId),
        eq(noteFiles.createdBy, userId),
        eq(noteFiles.bereich, bereich),
      ),
    )
}

/** Die Dateien einer Notiz – vor dem Löschen der Notiz gebraucht. */
export async function filesOfNote(noteId: string): Promise<NoteFileRow[]> {
  return db.select().from(noteFiles).where(eq(noteFiles.noteId, noteId))
}

/**
 * Entfernt Dateien samt ihren gerasterten Vorschauen.
 *
 * Zuerst von der Platte, dann aus der Datenbank: Scheitert das Löschen einer
 * Datei, bleibt ihre Zeile stehen, und das nächste Aufräumen versucht es
 * erneut – statt einer Datei, auf die nichts mehr zeigt.
 */
export async function deleteNoteFiles(
  rows: readonly NoteFileRow[],
  log?: FastifyBaseLogger,
): Promise<void> {
  const removed: string[] = []
  for (const row of rows) {
    const bereich = row.bereich as Bereich
    try {
      await removeFromStorage(bereich, row.storagePath)
      await removePreviews(bereich, row.id)
      removed.push(row.id)
    } catch (error) {
      log?.warn({ err: error, fileId: row.id }, 'Notiz-Datei liess sich nicht löschen')
    }
  }
  if (removed.length > 0) await db.delete(noteFiles).where(inArray(noteFiles.id, removed))
}

/**
 * Räumt Dateien weg, die nie in einer gespeicherten Notiz ankamen – oder
 * deren Notiz gelöscht ist. Ein Tag Frist, damit keine Datei verschwindet,
 * deren Notiz gerade noch geschrieben wird.
 */
export async function removeOrphanedNoteFiles(
  olderThanMs: number,
  log?: FastifyBaseLogger,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString()
  const rows = await db
    .select()
    .from(noteFiles)
    .where(and(isNull(noteFiles.noteId), lt(noteFiles.createdAt, cutoff)))
  await deleteNoteFiles(rows, log)
  return rows.length
}

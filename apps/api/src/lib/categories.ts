/**
 * Was an einer Kategorie hängt, wenn sie entsteht, sich umbenennt oder
 * verschwindet.
 *
 * Der Name einer Kategorie ist nicht nur ein Etikett: Er steht als Ordner im
 * Ablagepfad jedes Dokuments, das ihr zugeordnet ist. Jede Änderung an der
 * Liste ist deshalb auch eine Änderung an der Freigabe – und genau das steht
 * hier, an einer Stelle, statt in jeder Route noch einmal.
 */
import { normalizeForSearch, type Bereich } from '@manager/shared'
import { eq } from 'drizzle-orm'

import { dirname } from 'node:path'

import { db } from '../db/index.js'
import { categories, documents } from '../db/schema.js'
import {
  buildStoragePath,
  moveWithinStorage,
  removeEmptyDirectory,
} from './storage.js'

export interface CategoryView {
  id: string
  name: string
  icon: string
  sortOrder: number
  bereich: Bereich
}

/**
 * Wo eine neu angelegte Kategorie in der Liste steht.
 *
 * Sortiert wird nach dieser Zahl und danach nach dem Namen. Die Erstausstattung
 * belegt 10 bis 40, „Sonstiges" die 999 – wer selbst etwas anlegt, landet also
 * alphabetisch zwischen den vorgegebenen und dem Sammelposten am Ende. Das ist
 * kein Zufall: „Sonstiges" gehört auch dann nach unten, wenn zehn eigene
 * Kategorien dazugekommen sind.
 */
export const DEFAULT_SORT_ORDER = 100

/**
 * Zwei Kategorien gelten als gleich, wenn sie sich nur in Gross- und
 * Kleinschreibung, Umlautschreibweise oder Leerzeichen unterscheiden.
 *
 * Strenger als die Eindeutigkeit der Datenbank, und mit Absicht: „Kinder" und
 * „kinder" wären dort zwei Zeilen, in der Auswahl aber zweimal derselbe
 * Eintrag – und „Vaeter" und „Väter" bekämen in der Freigabe sogar denselben
 * Ordner, weil der Pfad Umlaute ausschreibt.
 */
export function sameCategoryName(a: string, b: string): boolean {
  return normalizeForSearch(a) === normalizeForSearch(b)
}

const CATEGORY_COLUMNS = {
  id: categories.id,
  name: categories.name,
  icon: categories.icon,
  sortOrder: categories.sortOrder,
  bereich: categories.bereich,
}

/**
 * Die Kategorie mit diesem Namen im selben Bereich, `exceptId` ausgenommen
 * (fürs Umbenennen). Der Haushalt und die DocBase dürfen beide „Sonstiges"
 * haben – das sind zwei verschiedene Schubladen.
 */
export async function findCategoryByName(
  bereich: Bereich,
  name: string,
  exceptId?: string,
): Promise<CategoryView | undefined> {
  const rows = await listCategories(bereich)
  return rows.find((row) => row.id !== exceptId && sameCategoryName(row.name, name))
}

export async function listCategories(bereich: Bereich): Promise<CategoryView[]> {
  const rows = await db
    .select(CATEGORY_COLUMNS)
    .from(categories)
    .where(eq(categories.bereich, bereich))
  return rows.map((row) => ({ ...row, bereich: row.bereich as Bereich }))
}

export async function findCategory(id: string): Promise<CategoryView | undefined> {
  const rows = await db
    .select(CATEGORY_COLUMNS)
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1)

  const row = rows[0]
  return row ? { ...row, bereich: row.bereich as Bereich } : undefined
}

interface RelocatableDocument {
  id: string
  title: string
  docDate: string
  storagePath: string
  deletedAt: string | null
  /** Bestimmt, in welcher Ablage die Datei liegt. */
  bereich: string
}

/** Die Dokumente einer Kategorie – samt allem, was der Pfad braucht. */
export async function documentsOfCategory(categoryId: string): Promise<RelocatableDocument[]> {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      docDate: documents.docDate,
      storagePath: documents.storagePath,
      deletedAt: documents.deletedAt,
      bereich: documents.bereich,
    })
    .from(documents)
    .where(eq(documents.categoryId, categoryId))
}

/**
 * Zieht die Dateien nach, nachdem sich der Kategoriename geändert hat oder
 * weggefallen ist (`categoryName === null` heisst „Unsortiert").
 *
 * Schlägt das Verschieben fehl, bleibt die Datei liegen und der Pfad in der
 * Datenbank zeigt weiterhin auf sie: falsch einsortiert ist besser als
 * verloren. Was im Papierkorb liegt, bleibt dort – dessen Pfade zeigen bereits
 * nach `.trash` und sollen das bis zum Ablauf der Frist auch tun.
 */
export async function relocateDocuments(
  rows: readonly RelocatableDocument[],
  categoryName: string | null,
): Promise<void> {
  for (const document of rows) {
    if (document.deletedAt) continue

    const nextPath = buildStoragePath({
      docDate: document.docDate,
      categoryName,
      title: document.title,
      documentId: document.id,
      extension: document.storagePath.split('.').pop() ?? 'bin',
    })

    const bereich = document.bereich as Bereich
    try {
      if (await moveWithinStorage(bereich, document.storagePath, nextPath)) {
        await db
          .update(documents)
          .set({ storagePath: nextPath })
          .where(eq(documents.id, document.id))
        // War es das letzte Dokument im alten Ordner, verschwindet auch er.
        await removeEmptyDirectory(bereich, dirname(document.storagePath))
      }
    } catch {
      // Absicht: siehe oben.
    }
  }
}

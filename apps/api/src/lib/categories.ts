/**
 * Was an einer Kategorie hängt, wenn sie entsteht, sich umbenennt oder
 * verschwindet.
 *
 * Der Name einer Kategorie ist nicht nur ein Etikett: Er steht als Ordner im
 * Ablagepfad jedes Dokuments, das ihr zugeordnet ist. Jede Änderung an der
 * Liste ist deshalb auch eine Änderung an der Freigabe – und genau das steht
 * hier, an einer Stelle, statt in jeder Route noch einmal.
 */
import { normalizeForSearch } from '@manager/shared'
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

/** Die Kategorie mit diesem Namen, `exceptId` ausgenommen (fürs Umbenennen). */
export async function findCategoryByName(
  name: string,
  exceptId?: string,
): Promise<CategoryView | undefined> {
  const rows = await listCategories()
  return rows.find((row) => row.id !== exceptId && sameCategoryName(row.name, name))
}

export async function listCategories(): Promise<CategoryView[]> {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      icon: categories.icon,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
}

export async function findCategory(id: string): Promise<CategoryView | undefined> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      icon: categories.icon,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1)
  return rows[0]
}

interface RelocatableDocument {
  id: string
  title: string
  docDate: string
  storagePath: string
  deletedAt: string | null
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

    try {
      if (await moveWithinStorage(document.storagePath, nextPath)) {
        await db
          .update(documents)
          .set({ storagePath: nextPath })
          .where(eq(documents.id, document.id))
        // War es das letzte Dokument im alten Ordner, verschwindet auch er.
        await removeEmptyDirectory(dirname(document.storagePath))
      }
    } catch {
      // Absicht: siehe oben.
    }
  }
}

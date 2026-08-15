/**
 * Was an einer Kategorie hängt, wenn sie entsteht, sich umbenennt oder
 * verschwindet.
 *
 * Der Name einer Kategorie ist nicht nur ein Etikett: Er steht als Ordner im
 * Ablagepfad jedes Dokuments, das ihr zugeordnet ist. Jede Änderung an der
 * Liste ist deshalb auch eine Änderung an der Freigabe – und genau das steht
 * hier, an einer Stelle, statt in jeder Route noch einmal.
 *
 * Seit es Unterkategorien gibt, betrifft das zwei Ebenen: Wer „Notfall"
 * umbenennt, verschiebt auch die Dokumente aus „Notfall › Medikamente".
 */
import { normalizeForSearch, type Bereich } from '@manager/shared'
import { eq, inArray } from 'drizzle-orm'

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
  /** null bei einer Hauptkategorie. */
  parentId: string | null
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
  parentId: categories.parentId,
}

function toView(row: Omit<CategoryView, 'bereich'> & { bereich: string }): CategoryView {
  return { ...row, bereich: row.bereich as Bereich }
}

/**
 * Die Kategorie mit diesem Namen unter derselben Hauptkategorie, `exceptId`
 * ausgenommen (fürs Umbenennen).
 *
 * Verglichen wird innerhalb einer Ebene: Der Haushalt und die DocBase dürfen
 * beide „Sonstiges" haben, und „Medikamente" darf unter „Notfall" wie unter
 * „Alltag" stehen – das sind verschiedene Schubladen. Zwei gleichnamige
 * Geschwister wären dagegen in jeder Auswahl derselbe Eintrag.
 */
export async function findCategoryByName(
  bereich: Bereich,
  name: string,
  parentId: string | null,
  exceptId?: string,
): Promise<CategoryView | undefined> {
  const rows = await listCategories(bereich)
  return rows.find(
    (row) =>
      row.id !== exceptId &&
      (row.parentId ?? null) === parentId &&
      sameCategoryName(row.name, name),
  )
}

export async function listCategories(bereich: Bereich): Promise<CategoryView[]> {
  const rows = await db
    .select(CATEGORY_COLUMNS)
    .from(categories)
    .where(eq(categories.bereich, bereich))
  return rows.map(toView)
}

export async function findCategory(id: string): Promise<CategoryView | undefined> {
  const rows = await db
    .select(CATEGORY_COLUMNS)
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1)

  const row = rows[0]
  return row ? toView(row) : undefined
}

/** Die Unterkategorien einer Hauptkategorie. */
export async function childCategories(parentId: string): Promise<CategoryView[]> {
  const rows = await db
    .select(CATEGORY_COLUMNS)
    .from(categories)
    .where(eq(categories.parentId, parentId))
  return rows.map(toView)
}

/**
 * Die Kategorie und ihre Hauptkategorie – genau das, was der Ablagepfad
 * braucht.
 *
 * Der Bereich wird mitgeprüft und ist keine Förmlichkeit: Eine Kennung aus der
 * DocBase in einem Haushaltsdokument würde dessen Datei in einen Ordner legen,
 * den der Haushalt gar nicht kennt.
 */
export async function categoryFolderNames(
  bereich: Bereich,
  categoryId: string | null,
): Promise<{ categoryName: string | null; parentCategoryName: string | null }> {
  if (!categoryId) return { categoryName: null, parentCategoryName: null }

  const category = await findCategory(categoryId)
  if (!category || category.bereich !== bereich) {
    return { categoryName: null, parentCategoryName: null }
  }

  const parent = category.parentId ? await findCategory(category.parentId) : undefined
  return {
    categoryName: category.name,
    parentCategoryName: parent?.name ?? null,
  }
}

interface RelocatableDocument {
  id: string
  title: string
  docDate: string
  storagePath: string
  deletedAt: string | null
  categoryId: string | null
  /** Bestimmt, in welcher Ablage die Datei liegt. */
  bereich: string
}

const DOCUMENT_COLUMNS = {
  id: documents.id,
  title: documents.title,
  docDate: documents.docDate,
  storagePath: documents.storagePath,
  deletedAt: documents.deletedAt,
  categoryId: documents.categoryId,
  bereich: documents.bereich,
}

/**
 * Die Dokumente dieser Kategorien – samt allem, was der Pfad braucht.
 *
 * Mehrere Kennungen auf einmal, weil eine Hauptkategorie nie allein betroffen
 * ist: Wer sie umbenennt oder löscht, meint immer auch die Dokumente in ihren
 * Unterkategorien.
 */
export async function documentsOfCategories(
  categoryIds: readonly string[],
): Promise<RelocatableDocument[]> {
  if (categoryIds.length === 0) return []
  return db
    .select(DOCUMENT_COLUMNS)
    .from(documents)
    .where(inArray(documents.categoryId, [...categoryIds]))
}

/**
 * Zieht die Dateien an den Ort nach, an den ihre heutige Kategorie gehört.
 *
 * Bewusst ohne den Namen als Parameter: Aufgerufen wird nach der Änderung, und
 * gefragt wird die Datenbank. Beim Umbenennen einer Hauptkategorie hat jedes
 * Dokument sonst einen anderen Zielordner – eines liegt in „Notfall", das
 * nächste in „Notfall/Medikamente" –, und der Aufrufer müsste dieselbe
 * Auflösung nochmals von Hand nachbauen.
 *
 * Schlägt das Verschieben fehl, bleibt die Datei liegen und der Pfad in der
 * Datenbank zeigt weiterhin auf sie: falsch einsortiert ist besser als
 * verloren. Was im Papierkorb liegt, bleibt dort – dessen Pfade zeigen bereits
 * nach `.trash` und sollen das bis zum Ablauf der Frist auch tun.
 */
export async function relocateDocuments(
  rows: readonly RelocatableDocument[],
): Promise<void> {
  // Ein Umbenennen betrifft schnell dreissig Dokumente derselben Kategorie –
  // ohne diesen Zwischenspeicher wären das dreissig gleiche Abfragen.
  const folders = new Map<string, { categoryName: string | null; parentCategoryName: string | null }>()

  for (const document of rows) {
    if (document.deletedAt) continue

    const bereich = document.bereich as Bereich
    const key = `${bereich}:${document.categoryId ?? ''}`
    let names = folders.get(key)
    if (!names) {
      names = await categoryFolderNames(bereich, document.categoryId)
      folders.set(key, names)
    }

    const nextPath = buildStoragePath({
      docDate: document.docDate,
      categoryName: names.categoryName,
      parentCategoryName: names.parentCategoryName,
      title: document.title,
      documentId: document.id,
      extension: document.storagePath.split('.').pop() ?? 'bin',
    })

    try {
      if (await moveWithinStorage(bereich, document.storagePath, nextPath)) {
        await db
          .update(documents)
          .set({ storagePath: nextPath })
          .where(eq(documents.id, document.id))
        // War es das letzte Dokument im alten Ordner, verschwindet auch er –
        // und danach womöglich der Ordner der Hauptkategorie darüber.
        const alt = dirname(document.storagePath)
        if (await removeEmptyDirectory(bereich, alt)) {
          await removeEmptyDirectory(bereich, dirname(alt))
        }
      }
    } catch {
      // Absicht: siehe oben.
    }
  }
}

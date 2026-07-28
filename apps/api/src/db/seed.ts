import { buildSearchText } from '@manager/shared'
import { eq, inArray } from 'drizzle-orm'

import { dirname } from 'node:path'

import { buildStoragePath, moveWithinStorage, removeEmptyDirectory } from '../lib/storage.js'
import { db } from './index.js'
import { categories, documents } from './schema.js'

/**
 * Die Kategorien der Ablage.
 *
 * „Unsortiert" steht bewusst nicht in dieser Liste: Das ist der Zustand eines
 * Dokuments, dem noch keine Kategorie zugewiesen wurde – und damit der
 * Zustand jedes frisch hochgeladenen. In der App heisst er längst überall so:
 * in der Detailansicht, in der Auswahl beim Bearbeiten und als Ordnername auf
 * dem NAS. Eine eigene Zeile in der Tabelle gäbe zwei Arten, dasselbe zu
 * sagen, und irgendwann stünden Dokumente in der einen und Dokumente in der
 * anderen.
 */
const CATEGORIES = [
  { name: 'Steuererklärung', icon: 'receipt', sortOrder: 10 },
  { name: 'Kinder', icon: 'child', sortOrder: 20 },
  { name: 'Rechnungen', icon: 'invoice', sortOrder: 30 },
  { name: 'Wichtige Dokumente', icon: 'star', sortOrder: 40 },
  { name: 'Sonstiges', icon: 'folder', sortOrder: 999 },
] as const

export interface CategorySync {
  added: string[]
  removed: string[]
  /** Dokumente, die durch das Entfernen wieder unsortiert sind. */
  unsorted: number
}

/**
 * Bringt die Kategorien in der Datenbank auf die Liste oben.
 *
 * Läuft bei jedem Start und ist danach ein No-Op. Die Liste im Code ist die
 * Wahrheit – es gibt keine Oberfläche, um Kategorien anzulegen, und ohne
 * diesen Abgleich bliebe eine Umbenennung ein Eingriff von Hand in die
 * SQLite-Datei. Wer eine Kategorie ergänzen will, ergänzt eine Zeile.
 *
 * Dokumente einer entfernten Kategorie gehen nicht verloren: Sie werden
 * unsortiert und ihre Datei wandert in den passenden Ordner nach.
 */
export async function syncCategories(): Promise<CategorySync> {
  const existing = await db.select().from(categories)
  const added: string[] = []

  for (const category of CATEGORIES) {
    const match = existing.find((row) => row.name === category.name)

    if (!match) {
      await db.insert(categories).values({ id: crypto.randomUUID(), ...category })
      added.push(category.name)
      continue
    }

    // Reihenfolge und Symbol dürfen sich ändern, ohne dass die Kategorie neu
    // angelegt werden muss – sonst verlören die Dokumente ihre Zuordnung.
    if (match.icon !== category.icon || match.sortOrder !== category.sortOrder) {
      await db
        .update(categories)
        .set({ icon: category.icon, sortOrder: category.sortOrder })
        .where(eq(categories.id, match.id))
    }
  }

  const obsolete = existing.filter(
    (row) => !CATEGORIES.some((category) => category.name === row.name),
  )
  if (obsolete.length === 0) return { added, removed: [], unsorted: 0 }

  const obsoleteIds = obsolete.map((row) => row.id)
  const affected = await db
    .select({
      id: documents.id,
      title: documents.title,
      docDate: documents.docDate,
      storagePath: documents.storagePath,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(inArray(documents.categoryId, obsoleteIds))

  await db
    .update(documents)
    .set({ categoryId: null })
    .where(inArray(documents.categoryId, obsoleteIds))
  await db.delete(categories).where(inArray(categories.id, obsoleteIds))

  for (const document of affected) {
    // Papierkorb ausgenommen: Dessen Pfade zeigen bereits in .trash und
    // sollen genau dort bleiben, bis die Frist abgelaufen ist.
    if (document.deletedAt) continue
    await moveToUnsorted(document)
  }

  return { added, removed: obsolete.map((row) => row.name), unsorted: affected.length }
}

/**
 * Zieht die Datei eines unsortiert gewordenen Dokuments nach.
 *
 * Ohne das läge eine Rechnung weiterhin im Ordner einer Kategorie, die es
 * nicht mehr gibt – und der Vorteil lesbarer Pfade auf dem NAS wäre dahin.
 * Schlägt das Verschieben fehl, bleibt die Datei liegen und der Pfad in der
 * Datenbank zeigt weiterhin auf sie: falsch einsortiert ist besser als
 * verloren.
 */
async function moveToUnsorted(document: {
  id: string
  title: string
  docDate: string
  storagePath: string
}): Promise<void> {
  const nextPath = buildStoragePath({
    docDate: document.docDate,
    categoryName: null,
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
      // War es das letzte Dokument der Kategorie, verschwindet ihr Ordner mit.
      await removeEmptyDirectory(dirname(document.storagePath))
    }
  } catch {
    // Absicht: siehe oben.
  }
}

/**
 * Füllt die Suchspalte für Dokumente, die vor ihrer Einführung angelegt
 * wurden. Eine SQL-Migration kann das nicht leisten – die Umlaut-Auflösung
 * steckt in JavaScript, nicht in SQLite.
 *
 * Ohne diesen Schritt wären ältere Dokumente nach einem Update stumm
 * unauffindbar: Sie stünden in der Liste, aber keine Suche würde sie zeigen.
 * Läuft bei jedem Start und ist nach dem ersten Mal ein No-Op.
 */
export async function backfillSearchText(): Promise<number> {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      vendor: documents.vendor,
      notes: documents.notes,
    })
    .from(documents)
    .where(eq(documents.searchText, ''))

  for (const row of rows) {
    await db
      .update(documents)
      .set({ searchText: buildSearchText(row) })
      .where(eq(documents.id, row.id))
  }

  return rows.length
}

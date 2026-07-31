import { buildSearchText } from '@manager/shared'
import { eq } from 'drizzle-orm'

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

/**
 * Legt die Erstausstattung an, solange keine einzige Kategorie da ist.
 *
 * Früher war die Liste oben die Wahrheit: Bei jedem Start wurde abgeglichen
 * und entfernt, was nicht darin stand. Seit sich Kategorien in der App anlegen
 * und löschen lassen, wäre genau das verkehrt – eine selbst angelegte
 * Kategorie überlebte den nächsten Neustart nicht, und eine gelöschte käme
 * zurück. Die Datenbank ist jetzt die Wahrheit; die Liste hier ist nur noch
 * der Anfang, damit ein frischer Haushalt nicht vor einer leeren Auswahl steht.
 */
export async function seedCategories(): Promise<string[]> {
  const existing = await db.select({ id: categories.id }).from(categories).limit(1)
  if (existing.length > 0) return []

  for (const category of CATEGORIES) {
    await db.insert(categories).values({ id: crypto.randomUUID(), ...category })
  }

  return CATEGORIES.map((category) => category.name)
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

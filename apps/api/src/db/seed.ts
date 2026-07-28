import { buildSearchText } from '@manager/shared'
import { eq, sql } from 'drizzle-orm'

import { db } from './index.js'
import { categories, documents } from './schema.js'

/**
 * Start-Kategorien. Bewusst nach dem gewählt, was in einem Schweizer Haushalt
 * tatsächlich im Briefkasten landet – nicht nach einer theoretischen Systematik.
 * Sie sind nur ein Anfang: Umbenennen und Ergänzen ist jederzeit möglich.
 */
const DEFAULT_CATEGORIES = [
  { name: 'Versicherung', icon: 'shield', sortOrder: 10 },
  { name: 'Steuern', icon: 'receipt', sortOrder: 20 },
  { name: 'Wohnen', icon: 'home', sortOrder: 30 },
  { name: 'Fahrzeug', icon: 'car', sortOrder: 40 },
  { name: 'Gesundheit', icon: 'heart', sortOrder: 50 },
  { name: 'Bank & Finanzen', icon: 'bank', sortOrder: 60 },
  { name: 'Arbeit', icon: 'briefcase', sortOrder: 70 },
  { name: 'Verträge', icon: 'file-signature', sortOrder: 80 },
  { name: 'Garantie & Quittung', icon: 'tag', sortOrder: 90 },
  { name: 'Behörden', icon: 'landmark', sortOrder: 100 },
  { name: 'Sonstiges', icon: 'folder', sortOrder: 999 },
] as const

/**
 * Läuft bei jedem Start, legt aber nur an, was fehlt. Eine vom Nutzer
 * umbenannte oder gelöschte Kategorie kehrt dadurch nicht zurück – bis auf die
 * Namen, die noch nie existierten.
 */
export async function seedCategories(): Promise<number> {
  const existing = await db.select({ count: sql<number>`count(*)` }).from(categories)
  if ((existing[0]?.count ?? 0) > 0) return 0

  await db.insert(categories).values(
    DEFAULT_CATEGORIES.map((category) => ({
      id: crypto.randomUUID(),
      ...category,
    })),
  )

  return DEFAULT_CATEGORIES.length
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

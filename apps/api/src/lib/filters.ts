/**
 * Was eine Mehrfachauswahl aus dem Suchfeld in der Adresse zu einer Bedingung
 * für die Datenbank macht.
 *
 * Steht hier und nicht in einer Route, seit die Kategorie zwei Listen filtert:
 * die Dokumente und – in der DocBase – die Notizen, die zwischen ihnen stehen.
 * Zwei Fassungen derselben Regel wären zwei Gelegenheiten, sie verschieden
 * auszulegen; wer „Notfall" anhakt, muss überall dasselbe sehen.
 */
import { UNCATEGORIZED } from '@manager/shared'
import { inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

import { db } from '../db/index.js'
import { categories } from '../db/schema.js'

/**
 * Trennt eine Mehrfachauswahl in echte Kennungen und das „ohne" darin – etwa
 * `unsortiert` bei den Kategorien. Leere Auswahl heisst „kein Filter" und gibt
 * null zurück, nicht eine Bedingung, die nichts durchlässt.
 */
export function auswahl(werte: string[] | undefined, ohneWert: string) {
  if (!werte || werte.length === 0) return null
  return {
    ohne: werte.includes(ohneWert),
    ids: werte.filter((wert) => wert !== ohneWert),
  }
}

/** Verknüpft die Teile eines Filters mit „oder" – fehlende Teile fallen weg. */
export function oderNichts(...teile: (SQL | undefined)[]): SQL {
  const vorhanden = teile.filter((teil): teil is SQL => teil !== undefined)
  // Mit einem Teil ist `or` überflüssig, mit keinem gäbe es nichts zu prüfen –
  // dann steht hier eine Bedingung, die nie zutrifft (die Auswahl war leer).
  if (vorhanden.length === 1) return vorhanden[0] as SQL
  return or(...vorhanden) ?? sql`1 = 0`
}

/**
 * Erweitert eine Kategorienauswahl um die Unterkategorien darin.
 *
 * Wer „Notfall" anhakt, meint alles, was darunter liegt – „Notfall ohne seine
 * Unterschubladen" ist keine Frage, die im Alltag jemand stellt. Umgekehrt
 * bleibt die Auswahl einer einzelnen Unterkategorie genau diese eine.
 */
export async function withSubcategories(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.parentId, [...ids]))

  return [...new Set([...ids, ...children.map((child) => child.id)])]
}

/**
 * Die Bedingung hinter dem Kategorienfilter – für jede Spalte, die auf eine
 * Kategorie zeigt. null heisst „nichts angehakt", also kein Filter.
 */
export async function categoryCondition(
  column: SQLiteColumn,
  gewaehlt: string[] | undefined,
): Promise<SQL | null> {
  const kategorien = auswahl(gewaehlt, UNCATEGORIZED)
  if (!kategorien) return null

  const ids = await withSubcategories(kategorien.ids)
  return oderNichts(
    kategorien.ohne ? isNull(column) : undefined,
    ids.length > 0 ? inArray(column, ids) : undefined,
  )
}

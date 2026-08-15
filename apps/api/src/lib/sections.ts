/**
 * Die Abteilungen der Einkaufsliste – wer sie kennt, kennt die Reihenfolge des
 * Ladenrundgangs.
 *
 * Sie stehen in der Datenbank und nicht mehr im Programmtext: Jeder Laden ist
 * anders angeordnet. Was hier steht, ist deshalb nicht die Liste selbst,
 * sondern der Weg zu ihr. Was sich ohne Datenbank beantworten lässt – wohin
 * Heimatloses kommt, wo eine neue Abteilung einsortiert wird –, steht im
 * geteilten Paket: Die Oberfläche stellt dieselben Fragen und soll nicht zu
 * anderen Antworten kommen.
 */
import { sameSectionName, type ShoppingSection } from '@manager/shared'
import { asc, eq } from 'drizzle-orm'

import { db } from '../db/index.js'
import { shoppingSections } from '../db/schema.js'

const SECTION_COLUMNS = {
  id: shoppingSections.id,
  name: shoppingSections.name,
  sortOrder: shoppingSections.sortOrder,
}

/** Alle Abteilungen in der Reihenfolge des Rundgangs. */
export async function listSections(): Promise<ShoppingSection[]> {
  return db
    .select(SECTION_COLUMNS)
    .from(shoppingSections)
    // Der Name als zweites Kriterium, damit zwei Abteilungen mit derselben
    // Zahl nicht bei jedem Abruf die Plätze tauschen.
    .orderBy(asc(shoppingSections.sortOrder), asc(shoppingSections.name))
}

export async function findSection(id: string): Promise<ShoppingSection | undefined> {
  const rows = await db
    .select(SECTION_COLUMNS)
    .from(shoppingSections)
    .where(eq(shoppingSections.id, id))
    .limit(1)

  return rows[0]
}

/**
 * Die Abteilung mit diesem Namen, `exceptId` ausgenommen (fürs Umbenennen).
 *
 * Verglichen wird vereinheitlicht: „Getränke" und „getraenke" sind für die
 * Datenbank zwei Zeilen, in der Auswahl beim Einsortieren aber zweimal
 * derselbe Knopf.
 */
export async function findSectionByName(
  name: string,
  exceptId?: string,
): Promise<ShoppingSection | undefined> {
  const sections = await listSections()
  return sections.find((section) => section.id !== exceptId && sameSectionName(section.name, name))
}


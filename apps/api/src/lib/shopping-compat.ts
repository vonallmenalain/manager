/**
 * Die Einkaufsliste in der Sprache der vorigen App-Version.
 *
 * Bis zu den eigenen Abteilungen stand im Eintrag der Name der Abteilung
 * („Molkerei"), seither ihre Kennung („molkerei"). Der Server hörte damit von
 * einem Tag auf den anderen auf, das Feld `section` zu schicken.
 *
 * Eine installierte App wechselt aber nicht in demselben Augenblick die
 * Sprache: Sie liegt als PWA auf dem Telefon und holt sich den neuen
 * Programmtext erst, wenn der Service Worker sie ablöst – beim nächsten Start,
 * nicht beim Neustart des Servers. Bis dahin fragt eine alte App den neuen
 * Server und findet das Feld nicht mehr, nach dem sie ihre ganze Liste
 * gruppiert.
 *
 * Das Ergebnis war keine Fehlermeldung, sondern etwas Schlimmeres: eine leere
 * Fläche, während in der Kopfzeile „23 offen" stand. Die alte App gruppierte
 * nach `item.section`, das nun überall `undefined` war, warf alle leeren
 * Gruppen weg – und behielt nichts übrig. Die Zählung daneben las die Einträge
 * direkt und stimmte weiter.
 *
 * Der Server spricht deshalb weiter beide Sprachen. Das kostet ein Feld in der
 * Antwort und ein paar Zeilen hier; eine Liste, die im Laden leer ist, kostet
 * den Einkauf. Wenn auf keinem Telefon mehr eine App von vor den eigenen
 * Abteilungen liegt, kann diese Datei ersatzlos weg.
 */
import {
  sameSectionName,
  STORE_SECTIONS,
  type ShoppingSection,
  type StoreSection,
} from '@manager/shared'

/**
 * Der Abteilungsname, den eine alte App erwartet.
 *
 * Sie kennt nur die neun Abteilungen der Erstausstattung – die stehen als
 * feste Liste in ihrem Programmtext. Eine später angelegte oder umbenannte
 * Abteilung ist für sie kein Name, sondern eine Gruppe, die es nicht gibt, und
 * sie liesse die Einträge darin wortlos verschwinden. Deshalb kommen sie unter
 * „Sonstiges": Das kennt jede alte App, und dort sucht man, was man nicht
 * findet.
 */
export function legacySectionName(
  sections: readonly ShoppingSection[],
  sectionId: string,
): StoreSection {
  const name = sections.find((section) => section.id === sectionId)?.name ?? ''
  return STORE_SECTIONS.find((bekannt) => sameSectionName(bekannt, name)) ?? 'Sonstiges'
}

/**
 * Die Abteilung, die eine alte App beim Einsortieren mitschickt – als Name.
 *
 * Ihre Anfrage sieht `{ section: "Molkerei" }` aus, wo die neue `{ sectionId:
 * "molkerei" }` schickt. Ohne diese Übersetzung fiele der Name beim Prüfen
 * stillschweigend weg: Es bliebe eine Änderung ohne Inhalt, und der Eintrag
 * bliebe unter dem Finger liegen, wo er war.
 */
export function legacySectionInput(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null

  const wert = (body as Record<string, unknown>).section
  if (typeof wert !== 'string') return null

  const name = wert.trim()
  return name ? name : null
}

/**
 * Die Kennung zu einem mitgeschickten Namen – oder nichts, wenn es die
 * Abteilung nicht mehr gibt.
 *
 * Verglichen wird wie überall vereinheitlicht, damit „Getränke" auch dann
 * trifft, wenn die alte App es anders schreibt als die Datenbank.
 */
export function legacySectionId(
  sections: readonly ShoppingSection[],
  name: string,
): string | undefined {
  return sections.find((section) => sameSectionName(section.name, name))?.id
}

import type { ShoppingItem, ShoppingSection } from '@manager/shared'

/**
 * Wie die Einkaufsliste aussieht – die beiden Fragen, die kein Bildschirm
 * beantworten kann, ohne dass man ihn öffnet: In welcher Gruppe steht ein
 * Eintrag, und wie liest sich ein Zeitpunkt?
 *
 * Beides steht deshalb hier und nicht in der Bildschirmdatei: So lässt es sich
 * prüfen, ohne einen Browser zu starten.
 */

export interface SectionGroup {
  key: string
  title: string
  items: ShoppingItem[]
}

/** Überschrift für alles, was zu keiner bekannten Abteilung gehört. */
export const OHNE_ABTEILUNG = 'Noch ohne Abteilung'

/**
 * Die Einträge, gruppiert nach Abteilung und in der Reihenfolge des
 * Ladenrundgangs. Leere Abteilungen fallen weg – im Laden interessiert der
 * Gang nicht, in dem nichts zu holen ist.
 *
 * Was zu keiner bekannten Abteilung gehört, fällt nicht unter den Tisch,
 * sondern sammelt sich am Ende. Das trifft den frisch getippten Eintrag, dem
 * der Server seine Abteilung noch nicht zugewiesen hat – und den Fall, dass am
 * anderen Gerät gerade eine Abteilung dazugekommen ist, die dieses hier noch
 * nicht kennt. Ein Eintrag, den man eingetippt hat und dann nirgends sieht,
 * wäre das Schlimmste, was dieser Liste passieren kann.
 */
export function nachAbteilung(
  items: readonly ShoppingItem[],
  sections: readonly ShoppingSection[],
): SectionGroup[] {
  const gruppen: SectionGroup[] = sections.map((section) => ({
    key: section.id,
    title: section.name,
    items: items.filter((item) => item.sectionId === section.id),
  }))

  const bekannt = new Set(sections.map((section) => section.id))
  const rest = items.filter((item) => !bekannt.has(item.sectionId))
  if (rest.length > 0) gruppen.push({ key: 'rest', title: OHNE_ABTEILUNG, items: rest })

  return gruppen.filter((gruppe) => gruppe.items.length > 0)
}

/**
 * Wann etwas erledigt wurde – kurz gehalten.
 *
 * Was heute passiert ist, steht mit der Uhrzeit da: „vor einer halben Stunde
 * abgehakt" ist im Laden die Auskunft, auf die es ankommt. Ältere Einträge
 * brauchen die Minute nicht mehr, dort genügt der Tag. Das Jahr steht nur
 * dabei, wenn es ein anderes ist – erledigte Einträge überleben selten den
 * nächsten Einkauf.
 */
export function erledigtAm(iso: string, jetzt = new Date()): string {
  const zeitpunkt = new Date(iso)
  // Ein unlesbarer Zeitstempel ergibt keine Zeile: „Invalid Date" hinter dem
  // Namen wäre schlechter als gar keine Angabe.
  if (Number.isNaN(zeitpunkt.getTime())) return ''

  const uhrzeit = zeitpunkt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
  const tage = tagesAbstand(zeitpunkt, jetzt)

  if (tage === 0) return uhrzeit
  if (tage === 1) return `gestern ${uhrzeit}`

  return zeitpunkt.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    ...(zeitpunkt.getFullYear() === jetzt.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/**
 * Wie viele Kalendertage dazwischenliegen – gerechnet auf den Tag und nicht
 * auf 24 Stunden. Sonst wäre um Mitternacht abgehaktes am nächsten Morgen
 * noch „heute" und würde erst am Nachmittag zu „gestern".
 */
function tagesAbstand(frueher: Date, spaeter: Date): number {
  const tag = (datum: Date) => new Date(datum.getFullYear(), datum.getMonth(), datum.getDate())
  return Math.round((tag(spaeter).getTime() - tag(frueher).getTime()) / 86_400_000)
}

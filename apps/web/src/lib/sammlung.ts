import type { ManagedDocument, Note } from '@manager/shared'

/**
 * Ein Eintrag der Sammlung – ein Dokument oder eine Notiz.
 *
 * Beide stehen in einer Liste, weil sie dieselbe Frage beantworten: „Was habe
 * ich zu diesem Thema?" Eine zweite Liste daneben hiesse, an zwei Orten zu
 * suchen und die Antwort erst im Kopf zusammenzusetzen.
 */
export type Eintrag =
  | { art: 'dokument'; id: string; tag: string; zeit: string; document: ManagedDocument }
  | { art: 'notiz'; id: string; tag: string; zeit: string; note: Note }

/**
 * Dokumente und Notizen in eine Reihenfolge bringen.
 *
 * Angeheftete Notizen stehen zuoberst – dafür heftet man sie an. Alles andere
 * ordnet sich nach dem Datum: beim Dokument das Datum darauf, bei der Notiz
 * der Tag, an dem zuletzt daran geschrieben wurde. Das ist bei beiden die
 * Angabe, nach der man in einer Sammlung sucht.
 *
 * Steht hier und nicht im Bildschirm daneben, weil es die einzige Stelle ist,
 * an der die beiden Listen zu einer werden – und die einzige, die sich ohne
 * Browser prüfen lässt.
 */
export function mische(
  documents: readonly ManagedDocument[],
  notes: readonly Note[],
): Eintrag[] {
  const angeheftet: Eintrag[] = []
  const rest: Eintrag[] = []

  for (const document of documents) {
    rest.push({
      art: 'dokument',
      id: document.id,
      tag: document.docDate,
      zeit: document.uploadedAt,
      document,
    })
  }

  for (const note of notes) {
    const eintrag: Eintrag = {
      art: 'notiz',
      id: note.id,
      tag: note.updatedAt.slice(0, 10),
      zeit: note.updatedAt,
      note,
    }
    if (note.pinned) angeheftet.push(eintrag)
    else rest.push(eintrag)
  }

  // Beide Zeitangaben sind ISO-Text – der Vergleich als Zeichenkette ist
  // deshalb derselbe wie der zeitliche, ohne ein einziges Date-Objekt.
  const neuesteZuerst = (a: Eintrag, b: Eintrag) =>
    b.tag.localeCompare(a.tag) || b.zeit.localeCompare(a.zeit)

  return [...angeheftet.sort(neuesteZuerst), ...rest.sort(neuesteZuerst)]
}

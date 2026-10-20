import type { Auftrag } from './auftraege'
import { api, ApiRequestError } from '../api'

/**
 * Was „schon weg" heisst, ist erledigt: Ein Eintrag, den die andere Person
 * inzwischen gelöscht hat, muss hier niemand mehr löschen – und eine Notiz,
 * die schon zurückgeholt ist, nicht nochmals.
 */
async function ohneNichtGefunden(anfrage: Promise<unknown>): Promise<void> {
  try {
    await anfrage
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return
    throw error
  }
}

/** Ein Auftrag der Warteschlange als Anfrage an den Server. */
export async function auftragSenden(auftrag: Auftrag): Promise<void> {
  switch (auftrag.art) {
    case 'einkauf.neu':
      // Die vermutete Abteilung bleibt hier: Welche es wird, entscheidet der
      // Server mit dem Gedächtnis der Liste.
      await api.addShoppingItem({ id: auftrag.id, text: auftrag.text })
      return
    case 'einkauf.aendern':
      await ohneNichtGefunden(api.updateShoppingItem(auftrag.id, auftrag.changes))
      return
    case 'einkauf.loeschen':
      await ohneNichtGefunden(api.deleteShoppingItem(auftrag.id))
      return
    case 'einkauf.aufraeumen':
      await api.clearDoneShoppingItems({ ids: auftrag.ids })
      return
    case 'einkauf.zurueck':
      await api.restoreShoppingItems({
        items: auftrag.items.map((item) => ({
          id: item.id,
          text: item.text,
          sectionId: item.sectionId,
          done: item.done,
          createdBy: item.createdBy,
          doneBy: item.doneBy,
          createdAt: item.createdAt,
          doneAt: item.doneAt,
        })),
      })
      return
    case 'notiz.speichern':
      // Gibt es die Notiz auf dem Server nicht mehr, geht die Meldung bis zum
      // Menschen durch: Was er geschrieben hat, ist dann nicht angekommen.
      if (auftrag.neu) await api.createNote({ ...auftrag.note, id: auftrag.id })
      else await api.updateNote(auftrag.id, auftrag.note)
      return
    case 'notiz.loeschen':
      await ohneNichtGefunden(api.deleteNote(auftrag.id))
      return
    case 'notiz.zurueck':
      await ohneNichtGefunden(api.restoreNote(auftrag.id))
      return
    case 'notiz.reihenfolge':
      await api.reorderNotes({ bereich: auftrag.bereich, ids: auftrag.ids })
      return
  }
}

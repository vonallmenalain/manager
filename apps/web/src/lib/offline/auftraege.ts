import {
  compareNotesInOwnOrder,
  NOTE_SORT_STEP,
  normalizeForSearch,
  parseChecklist,
  placeInOrder,
  UNCATEGORIZED,
  type Bereich,
  type Note,
  type ShoppingItem,
  type UpdateShoppingItemInput,
  type UpsertNoteInput,
} from '@manager/shared'

/**
 * Die Änderungen, die auf dem Gerät warten, bis der Server sie bekommt.
 *
 * Jede Änderung an Einkaufsliste und Notizen wird zuerst ein Auftrag: Er
 * steht sofort in der Liste auf dem Bildschirm und wird übertragen, sobald
 * der Server erreichbar ist – gleich, im Laden ohne Empfang erst später oder
 * nach einem Neustart der App. Die Reihenfolge bleibt dabei erhalten.
 *
 * Hier stehen nur die Aufträge selbst und wie sie sich auf eine Liste
 * auswirken. Das ist reine Rechnerei ohne Browser und deshalb prüfbar; das
 * Speichern und Senden steht in `warteschlange.ts`.
 *
 * Was neu entsteht, bekommt seine Kennung hier auf dem Gerät. So lässt sich
 * ein eben angelegter Eintrag abhaken, bevor der Server ihn kennt, und eine
 * wiederholte Anfrage legt nichts doppelt an (siehe `clientIdSchema`).
 */
export type AuftragsInhalt =
  | { art: 'einkauf.neu'; id: string; text: string; abteilung?: string; von: string }
  | { art: 'einkauf.aendern'; id: string; changes: UpdateShoppingItemInput; von: string }
  | { art: 'einkauf.loeschen'; id: string }
  | { art: 'einkauf.aufraeumen'; ids: string[] }
  | { art: 'einkauf.zurueck'; items: ShoppingItem[] }
  | { art: 'notiz.speichern'; id: string; neu: boolean; note: UpsertNoteInput; von: string }
  | { art: 'notiz.loeschen'; id: string }
  | { art: 'notiz.zurueck'; id: string; notiz?: Note }
  | { art: 'notiz.reihenfolge'; bereich: Bereich; ids: string[] }

export type Auftrag = AuftragsInhalt & {
  /** Eindeutig je Auftrag – fürs Ersetzen und Entfernen. */
  nr: string
  /** Wann es geschah – zeigt die Liste als Zeitpunkt der Änderung an. */
  zeit: string
  /**
   * Wer angemeldet war. Meldet sich auf dem Gerät inzwischen jemand anderes
   * an, geht der Auftrag nicht unter dessen Namen zum Server – eine private
   * Notiz gehörte sonst plötzlich der anderen Person.
   */
  benutzer?: string
}

/**
 * Zwei Aufträge zu einem, wenn der zweite den ersten ohnehin überschreibt.
 *
 * Das Notizfenster speichert alle paar Sekunden; ohne Verbindung stünden nach
 * einer Viertelstunde Schreiben hundert Fassungen derselben Notiz in der
 * Schlange, von denen nur die letzte zählt. Eine Notiz, die noch angelegt
 * werden muss, bleibt dabei „neu".
 */
export function zusammenfassen(vorher: Auftrag, danach: Auftrag): Auftrag | null {
  if (vorher.art === 'notiz.speichern' && danach.art === 'notiz.speichern') {
    if (vorher.id !== danach.id) return null
    return { ...danach, nr: vorher.nr, neu: vorher.neu || danach.neu }
  }
  if (vorher.art === 'einkauf.aendern' && danach.art === 'einkauf.aendern') {
    if (vorher.id !== danach.id) return null
    return { ...danach, nr: vorher.nr, changes: { ...vorher.changes, ...danach.changes } }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Einkaufsliste                                                       */
/* ------------------------------------------------------------------ */

function einkaufEinzeln(items: ShoppingItem[], auftrag: Auftrag): ShoppingItem[] {
  switch (auftrag.art) {
    case 'einkauf.neu':
      if (items.some((item) => item.id === auftrag.id)) return items
      return [
        ...items,
        {
          id: auftrag.id,
          text: auftrag.text,
          // Welche Abteilung es wird, entscheidet der Server mit dem
          // Gedächtnis der Liste. Bis dahin gilt die Vermutung von hier –
          // ohne sie stünde der Eintrag unter „Noch ohne Abteilung".
          sectionId: auftrag.abteilung ?? '',
          done: false,
          createdBy: auftrag.von,
          doneBy: null,
          createdAt: auftrag.zeit,
          doneAt: null,
        },
      ]
    case 'einkauf.aendern':
      return items.map((item) => {
        if (item.id !== auftrag.id) return item
        const { done, ...rest } = auftrag.changes
        const next: ShoppingItem = { ...item, ...rest }
        if (done !== undefined) {
          next.done = done
          next.doneBy = done ? auftrag.von : null
          next.doneAt = done ? auftrag.zeit : null
        }
        return next
      })
    case 'einkauf.loeschen':
      return items.filter((item) => item.id !== auftrag.id)
    case 'einkauf.aufraeumen': {
      const weg = new Set(auftrag.ids)
      return items.filter((item) => !(item.done && weg.has(item.id)))
    }
    case 'einkauf.zurueck': {
      const da = new Set(items.map((item) => item.id))
      return [...items, ...auftrag.items.filter((item) => !da.has(item.id))]
    }
    default:
      return items
  }
}

/**
 * Die Einkaufsliste, wie sie mit den wartenden Änderungen aussieht.
 *
 * Läuft über jede frisch geholte Liste: Sonst setzte die nächste Antwort des
 * Servers – die von den wartenden Änderungen noch nichts weiss – den Haken
 * wieder zurück, den man eben gesetzt hat.
 */
export function einkaufMit(
  items: readonly ShoppingItem[],
  auftraege: readonly Auftrag[],
): ShoppingItem[] {
  return auftraege.reduce(einkaufEinzeln, [...items])
}

/* ------------------------------------------------------------------ */
/* Notizen                                                             */
/* ------------------------------------------------------------------ */

/** Wonach eine Notizliste gefragt hat – wie `NoteFilters` in household.ts. */
export interface NotizFilter {
  bereich?: Bereich
  q?: string
  categoryId?: string[]
}

/**
 * Gehört eine Notiz, die es auf dem Server noch nicht gibt, in diese Liste?
 *
 * Dieselben Fragen wie auf dem Server, so weit sie sich hier beantworten
 * lassen: Bereich, Suchbegriff, Kategorie. Unterkategorien kennt das Gerät
 * an dieser Stelle nicht – eine neue Notiz in einer Unterkategorie erscheint
 * unter dem Häkchen der Hauptkategorie erst, wenn der Server sie kennt.
 */
function passt(note: Note, filter: NotizFilter): boolean {
  if (note.bereich !== (filter.bereich ?? 'manager')) return false
  if (filter.q) {
    const text =
      note.kind === 'liste'
        ? parseChecklist(note.body)
            .map((item) => item.text)
            .join(' ')
        : note.body
    if (!normalizeForSearch(`${note.title} ${text}`).includes(normalizeForSearch(filter.q))) {
      return false
    }
  }
  if (filter.categoryId && filter.categoryId.length > 0) {
    const kategorie = note.categoryId ?? UNCATEGORIZED
    if (!filter.categoryId.includes(kategorie)) return false
  }
  return true
}

/**
 * Die Notiz, wie sie nach dem Speichern dasteht – aus der bisherigen und dem,
 * was das Fenster geschickt hat. Ohne bisherige ist sie neu: oben in der
 * eigenen Reihenfolge, wie es auch der Server hielte.
 */
export function notizNach(
  auftrag: Extract<Auftrag, { art: 'notiz.speichern' }>,
  bisher: Note | undefined,
  kleinsterPlatz = 0,
): Note {
  const { note } = auftrag
  return {
    id: auftrag.id,
    createdBy: bisher?.createdBy ?? auftrag.von,
    createdAt: bisher?.createdAt ?? auftrag.zeit,
    sortOrder: bisher?.sortOrder ?? Math.min(0, kleinsterPlatz - NOTE_SORT_STEP),
    title: note.title,
    body: note.body,
    bodyRich: note.bodyRich === undefined ? (bisher?.bodyRich ?? null) : note.bodyRich,
    kind: note.kind,
    bereich: note.bereich,
    categoryId: note.categoryId,
    pinned: note.pinned,
    // In der DocBase gehört jede Notiz allen – so hält es auch der Server.
    shared: note.bereich === 'docbase' ? true : note.shared,
    color: note.color,
    updatedBy: auftrag.von,
    updatedAt: auftrag.zeit,
  }
}

function notizenEinzeln(notes: Note[], auftrag: Auftrag, filter: NotizFilter): Note[] {
  switch (auftrag.art) {
    case 'notiz.speichern': {
      const index = notes.findIndex((note) => note.id === auftrag.id)
      if (index !== -1) {
        const next = [...notes]
        next[index] = notizNach(auftrag, notes[index])
        return next
      }
      const kleinster = notes
        .filter((note) => note.bereich === auftrag.note.bereich)
        .reduce((min, note) => Math.min(min, note.sortOrder ?? 0), 0)
      const neu = notizNach(auftrag, undefined, kleinster)
      return passt(neu, filter) ? [neu, ...notes] : notes
    }
    case 'notiz.loeschen':
      return notes.filter((note) => note.id !== auftrag.id)
    case 'notiz.zurueck':
      if (!auftrag.notiz || notes.some((note) => note.id === auftrag.id)) return notes
      return passt(auftrag.notiz, filter) ? [auftrag.notiz, ...notes] : notes
    case 'notiz.reihenfolge': {
      if ((filter.bereich ?? 'manager') !== auftrag.bereich) return notes
      // Dieselbe Rechnung wie auf dem Server (siehe die Route).
      const bisher = [...notes].sort(compareNotesInOwnOrder)
      const platz = new Map(
        placeInOrder(
          bisher.map((note) => note.id),
          auftrag.ids,
        ).map((id, index) => [id, (index + 1) * NOTE_SORT_STEP]),
      )
      return notes.map((note) => ({ ...note, sortOrder: platz.get(note.id) ?? note.sortOrder }))
    }
    default:
      return notes
  }
}

/** Eine Notizliste, wie sie mit den wartenden Änderungen aussieht – siehe `einkaufMit`. */
export function notizenMit(
  notes: readonly Note[],
  auftraege: readonly Auftrag[],
  filter: NotizFilter,
): Note[] {
  return auftraege.reduce<Note[]>(
    (stand, auftrag) => notizenEinzeln(stand, auftrag, filter),
    [...notes],
  )
}

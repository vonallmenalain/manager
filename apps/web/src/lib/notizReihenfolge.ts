import { compareNotesInOwnOrder, type Note } from '@manager/shared'

/**
 * Wie die Notizen in der Übersicht stehen: in der eigenen Reihenfolge – oder,
 * wie früher, die zuletzt bearbeitete zuoberst.
 *
 * Eine Einstellung am Gerät wie die übrigen der Ansicht; die Reihenfolge
 * selbst steht auf dem Server und gilt überall.
 */
export const NOTIZ_REIHENFOLGEN = ['eigene', 'bearbeitet'] as const
export type NotizReihenfolge = (typeof NOTIZ_REIHENFOLGEN)[number]

export const NOTIZ_REIHENFOLGE_LABELS: Record<NotizReihenfolge, string> = {
  eigene: 'Eigene Reihenfolge',
  bearbeitet: 'Zuletzt bearbeitet',
}

/**
 * Die Notizen in der gewählten Reihenfolge. Angeheftete stehen in beiden
 * zuoberst. „Zuletzt bearbeitet" ist die Reihenfolge, in der der Server sie
 * schickt.
 */
export function sortiereNotizen<T extends Pick<Note, 'pinned' | 'sortOrder' | 'updatedAt'>>(
  notes: readonly T[],
  reihenfolge: NotizReihenfolge,
): T[] {
  return reihenfolge === 'eigene' ? [...notes].sort(compareNotesInOwnOrder) : [...notes]
}

/**
 * Die neue Reihenfolge, wenn `id` einen Platz nach vorne (-1) oder hinten (1)
 * rückt – oder `null`, wenn es dort nicht weitergeht. Über die Grenze zwischen
 * Angeheftetem und dem Rest geht es nie: Angeheftetes steht immer oben.
 */
export function verschoben(
  notes: readonly Pick<Note, 'id' | 'pinned'>[],
  id: string,
  richtung: -1 | 1,
): string[] | null {
  const index = notes.findIndex((note) => note.id === id)
  const a = notes[index]
  const b = notes[index + richtung]
  if (!a || !b || a.pinned !== b.pinned) return null
  const ids = notes.map((note) => note.id)
  ids[index] = b.id
  ids[index + richtung] = a.id
  return ids
}

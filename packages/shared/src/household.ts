import { z } from 'zod'

import { normalizeForSearch } from './documents.js'

/**
 * Abteilungen im Laden, in der Reihenfolge, in der man sie üblicherweise
 * abläuft. Die Einkaufsliste sortiert danach, damit man nicht zweimal durch
 * denselben Gang muss.
 */
export const STORE_SECTIONS = [
  'Früchte & Gemüse',
  'Brot & Backwaren',
  'Molkerei',
  'Fleisch & Fisch',
  'Vorrat',
  'Tiefkühl',
  'Getränke',
  'Haushalt',
  'Sonstiges',
] as const

export type StoreSection = (typeof STORE_SECTIONS)[number]

/**
 * Erstzuordnung für einen neuen Eintrag, wenn er noch nie auf der Liste stand.
 *
 * Bewusst eine schlichte Stichwortliste statt einer klugen Erkennung: Wird sie
 * einmal korrigiert, merkt sich die App die Zuordnung ohnehin dauerhaft. Sie
 * muss also nur oft genug richtig liegen, um Arbeit zu sparen.
 */
export const SECTION_KEYWORDS: Record<string, StoreSection> = {
  apfel: 'Früchte & Gemüse',
  banane: 'Früchte & Gemüse',
  salat: 'Früchte & Gemüse',
  tomate: 'Früchte & Gemüse',
  gurke: 'Früchte & Gemüse',
  zwiebel: 'Früchte & Gemüse',
  kartoffel: 'Früchte & Gemüse',
  karotte: 'Früchte & Gemüse',
  // „Rüebli“ wird zu „rueebli“ ausgeschrieben, „Rübli“ zu „ruebli“ – beide
  // Schreibweisen sind hier gebräuchlich, also stehen beide in der Liste.
  rueebli: 'Früchte & Gemüse',
  ruebli: 'Früchte & Gemüse',
  zucchetti: 'Früchte & Gemüse',
  peperoni: 'Früchte & Gemüse',
  zitrone: 'Früchte & Gemüse',
  beeren: 'Früchte & Gemüse',
  obst: 'Früchte & Gemüse',
  gemuese: 'Früchte & Gemüse',

  brot: 'Brot & Backwaren',
  broetchen: 'Brot & Backwaren',
  gipfeli: 'Brot & Backwaren',
  zopf: 'Brot & Backwaren',
  kuchen: 'Brot & Backwaren',

  milch: 'Molkerei',
  butter: 'Molkerei',
  kaese: 'Molkerei',
  joghurt: 'Molkerei',
  rahm: 'Molkerei',
  quark: 'Molkerei',
  ei: 'Molkerei',
  eier: 'Molkerei',

  fleisch: 'Fleisch & Fisch',
  poulet: 'Fleisch & Fisch',
  hackfleisch: 'Fleisch & Fisch',
  wurst: 'Fleisch & Fisch',
  schinken: 'Fleisch & Fisch',
  lachs: 'Fleisch & Fisch',
  fisch: 'Fleisch & Fisch',

  reis: 'Vorrat',
  teigwaren: 'Vorrat',
  pasta: 'Vorrat',
  mehl: 'Vorrat',
  zucker: 'Vorrat',
  salz: 'Vorrat',
  oel: 'Vorrat',
  essig: 'Vorrat',
  konserve: 'Vorrat',
  mueesli: 'Vorrat',
  kaffee: 'Vorrat',
  tee: 'Vorrat',

  glace: 'Tiefkühl',
  pizza: 'Tiefkühl',
  tiefkuehl: 'Tiefkühl',

  wasser: 'Getränke',
  saft: 'Getränke',
  bier: 'Getränke',
  wein: 'Getränke',
  sirup: 'Getränke',

  waschmittel: 'Haushalt',
  abwaschmittel: 'Haushalt',
  putzmittel: 'Haushalt',
  klopapier: 'Haushalt',
  wc: 'Haushalt',
  haushaltpapier: 'Haushalt',
  zahnpasta: 'Haushalt',
  shampoo: 'Haushalt',
  seife: 'Haushalt',
  batterien: 'Haushalt',
}

export function guessSection(text: string): StoreSection {
  const normalized = normalizeForSearch(text)
  for (const word of normalized.split(' ')) {
    const hit = SECTION_KEYWORDS[word]
    if (hit) return hit
  }
  // Auch Teilwörter prüfen: „Vollmilch" soll bei „milch" landen.
  for (const [keyword, section] of Object.entries(SECTION_KEYWORDS)) {
    if (keyword.length >= 4 && normalized.includes(keyword)) return section
  }
  return 'Sonstiges'
}

export const storeSectionSchema = z.enum(STORE_SECTIONS)

export const shoppingItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  section: storeSectionSchema,
  done: z.boolean(),
  createdBy: z.string(),
  doneBy: z.string().nullable(),
  createdAt: z.string(),
  doneAt: z.string().nullable(),
})

export type ShoppingItem = z.infer<typeof shoppingItemSchema>

export const createShoppingItemSchema = z.object({
  text: z.string().trim().min(1, 'Bitte etwas eingeben').max(120, 'Zu lang'),
  section: storeSectionSchema.optional(),
})

export type CreateShoppingItemInput = z.infer<typeof createShoppingItemSchema>

export const updateShoppingItemSchema = z.object({
  text: z.string().trim().min(1).max(120).optional(),
  section: storeSectionSchema.optional(),
  done: z.boolean().optional(),
})

export type UpdateShoppingItemInput = z.infer<typeof updateShoppingItemSchema>

/** Farben für Notizen – gedeckt gehalten, damit die Liste ruhig bleibt. */
export const NOTE_COLORS = ['default', 'gelb', 'gruen', 'blau', 'rosa'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export const noteColorSchema = z.enum(NOTE_COLORS)

/**
 * Zwei Arten von Notiz: Fliesstext oder eine Liste zum Abhaken.
 *
 * Beide liegen im selben Feld `body`. Eine Checkliste schreibt je Zeile einen
 * Eintrag, dem ein `[ ]` oder `[x]` vorangeht – dieselbe Schreibweise, die
 * Menschen ohnehin verwenden. Eine eigene Tabelle für Listeneinträge wäre die
 * lehrbuchmässige Lösung und hier reiner Ballast: Es gibt kein Sortieren über
 * Notizen hinweg, keine Rechte je Eintrag, und eine Notiz wird immer als
 * Ganzes gespeichert. Dafür bleibt die Notiz in der Datenbank lesbar, und die
 * Volltextsuche findet sie ohne Zusatzarbeit.
 */
export const NOTE_KINDS = ['text', 'liste'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

export const noteKindSchema = z.enum(NOTE_KINDS)

export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  text: 'Text',
  liste: 'Checkliste',
}

export interface ChecklistItem {
  text: string
  done: boolean
}

/** `[x] Milch`, `[ ] Brot` – auch mit vorangestelltem Listenstrich. */
const CHECKLIST_LINE = /^\s*(?:[-*]\s*)?\[([ xX])\]\s?(.*)$/

/**
 * Liest die Einträge einer Checkliste.
 *
 * Zeilen ohne Kästchen werden zu offenen Einträgen. Das ist der Fall, wenn
 * aus einer Textnotiz eine Liste wird oder jemand etwas hineinkopiert – beides
 * soll Einträge ergeben und keine Fehlermeldung.
 */
export function parseChecklist(body: string): ChecklistItem[] {
  const items: ChecklistItem[] = []

  for (const line of body.split('\n')) {
    const match = CHECKLIST_LINE.exec(line)
    const text = (match ? (match[2] ?? '') : line).trim()
    if (!text) continue
    items.push({ text, done: match ? (match[1] ?? ' ').toLowerCase() === 'x' : false })
  }

  return items
}

/** Schreibt die Einträge zurück. Leere fallen weg – sie sind eine Zeile im Entstehen. */
export function serializeChecklist(items: readonly ChecklistItem[]): string {
  return items
    .filter((item) => item.text.trim() !== '')
    .map((item) => `[${item.done ? 'x' : ' '}] ${item.text.trim()}`)
    .join('\n')
}

/**
 * Erledigtes nach unten.
 *
 * Eine Liste beantwortet die Frage „was ist noch zu tun" – und die steht dann
 * oben, ohne dass man zwischen Durchgestrichenem suchen muss. Die Reihenfolge
 * innerhalb der beiden Gruppen bleibt erhalten: Wer sich beim Schreiben etwas
 * dabei gedacht hat, findet es wieder.
 *
 * Sortiert wird der gespeicherte Inhalt selbst, nicht nur die Anzeige. So
 * sieht die Liste auf jedem Gerät gleich aus, und die Vorschau in der
 * Übersicht zeigt dieselben offenen Punkte wie die geöffnete Notiz.
 */
export function sortChecklist(items: readonly ChecklistItem[]): ChecklistItem[] {
  return [...items.filter((item) => !item.done), ...items.filter((item) => item.done)]
}

export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  kind: noteKindSchema,
  pinned: z.boolean(),
  /**
   * false heisst „nur für mich". Eine Notiz ist zunächst privat und wird
   * bewusst freigegeben – umgekehrt hätte man Geteiltes, das nie jemand
   * teilen wollte.
   */
  shared: z.boolean(),
  color: noteColorSchema,
  createdBy: z.string(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Note = z.infer<typeof noteSchema>

export const upsertNoteSchema = z
  .object({
    title: z.string().trim().max(120).default(''),
    body: z.string().max(20_000).default(''),
    kind: noteKindSchema.default('text'),
    pinned: z.boolean().default(false),
    shared: z.boolean().default(false),
    color: noteColorSchema.default('default'),
  })
  .refine((note) => note.title.trim() !== '' || note.body.trim() !== '', {
    message: 'Titel oder Text ausfüllen',
  })

export type UpsertNoteInput = z.infer<typeof upsertNoteSchema>

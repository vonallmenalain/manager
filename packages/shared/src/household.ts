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

export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  pinned: z.boolean(),
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
    pinned: z.boolean().default(false),
    color: noteColorSchema.default('default'),
  })
  .refine((note) => note.title.trim() !== '' || note.body.trim() !== '', {
    message: 'Titel oder Text ausfüllen',
  })

export type UpsertNoteInput = z.infer<typeof upsertNoteSchema>

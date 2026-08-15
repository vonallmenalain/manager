import { z } from 'zod'

import { normalizeForSearch } from './documents.js'

/**
 * Die Abteilungen, mit denen eine frische Einkaufsliste beginnt – in der
 * Reihenfolge, in der man sie üblicherweise abläuft. Die Liste sortiert
 * danach, damit man nicht zweimal durch denselben Gang muss.
 *
 * Seit sich Abteilungen in der App anlegen, umbenennen und umordnen lassen,
 * ist diese Liste nicht mehr die Wahrheit, sondern nur noch der Anfang: Die
 * Datenbank sagt, welche Abteilungen dieser Haushalt hat und in welcher
 * Reihenfolge sie stehen. Hier steht, womit er startet – und woran die
 * Stichwortliste unten ihre Erstzuordnung hängt.
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

/**
 * Eine Abteilung, wie sie in der Datenbank steht.
 *
 * Ein Eintrag zeigt mit `sectionId` darauf und nicht auf den Namen: Wer
 * „Molkerei" in „Kühlregal" umbenennt, meint dieselbe Abteilung – und alles,
 * was darin liegt, soll darin bleiben.
 */
export const shoppingSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Kleiner heisst weiter vorn im Laden. */
  sortOrder: z.number(),
})

export type ShoppingSection = z.infer<typeof shoppingSectionSchema>

const sectionNameSchema = z
  .string()
  .trim()
  .min(1, 'Bitte einen Namen eingeben')
  .max(40, 'Zu lang')

export const createShoppingSectionSchema = z.object({ name: sectionNameSchema })

export type CreateShoppingSectionInput = z.infer<typeof createShoppingSectionSchema>

export const updateShoppingSectionSchema = z.object({ name: sectionNameSchema })

export type UpdateShoppingSectionInput = z.infer<typeof updateShoppingSectionSchema>

/**
 * Die neue Reihenfolge, als ganze Liste von Kennungen.
 *
 * Bewusst nicht „schieb diese eine Abteilung um einen Platz": Wer zweimal
 * schnell hintereinander tippt, schickt sonst zwei Anweisungen, die beide vom
 * alten Stand ausgehen – und die Liste steht danach anders da, als sie auf dem
 * Bildschirm aussah.
 */
export const reorderShoppingSectionsSchema = z.object({
  ids: z.array(z.string()).min(1, 'Keine Abteilungen angegeben'),
})

export type ReorderShoppingSectionsInput = z.infer<typeof reorderShoppingSectionsSchema>

/**
 * Zwei Abteilungen gelten als dieselbe, wenn sie sich nur in Gross- und
 * Kleinschreibung, Umlautschreibweise oder Leerzeichen unterscheiden.
 *
 * „Getränke" und „getraenke" wären zwei Zeilen in der Datenbank, in der
 * Auswahl beim Einsortieren aber zweimal derselbe Knopf – und man träfe nie
 * verlässlich denselben.
 */
export function sameSectionName(a: string, b: string): boolean {
  return normalizeForSearch(a) === normalizeForSearch(b)
}

/**
 * Die Abteilung, in der landet, was sich nicht zuordnen lässt – „Sonstiges"
 * aus der Erstausstattung.
 *
 * Kein Merkmal an der Zeile, sondern eine feste Kennung: Ein Merkmal müsste
 * beim Löschen weitergereicht werden, und dann gäbe es Zustände ohne
 * Sammelposten.
 */
export const CATCH_ALL_SECTION_ID = 'sonstiges'

/**
 * Wohin ein Eintrag kommt, für den keine Abteilung feststeht – und wohin die
 * Einträge einer gelöschten Abteilung wandern.
 *
 * `exclude` ist die Abteilung, die gerade verschwindet: Sie darf das Ziel
 * nicht sein. Wurde der Sammelposten selbst gelöscht, ist es die letzte
 * Abteilung – dort steht ein Sammelposten in einem Laden ohnehin. Gibt es
 * überhaupt keine andere, ist die Antwort `undefined`; dann verhindert der
 * Server das Löschen, statt Einträge ins Leere zu schieben.
 */
export function catchAllSection(
  sections: readonly ShoppingSection[],
  exclude?: string,
): ShoppingSection | undefined {
  const uebrig = sections.filter((section) => section.id !== exclude)
  return uebrig.find((section) => section.id === CATCH_ALL_SECTION_ID) ?? uebrig[uebrig.length - 1]
}

/**
 * Der Abstand zwischen zwei Abteilungen in der Sortierung. Die Lücken sind
 * Absicht: Eine neue Abteilung hängt sich hinten an, ohne dass eine einzige
 * bestehende Zeile angefasst werden muss.
 */
export const SECTION_SORT_STEP = 10

/** Ganz hinten, mit Abstand zur letzten Abteilung. */
export function nextSectionSortOrder(sections: readonly ShoppingSection[]): number {
  const letzte = sections[sections.length - 1]
  return letzte ? letzte.sortOrder + SECTION_SORT_STEP : SECTION_SORT_STEP
}

export const shoppingItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  sectionId: z.string(),
  /**
   * Der Name der Abteilung, nur für eine App, die noch von vor den eigenen
   * Abteilungen stammt und danach gruppiert – siehe
   * `apps/api/src/lib/shopping-compat.ts`. Die heutige Oberfläche liest
   * `sectionId`; wer hier etwas anzeigt, zeigt einen Namen an, der nach dem
   * Umbenennen einer Abteilung nicht mehr stimmt.
   */
  section: storeSectionSchema.optional(),
  done: z.boolean(),
  createdBy: z.string(),
  doneBy: z.string().nullable(),
  createdAt: z.string(),
  doneAt: z.string().nullable(),
})

export type ShoppingItem = z.infer<typeof shoppingItemSchema>

export const createShoppingItemSchema = z.object({
  text: z.string().trim().min(1, 'Bitte etwas eingeben').max(120, 'Zu lang'),
  sectionId: z.string().optional(),
})

export type CreateShoppingItemInput = z.infer<typeof createShoppingItemSchema>

export const updateShoppingItemSchema = z.object({
  text: z.string().trim().min(1).max(120).optional(),
  sectionId: z.string().optional(),
  done: z.boolean().optional(),
})

export type UpdateShoppingItemInput = z.infer<typeof updateShoppingItemSchema>

/** Farben für Notizen – gedeckt gehalten, damit die Liste ruhig bleibt. */
export const NOTE_COLORS = ['default', 'gelb', 'gruen', 'blau', 'rosa'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  default: 'Ohne Farbe',
  gelb: 'Gelb',
  gruen: 'Grün',
  blau: 'Blau',
  rosa: 'Rosa',
}

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

/**
 * Ein Stück Notiztext: entweder gewöhnlicher Text oder ein Verweis.
 *
 * Der Text bleibt so, wie er dasteht – auch beim Verweis. Angezeigt wird, was
 * jemand geschrieben hat („www.sbb.ch"), aufgerufen wird die Adresse mit
 * Schema („https://www.sbb.ch"). Beides auseinanderzuhalten erspart es, den
 * Text beim Speichern zu verändern.
 */
export interface TextPart {
  text: string
  /** Gesetzt, wenn dieses Stück ein Verweis ist. */
  href?: string
}

/**
 * Findet Verweise: `https://…`, `http://…`, `www.…` und E-Mail-Adressen.
 *
 * Bewusst diese vier und nicht „alles, was nach einer Domain aussieht": Ein
 * Satz wie „Das kostet 12.50 pro Person" enthält keinen Verweis, und ein
 * Muster, das ihn dafür hält, macht aus jeder Notiz ein Minenfeld.
 */
const LINK_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"]+|[^\s<>"@]+@[^\s<>"@]+\.[a-zA-Z]{2,})/g

/**
 * Zeichen, die am Ende eines Verweises fast nie dazugehören.
 *
 * „Siehe https://sbb.ch." endet mit einem Punkt, der zum Satz gehört und nicht
 * zur Adresse. Eine schliessende Klammer bleibt nur stehen, wenn im Verweis
 * auch eine öffnende steht – Wikipedia-Adressen leben davon.
 */
function trimTrailing(raw: string): { link: string; rest: string } {
  let link = raw

  while (link.length > 0) {
    const last = link[link.length - 1] as string
    if ('.,;:!?«»"\''.includes(last)) {
      link = link.slice(0, -1)
      continue
    }
    if (last === ')' && !link.includes('(')) {
      link = link.slice(0, -1)
      continue
    }
    break
  }

  return { link, rest: raw.slice(link.length) }
}

/**
 * Zerlegt einen Text in Stücke, damit die Oberfläche Verweise anklickbar
 * machen kann.
 *
 * Die Erkennung steht hier und nicht im Frontend: Sie gehört zum Verständnis
 * dessen, was in einer Notiz steht, und ist damit prüfbar, ohne einen Browser
 * zu starten.
 */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let position = 0

  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0
    const { link, rest } = trimTrailing(match[0])
    if (link === '') continue

    if (start > position) parts.push({ text: text.slice(position, start) })

    parts.push({ text: link, href: hrefFor(link) })
    if (rest) parts.push({ text: rest })

    position = start + match[0].length
  }

  if (position < text.length) parts.push({ text: text.slice(position) })
  return parts
}

/** Die Adresse, die hinter einem gefundenen Stück steckt. */
function hrefFor(link: string): string {
  if (/^https?:\/\//i.test(link)) return link
  if (link.includes('@')) return `mailto:${link}`
  return `https://${link}`
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

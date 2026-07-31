import { z } from 'zod'

/**
 * Zwei Sammlungen, ein Mechanismus.
 *
 * Der Manager verwaltet den Haushalt: Rechnungen, Verträge, Post. Die DocBase
 * ist etwas anderes – Studien, Kursunterlagen, eigene Notizen zu medizinischen
 * Themen – und soll dem Haushalt nirgends begegnen: keine Verknüpfung, keine
 * gemeinsame Liste, eine eigene App auf dem Startbildschirm.
 *
 * Getrennt wird deshalb an genau einer Stelle: einer Spalte. Alles darunter –
 * Hochladen, Texterkennung, Vorschau, Papierkorb – bleibt ein einziger
 * Mechanismus. Zwei Sätze Tabellen und zwei Warteschlangen wären dieselbe
 * Sache zweimal, und die zweite hinkte der ersten ab dem ersten Tag hinterher.
 *
 * Die Ablage trennt hingegen wirklich: Jeder Bereich hat seinen eigenen
 * Wurzelordner auf dem NAS.
 */
export const BEREICHE = ['manager', 'docbase'] as const
export type Bereich = (typeof BEREICHE)[number]

/**
 * Ohne Angabe ist ein Dokument ein Haushaltsdokument. Der Standard steht hier
 * und nicht bei jedem Aufruf: Eine Abfrage, die den Bereich vergisst, soll
 * nichts aus der DocBase zeigen – nicht alles aus beiden.
 */
export const DEFAULT_BEREICH: Bereich = 'manager'

export const bereichSchema = z.enum(BEREICHE)

/**
 * Der Ordner der DocBase in der Dokumentenablage.
 *
 * Er liegt in derselben Freigabe wie der Haushalt, eine Ebene darunter – also
 * `…/Dokumente/Manager/DocBase`. Ein eigenes Volume wäre eine zweite Sache,
 * die beim Einrichten schiefgehen kann; ein Unterordner ist beim Backup,
 * beim Zugriff über SMB und in der Rechtevergabe einfach schon dabei.
 */
export const DOCBASE_DIR = 'DocBase'

/**
 * Bewusst nur drei Zustände. Jeder weitere klingt beim Entwerfen sinnvoll und
 * führt im Alltag dazu, dass man vor dem Ablegen erst nachdenken muss.
 *
 * „Offen" und „In Arbeit" waren zwei Namen für dasselbe: etwas liegt an.
 * Beim Ablegen ist es dieselbe Handbewegung, in der Liste dieselbe Zeile, und
 * die Frage „ist das schon in Arbeit?" beantwortet niemand zuverlässig für
 * ein Stück Post. Beides heisst jetzt `pendent` – und weil der Filter und die
 * Kachel auf dem Startbildschirm ohnehin so hiessen, fällt auch die
 * Übersetzung dazwischen weg.
 */
export const DOCUMENT_STATUSES = ['pendent', 'erledigt', 'archiviert'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  pendent: 'Pendent',
  erledigt: 'Erledigt',
  archiviert: 'Archiviert',
}

/** Der Zustand, in dem ein Dokument ankommt. */
export const DEFAULT_DOCUMENT_STATUS: DocumentStatus = 'pendent'

/** Was auf dem Startbildschirm unter „Pendent" erscheint. */
export const OPEN_STATUSES: readonly DocumentStatus[] = ['pendent']

export const documentStatusSchema = z.enum(DOCUMENT_STATUSES)

/**
 * Erlaubte Dateitypen. Alles was ein Haushalt tatsächlich bekommt: PDFs aus
 * E-Mails, Fotos von Papier, Screenshots. Bewusst eng gehalten – ein
 * Dokumentenarchiv ist kein Dateiserver.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/tiff',
] as const

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/**
 * Wie nach „hat noch keine Kategorie" gefiltert wird.
 *
 * Unsortiert ist keine Zeile in der Kategorientabelle, sondern das Fehlen
 * einer Zuordnung – der Zustand jedes frisch hochgeladenen Dokuments. Für den
 * Filter braucht es trotzdem einen Wert, den man in die Adresse schreiben
 * kann. Eine UUID sieht anders aus, eine Verwechslung ist also ausgeschlossen.
 */
export const UNCATEGORIZED = 'unsortiert'
export const UNCATEGORIZED_LABEL = 'Unsortiert'

/**
 * Kein Zuständiger heisst „beide" – nicht „niemand". Wie `UNCATEGORIZED` ist
 * das keine Zeile in einer Tabelle, sondern das Fehlen einer Zuordnung; zum
 * Filtern braucht es trotzdem einen Namen.
 */
export const UNASSIGNED = 'beide'
export const UNASSIGNED_LABEL = 'Beide'

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  sortOrder: z.number(),
})

export type Category = z.infer<typeof categorySchema>

/**
 * Der Name einer Kategorie.
 *
 * Kurz gehalten, weil er zweimal sichtbar wird: in einem Auswahlfeld auf dem
 * Handy und als Ordnername in der Freigabe. Zeilenumbrüche und doppelte
 * Leerzeichen fallen weg – über die Zwischenablage geraten sie leicht hinein
 * und ergäben zwei Kategorien, die gleich aussehen.
 */
export const categoryNameSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Name fehlt').max(40, 'Name ist zu lang'))

export const createCategorySchema = z.object({
  name: categoryNameSchema,
  bereich: bereichSchema.default(DEFAULT_BEREICH),
})
export type CreateCategoryInput = z.input<typeof createCategorySchema>

export const updateCategorySchema = z.object({ name: categoryNameSchema })
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>

export const activityActionSchema = z.enum([
  'upload',
  'edit',
  'status_change',
  'assign',
  'delete',
  'restore',
])

export type ActivityAction = z.infer<typeof activityActionSchema>

export const activityEntrySchema = z.object({
  id: z.string(),
  action: activityActionSchema,
  userId: z.string(),
  userName: z.string(),
  /** Menschenlesbare Zusammenfassung, serverseitig formuliert. */
  summary: z.string(),
  createdAt: z.string(),
})

export type ActivityEntry = z.infer<typeof activityEntrySchema>

export const OCR_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const
export type OcrStatus = (typeof OCR_STATUSES)[number]

export const OCR_STATUS_LABELS: Record<OcrStatus, string> = {
  pending: 'Text wird gelesen',
  running: 'Text wird gelesen',
  done: 'Text erkannt',
  failed: 'Texterkennung fehlgeschlagen',
  skipped: 'Kein Text',
}

export const ocrStatusSchema = z.enum(OCR_STATUSES)

export const textSnippetSchema = z.object({
  text: z.string(),
  matchStart: z.number(),
  matchEnd: z.number(),
})

export const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: documentStatusSchema,
  categoryId: z.string().nullable(),
  /** null bedeutet "beide" – nicht "niemand". */
  assignedTo: z.string().nullable(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  /** Datum des Dokuments selbst, nicht des Uploads. */
  docDate: z.string(),
  dueDate: z.string().nullable(),
  /** In Rappen, um Rundungsfehler von Gleitkommazahlen zu vermeiden. */
  amountCents: z.number().nullable(),
  vendor: z.string().nullable(),
  notes: z.string().nullable(),
  hasFile: z.boolean(),
  ocrStatus: ocrStatusSchema,
  /**
   * Wann das Dokument in den Papierkorb gelegt wurde, sonst null. Steht auch
   * in der Liste, weil sich Gelöschtes dort einblenden lässt und dann als
   * solches erkennbar sein muss.
   */
  deletedAt: z.string().nullable(),
  /** Nur in Suchergebnissen gesetzt: die Fundstelle im erkannten Text. */
  snippet: textSnippetSchema.nullable().optional(),
})

export type ManagedDocument = z.infer<typeof documentSchema>

/**
 * Wie sich ein Dokument in der App anschauen lässt.
 *
 * 'pdf'   – der Server rastert die Seiten zu Bildern, `pages` sagt wie viele
 * 'image' – die Datei selbst ist ein Bild und wird direkt angezeigt
 * 'none'  – keine Vorschau möglich, es bleibt beim Öffnen der Datei
 */
export const PREVIEW_KINDS = ['pdf', 'image', 'none'] as const
export type PreviewKind = (typeof PREVIEW_KINDS)[number]

export const previewInfoSchema = z.object({
  kind: z.enum(PREVIEW_KINDS),
  /** Anzahl anzeigbarer Seiten. 0, wenn keine Vorschau möglich ist. */
  pages: z.number().int().nonnegative(),
})

export type PreviewInfo = z.infer<typeof previewInfoSchema>

export const documentDetailSchema = documentSchema.extend({
  activity: z.array(activityEntrySchema),
  /** Der vollständige erkannte Text, für die Ansicht im Detail. */
  ocrText: z.string().nullable(),
  ocrMethod: z.string().nullable(),
  ocrError: z.string().nullable(),
})

export type DocumentDetail = z.infer<typeof documentDetailSchema>

/**
 * Wandelt eine Betragseingabe in Rappen um, oder gibt null zurück, wenn sie
 * keine gültige Zahl ergibt.
 *
 * Akzeptiert alle Schreibweisen, die im Alltag vorkommen: "1'234.55",
 * "1’234.55" (der typografische Apostroph, den die Schweizer Formatierung
 * selbst ausgibt), "1 234,55" und "1234.55". Wer einen Betrag aus der
 * Detailansicht kopiert und wieder einfügt, muss ihn nicht von Hand säubern.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input
    // Gerader und typografischer Apostroph, normale und schmale
    // geschützte Leerzeichen – alles mögliche Tausendertrennzeichen.
    .replace(/['\u2019\s\u00a0\u202f]/g, '')
    .replace(',', '.')
    .trim()

  if (!cleaned) return null

  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return null
  return Math.round(value * 100)
}

export const amountInputSchema = z
  .string()
  .transform(parseAmountToCents)
  .refine((value) => value !== null, 'Bitte einen gültigen Betrag eingeben')

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss im Format JJJJ-MM-TT vorliegen')

/**
 * Titel, der beim Hochladen mitgeschickt werden darf.
 *
 * Gedacht für den Scanner: Wer gerade drei Seiten fotografiert hat, weiss in
 * dem Moment am besten, was er da vor sich hat – später in der Liste steht
 * sonst „Scan 28.07.2026" neben fünf anderen. Ohne Angabe entsteht der Titel
 * wie bisher aus dem Dateinamen.
 *
 * Zeilenumbrüche werden zu Leerzeichen: Ein Titel steht in der App immer in
 * einer Zeile, und über die Zwischenablage gerät schnell einer hinein.
 */
export const uploadTitleSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Titel fehlt').max(200, 'Titel ist zu lang'))

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1, 'Titel fehlt').max(200, 'Titel ist zu lang').optional(),
  status: documentStatusSchema.optional(),
  categoryId: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  docDate: isoDate.optional(),
  dueDate: isoDate.nullable().optional(),
  amountCents: z.number().int().nonnegative().nullable().optional(),
  vendor: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>

/**
 * Mehrfachauswahl als ein Parameter: `?status=pendent,erledigt`.
 *
 * Ein Filter mit Häkchen liefert keine oder mehrere Werte. Wiederholte
 * Parameter (`?status=a&status=b`) wären die andere Schreibweise – sie kommen
 * je nach Anzahl mal als Zeichenkette und mal als Liste an, und genau daran
 * scheitern solche Schnittstellen dann im Einzelfall.
 */
const commaSeparated = z
  .string()
  .max(1000)
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().max(60)).max(50))

export const documentQuerySchema = z.object({
  /**
   * Welche Sammlung gemeint ist. Ohne Angabe der Haushalt – eine Abfrage, die
   * den Bereich vergisst, zeigt nichts aus der DocBase.
   */
  bereich: bereichSchema.default(DEFAULT_BEREICH),
  /** Freitext über Titel, Absender und Notizen. Ab Etappe 3 auch über OCR-Text. */
  q: z.string().trim().max(200).optional(),
  /** Eine oder mehrere Zuständigkeiten; `beide` steht für „niemandem zugeteilt". */
  status: commaSeparated.optional(),
  categoryId: commaSeparated.optional(),
  assignedTo: commaSeparated.optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  /** Hochgeladen ab / bis, jeweils einschliesslich. */
  uploadedFrom: isoDate.optional(),
  uploadedTo: isoDate.optional(),
  /** Kurzform für `status=pendent` – gebraucht von der Kachel „Pendent". */
  pending: z.coerce.boolean().optional(),
  /**
   * Was mit dem Papierkorb geschehen soll. Standard ist `ohne`: Gelöschtes ist
   * gelöscht und hat in der Liste nichts verloren, bis man danach fragt.
   */
  deleted: z.enum(['ohne', 'mit', 'nur']).default('ohne'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export type DocumentQuery = z.infer<typeof documentQuerySchema>

const SEARCH_FOLD: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
}

/**
 * Vereinheitlicht Text für die Suche und merkt sich zugleich, aus welchem
 * Zeichen des Ursprungstexts jedes Ergebniszeichen entstanden ist.
 *
 * SQLite vergleicht bei `LIKE` nur ASCII-Buchstaben unabhängig von der
 * Schreibweise – „PRÄMIE" findet „Prämie" also nicht. Und niemand tippt
 * unterwegs zuverlässig Umlaute. Gerade weil unsere Dateinamen auf dem NAS
 * ohnehin „Praemie" schreiben, muss diese Schreibweise auch etwas finden.
 *
 * Die Positionszuordnung braucht es für Textausschnitte in den
 * Suchergebnissen: Gefunden wird im vereinheitlichten Text, angezeigt werden
 * muss das Original. Ohne sie stünde in der Trefferliste „praemie" statt
 * „Prämie" – und die Längen unterscheiden sich, weil ein Umlaut zu zwei
 * Zeichen wird.
 */
export function normalizeWithMap(input: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let spacePending = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string

    if (WHITESPACE.test(char)) {
      // Leerraum wird zu höchstens einem Leerzeichen, und nie am Anfang –
      // das entspricht dem früheren \s+ → ' ' samt trim().
      if (text.length > 0) spacePending = true
      continue
    }

    if (spacePending) {
      text += ' '
      map.push(index)
      spacePending = false
    }

    const folded = char
      .toLowerCase()
      .replace(/[äöüß]/g, (c) => SEARCH_FOLD[c] ?? c)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

    for (const produced of folded) {
      text += produced
      map.push(index)
    }
  }

  return { text, map }
}

const WHITESPACE = /\s/

/**
 * Vereinheitlichte Fassung für die Suche. Bewusst über normalizeWithMap
 * gebaut: Liefen die beiden auseinander, würde die Suche Treffer liefern,
 * für die sich kein Textausschnitt finden lässt – oder umgekehrt.
 */
export function normalizeForSearch(input: string): string {
  return normalizeWithMap(input).text
}

export interface TextSnippet {
  text: string
  /** Bereich innerhalb von `text`, der zur Suche passt – zum Hervorheben. */
  matchStart: number
  matchEnd: number
}

/**
 * Sucht den Begriff im Text und gibt die Umgebung zurück, in der er steht.
 * Beantwortet in der Trefferliste die Frage „warum ist das ein Treffer?" –
 * gerade wenn der Begriff nur tief im erkannten Text vorkommt.
 */
export function findSnippet(
  raw: string,
  query: string,
  contextChars = 70,
): TextSnippet | null {
  const needle = normalizeForSearch(query)
  if (!needle || !raw) return null

  const { text: haystack, map } = normalizeWithMap(raw)
  const hit = haystack.indexOf(needle)
  if (hit === -1) return null

  const rawStart = map[hit] ?? 0
  const rawEnd = (map[hit + needle.length - 1] ?? rawStart) + 1

  let from = Math.max(0, rawStart - contextChars)
  let to = Math.min(raw.length, rawEnd + contextChars)

  // An Wortgrenzen ausrichten, damit der Ausschnitt nicht mitten im Wort beginnt.
  if (from > 0) {
    const space = raw.indexOf(' ', from)
    if (space !== -1 && space < rawStart) from = space + 1
  }
  if (to < raw.length) {
    const space = raw.lastIndexOf(' ', to)
    if (space !== -1 && space > rawEnd) to = space
  }

  const prefix = from > 0 ? '… ' : ''
  const suffix = to < raw.length ? ' …' : ''
  const snippet = raw.slice(from, to).replace(/\s+/g, ' ').trim()

  // Nach dem Zusammenfassen der Leerzeichen stimmen die alten Positionen nicht
  // mehr; der Treffer wird deshalb im fertigen Ausschnitt neu gesucht.
  const shown = `${prefix}${snippet}${suffix}`
  const matchText = raw.slice(rawStart, rawEnd)
  const matchStart = shown.toLowerCase().indexOf(matchText.toLowerCase())

  return {
    text: shown,
    matchStart: matchStart === -1 ? 0 : matchStart,
    matchEnd: matchStart === -1 ? 0 : matchStart + matchText.length,
  }
}

/**
 * Obergrenze für den erkannten Text in der Suchspalte.
 *
 * Ein 25-seitiges Dokument liefert schnell mehrere hunderttausend Zeichen.
 * Ungebremst stünde in jeder Zeile der Dokumententabelle ein Roman, und jede
 * Abfrage würde ihn mitlesen. Der vollständige Text bleibt in `ocrText` und
 * in der .txt-Datei erhalten – gesucht wird im Anfang, wo bei Rechnungen und
 * Briefen praktisch immer das Wesentliche steht.
 */
export const MAX_SEARCHABLE_OCR_CHARS = 40_000

/** Baut den durchsuchbaren Text eines Dokuments aus Metadaten und erkanntem Text. */
export function buildSearchText(parts: {
  title: string
  vendor?: string | null
  notes?: string | null
  ocrText?: string | null
}): string {
  const ocr = parts.ocrText ? parts.ocrText.slice(0, MAX_SEARCHABLE_OCR_CHARS) : null
  return normalizeForSearch([parts.title, parts.vendor, parts.notes, ocr].filter(Boolean).join(' '))
}

export function formatAmount(cents: number | null): string {
  if (cents === null) return ''
  return (cents / 100).toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

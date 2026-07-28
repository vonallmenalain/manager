import { z } from 'zod'

/**
 * Bewusst nur vier Zustände. Jeder weitere klingt beim Entwerfen sinnvoll und
 * führt im Alltag dazu, dass man vor dem Ablegen erst nachdenken muss.
 */
export const DOCUMENT_STATUSES = ['offen', 'in_arbeit', 'erledigt', 'archiviert'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  erledigt: 'Erledigt',
  archiviert: 'Archiviert',
}

/** Was auf dem Dashboard unter "Pendent" erscheint. */
export const OPEN_STATUSES: readonly DocumentStatus[] = ['offen', 'in_arbeit']

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

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  sortOrder: z.number(),
})

export type Category = z.infer<typeof categorySchema>

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
  /** Nur in Suchergebnissen gesetzt: die Fundstelle im erkannten Text. */
  snippet: textSnippetSchema.nullable().optional(),
})

export type ManagedDocument = z.infer<typeof documentSchema>

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

export const documentQuerySchema = z.object({
  /** Freitext über Titel, Absender und Notizen. Ab Etappe 3 auch über OCR-Text. */
  q: z.string().trim().max(200).optional(),
  status: documentStatusSchema.optional(),
  categoryId: z.string().optional(),
  assignedTo: z.string().optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  /** 'pendent' fasst offen und in_arbeit zusammen – der häufigste Filter. */
  pending: z.coerce.boolean().optional(),
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

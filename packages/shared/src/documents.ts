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
})

export type ManagedDocument = z.infer<typeof documentSchema>

export const documentDetailSchema = documentSchema.extend({
  activity: z.array(activityEntrySchema),
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
 * Vereinheitlicht Text für die Suche: klein geschrieben, Umlaute
 * ausgeschrieben, Akzente entfernt.
 *
 * SQLite vergleicht bei `LIKE` nur ASCII-Buchstaben unabhängig von der
 * Schreibweise – „PRÄMIE" findet „Prämie" also nicht. Und niemand tippt
 * unterwegs zuverlässig Umlaute. Gerade weil unsere Dateinamen auf dem NAS
 * ohnehin „Praemie" schreiben, muss diese Schreibweise auch etwas finden.
 *
 * Wird auf beide Seiten angewandt: auf den gespeicherten Suchtext und auf
 * die Eingabe. Ab Etappe 3 fliesst hier auch der OCR-Text ein.
 */
export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => SEARCH_FOLD[char] ?? char)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Baut den durchsuchbaren Text eines Dokuments aus seinen Metadaten. */
export function buildSearchText(parts: {
  title: string
  vendor?: string | null
  notes?: string | null
}): string {
  return normalizeForSearch([parts.title, parts.vendor, parts.notes].filter(Boolean).join(' '))
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

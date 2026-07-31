/**
 * Woher ein hochgeladenes Dokument seine Angaben bekommt.
 *
 * Der Titel aus zwei Quellen, in dieser Reihenfolge: das Formularfeld `title`,
 * wenn eines mitgeschickt wurde – so benennt der Scanner mehrere Seiten, bevor
 * sie ein Dokument werden –, sonst der Dateiname. Dazu die drei Angaben, die
 * sich im Stapel schon festlegen lassen: Kategorie, Zuständigkeit und Status.
 *
 * Bewusst ohne Datenbank und ohne Dateisystem, damit alles ohne laufenden
 * Server prüfbar bleibt. Ob eine mitgeschickte Kennung tatsächlich zu einer
 * Kategorie oder zu einer Person gehört, weiss nur die Datenbank – das prüft
 * der Aufrufer.
 */
import type { Multipart, MultipartFields } from '@fastify/multipart'
import {
  bereichSchema,
  DEFAULT_BEREICH,
  DEFAULT_DOCUMENT_STATUS,
  documentStatusSchema,
  uploadTitleSchema,
  type Bereich,
  type DocumentStatus,
} from '@manager/shared'

/** "Rechnung Krankenkasse_Maerz.pdf" → "Rechnung Krankenkasse Maerz" */
export function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, '')
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 200) || 'Ohne Titel'
}

function firstEntry(field: Multipart | Multipart[] | undefined): Multipart | undefined {
  return Array.isArray(field) ? field[0] : field
}

/**
 * Der Titel aus dem Formularfeld, oder null.
 *
 * Null bedeutet „nichts Brauchbares dabei" und nicht „Fehler": Ein leeres
 * Feld, ein zu langer Titel oder gar keines führen alle dazu, dass der
 * Dateiname einspringt. Eine Fehlermeldung wäre hier die schlechtere Antwort –
 * die Datei ist zu dem Zeitpunkt bereits übertragen.
 */
export function titleFromFields(fields: MultipartFields | undefined): string | null {
  const parsed = uploadTitleSchema.safeParse(textField(fields, 'title'))
  return parsed.success ? parsed.data : null
}

/** Der Wert eines Textfeldes im Formular, oder null. */
function textField(fields: MultipartFields | undefined, name: string): string | null {
  const entry = firstEntry(fields?.[name])
  if (!entry || entry.type !== 'field') return null
  return typeof entry.value === 'string' ? entry.value : null
}

/**
 * Die Angaben, die zusammen mit der Datei mitgeschickt werden dürfen.
 *
 * Alles davon ist freiwillig: Kommt nichts, entsteht ein Dokument wie bisher –
 * unsortiert, für beide, pendent.
 */
export interface UploadMetadata {
  /**
   * In welche Sammlung das Dokument gehört. Anders als der Rest kein
   * Vorschlag, sondern die Entscheidung darüber, wo die Datei überhaupt
   * landet – ohne Angabe der Haushalt.
   */
  bereich: Bereich
  /** Kennung der gewünschten Kategorie, oder null für „Unsortiert". */
  categoryId: string | null
  /** Kennung der zuständigen Person, oder null für „beide". */
  assignedTo: string | null
  status: DocumentStatus
}

/**
 * Liest Kategorie, Zuständigkeit und Status aus dem Formular.
 *
 * Unbrauchbares wird verworfen und nicht als Fehler beantwortet – dieselbe
 * Überlegung wie beim Titel: Die Datei ist zu diesem Zeitpunkt bereits
 * übertragen, und ein Dokument ohne Kategorie ist immer noch ein abgelegtes
 * Dokument. Ein abgewiesener Upload wäre die schlechtere Antwort.
 */
export function metadataFromFields(fields: MultipartFields | undefined): UploadMetadata {
  const status = documentStatusSchema.safeParse(textField(fields, 'status'))
  const bereich = bereichSchema.safeParse(textField(fields, 'bereich'))

  return {
    bereich: bereich.success ? bereich.data : DEFAULT_BEREICH,
    categoryId: identifier(textField(fields, 'categoryId')),
    assignedTo: identifier(textField(fields, 'assignedTo')),
    status: status.success ? status.data : DEFAULT_DOCUMENT_STATUS,
  }
}

/**
 * Eine Kennung, wie die App sie vergibt – oder null.
 *
 * Geprüft wird hier nur die Form, und selbst die nur grob: Ob es die Kategorie
 * oder die Person überhaupt gibt, steht in der Datenbank. Die Länge begrenzt
 * trotzdem etwas Wesentliches – ein Feld von einem Megabyte hat in einer
 * Abfrage nichts zu suchen.
 */
function identifier(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length <= 60 ? trimmed : null
}

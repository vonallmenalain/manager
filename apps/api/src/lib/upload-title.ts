/**
 * Woher ein hochgeladenes Dokument seinen Titel bekommt.
 *
 * Zwei Quellen, in dieser Reihenfolge: das Formularfeld `title`, wenn eines
 * mitgeschickt wurde – so benennt der Scanner mehrere Seiten, bevor sie ein
 * Dokument werden –, sonst der Dateiname. Bewusst ohne Datenbank und ohne
 * Dateisystem, damit beides ohne laufenden Server prüfbar bleibt.
 */
import type { Multipart, MultipartFields } from '@fastify/multipart'
import { uploadTitleSchema } from '@manager/shared'

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
  const entry = firstEntry(fields?.title)
  if (!entry || entry.type !== 'field') return null

  const parsed = uploadTitleSchema.safeParse(entry.value)
  return parsed.success ? parsed.data : null
}

import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES } from '@manager/shared'

/**
 * Welche Dateien die App annimmt – aus derselben Liste wie der Server, damit
 * die Auswahl nichts anbietet, was er danach ablehnt, und nichts verbirgt,
 * was er nähme.
 *
 * Nicht im Service Worker verwenden: `@manager/shared` zöge dort die ganze
 * Schemaprüfung mit in den Worker.
 */

/**
 * Für `<input type="file" accept>`: alle Bilder, die erlaubten Typen und
 * zusätzlich ihre Endungen. Manche Ablagen melden bei Office-Dateien keinen
 * oder einen allgemeinen Typ – dann entscheidet im Auswahlfenster die Endung.
 */
export const DATEI_ACCEPT = [
  'image/*',
  ...ALLOWED_MIME_TYPES.filter((typ) => !typ.startsWith('image/')),
  ...ALLOWED_EXTENSIONS.map((endung) => `.${endung}`),
].join(',')

/**
 * Wofür Manager und DocBase im Teilen-Menü erscheinen. Android vergleicht
 * dort nur Typen, keine Endungen.
 */
export const TEILEN_ACCEPT: string[] = [
  'image/*',
  ...ALLOWED_MIME_TYPES.filter((typ) => !typ.startsWith('image/')),
]

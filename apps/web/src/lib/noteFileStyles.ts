import { fileKindLabel, formatFileSize, type RichFile } from '@manager/shared'

/**
 * Wie eine Datei im Text einer Notiz aussieht – im gelesenen Text (React,
 * `NoteFileBlock`) und im Editor (`renderDocInto`, ohne React) mit genau
 * denselben Klassen.
 *
 * Das ist keine Kosmetik: Beim Antippen der gelesenen Notiz landet der Cursor
 * dort, wo getippt wurde, und das geht nur, wenn beide Fassungen Zeile für
 * Zeile gleich hoch sind. Deshalb haben Bild und PDF eine feste Höhe – ein Bild,
 * das erst nachlädt, schiebt nichts mehr nach unten.
 */

/** Der Block um die Datei; `select-none`, damit Kopieren ihren Namen nicht mitnimmt. */
export const FILE_BLOCK = 'rt-file relative my-1.5 block w-fit max-w-full select-none'

/** Ein Bild: feste Höhe, die Breite ergibt sich aus dem Bild. */
export const FILE_IMAGE_BUTTON =
  'block h-40 min-w-24 max-w-full cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5'
export const FILE_IMAGE = 'block h-full w-auto max-w-full object-contain'

/** Ein PDF (oder ein Bild, das der Browser nicht zeichnen kann): eine Zeile mit Name und Grösse. */
export const FILE_CHIP_BUTTON =
  'flex h-16 w-72 max-w-full cursor-pointer items-center gap-3 rounded-xl border border-black/10 bg-white/70 p-2 text-left dark:border-white/10 dark:bg-slate-900/60'
export const FILE_CHIP_THUMB =
  'h-12 w-9 shrink-0 rounded border border-black/10 bg-white object-cover object-top dark:border-white/10'
export const FILE_CHIP_ICON =
  'grid h-12 w-9 shrink-0 place-items-center rounded border border-black/10 bg-white text-lg dark:border-white/10 dark:bg-slate-800'
export const FILE_CHIP_TEXT = 'min-w-0 flex-1'
export const FILE_NAME = 'block truncate text-sm font-medium'
export const FILE_META = 'block text-xs text-slate-500 dark:text-slate-400'

/** Das Kreuz zum Entfernen – nur im Editor. */
export const FILE_REMOVE =
  'absolute -right-2 -top-2 grid size-7 cursor-pointer place-items-center rounded-full border border-slate-200 bg-white text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'

/** In der Übersicht (Kachel, Listeneintrag): nur eine Zeile mit Büroklammer. */
export const FILE_COMPACT = 'block truncate'

/** „PDF · 245 KB", „Word · 38 KB" – die kleine Zeile unter dem Namen. */
export function fileMeta(file: RichFile): string {
  return `${fileKindLabel(file.mime)} · ${formatFileSize(file.size)}`
}

export function isImage(file: RichFile): boolean {
  return file.mime.startsWith('image/')
}

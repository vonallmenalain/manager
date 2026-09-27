import {
  BG_COLOR_KEYS,
  BG_COLOR_LABELS,
  TEXT_COLOR_KEYS,
  TEXT_COLOR_LABELS,
  TEXT_SIZE_KEYS,
  TEXT_SIZE_LABELS,
  type RichMarks,
} from '@manager/shared'

/**
 * Wie formatierter Text aussieht – die Klassen zu den Marken.
 *
 * Das Modell (`richtext` im geteilten Paket) kennt nur Namen wie „red" oder
 * „xl"; welche Farbe im hellen und im dunklen Bild dazugehört, steht hier.
 * Editor und gelesener Text nehmen dieselben Klassen – was man beim Schreiben
 * sieht, steht nachher genau so da.
 */

export interface Swatch {
  key: string
  label: string
  /** Klassen für den gezeichneten Text bzw. Hintergrund */
  class: string
  /** Klassen für den Farbpunkt im Menü */
  dot: string
}

const TEXT_COLOR_CLASSES: Record<(typeof TEXT_COLOR_KEYS)[number], { class: string; dot: string }> =
  {
    red: { class: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
    orange: { class: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500' },
    amber: { class: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-400' },
    green: { class: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    blue: { class: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
    violet: { class: 'text-violet-600 dark:text-violet-400', dot: 'bg-violet-500' },
    pink: { class: 'text-pink-600 dark:text-pink-400', dot: 'bg-pink-500' },
    gray: { class: 'text-slate-500 dark:text-slate-400', dot: 'bg-slate-400' },
  }

const BG_COLOR_CLASSES: Record<(typeof BG_COLOR_KEYS)[number], { class: string; dot: string }> = {
  yellow: { class: 'bg-yellow-200/80 dark:bg-yellow-500/30', dot: 'bg-yellow-300' },
  green: { class: 'bg-emerald-200/70 dark:bg-emerald-500/30', dot: 'bg-emerald-300' },
  blue: { class: 'bg-sky-200/70 dark:bg-sky-500/30', dot: 'bg-sky-300' },
  pink: { class: 'bg-pink-200/70 dark:bg-pink-500/30', dot: 'bg-pink-300' },
  orange: { class: 'bg-orange-200/70 dark:bg-orange-500/30', dot: 'bg-orange-300' },
  violet: { class: 'bg-violet-200/70 dark:bg-violet-500/30', dot: 'bg-violet-300' },
}

/**
 * Die Grössen in `em`, also **relativ zur Umgebung**: „Gross" in der Vorschau
 * einer Kachel und „Gross" in der geöffneten Notiz stehen im selben
 * Verhältnis zu ihrem Text, statt auf eine feste Pixelzahl zu springen.
 */
const TEXT_SIZE_CLASSES: Record<(typeof TEXT_SIZE_KEYS)[number], string> = {
  s: 'text-[0.85em]',
  l: 'text-[1.25em]',
  xl: 'text-[1.5em]',
}

export const TEXT_COLORS: Swatch[] = TEXT_COLOR_KEYS.map((key) => ({
  key,
  label: TEXT_COLOR_LABELS[key],
  ...TEXT_COLOR_CLASSES[key],
}))

export const BG_COLORS: Swatch[] = BG_COLOR_KEYS.map((key) => ({
  key,
  label: BG_COLOR_LABELS[key],
  ...BG_COLOR_CLASSES[key],
}))

export const TEXT_SIZES = TEXT_SIZE_KEYS.map((key) => ({
  key,
  label: TEXT_SIZE_LABELS[key],
  class: TEXT_SIZE_CLASSES[key],
}))

const textColorClass = new Map(TEXT_COLORS.map((color) => [color.key, color.class]))
const bgColorClass = new Map(BG_COLORS.map((color) => [color.key, color.class]))
const sizeClass = new Map(TEXT_SIZES.map((size) => [size.key as string, size.class]))

/** Die Klassen zu einem Satz Marken – für Editor und gelesenen Text dieselben. */
export function markClasses(marks: RichMarks): string {
  const classes: string[] = []
  // Volles Fett (700), nicht halbfett: „Fett" soll auch neben einem halbfetten
  // Titel sichtbar etwas tun.
  if (marks.b) classes.push('font-bold')
  if (marks.i) classes.push('italic')
  if (marks.u) classes.push('underline')
  const size = marks.size ? sizeClass.get(marks.size) : undefined
  if (size) classes.push(size)
  const color = marks.color ? textColorClass.get(marks.color) : undefined
  if (color) classes.push(color)
  const bg = marks.bg ? bgColorClass.get(marks.bg) : undefined
  if (bg) classes.push('rounded-[3px]', bg)
  return classes.join(' ')
}

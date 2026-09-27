/**
 * Formatierter Notiztext – Fett, Kursiv, Farben, Grössen und Aufzählungen.
 *
 * Übernommen aus der BSS-App, wo sich dieselbe Formatierung im Alltag bewährt
 * hat, und auf das beschränkt, was eine Notiz braucht: keine Erwähnungen,
 * keine Zuordnung an Personen.
 *
 * ## Der Grundsatz: Der Text bleibt Text
 *
 * Gespeichert wird die Formatierung nicht **im** Text, sondern als Feld
 * **daneben** (`bodyRich` neben `body`). Im Text selbst steht weiterhin reiner
 * Text, ohne `**` und ohne spitze Klammern: Suche, Vorschau, Startbildschirm
 * und eine noch nicht aktualisierte App lesen denselben Text wie eh und je.
 *
 * Das Formatfeld trägt eine JSON-Beschreibung desselben Textes, zerlegt in
 * **Blöcke** (Absätze oder Listenpunkte mit Ebene) und **Läufe** (Textstücke
 * mit Marken). Damit die beiden nie auseinanderlaufen, gilt eine einzige
 * Regel: Die Klartext-Projektion des Formatfelds muss Zeichen für Zeichen dem
 * gespeicherten Text entsprechen (`richDocFor`). Hat irgendwer – etwa eine
 * ältere Fassung der App – nur den Text geändert, passt die Projektion nicht
 * mehr, und die Notiz steht stillschweigend unformatiert da. Falsch
 * formatierter Text ist schlimmer als unformatierter.
 *
 * ## Zwei Projektionen
 *
 * - `plainTextOf` ist der **gespeicherte** Text: Listenpunkte tragen ihr
 *   Aufzählungszeichen („• …", eingerückt je Ebene), damit auch Suche und
 *   Vorschau die Liste als Liste zeigen.
 * - `editTextOf` ist der Text, wie er **im Editor** steht: ohne die
 *   Aufzählungszeichen, denn die zeichnet der Browser als Marker vor die
 *   Zeile. Auf diesem Text rechnen Cursor und Auswahl.
 *
 * Das Modell steht im geteilten Paket, weil beide Seiten es brauchen: Die App
 * rechnet damit beim Schreiben, der Server prüft damit, ob ein Formatfeld
 * überhaupt zum Text passt, bevor er es ablegt (`normalizeRich`). Die
 * Darstellung – welche Klassen zu „Rot" gehören – bleibt in der App.
 */

/* ------------------------------------------------------------------ */
/* Modell                                                              */
/* ------------------------------------------------------------------ */

export interface RichMarks {
  /** Fett */
  b?: true
  /** Kursiv */
  i?: true
  /** Unterstrichen */
  u?: true
  /** Textgrösse – ein Schlüssel aus `TEXT_SIZE_KEYS`; fehlt: normal */
  size?: string
  /** Textfarbe – ein Schlüssel aus `TEXT_COLOR_KEYS` */
  color?: string
  /** Hintergrund, wie ein Leuchtstift – ein Schlüssel aus `BG_COLOR_KEYS` */
  bg?: string
}

/** Ein Stück Text mit einheitlichen Marken – ohne Zeilenumbrüche. */
export interface RichRun extends RichMarks {
  t: string
}

export interface RichBlock {
  /** Listenpunkt dieser Ebene (1–4); fehlt die Angabe, ist es ein Absatz. */
  list?: number
  runs: RichRun[]
}

export interface RichDoc {
  blocks: RichBlock[]
}

/**
 * Das Paar, das gespeichert wird: der Text und die Formatierung daneben.
 *
 * `rich` ist `null`, solange nichts formatiert ist – eine unformatierte Notiz
 * sieht in der Datenbank genauso aus wie vor dieser Funktion.
 */
export interface RichValue {
  text: string
  rich: string | null
}

export const MAX_LIST_LEVEL = 4

/** Aufzählungszeichen je Ebene – so steht die Liste auch im reinen Text da. */
const LIST_MARKERS = ['•', '◦', '▪', '▫']

/* ------------------------------------------------------------------ */
/* Palette und Grössen                                                 */
/* ------------------------------------------------------------------ */

/**
 * Eine feste, kleine Palette statt freier Farben.
 *
 * Gespeichert wird der **Name**, gezeichnet wird in der App ein heller und
 * ein dunkler Wert dazu: Ein sattes Rot auf weissem Grund wäre auf dunklem
 * Grund unleserlich. Freie Farbwerte könnten das nicht – und mehr als eine
 * Handvoll Farben braucht eine Notiz nicht.
 */
export const TEXT_COLOR_KEYS = [
  'red',
  'orange',
  'amber',
  'green',
  'blue',
  'violet',
  'pink',
  'gray',
] as const
export type TextColorKey = (typeof TEXT_COLOR_KEYS)[number]

export const TEXT_COLOR_LABELS: Record<TextColorKey, string> = {
  red: 'Rot',
  orange: 'Orange',
  amber: 'Gelb',
  green: 'Grün',
  blue: 'Blau',
  violet: 'Violett',
  pink: 'Rosa',
  gray: 'Grau',
}

export const BG_COLOR_KEYS = ['yellow', 'green', 'blue', 'pink', 'orange', 'violet'] as const
export type BgColorKey = (typeof BG_COLOR_KEYS)[number]

export const BG_COLOR_LABELS: Record<BgColorKey, string> = {
  yellow: 'Gelb',
  green: 'Grün',
  blue: 'Blau',
  pink: 'Rosa',
  orange: 'Orange',
  violet: 'Violett',
}

/**
 * Feste Grössenstufen statt freier Zahlen.
 *
 * Drei Stufen neben „Normal" genügen: eine zum Zurücknehmen und zwei zum
 * Hervorheben, etwa für eine Zwischenüberschrift. Eine freie Eingabe ergäbe
 * in jeder Notiz eine andere Typografie, und niemand fände zweimal dieselbe.
 */
export const TEXT_SIZE_KEYS = ['s', 'l', 'xl'] as const
export type TextSizeKey = (typeof TEXT_SIZE_KEYS)[number]

export const TEXT_SIZE_LABELS: Record<TextSizeKey, string> = {
  s: 'Klein',
  l: 'Gross',
  xl: 'Sehr gross',
}

const TEXT_COLOR_SET = new Set<string>(TEXT_COLOR_KEYS)
const BG_COLOR_SET = new Set<string>(BG_COLOR_KEYS)
const TEXT_SIZE_SET = new Set<string>(TEXT_SIZE_KEYS)

/* ------------------------------------------------------------------ */
/* Marken lesen und vergleichen                                        */
/* ------------------------------------------------------------------ */

/** Nur die Marken eines Laufs – ohne den Text, ohne Unbekanntes. */
export function marksOf(run: RichMarks): RichMarks {
  const marks: RichMarks = {}
  if (run.b) marks.b = true
  if (run.i) marks.i = true
  if (run.u) marks.u = true
  if (run.size) marks.size = run.size
  if (run.color) marks.color = run.color
  if (run.bg) marks.bg = run.bg
  return marks
}

export function sameMarks(a: RichMarks, b: RichMarks): boolean {
  return (
    (a.b ?? false) === (b.b ?? false) &&
    (a.i ?? false) === (b.i ?? false) &&
    (a.u ?? false) === (b.u ?? false) &&
    (a.size ?? '') === (b.size ?? '') &&
    (a.color ?? '') === (b.color ?? '') &&
    (a.bg ?? '') === (b.bg ?? '')
  )
}

export function hasMarks(marks: RichMarks): boolean {
  return Boolean(marks.b || marks.i || marks.u || marks.size || marks.color || marks.bg)
}

/**
 * Marken als `data-rt`-Attribut, z. B. `b;color:red`.
 *
 * Im Editor tragen die `<span>` ihre Marken doppelt: als Klassen fürs Auge
 * und als dieses Attribut für den Rückweg. Gelesen wird **nur** das Attribut
 * – Klassen sind Darstellung und könnten sich jederzeit ändern.
 */
export function encodeMarks(marks: RichMarks): string {
  const parts: string[] = []
  if (marks.b) parts.push('b')
  if (marks.i) parts.push('i')
  if (marks.u) parts.push('u')
  if (marks.size) parts.push(`size:${marks.size}`)
  if (marks.color) parts.push(`color:${marks.color}`)
  if (marks.bg) parts.push(`bg:${marks.bg}`)
  return parts.join(';')
}

export function decodeMarks(value: string): RichMarks {
  const marks: RichMarks = {}
  for (const part of value.split(';')) {
    if (part === 'b') marks.b = true
    else if (part === 'i') marks.i = true
    else if (part === 'u') marks.u = true
    else if (part.startsWith('size:')) marks.size = part.slice(5)
    else if (part.startsWith('color:')) marks.color = part.slice(6)
    else if (part.startsWith('bg:')) marks.bg = part.slice(3)
  }
  return marks
}

/* ------------------------------------------------------------------ */
/* Aufbauen und projizieren                                            */
/* ------------------------------------------------------------------ */

function clampLevel(value: number): number {
  return Math.min(MAX_LIST_LEVEL, Math.max(1, Math.round(value)))
}

/** Reiner Text als Modell – jede Zeile ein Absatz, nichts markiert. */
export function docFromPlain(text: string): RichDoc {
  const lines = (text ?? '').split('\n')
  return { blocks: lines.map((line) => ({ runs: line ? [{ t: line }] : [] })) }
}

export function blockText(block: RichBlock): string {
  return block.runs.map((run) => run.t).join('')
}

/** Der Text, wie er im Editor steht – ohne Aufzählungszeichen. */
export function editTextOf(doc: RichDoc): string {
  return doc.blocks.map(blockText).join('\n')
}

/**
 * Der Text, wie er gespeichert wird – Listenpunkte mit Zeichen und Einzug.
 *
 * Ein leerer Listenpunkt endet ohne Leerzeichen („•", nicht „• "): Wer den
 * Text irgendwo an den Rändern beschneidet, soll damit nicht Text und
 * Formatfeld auseinanderbringen.
 */
export function plainTextOf(doc: RichDoc): string {
  return doc.blocks
    .map((block) => {
      const text = blockText(block)
      if (!block.list) return text
      const level = clampLevel(block.list)
      const marker = LIST_MARKERS[level - 1] ?? '•'
      return `${'  '.repeat(level - 1)}${marker}${text ? ` ${text}` : ''}`
    })
    .join('\n')
}

export function editLengthOf(doc: RichDoc): number {
  return doc.blocks.reduce((sum, block) => sum + blockText(block).length, 0) + doc.blocks.length - 1
}

/**
 * Aufräumen: gleiche Nachbarläufe verschmelzen, Leeres verwerfen, Ebenen
 * begrenzen. Alles Weitere setzt einen aufgeräumten Stand voraus.
 */
export function normalizeDoc(doc: RichDoc): RichDoc {
  const blocks = doc.blocks.map((block) => {
    const runs: RichRun[] = []
    for (const raw of block.runs) {
      const t = raw.t.replace(/\r/g, '').replace(/\n/g, ' ')
      if (!t) continue
      const marks = marksOf(raw)
      const last = runs[runs.length - 1]
      if (last && sameMarks(last, marks)) last.t += t
      else runs.push({ t, ...marks })
    }
    const clean: RichBlock = { runs }
    if (block.list) clean.list = clampLevel(block.list)
    return clean
  })
  return { blocks: blocks.length > 0 ? blocks : [{ runs: [] }] }
}

/** Trägt das Modell überhaupt eine Formatierung? */
export function isPlainDoc(doc: RichDoc): boolean {
  return doc.blocks.every((block) => !block.list && block.runs.every((run) => !hasMarks(run)))
}

/* ------------------------------------------------------------------ */
/* Speichern und Lesen                                                 */
/* ------------------------------------------------------------------ */

const FORMAT_VERSION = 1

/**
 * Obergrenzen beim Einlesen – gegen kaputte oder bösartig grosse Felder.
 *
 * Grosszügig bemessen: Eine Notiz darf 20 000 Zeichen lang sein, und jeder
 * Block und jeder Lauf trägt mindestens eines davon. Was darüber liegt, kann
 * nicht zu einer gültigen Notiz gehören.
 */
const LIMITS = { blocks: 25_000, runs: 50_000 }

export function serializeDoc(doc: RichDoc): string {
  const blocks = doc.blocks.map((block) => {
    const runs = block.runs.map((run) => {
      const out: Record<string, unknown> = { t: run.t }
      if (run.b) out.b = true
      if (run.i) out.i = true
      if (run.u) out.u = true
      if (run.size) out.size = run.size
      if (run.color) out.color = run.color
      if (run.bg) out.bg = run.bg
      return out
    })
    return block.list ? { list: block.list, runs } : { runs }
  })
  return JSON.stringify({ v: FORMAT_VERSION, blocks })
}

/**
 * Das Formatfeld einlesen – wohlwollend im Kleinen, streng im Grossen.
 *
 * Eine unbekannte Farbe fällt weg (der Text bleibt), ein unbekannter Aufbau
 * lässt das ganze Feld fallen (`null`): Dann gilt der reine Text, und der ist
 * immer da.
 */
export function parseRichJson(json: string): RichDoc | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const { v, blocks: rawBlocks } = raw as { v?: unknown; blocks?: unknown }
  if (v !== FORMAT_VERSION || !Array.isArray(rawBlocks) || rawBlocks.length > LIMITS.blocks) {
    return null
  }

  let runCount = 0
  const blocks: RichBlock[] = []
  for (const entry of rawBlocks) {
    if (!entry || typeof entry !== 'object') return null
    const { list, runs: rawRuns } = entry as { list?: unknown; runs?: unknown }
    if (!Array.isArray(rawRuns)) return null

    const block: RichBlock = { runs: [] }
    if (typeof list === 'number' && Number.isFinite(list)) block.list = clampLevel(list)

    for (const rawRun of rawRuns) {
      if (!rawRun || typeof rawRun !== 'object') return null
      const { t, b, i, u, size, color, bg } = rawRun as Record<string, unknown>
      if (typeof t !== 'string') return null
      if (++runCount > LIMITS.runs) return null

      const run: RichRun = { t }
      if (b === true) run.b = true
      if (i === true) run.i = true
      if (u === true) run.u = true
      if (typeof size === 'string' && TEXT_SIZE_SET.has(size)) run.size = size
      if (typeof color === 'string' && TEXT_COLOR_SET.has(color)) run.color = color
      if (typeof bg === 'string' && BG_COLOR_SET.has(bg)) run.bg = bg
      block.runs.push(run)
    }
    blocks.push(block)
  }
  return normalizeDoc({ blocks })
}

/** Aus dem Modell das Paar machen, das gespeichert wird. */
export function toRichValue(doc: RichDoc): RichValue {
  const normal = normalizeDoc(doc)
  return {
    text: plainTextOf(normal),
    rich: isPlainDoc(normal) ? null : serializeDoc(normal),
  }
}

export function richValueOf(
  text: string | null | undefined,
  rich: string | null | undefined,
): RichValue {
  return { text: text ?? '', rich: rich ?? null }
}

/**
 * Das Formatfeld zu einem Text – oder `null`, wenn es nicht (mehr) passt.
 *
 * Der Wächter dieser ganzen Einrichtung: Nur wenn die Projektion des
 * Formatfelds Zeichen für Zeichen dem gespeicherten Text entspricht, wird
 * formatiert gezeichnet. Alles andere hiesse, einen Text zu zeigen, den so
 * niemand geschrieben hat.
 */
export function richDocFor(
  rich: string | null | undefined,
  text: string | null | undefined,
): RichDoc | null {
  if (!rich) return null
  const doc = parseRichJson(rich)
  if (!doc) return null
  return plainTextOf(doc) === (text ?? '') ? doc : null
}

/** Das Modell zu einem gespeicherten Paar – notfalls der reine Text. */
export function docOfValue(value: { text: string; rich?: string | null }): RichDoc {
  return richDocFor(value.rich ?? null, value.text) ?? docFromPlain(value.text)
}

/**
 * Das Formatfeld, wie es abgelegt wird – aufgeräumt, oder gar keins.
 *
 * Für den Server: Er nimmt nur ein Formatfeld an, das zum Text passt, und
 * legt es in der aufgeräumten Form ab. Trägt es keine Formatierung (mehr),
 * bleibt das Feld leer – so sieht eine unformatierte Notiz immer gleich aus,
 * egal auf welchem Weg sie entstanden ist.
 */
export function normalizeRich(text: string, rich: string | null | undefined): string | null {
  const doc = richDocFor(rich, text)
  if (!doc || isPlainDoc(doc)) return null
  return serializeDoc(doc)
}

/* ------------------------------------------------------------------ */
/* Bereiche im Bearbeitungstext                                        */
/* ------------------------------------------------------------------ */

interface BlockPos {
  /** Anfang des Blocktexts im Bearbeitungstext */
  start: number
  /** Ende des Blocktexts (ohne das `\n` dahinter) */
  end: number
}

function blockPositions(doc: RichDoc): BlockPos[] {
  const positions: BlockPos[] = []
  let offset = 0
  for (const block of doc.blocks) {
    const length = blockText(block).length
    positions.push({ start: offset, end: offset + length })
    offset += length + 1
  }
  return positions
}

function clampRange(doc: RichDoc, start: number, end: number): [number, number] {
  const length = editLengthOf(doc)
  const from = Math.max(0, Math.min(start, length))
  const to = Math.max(0, Math.min(end, length))
  return from <= to ? [from, to] : [to, from]
}

/** Läufe an den angegebenen Stellen (lokal zum Block) auftrennen. */
function splitRuns(runs: RichRun[], cuts: number[]): RichRun[] {
  const points = [...new Set(cuts)].sort((a, b) => a - b)
  const out: RichRun[] = []
  let pos = 0
  for (const run of runs) {
    const end = pos + run.t.length
    let from = pos
    for (const cut of points) {
      if (cut <= from || cut >= end) continue
      out.push({ ...run, t: run.t.slice(from - pos, cut - pos) })
      from = cut
    }
    out.push({ ...run, t: run.t.slice(from - pos) })
    pos = end
  }
  return out.filter((run) => run.t !== '')
}

/** Die Läufe eines Blocks im lokalen Bereich [from, to). */
function runsSlice(runs: RichRun[], from: number, to: number): RichRun[] {
  const out: RichRun[] = []
  let pos = 0
  for (const run of runs) {
    const end = pos + run.t.length
    const cutFrom = Math.max(from, pos)
    const cutTo = Math.min(to, end)
    if (cutFrom < cutTo) out.push({ ...run, t: run.t.slice(cutFrom - pos, cutTo - pos) })
    pos = end
  }
  return out
}

export type MarkKey = 'b' | 'i' | 'u' | 'size' | 'color' | 'bg'

function withMark(run: RichRun, key: MarkKey, value: true | string | null): RichRun {
  const next: RichRun = { t: run.t, ...marksOf(run) }
  if (value === null) delete next[key]
  else if (key === 'b' || key === 'i' || key === 'u') next[key] = true
  else next[key] = value as string
  return next
}

/** Eine Marke über den Bereich setzen (`value`) oder entfernen (`null`). */
export function applyMark(
  doc: RichDoc,
  start: number,
  end: number,
  key: MarkKey,
  value: true | string | null,
): RichDoc {
  const [from, to] = clampRange(doc, start, end)
  if (from === to) return doc
  const positions = blockPositions(doc)

  const blocks = doc.blocks.map((block, index) => {
    const { start: bs, end: be } = positions[index] as BlockPos
    const localFrom = Math.max(from, bs) - bs
    const localTo = Math.min(to, be) - bs
    if (localFrom >= localTo) return block

    const runs = splitRuns(block.runs, [localFrom, localTo])
    let pos = 0
    const next = runs.map((run) => {
      const runStart = pos
      pos += run.t.length
      if (runStart < localFrom || runStart >= localTo) return run
      return withMark(run, key, value)
    })
    return { ...block, runs: next }
  })
  return normalizeDoc({ blocks })
}

/** Alle Marken im Bereich entfernen – die Listenform bleibt. */
export function clearMarks(doc: RichDoc, start: number, end: number): RichDoc {
  const [from, to] = clampRange(doc, start, end)
  if (from === to) return doc
  const positions = blockPositions(doc)

  const blocks = doc.blocks.map((block, index) => {
    const { start: bs, end: be } = positions[index] as BlockPos
    const localFrom = Math.max(from, bs) - bs
    const localTo = Math.min(to, be) - bs
    if (localFrom >= localTo) return block

    const runs = splitRuns(block.runs, [localFrom, localTo])
    let pos = 0
    const next = runs.map((run) => {
      const runStart = pos
      pos += run.t.length
      if (runStart < localFrom || runStart >= localTo) return run
      return { t: run.t }
    })
    return { ...block, runs: next }
  })
  return normalizeDoc({ blocks })
}

/** Der Lauf, in dem das Zeichen an `offset` steht – `null` auf einem `\n`. */
function runAtOffset(doc: RichDoc, offset: number): RichRun | null {
  const positions = blockPositions(doc)
  for (let index = 0; index < doc.blocks.length; index++) {
    const { start: bs, end: be } = positions[index] as BlockPos
    if (offset < bs || offset >= be) continue
    let pos = bs
    for (const run of (doc.blocks[index] as RichBlock).runs) {
      if (offset < pos + run.t.length) return run
      pos += run.t.length
    }
  }
  return null
}

/**
 * Die Marken an der Auswahl – für den Zustand des Menüs.
 *
 * Massgeblich ist das erste markierte Zeichen; beim blossen Cursor das
 * Zeichen davor (so schreibt der Browser auch weiter) und am Zeilenanfang
 * das danach. Das genügt: Das Menü zeigt an, was ein Griff bewirken würde,
 * keine Statistik über die ganze Auswahl.
 */
export function marksAt(doc: RichDoc, start: number, end: number): RichMarks {
  const [from, to] = clampRange(doc, start, end)
  const candidates = from < to ? [from, from - 1] : [from - 1, from]
  for (const candidate of candidates) {
    if (candidate < 0) continue
    const run = runAtOffset(doc, candidate)
    if (run) return marksOf(run)
  }
  return {}
}

/** Erster und letzter Block, den der Bereich berührt (einschliesslich). */
function blockIndexRange(doc: RichDoc, start: number, end: number): [number, number] {
  const [from, to] = clampRange(doc, start, end)
  const positions = blockPositions(doc)
  let first = 0
  let last = doc.blocks.length - 1
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index] as BlockPos
    // Das `\n` hinter einem Block gehört noch zu ihm – ein Cursor am
    // Zeilenende meint diese Zeile.
    if (from >= position.start && from <= position.end) first = index
    if (to >= position.start && to <= position.end) {
      last = index
      break
    }
  }
  return [first, Math.max(first, last)]
}

/** Der Listenstand an der Auswahl – für Menü und Tab-Taste. */
export function listStateAt(
  doc: RichDoc,
  start: number,
  end: number,
): { active: boolean; level: number } {
  const [first] = blockIndexRange(doc, start, end)
  const block = doc.blocks[first]
  return block?.list ? { active: true, level: clampLevel(block.list) } : { active: false, level: 0 }
}

/** Aufzählung ein- bzw. ausschalten – für alle Blöcke der Auswahl. */
export function toggleList(doc: RichDoc, start: number, end: number): RichDoc {
  const [first, last] = blockIndexRange(doc, start, end)
  const allList = doc.blocks.slice(first, last + 1).every((block) => block.list)
  const blocks = doc.blocks.map((block, index) => {
    if (index < first || index > last) return block
    if (allList) return { runs: block.runs }
    return { ...block, list: block.list ?? 1 }
  })
  return normalizeDoc({ blocks })
}

/**
 * Ein- oder ausrücken. Einrücken macht aus einem Absatz einen Listenpunkt;
 * Ausrücken auf Ebene 1 macht daraus wieder einen Absatz.
 */
export function changeIndent(doc: RichDoc, start: number, end: number, delta: 1 | -1): RichDoc {
  const [first, last] = blockIndexRange(doc, start, end)
  const blocks = doc.blocks.map((block, index) => {
    if (index < first || index > last) return block
    if (delta === 1) {
      return { ...block, list: block.list ? Math.min(MAX_LIST_LEVEL, block.list + 1) : 1 }
    }
    if (!block.list) return block
    if (block.list <= 1) return { runs: block.runs }
    return { ...block, list: block.list - 1 }
  })
  return normalizeDoc({ blocks })
}

/**
 * Einen Bereich durch Text ersetzen – für das Einfügen aus der Zwischenablage.
 *
 * Eingesetzter Text übernimmt die Marken des Zeichens davor: Wer mitten im
 * fett Geschriebenen etwas einfügt, bekommt es fett, wie weitergetippt.
 * Mehrzeiliges spaltet Blöcke; neue Zeilen erben die Listenebene der
 * Einfügestelle.
 */
export function replaceRange(
  doc: RichDoc,
  start: number,
  end: number,
  text: string,
): { doc: RichDoc; caret: number } {
  const [from, to] = clampRange(doc, start, end)
  const clean = text.replace(/\r\n?/g, '\n')
  const lines = clean.split('\n')
  const positions = blockPositions(doc)
  const [startIndex, endIndex] = blockIndexRange(doc, from, to)

  const startBlock = doc.blocks[startIndex] as RichBlock
  const endBlock = doc.blocks[endIndex] as RichBlock
  const startPos = positions[startIndex] as BlockPos
  const endPos = positions[endIndex] as BlockPos
  const localFrom = Math.min(from - startPos.start, blockText(startBlock).length)
  const localTo = Math.min(to - endPos.start, blockText(endBlock).length)

  const before = runsSlice(startBlock.runs, 0, localFrom)
  const after = runsSlice(endBlock.runs, localTo, Number.POSITIVE_INFINITY)
  const marks =
    localFrom > 0 ? marksOf(runsSlice(startBlock.runs, localFrom - 1, localFrom)[0] ?? {}) : {}

  const inserted: RichBlock[] = []
  const firstRuns = [...before]
  if (lines[0]) firstRuns.push({ t: lines[0], ...marks })
  const firstBlock: RichBlock = startBlock.list
    ? { list: startBlock.list, runs: firstRuns }
    : { runs: firstRuns }

  if (lines.length === 1) {
    firstBlock.runs = [...firstBlock.runs, ...after]
    inserted.push(firstBlock)
  } else {
    inserted.push(firstBlock)
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index] ?? ''
      const runs: RichRun[] = line ? [{ t: line, ...marks }] : []
      const list = index === lines.length - 1 ? (endBlock.list ?? startBlock.list) : startBlock.list
      inserted.push(list ? { list, runs } : { runs })
    }
    const lastBlock = inserted[inserted.length - 1] as RichBlock
    lastBlock.runs = [...lastBlock.runs, ...after]
  }

  const blocks = [
    ...doc.blocks.slice(0, startIndex),
    ...inserted,
    ...doc.blocks.slice(endIndex + 1),
  ]
  return { doc: normalizeDoc({ blocks }), caret: from + clean.length }
}

/**
 * „- " am Zeilenanfang startet eine Aufzählung – wie man es aus anderen
 * Editoren im Griff hat.
 *
 * Geprüft wird nach jeder Eingabe: Steht der Cursor unmittelbar hinter einem
 * „- ", mit dem ein gewöhnlicher Absatz beginnt, wird der Absatz zum
 * Listenpunkt, und die beiden Zeichen verschwinden – sie waren Befehl, nicht
 * Text. Wer die Liste nicht wollte, schaltet sie im Formatmenü wieder aus.
 *
 * `null` heisst: kein Fall für die Verwandlung – die Eingabe bleibt, wie sie
 * ist.
 */
export function autoListBlock(doc: RichDoc, caret: number): { doc: RichDoc; caret: number } | null {
  const positions = blockPositions(doc)
  for (let index = 0; index < doc.blocks.length; index++) {
    const block = doc.blocks[index] as RichBlock
    const { start, end } = positions[index] as BlockPos
    if (caret < start || caret > end) continue
    if (block.list) return null
    if (caret - start !== 2 || !blockText(block).startsWith('- ')) return null

    const runs = runsSlice(block.runs, 2, Number.POSITIVE_INFINITY)
    const blocks = doc.blocks.map((entry, at) => (at === index ? { list: 1, runs } : entry))
    return { doc: normalizeDoc({ blocks }), caret: start }
  }
  return null
}

/**
 * Das Wort unter dem Cursor – die Fläche, auf die eine Marke ohne Auswahl
 * wirkt. Auf Weissraum gibt es keins, dann bewirkt der Griff nichts.
 */
export function wordRangeAt(text: string, position: number): { start: number; end: number } | null {
  const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)
  let start = Math.max(0, Math.min(position, text.length))
  let end = start
  while (isWord(text[start - 1])) start--
  while (isWord(text[end])) end++
  return start === end ? null : { start, end }
}

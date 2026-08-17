import { inflateRawSync, inflateSync } from 'node:zlib'

/**
 * Text aus einem PDF lesen – mit Position, ohne fremdes Werkzeug.
 *
 * Warum nicht `pdftotext` wie bei der Texterkennung: Die Rechnungen des
 * Energieversorgers bringen zwar eine Textebene mit, aber ihre Schriften bilden
 * die Zeichen auf den privaten Unicode-Bereich ab. `pdftotext` gibt das brav so
 * aus – heraus kommen 2000 Zeichen aus U+E000 aufwärts, also Buchstabensalat,
 * der obendrein „genug Text" aussieht und damit die Texterkennung ausbremsen
 * würde. Die richtige Zuordnung steht im Encoding der Schrift (`/Differences`,
 * Glyphennamen wie `/E` oder `/adieresis`), und genau die wird hier gelesen.
 *
 * Zusätzlich behält dieses Modul die Position jedes Textstücks. Eine Rechnung
 * ist eine Tabelle; ohne Spalten und Zeilen bliebe von „3'286 kWh zu 18.50 Rp."
 * nur eine Zahlenreihe ohne Zuordnung.
 */

/** Ein zusammenhängendes Textstück mit seinem Ursprung auf der Seite. */
export interface PdfTextRun {
  page: number
  x: number
  /** PDF-Koordinate: grösser heisst weiter oben. */
  y: number
  text: string
}

/** Eine Zeile der Seite: alle Textstücke auf gleicher Höhe, von links nach rechts. */
export interface PdfLine {
  page: number
  y: number
  /** Die Stücke einzeln – bei einer Tabellenzeile sind das die Zellen. */
  cells: string[]
  /** Dieselben Stücke, mit einem Leerzeichen verbunden. */
  text: string
}

export class PdfTextError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PdfTextError'
  }
}

/** Grenzen gegen absichtlich bösartige Dateien – eine Rechnung bleibt weit darunter. */
const MAX_OBJECTS = 20_000
const MAX_STREAM_BYTES = 32 * 1024 * 1024
const MAX_RUNS = 100_000

/**
 * Wie weit zwei Textstücke senkrecht auseinanderliegen dürfen und trotzdem
 * dieselbe Zeile sind. Zwei Punkte: Tabellenzeilen stehen mindestens acht
 * Punkte auseinander, hoch- und tiefgestellte Zeichen weniger als zwei.
 */
const LINE_TOLERANCE = 2

// ------------------------------------------------------------------ Glyphen

/**
 * Glyphennamen, die nicht schon ihr eigenes Zeichen sind.
 *
 * Bewusst nur die im deutschsprachigen Raum vorkommenden statt der vollen
 * Adobe-Liste mit ihren viertausend Einträgen: Was hier fehlt, fällt auf das
 * Basis-Encoding zurück und ist damit nicht verloren, sondern nur ungenauer.
 */
const GLYPH_NAMES: Record<string, string> = {
  space: ' ',
  exclam: '!',
  quotedbl: '"',
  numbersign: '#',
  dollar: '$',
  percent: '%',
  ampersand: '&',
  quotesingle: "'",
  quoteright: '’',
  quoteleft: '‘',
  quotedblleft: '“',
  quotedblright: '”',
  parenleft: '(',
  parenright: ')',
  asterisk: '*',
  plus: '+',
  comma: ',',
  hyphen: '-',
  period: '.',
  slash: '/',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  colon: ':',
  semicolon: ';',
  less: '<',
  equal: '=',
  greater: '>',
  question: '?',
  at: '@',
  bracketleft: '[',
  backslash: '\\',
  bracketright: ']',
  underscore: '_',
  braceleft: '{',
  bar: '|',
  braceright: '}',
  endash: '–',
  emdash: '—',
  bullet: '•',
  Euro: '€',
  degree: '°',
  twosuperior: '²',
  threesuperior: '³',
  onesuperior: '¹',
  germandbls: 'ß',
  adieresis: 'ä',
  odieresis: 'ö',
  udieresis: 'ü',
  Adieresis: 'Ä',
  Odieresis: 'Ö',
  Udieresis: 'Ü',
  agrave: 'à',
  aacute: 'á',
  acircumflex: 'â',
  ccedilla: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecircumflex: 'ê',
  igrave: 'ì',
  iacute: 'í',
  ograve: 'ò',
  oacute: 'ó',
  ugrave: 'ù',
  uacute: 'ú',
  ntilde: 'ñ',
}

function glyphToChar(name: string): string | null {
  const known = GLYPH_NAMES[name]
  if (known) return known
  if (name.length === 1) return name

  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name)
  if (uni) return String.fromCharCode(Number.parseInt(uni[1] as string, 16))

  const short = /^u([0-9A-Fa-f]{4,6})$/.exec(name)
  if (short) return String.fromCodePoint(Number.parseInt(short[1] as string, 16))

  return null
}

/** Der private Unicode-Bereich: dort steht nie echter Text, nur Schriftinterna. */
function isPrivateUse(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0xe000 && code <= 0xf8ff) return true
  }
  return false
}

// ------------------------------------------------------------------ Objekte

interface PdfObject {
  /** Der Wörterbuchteil als Text – alles vor `stream`. */
  dict: string
  /** Der noch gepackte Datenstrom, falls das Objekt einen hat. */
  stream: Buffer | null
}

/**
 * Liest alle indirekten Objekte.
 *
 * Bewusst über die Datei gesucht statt über die Querverweistabelle: Die Tabelle
 * ist bei nachträglich veränderten PDFs oft nicht mehr die einzige, und ein
 * fehlendes Objekt wäre schlimmer als eines zu viel. Latin-1 als Textform, weil
 * dabei ein Byte genau ein Zeichen bleibt – Positionen im Text und in den
 * Rohdaten stimmen so überein.
 */
function readObjects(data: Buffer): Map<number, PdfObject> {
  const raw = data.toString('latin1')
  const objects = new Map<number, PdfObject>()
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g

  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw)) !== null) {
    if (objects.size >= MAX_OBJECTS) break

    const number = Number(match[1])
    const start = match.index + match[0].length

    const streamAt = raw.indexOf('stream', start)
    const endAt = raw.indexOf('endobj', start)
    const hasStream = streamAt >= 0 && (endAt < 0 || streamAt < endAt)

    if (!hasStream) {
      objects.set(number, { dict: raw.slice(start, endAt < 0 ? undefined : endAt), stream: null })
      continue
    }

    const dict = raw.slice(start, streamAt)

    // Nach 'stream' folgt ein Zeilenumbruch, der nicht zu den Daten gehört.
    let from = streamAt + 'stream'.length
    if (raw[from] === '\r') from += 1
    if (raw[from] === '\n') from += 1

    // /Length ist die verlässliche Angabe; nur wenn sie fehlt oder selbst ein
    // Verweis ist, wird nach 'endstream' gesucht.
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)
    let to = length ? from + Number(length[1]) : -1
    if (to < 0 || to > raw.length || !raw.startsWith('endstream', skipEol(raw, to))) {
      to = raw.indexOf('endstream', from)
      if (to < 0) to = raw.length
    }

    if (to - from > MAX_STREAM_BYTES) continue
    objects.set(number, { dict, stream: data.subarray(from, to) })

    // Weiter hinter dem Datenstrom suchen: Binärdaten dürfen nicht als
    // Objektköpfe missverstanden werden.
    pattern.lastIndex = Math.max(pattern.lastIndex, to)
  }

  return objects
}

function skipEol(raw: string, at: number): number {
  let index = at
  while (raw[index] === '\r' || raw[index] === '\n') index += 1
  return index
}

function inflateStream(object: PdfObject): Buffer | null {
  if (!object.stream) return null
  if (!/\/Filter/.test(object.dict)) return object.stream
  if (!/\/FlateDecode/.test(object.dict)) return null

  try {
    return inflateSync(object.stream)
  } catch {
    try {
      return inflateRawSync(object.stream)
    } catch {
      return null
    }
  }
}

/**
 * Holt den Wert eines Schlüssels aus einem Wörterbuch-Text.
 *
 * Ein vollständiger Parser wäre hier Ballast: Gebraucht werden eine Handvoll
 * Schlüssel, und deren Werte sind entweder ein Name, eine Zahl, ein Verweis
 * oder ein geklammerter Block. Klammern werden mitgezählt, damit ein
 * verschachteltes Wörterbuch als Ganzes zurückkommt.
 */
function dictValue(dict: string, key: string): string | null {
  const pattern = new RegExp(`/${key}\\b`)
  const found = pattern.exec(dict)
  if (!found) return null

  let index = found.index + found[0].length
  while (index < dict.length && /\s/.test(dict[index] as string)) index += 1

  if (dict.startsWith('<<', index)) return readBalanced(dict, index, '<<', '>>')
  if (dict[index] === '[') return readBalanced(dict, index, '[', ']')

  const rest = dict.slice(index)
  const reference = /^(\d+)\s+(\d+)\s+R\b/.exec(rest)
  if (reference) return reference[0]

  const token = /^(\/[^\s/<>[\]()]*|-?[\d.]+|\([^)]*\))/.exec(rest)
  return token ? token[0] : null
}

function readBalanced(text: string, from: number, open: string, close: string): string {
  let depth = 0
  let index = from
  while (index < text.length) {
    if (text.startsWith(open, index)) {
      depth += 1
      index += open.length
      continue
    }
    if (text.startsWith(close, index)) {
      depth -= 1
      index += close.length
      if (depth === 0) return text.slice(from, index)
      continue
    }
    index += 1
  }
  return text.slice(from)
}

function referenceNumber(value: string | null): number | null {
  if (!value) return null
  const match = /^(\d+)\s+\d+\s+R$/.exec(value.trim())
  return match ? Number(match[1]) : null
}

/** Löst einen Wert auf, der auch ein Verweis auf ein anderes Objekt sein kann. */
function resolveDict(objects: Map<number, PdfObject>, value: string | null): string | null {
  if (!value) return null
  const number = referenceNumber(value)
  if (number === null) return value
  return objects.get(number)?.dict ?? null
}

// ---------------------------------------------------------------- Encodings

type FontMap = Map<number, string>

/**
 * Baut die Tabelle Zeichencode → Zeichen für eine Schrift.
 *
 * In dieser Reihenfolge, von unten nach oben überschrieben:
 *
 * 1. WinAnsi als Grundlage – deckt Ziffern, Satzzeichen und Leerzeichen ab,
 *    die in `/Differences` üblicherweise gar nicht auftauchen.
 * 2. `/ToUnicode`, sofern die Angaben brauchbar sind. Zeichen aus dem privaten
 *    Bereich werden dabei verworfen: Sie sind der Grund, weshalb fertige
 *    Werkzeuge an diesen Rechnungen scheitern.
 * 3. `/Differences` – die Glyphennamen. Sie sind hier die verlässlichste
 *    Quelle und stehen deshalb zuletzt.
 */
function buildFontMap(objects: Map<number, PdfObject>, fontDict: string): FontMap {
  const map: FontMap = new Map()

  // 1. Grundlage: Latin-1 deckt WinAnsi im hier gebrauchten Bereich.
  for (let code = 32; code <= 255; code += 1) map.set(code, String.fromCharCode(code))

  // 2. ToUnicode
  const toUnicode = referenceNumber(dictValue(fontDict, 'ToUnicode'))
  if (toUnicode !== null) {
    const stream = objects.get(toUnicode)
    const cmap = stream ? inflateStream(stream) : null
    if (cmap) applyToUnicode(map, cmap.toString('latin1'))
  }

  // 3. Differences
  const encoding = resolveDict(objects, dictValue(fontDict, 'Encoding'))
  const differences = encoding ? dictValue(encoding, 'Differences') : null
  if (differences) applyDifferences(map, differences)

  return map
}

function applyDifferences(map: FontMap, differences: string): void {
  let code = 0
  for (const token of differences.replace(/[[\]]/g, ' ').split(/\s+/)) {
    if (!token) continue
    if (/^\d+$/.test(token)) {
      code = Number(token)
      continue
    }
    if (!token.startsWith('/')) continue

    const char = glyphToChar(token.slice(1))
    if (char !== null) map.set(code, char)
    code += 1
  }
}

function applyToUnicode(map: FontMap, cmap: string): void {
  const hexToText = (hex: string): string => {
    let out = ''
    for (let index = 0; index + 3 < hex.length + 1; index += 4) {
      out += String.fromCharCode(Number.parseInt(hex.slice(index, index + 4), 16))
    }
    return out
  }

  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of (block[1] as string).matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const text = hexToText(entry[2] as string)
      if (!text || isPrivateUse(text)) continue
      map.set(Number.parseInt(entry[1] as string, 16), text)
    }
  }

  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const pattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
    for (const entry of (block[1] as string).matchAll(pattern)) {
      const from = Number.parseInt(entry[1] as string, 16)
      const to = Number.parseInt(entry[2] as string, 16)
      const base = Number.parseInt(entry[3] as string, 16)
      if (to - from > 65_535) continue
      for (let offset = 0; offset <= to - from; offset += 1) {
        const text = String.fromCharCode(base + offset)
        if (isPrivateUse(text)) continue
        map.set(from + offset, text)
      }
    }
  }
}

// ------------------------------------------------------------------- Seiten

interface PdfPage {
  content: Buffer
  fonts: Map<string, FontMap>
}

function collectPages(objects: Map<number, PdfObject>): PdfPage[] {
  const pages: PdfPage[] = []

  for (const [, object] of objects) {
    if (!/\/Type\s*\/Page(?![a-zA-Z])/.test(object.dict)) continue

    const content = pageContent(objects, object)
    if (!content) continue

    pages.push({ content, fonts: pageFonts(objects, object) })
  }

  return pages
}

function pageContent(objects: Map<number, PdfObject>, page: PdfObject): Buffer | null {
  const contents = dictValue(page.dict, 'Contents')
  if (!contents) return null

  const numbers: number[] = []
  const single = referenceNumber(contents)
  if (single !== null) numbers.push(single)
  else {
    for (const entry of contents.matchAll(/(\d+)\s+\d+\s+R/g)) numbers.push(Number(entry[1]))
  }

  const parts: Buffer[] = []
  for (const number of numbers) {
    const object = objects.get(number)
    const decoded = object ? inflateStream(object) : null
    if (decoded) parts.push(decoded)
  }

  return parts.length > 0 ? Buffer.concat(parts) : null
}

/**
 * Die Schriften einer Seite unter ihren Kurznamen (`/F1`).
 *
 * Fehlt der Seite ein eigenes Ressourcen-Wörterbuch, erbt sie es laut Norm vom
 * Seitenbaum. Statt den Baum hochzulaufen, wird dann jede Schrift der Datei
 * eingesammelt: Für die eine Zuordnung, um die es geht, ist das Ergebnis
 * dasselbe, und eine kaputte Elternkette macht die Datei nicht unlesbar.
 */
function pageFonts(objects: Map<number, PdfObject>, page: PdfObject): Map<string, FontMap> {
  const fonts = new Map<string, FontMap>()

  const resources = resolveDict(objects, dictValue(page.dict, 'Resources'))
  const fontDict = resources ? resolveDict(objects, dictValue(resources, 'Font')) : null

  const entries = fontDict
    ? [...fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)].map((match) => ({
        name: match[1] as string,
        number: Number(match[2]),
      }))
    : [...objects]
        .filter(([, object]) => /\/Type\s*\/Font\b/.test(object.dict))
        .map(([number]) => ({ name: `#${number}`, number }))

  for (const entry of entries) {
    const object = objects.get(entry.number)
    if (!object) continue
    fonts.set(entry.name, buildFontMap(objects, object.dict))
  }

  // Ohne Ressourcen-Wörterbuch kennt der Inhalt Namen wie /F1, die hier
  // niemandem gehören. Dann gilt die erste Schrift für alles – bei einer
  // Rechnung liegt der Text damit immer noch richtig.
  if (!fontDict && fonts.size > 0) {
    const first = [...fonts.values()][0] as FontMap
    fonts.set('*', first)
  }

  return fonts
}

// ------------------------------------------------------------------ Inhalt

/** Eine affine Abbildung [a b c d e f], wie sie im PDF steht. */
type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
    left[4] * right[0] + left[5] * right[2] + right[4],
    left[4] * right[1] + left[5] * right[3] + right[5],
  ]
}

type Token = { kind: 'operand'; value: string } | { kind: 'operator'; value: string }

/**
 * Zerlegt einen Inhaltsstrom in Operanden und Operatoren.
 *
 * Eingebettete Bilder werden übersprungen: Zwischen `BI` und `EI` stehen
 * Rohdaten, die zufällig wie Befehle aussehen können.
 */
function* tokenize(content: string): Generator<Token> {
  let index = 0

  while (index < content.length) {
    const char = content[index] as string

    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (char === '%') {
      while (index < content.length && content[index] !== '\n') index += 1
      continue
    }

    if (char === '(') {
      const end = findStringEnd(content, index)
      yield { kind: 'operand', value: content.slice(index, end) }
      index = end
      continue
    }

    if (char === '<' && content[index + 1] === '<') {
      const block = readBalanced(content, index, '<<', '>>')
      yield { kind: 'operand', value: block }
      index += block.length
      continue
    }

    if (char === '<') {
      const end = content.indexOf('>', index)
      const stop = end < 0 ? content.length : end + 1
      yield { kind: 'operand', value: content.slice(index, stop) }
      index = stop
      continue
    }

    if (char === '[') {
      const block = readBalancedArray(content, index)
      yield { kind: 'operand', value: block }
      index += block.length
      continue
    }

    if (char === '/' || char === '+' || char === '-' || char === '.' || /\d/.test(char)) {
      const match = /^[/+\-.\d][^\s/<>[\]()%]*/.exec(content.slice(index))
      const value = match ? match[0] : char
      yield { kind: 'operand', value }
      index += value.length
      continue
    }

    const match = /^[^\s/<>[\]()%]+/.exec(content.slice(index))
    const value = match ? match[0] : char
    index += value.length

    if (value === 'BI') {
      const end = content.indexOf('EI', index)
      index = end < 0 ? content.length : end + 2
      continue
    }

    yield { kind: 'operator', value }
  }
}

/** Findet das Ende eines `(…)`-Textes samt verschachtelter und maskierter Klammern. */
function findStringEnd(content: string, from: number): number {
  let depth = 0
  let index = from
  while (index < content.length) {
    const char = content[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return index + 1
    }
    index += 1
  }
  return content.length
}

function readBalancedArray(content: string, from: number): string {
  let depth = 0
  let index = from
  while (index < content.length) {
    const char = content[index]
    if (char === '(') {
      index = findStringEnd(content, index)
      continue
    }
    if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      if (depth === 0) return content.slice(from, index + 1)
    }
    index += 1
  }
  return content.slice(from)
}

/** Löst die Maskierungen eines `(…)`-Textes auf und liefert die Bytes. */
function decodeLiteral(raw: string): number[] {
  const body = raw.slice(1, -1)
  const bytes: number[] = []
  let index = 0

  while (index < body.length) {
    const char = body[index] as string
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0))
      index += 1
      continue
    }

    const next = body[index + 1]
    if (next === undefined) break

    const octal = /^[0-7]{1,3}/.exec(body.slice(index + 1))
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8) & 0xff)
      index += 1 + octal[0].length
      continue
    }

    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 }
    if (next in escapes) bytes.push(escapes[next] as number)
    else if (next !== '\n' && next !== '\r') bytes.push(next.charCodeAt(0))
    index += 2
  }

  return bytes
}

function decodeHexString(raw: string): number[] {
  const hex = raw.slice(1, -1).replace(/[^0-9A-Fa-f]/g, '')
  const bytes: number[] = []
  for (let index = 0; index + 1 < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16))
  }
  if (hex.length % 2 === 1) bytes.push(Number.parseInt(`${hex.slice(-1)}0`, 16))
  return bytes
}

function bytesToText(bytes: readonly number[], font: FontMap | null): string {
  let out = ''
  for (const byte of bytes) {
    out += font?.get(byte) ?? String.fromCharCode(byte)
  }
  return out
}

/**
 * Zwischenraum aus einem `TJ`-Feld: Wo die Schrift um mehr als ein Fünftel
 * eines Gevierts zurückgesetzt wird, steht auf dem Papier ein Wortabstand.
 * Ohne diese Regel klebten „Rechnung" und „Nr." aneinander.
 */
const KERNING_SPACE = 200

function runsOfPage(page: PdfPage, pageNumber: number, runs: PdfTextRun[]): void {
  const content = page.content.toString('latin1')

  let ctm: Matrix = IDENTITY
  const graphicsStack: Matrix[] = []

  let textMatrix: Matrix = IDENTITY
  let lineMatrix: Matrix = IDENTITY
  let leading = 0
  let font: FontMap | null = page.fonts.get('*') ?? null

  let operands: string[] = []

  const number = (index: number): number => {
    const value = Number(operands[operands.length - index])
    return Number.isFinite(value) ? value : 0
  }

  const moveLine = (tx: number, ty: number): void => {
    lineMatrix = multiply([1, 0, 0, 1, tx, ty], lineMatrix)
    textMatrix = lineMatrix
  }

  const show = (text: string): void => {
    if (!text.trim() || runs.length >= MAX_RUNS) return
    const placed = multiply(textMatrix, ctm)
    runs.push({ page: pageNumber, x: placed[4], y: placed[5], text })
  }

  for (const token of tokenize(content)) {
    if (token.kind === 'operand') {
      operands.push(token.value)
      if (operands.length > 32) operands.shift()
      continue
    }

    switch (token.value) {
      case 'q':
        graphicsStack.push(ctm)
        break
      case 'Q':
        ctm = graphicsStack.pop() ?? IDENTITY
        break
      case 'cm':
        ctm = multiply(
          [number(6), number(5), number(4), number(3), number(2), number(1)],
          ctm,
        )
        break
      case 'BT':
        textMatrix = IDENTITY
        lineMatrix = IDENTITY
        break
      case 'Tf': {
        const name = (operands[operands.length - 2] ?? '').replace(/^\//, '')
        font = page.fonts.get(name) ?? page.fonts.get('*') ?? font
        break
      }
      case 'TL':
        leading = number(1)
        break
      case 'Td':
        moveLine(number(2), number(1))
        break
      case 'TD':
        leading = -number(1)
        moveLine(number(2), number(1))
        break
      case 'T*':
        moveLine(0, -leading)
        break
      case 'Tm':
        textMatrix = [number(6), number(5), number(4), number(3), number(2), number(1)]
        lineMatrix = textMatrix
        break
      case 'Tj':
      case "'":
      case '"': {
        if (token.value !== 'Tj') moveLine(0, -leading)
        const raw = operands[operands.length - 1] ?? ''
        const bytes = raw.startsWith('<') ? decodeHexString(raw) : decodeLiteral(raw)
        show(bytesToText(bytes, font))
        break
      }
      case 'TJ': {
        const array = operands[operands.length - 1] ?? ''
        let text = ''
        const pattern = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|-?[\d.]+/g
        for (const part of array.matchAll(pattern)) {
          const value = part[0]
          if (value.startsWith('(')) text += bytesToText(decodeLiteral(value), font)
          else if (value.startsWith('<')) text += bytesToText(decodeHexString(value), font)
          else if (Number(value) < -KERNING_SPACE && !text.endsWith(' ')) text += ' '
        }
        show(text)
        break
      }
      default:
        break
    }

    operands = []
  }
}

// ------------------------------------------------------------------- Ausgabe

/**
 * Liest ein PDF und liefert seine Zeilen, von oben nach unten und links nach
 * rechts – so, wie ein Mensch die Seite liest.
 */
export function extractPdfLines(data: Buffer): PdfLine[] {
  if (!data.subarray(0, 1024).toString('latin1').includes('%PDF')) {
    throw new PdfTextError('Die Datei ist kein PDF.')
  }

  const objects = readObjects(data)
  const pages = collectPages(objects)
  if (pages.length === 0) throw new PdfTextError('Das PDF enthält keine lesbaren Seiten.')

  const runs: PdfTextRun[] = []
  pages.forEach((page, index) => runsOfPage(page, index + 1, runs))

  runs.sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page
    if (Math.abs(left.y - right.y) > LINE_TOLERANCE) return right.y - left.y
    return left.x - right.x
  })

  const lines: PdfLine[] = []
  for (const run of runs) {
    const current = lines[lines.length - 1]
    const sameLine =
      current !== undefined &&
      current.page === run.page &&
      Math.abs(current.y - run.y) <= LINE_TOLERANCE

    if (sameLine) current.cells.push(run.text.trim())
    else lines.push({ page: run.page, y: run.y, cells: [run.text.trim()], text: '' })
  }

  for (const line of lines) {
    line.cells = line.cells.filter(Boolean)
    line.text = line.cells.join(' ')
  }

  return lines.filter((line) => line.cells.length > 0)
}

/** Der ganze Text einer Datei, Zeile für Zeile – für Suche und Fehlersuche. */
export function extractPdfText(data: Buffer): string {
  return extractPdfLines(data)
    .map((line) => line.text)
    .join('\n')
}

import {
  MAX_LIST_LEVEL,
  decodeMarks,
  encodeMarks,
  hasMarks,
  marksOf,
  normalizeDoc,
  type RichBlock,
  type RichDoc,
  type RichMarks,
  type RichRun,
} from '@manager/shared'

import { markClasses } from './richStyles'

/**
 * Die Brücke zwischen dem Modell (`richtext` im geteilten Paket) und einem
 * `contentEditable` – übernommen aus der BSS-App.
 *
 * Der Editor arbeitet nicht gegen einen eigenen Zustand, sondern gegen das,
 * was der Browser aus dem Feld macht: Getippt wird nativ, und nach jeder
 * Eingabe liest `docFromDom` den Stand zurück – gleich, ob Chrome eine neue
 * Zeile als `<div>` anlegt, Safari ein `<br>` setzt oder ein Löschen zwei
 * Zeilen verschmilzt. Nur bei eigenen Handgriffen (Marke setzen, Liste
 * einrücken, Einfügen) wird das Feld aus dem Modell neu aufgebaut
 * (`renderDocInto`) und der Cursor an dieselbe Stelle zurückgesetzt.
 *
 * Marken hängen an `<span data-rt="…">`: Das Attribut ist die Wahrheit, die
 * Klassen daneben sind blosse Darstellung. Fremdes Markup verliert seine
 * Marken, nie seinen Text.
 *
 * Cursor und Auswahl werden als Zeichenstellen im Bearbeitungstext gemerkt
 * (`editTextOf`, Blöcke mit `\n` verbunden): Diese Zahlen überleben den
 * Neuaufbau des Feldes – die DOM-Knoten nicht.
 */

type ScanEvent =
  | { kind: 'block'; level: number; anchor: Node }
  | { kind: 'text'; node: Text; text: string; marks: RichMarks }

const BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'SECTION',
  'ARTICLE',
  'TABLE',
  'TR',
])

const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'BUTTON', 'SELECT', 'TEXTAREA'])

const INVISIBLE = /[​﻿\r\n]/

/**
 * Unsichtbares verwerfen, geschütztes Leerzeichen normalisieren.
 *
 * `&nbsp;` setzt der Browser beim Tippen mehrerer Leerzeichen – im Text ist
 * es ein Leerzeichen (gleiche Länge, die Cursor-Rechnung bleibt einfach).
 * Nullbreite Zeichen und Zeilenumbrüche in Textknoten entstehen beim Tippen
 * nicht; was doch hereinrutscht, fällt weg.
 */
function cleanText(raw: string): string {
  return raw.replace(/ /g, ' ').replace(/[​﻿\r\n]/g, '')
}

/** Die rohe Stelle im Textknoten zu einer bereinigten Zeichenstelle. */
function rawIndexFor(node: Text, cleanOffset: number): number {
  const raw = node.nodeValue ?? ''
  if (cleanOffset <= 0) return 0
  let seen = 0
  for (let index = 0; index < raw.length; index++) {
    if (!INVISIBLE.test(raw[index] ?? '')) seen++
    if (seen >= cleanOffset) return index + 1
  }
  return raw.length
}

/** Wie viele bereinigte Zeichen vor der rohen Stelle liegen. */
function cleanLengthBefore(node: Text, rawOffset: number): number {
  return cleanText((node.nodeValue ?? '').slice(0, rawOffset)).length
}

/**
 * Bricht dieses `<br>` eine Zeile – oder steht es nur als Platzhalter am
 * Blockende? `<div>abc<br></div>` zeigt keine Leerzeile, `abc<br><br>` schon:
 * Es zählt, ob innerhalb des Blocks noch etwas folgt.
 */
function brBreaks(br: HTMLElement, root: HTMLElement): boolean {
  let node: Node = br
  while (node !== root) {
    let sibling = node.nextSibling
    while (sibling) {
      if (sibling.nodeType === Node.TEXT_NODE) {
        if (cleanText(sibling.nodeValue ?? '') !== '') return true
      } else if (sibling.nodeType === Node.ELEMENT_NODE) {
        return true
      }
      sibling = sibling.nextSibling
    }
    const parent = node.parentNode
    if (!parent || parent === root || parent.nodeType !== Node.ELEMENT_NODE) return false
    const tag = (parent as HTMLElement).tagName
    if (BLOCK_TAGS.has(tag) || tag === 'UL' || tag === 'OL') return false
    node = parent
  }
  return false
}

/**
 * Marken, die ein Inline-Element beiträgt – ausschliesslich aus `data-rt`.
 *
 * Nach dem Löschen formatierten Texts schreibt Chrome neuen Text mit einem
 * „wiederbelebten" Tippstil weiter – ein Span mit kopierter Farbe, das nie
 * durch unsere Hände ging. Wer solches Markup halb liest, macht Geratenes zu
 * gespeicherten Marken; wer es ganz übergeht, behält das Modell als einzige
 * Wahrheit. Was der Browser hineinschmuggelt, erkennt `needsNormalize`, und
 * das Feld wird gleich darauf sauber aus dem Modell neu gezeichnet.
 */
function inlineMarks(el: HTMLElement, marks: RichMarks): RichMarks {
  const data = el.getAttribute('data-rt')
  return data ? { ...marks, ...decodeMarks(data) } : marks
}

/**
 * Fremdes Markup im Feld – alles, was nicht aus `renderDocInto` stammt.
 *
 * Unser eigenes Zeichnen erzeugt genau: `div`, `ul`, `li`, `br`, Textknoten
 * und `span` **mit** `data-rt` – nie Inline-Styles, nie `<b>` und Konsorten.
 * Taucht anderes auf (der wiederbelebte Tippstil nach dem Löschen, das B/I/U
 * einer Auswahlleiste), stimmt die Anzeige nicht mehr mit dem Modell überein,
 * und das Feld gehört neu gezeichnet.
 */
const FOREIGN_MARKUP = '[style],font,b,strong,i,em,u,span:not([data-rt])'

export function needsNormalize(root: HTMLElement): boolean {
  return root.querySelector(FOREIGN_MARKUP) !== null
}

/**
 * Der eine Durchlauf durchs Feld, auf dem alles rechnet.
 *
 * Parser (`docFromDom`) und Cursor-Rechnung (`buildMap`) falten dieselben
 * Ereignisse – nur so meinen beide mit „Zeichen 17" dieselbe Stelle.
 */
function scan(root: HTMLElement, emit: (event: ScanEvent) => void): void {
  // Eben einen Block verlassen: Fliesstext dahinter beginnt eine neue Zeile.
  let pendingBlock = false

  const visitChildren = (parent: Node, marks: RichMarks, level: number): void => {
    for (const child of Array.from(parent.childNodes)) visit(child, marks, level)
  }

  const visit = (node: Node, marks: RichMarks, level: number): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.nodeValue ?? '')
      if (!text) return
      if (pendingBlock) {
        emit({ kind: 'block', level, anchor: node })
        pendingBlock = false
      }
      emit({ kind: 'text', node: node as Text, text, marks })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName
    if (SKIP_TAGS.has(tag)) return

    if (tag === 'BR') {
      if (brBreaks(el, root)) {
        emit({ kind: 'block', level, anchor: el })
        pendingBlock = false
      }
      return
    }
    if (tag === 'UL' || tag === 'OL') {
      visitChildren(el, marks, Math.min(MAX_LIST_LEVEL, level + 1))
      pendingBlock = true
      return
    }
    if (tag === 'LI') {
      emit({ kind: 'block', level: Math.max(1, level), anchor: el })
      pendingBlock = false
      visitChildren(el, marks, Math.max(1, level))
      pendingBlock = true
      return
    }
    if (BLOCK_TAGS.has(tag)) {
      emit({ kind: 'block', level, anchor: el })
      pendingBlock = false
      visitChildren(el, marks, level)
      pendingBlock = true
      return
    }
    visitChildren(el, inlineMarks(el, marks), level)
  }

  visitChildren(root, {}, 0)
}

/* ------------------------------------------------------------------ */
/* DOM → Modell                                                        */
/* ------------------------------------------------------------------ */

export function docFromDom(root: HTMLElement): RichDoc {
  const blocks: RichBlock[] = []
  scan(root, (event) => {
    if (event.kind === 'block') {
      blocks.push(event.level > 0 ? { list: event.level, runs: [] } : { runs: [] })
      return
    }
    let current = blocks[blocks.length - 1]
    if (!current) {
      current = { runs: [] }
      blocks.push(current)
    }
    current.runs.push({ t: event.text, ...marksOf(event.marks) })
  })
  return normalizeDoc({ blocks: blocks.length > 0 ? blocks : [{ runs: [] }] })
}

/* ------------------------------------------------------------------ */
/* Cursorstellen                                                       */
/* ------------------------------------------------------------------ */

interface PositionMap {
  texts: { offset: number; node: Text; length: number }[]
  blocks: { offset: number; anchor: Node }[]
  /** Beide zusammen, in Dokumentreihenfolge */
  points: { offset: number; node: Node; textLength: number }[]
  length: number
}

function buildMap(root: HTMLElement): PositionMap {
  const map: PositionMap = { texts: [], blocks: [], points: [], length: 0 }
  let offset = 0
  let started = false
  scan(root, (event) => {
    if (event.kind === 'block') {
      if (started) offset += 1
      started = true
      map.blocks.push({ offset, anchor: event.anchor })
      map.points.push({ offset, node: event.anchor, textLength: 0 })
      return
    }
    started = true
    map.texts.push({ offset, node: event.node, length: event.text.length })
    map.points.push({ offset, node: event.node, textLength: event.text.length })
    offset += event.text.length
  })
  map.length = offset
  return map
}

/**
 * Die Stelle eines Knotens, der selbst nicht in der Karte steht.
 *
 * Browser setzen den Cursor meist in Textknoten – dann genügt die Karte
 * direkt. In leeren Blöcken aber hängt er am Element (im `<li>`, vor dessen
 * `<br>`), und die Stelle muss aus der Umgebung erschlossen werden: Das Ende
 * des letzten gemessenen Punkts davor ist die Untergrenze, und liegt der
 * Knoten in einem leeren Block, hebt dessen Anfang sie an. Ohne das Anheben
 * fiele ein Cursor in einer Leerzeile auf das Ende der Zeile davor – oder,
 * schlimmer, auf den Anfang der Zeile danach.
 */
function resolveNodePoint(map: PositionMap, target: Node): number {
  let containingBlock: number | null = null
  let floor = 0
  for (const point of map.points) {
    if (point.node === target || target.contains(point.node)) return point.offset
    const rel = target.compareDocumentPosition(point.node)
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) break
    if (rel & Node.DOCUMENT_POSITION_CONTAINS) {
      // Ein Blockanker, der den Knoten enthält – sein Anfang zählt mit.
      if (point.textLength === 0) containingBlock = point.offset
      continue
    }
    floor = point.offset + point.textLength
  }
  return containingBlock !== null ? Math.max(containingBlock, floor) : floor
}

/** Das Ende des letzten gemessenen Punkts innerhalb von `container`. */
function lastPointInside(map: PositionMap, container: Node): number | null {
  for (let index = map.points.length - 1; index >= 0; index--) {
    const point = map.points[index]
    if (point && (container === point.node || container.contains(point.node))) {
      return point.offset + point.textLength
    }
  }
  return null
}

function resolvePoint(map: PositionMap, node: Node, nodeOffset: number): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const entry = map.texts.find((text) => text.node === node)
    if (entry) return entry.offset + cleanLengthBefore(node as Text, nodeOffset)
    // Ein Textknoten, den die Karte nicht kennt (leer): über die Lage auflösen.
    return resolveNodePoint(map, node)
  }

  const children = node.childNodes
  const child = nodeOffset < children.length ? children[nodeOffset] : null
  if (child) return resolveNodePoint(map, child)

  // Am Ende des Elements: hinter dem letzten Punkt darin.
  const inside = lastPointInside(map, node)
  if (inside !== null) return inside
  return resolveNodePoint(map, node)
}

function locatePoint(
  root: HTMLElement,
  map: PositionMap,
  offset: number,
): { node: Node; offset: number } {
  const target = Math.max(0, Math.min(offset, map.length))

  for (const text of map.texts) {
    if (target >= text.offset && target <= text.offset + text.length) {
      return { node: text.node, offset: rawIndexFor(text.node, target - text.offset) }
    }
  }

  // Kein Text an dieser Stelle – ein leerer Block. Sein Anker trägt den Cursor.
  let best: { node: Node; offset: number } | null = null
  for (const block of map.blocks) {
    if (block.offset !== target) continue
    const anchor = block.anchor
    if (anchor.nodeType === Node.TEXT_NODE) {
      best = { node: anchor, offset: 0 }
    } else if ((anchor as HTMLElement).tagName === 'BR') {
      const parent = anchor.parentNode
      if (parent) {
        const index = Array.prototype.indexOf.call(parent.childNodes, anchor)
        best = { node: parent, offset: index + 1 }
      }
    } else {
      best = { node: anchor, offset: 0 }
    }
  }
  if (best) return best
  return { node: root, offset: root.childNodes.length }
}

/** Wo die Auswahl steht – als Zeichenstellen im Bearbeitungstext. */
export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null

  const map = buildMap(root)
  const start = resolvePoint(map, range.startContainer, range.startOffset)
  const end = range.collapsed ? start : resolvePoint(map, range.endContainer, range.endOffset)
  return start <= end ? { start, end } : { start: end, end: start }
}

/** Die Auswahl an diese Zeichenstellen setzen. */
export function setSelectionOffsets(root: HTMLElement, start: number, end: number): void {
  const map = buildMap(root)
  const from = locatePoint(root, map, Math.min(start, end))
  const to = start === end ? from : locatePoint(root, map, Math.max(start, end))

  const selection = window.getSelection()
  if (!selection) return
  try {
    const range = document.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    // Eine nicht setzbare Stelle (das Feld wurde eben umgebaut) ist kein
    // Grund, das Tippen anzuhalten – der Cursor bleibt dann, wo er ist.
  }
}

/**
 * Den Cursor dorthin setzen, wo angetippt wurde.
 *
 * Wer in einer langen Notiz auf die fünfzigste Zeile tippt, will dort
 * weiterschreiben – nicht am Anfang und nicht am Ende. Gelesener Text und
 * Editor sind gleich aufgebaut (dieselben Blöcke, dieselben Klassen), der
 * Punkt am Bildschirm trifft deshalb im Editor dasselbe Zeichen wie vorher im
 * gelesenen Text. `false` heisst: Der Browser kennt keinen Weg dorthin, oder
 * der Punkt liegt ausserhalb des Feldes.
 */
export function placeCaretAtPoint(root: HTMLElement, x: number, y: number): boolean {
  const lookup = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | null = null
  let offset = 0
  const position = lookup.caretPositionFromPoint?.(x, y)
  if (position) {
    node = position.offsetNode
    offset = position.offset
  } else {
    const range = lookup.caretRangeFromPoint?.(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  }
  if (!node || !root.contains(node)) return false

  const selection = window.getSelection()
  if (!selection) return false
  try {
    const range = document.createRange()
    range.setStart(node, offset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  } catch {
    return false
  }
}

/** Wo der Cursor am Bildschirm steht – das Ende der Auswahl, dort geht es weiter. */
function caretRect(): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(false)

  const rects = range.getClientRects()
  const last = rects[rects.length - 1]
  if (last && last.height > 0) return last
  const box = range.getBoundingClientRect()
  if (box.height > 0) return box

  // In einer leeren Zeile hat ein zusammengefallener Bereich keine Masse –
  // dann steht der Cursor dort, wo die Zeile steht.
  const container = range.endContainer
  const near =
    container.nodeType === Node.ELEMENT_NODE
      ? (container.childNodes[range.endOffset] ??
        container.childNodes[range.endOffset - 1] ??
        container)
      : container
  const element = near.nodeType === Node.ELEMENT_NODE ? (near as Element) : near.parentElement
  return element ? element.getBoundingClientRect() : null
}

/** Das nächste Element darüber, das seinen Inhalt selbst rollt. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Den Cursor sichtbar halten – mit etwas Luft darüber und darunter.
 *
 * Browser rollen beim Tippen von selbst zum Cursor, aber nicht zuverlässig:
 * Die Eingabe einer Handytastatur läuft über Kompositionen statt über
 * Tastendrücke, und wenn die Tastatur aufgeht, wird das Fenster kleiner, ohne
 * dass jemand getippt hätte. Deshalb rechnet das Feld selbst nach: Liegt der
 * Cursor ausserhalb des sichtbaren Bereichs – gemessen am rollenden Fenster
 * und am Teil des Bildschirms, den die Tastatur frei lässt –, wird genau so
 * weit gerollt, dass er wieder mit etwas Abstand (`luft`) im Bild steht.
 */
export function revealCaret(root: HTMLElement, luft = 48): void {
  const rect = caretRect()
  if (!rect) return
  const scroller = scrollParent(root)
  if (!scroller) return

  const box = scroller.getBoundingClientRect()
  const viewport = window.visualViewport
  const top = Math.max(box.top, viewport ? viewport.offsetTop : 0)
  const bottom = Math.min(
    box.bottom,
    viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
  )
  // Rund zwei Zeilen Luft, auf einem sehr kleinen Ausschnitt entsprechend weniger.
  const margin = Math.max(0, Math.min(luft, (bottom - top) / 4))

  if (rect.bottom > bottom - margin) {
    scroller.scrollTop += rect.bottom - (bottom - margin)
  } else if (rect.top < top + margin) {
    scroller.scrollTop -= top + margin - rect.top
  }
}

/* ------------------------------------------------------------------ */
/* Modell → DOM                                                        */
/* ------------------------------------------------------------------ */

function markedSpan(text: string, marks: RichMarks): HTMLElement {
  const span = document.createElement('span')
  span.className = markClasses(marks)
  span.setAttribute('data-rt', encodeMarks(marks))
  span.textContent = text
  return span
}

function runNodes(runs: RichRun[]): Node[] {
  return runs.map((run) => {
    const marks = marksOf(run)
    return hasMarks(marks) ? markedSpan(run.t, marks) : document.createTextNode(run.t)
  })
}

function fillBlock(el: HTMLElement, block: RichBlock): void {
  const nodes = runNodes(block.runs)
  // Eine leere Zeile braucht ein <br>, sonst hätte der Cursor keine Höhe.
  if (nodes.length === 0) el.appendChild(document.createElement('br'))
  else el.append(...nodes)
}

/**
 * Das Feld aus dem Modell aufbauen.
 *
 * Absätze werden `<div>` (so legt sie auch der Browser beim Tippen an),
 * Listenpunkte `<li>` in so tief verschachtelten `<ul>`, wie die Ebene sagt –
 * derselbe Aufbau wie im gelesenen Text (`RichText`).
 */
export function renderDocInto(root: HTMLElement, doc: RichDoc): void {
  const normal = normalizeDoc(doc)
  const nodes: Node[] = []
  // Offene Listen je Ebene – Ebene 2 hängt in der letzten <li> von Ebene 1.
  const stack: HTMLElement[] = []
  for (const block of normal.blocks) {
    const level = block.list ? Math.min(block.list, MAX_LIST_LEVEL) : 0
    if (level === 0) {
      stack.length = 0
      const div = document.createElement('div')
      fillBlock(div, block)
      nodes.push(div)
      continue
    }
    while (stack.length > level) stack.pop()
    while (stack.length < level) {
      const ul = document.createElement('ul')
      const parent = stack[stack.length - 1]
      if (!parent) {
        nodes.push(ul)
      } else {
        const lastChild = parent.lastElementChild
        ;(lastChild && lastChild.tagName === 'LI' ? lastChild : parent).appendChild(ul)
      }
      stack.push(ul)
    }
    const li = document.createElement('li')
    fillBlock(li, block)
    stack[stack.length - 1]?.appendChild(li)
  }
  root.replaceChildren(...nodes)
}

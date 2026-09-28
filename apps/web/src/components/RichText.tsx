import {
  MAX_LIST_LEVEL,
  docOfValue,
  hasMarks,
  marksOf,
  splitLinks,
  withWritingLines,
  type RichBlock,
  type RichFile,
  type RichRun,
} from '@manager/shared'
import { Fragment, useMemo, type ReactNode } from 'react'

import { NoteFileBlock } from './NoteFiles'
import { markClasses } from '../lib/richStyles'

/**
 * Formatierter Text, gelesen – mit Verweisen, die sich antippen lassen.
 *
 * Gezeichnet wird immer über das Modell, auch bei reinem Text: Jede Zeile ist
 * ein Block, eine Liste ist eine Liste – genau so, wie der Editor das Feld
 * aufbaut (`renderDocInto`). Das ist mehr als Ordnungsliebe: Beim Wechsel vom
 * Lesen ins Schreiben steht jedes Zeichen an derselben Stelle, und der Cursor
 * landet dort, wo getippt wurde.
 *
 * Passt das Formatfeld nicht mehr zum Text – jemand hat mit einer älteren
 * Fassung der App nur den Text geändert –, steht hier stillschweigend der
 * unformatierte Text: Er ist die Wahrheit, die Formatierung nur die Ansicht
 * dazu.
 */
export function RichText({
  text,
  rich,
  links = true,
  dateien = 'gross',
  onOpenFile,
  className = '',
}: {
  text: string
  rich?: string | null
  /**
   * Verweise anklickbar machen. Nicht dort, wo der ganze Text selbst ein
   * Knopf ist (die Kachel der DocBase): Ein Verweis in einem Knopf ist nicht
   * erlaubt, und auf einer so kleinen Fläche träfe man ihn nur aus Versehen.
   */
  links?: boolean
  /**
   * Wie Dateien dastehen: gross wie im Editor (die geöffnete Notiz) oder als
   * eine Zeile „📎 Name" (Kachel und Liste – dort ist für Bilder kein Platz,
   * und die Fläche gehört dem Öffnen der Notiz).
   */
  dateien?: 'gross' | 'kompakt'
  /** Antippen einer Datei – ohne Angabe lässt sie sich nicht öffnen. */
  onOpenFile?: (file: RichFile) => void
  className?: string
}) {
  const doc = useMemo(() => {
    const value = docOfValue({ text, rich })
    // Um jede Datei eine Zeile zum Schreiben – wie im Editor, damit beide
    // Fassungen gleich hoch sind (siehe `withWritingLines`).
    return dateien === 'gross' ? withWritingLines(value) : value
  }, [text, rich, dateien])
  const ctx: Zeichnen = { links, kompakt: dateien === 'kompakt', onOpenFile }

  return <div className={`richtext ${className}`}>{blockNodes(doc.blocks, ctx)}</div>
}

/** Was beim Zeichnen durch alle Ebenen gereicht wird. */
interface Zeichnen {
  links: boolean
  kompakt: boolean
  onOpenFile?: (file: RichFile) => void
}

/* ------------------------------------------------------------------ */
/* Blöcke und Listen                                                   */
/* ------------------------------------------------------------------ */

function renderBlock(block: RichBlock, key: number, ctx: Zeichnen): ReactNode {
  // Eine leere Zeile trägt ein <br> wie im Editor – sonst fiele sie zusammen.
  return block.runs.length === 0 ? <br /> : renderRuns(block.runs, `b${key}`, ctx.links)
}

function blockNodes(blocks: RichBlock[], ctx: Zeichnen): ReactNode[] {
  const out: ReactNode[] = []
  let index = 0
  while (index < blocks.length) {
    const block = blocks[index] as RichBlock
    if (block.file) {
      // Eine Datei ist nie ein Listenpunkt – sie steht immer für sich.
      out.push(
        <NoteFileBlock
          key={`file-${index}`}
          file={block.file}
          kompakt={ctx.kompakt}
          onOpen={ctx.onOpenFile}
        />,
      )
      index++
      continue
    }
    if (!block.list) {
      out.push(<div key={index}>{renderBlock(block, index, ctx)}</div>)
      index++
      continue
    }
    const result = listNodes(blocks, index, 1, ctx)
    out.push(<Fragment key={`list-${index}`}>{result.node}</Fragment>)
    index = result.next
  }
  return out
}

/** Aufeinanderfolgende Listenpunkte als verschachtelte `<ul>`. */
function listNodes(
  blocks: RichBlock[],
  start: number,
  level: number,
  ctx: Zeichnen,
): { node: ReactNode; next: number } {
  const items: ReactNode[] = []
  let index = start
  while (index < blocks.length) {
    const block = blocks[index] as RichBlock
    const blockLevel = block.list ? Math.min(block.list, MAX_LIST_LEVEL) : 0
    if (blockLevel === 0 || blockLevel < level) break

    if (blockLevel === level) {
      const key = index
      const content = renderBlock(block, key, ctx)
      let sub: ReactNode = null
      const following = blocks[index + 1]
      if (following?.list && following.list > level) {
        const nested = listNodes(blocks, index + 1, level + 1, ctx)
        sub = nested.node
        index = nested.next
      } else {
        index++
      }
      items.push(
        <li key={key}>
          {content}
          {sub}
        </li>,
      )
    } else {
      // Ebene übersprungen (4 direkt nach 1, etwa nach dreimal Tab): Jede
      // fehlende Ebene bekommt ihre eigene Liste, eine in der anderen – so
      // baut auch der Editor das Feld (`renderDocInto`). Spränge die Liste
      // direkt auf die Zielebene, stünde der Punkt beim Lesen weniger weit
      // eingerückt als beim Schreiben.
      const nested = listNodes(blocks, index, level + 1, ctx)
      items.push(<Fragment key={`deep-${index}`}>{nested.node}</Fragment>)
      index = nested.next
    }
  }
  return { node: <ul>{items}</ul>, next: index }
}

/* ------------------------------------------------------------------ */
/* Läufe und Verweise                                                  */
/* ------------------------------------------------------------------ */

function renderRuns(runs: RichRun[], keyBase: string, links: boolean): ReactNode {
  return runs.map((run, index) => {
    const marks = marksOf(run)
    const content = links ? linked(run.t, `${keyBase}-${index}`) : run.t
    if (!hasMarks(marks)) return <Fragment key={index}>{content}</Fragment>
    return (
      <span key={index} className={markClasses(marks)}>
        {content}
      </span>
    )
  })
}

/**
 * Ein Stück Lauftext mit anklickbaren Verweisen – wie `LinkedText`.
 *
 * Gesucht wird je Lauf: Ein Verweis, den eine Formatgrenze zerschneidet, wird
 * zu zwei halben Verweisen, die beide nicht stimmen. Das nimmt man in Kauf –
 * wer einen Verweis einfärbt, färbt ihn als Ganzes.
 */
function linked(text: string, key: string): ReactNode {
  return splitLinks(text).map((teil, index) =>
    teil.href ? (
      <a
        key={`${key}-${index}`}
        href={teil.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="pointer-events-auto relative z-10 break-words text-brand-700 underline underline-offset-2 dark:text-brand-300"
      >
        {teil.text}
      </a>
    ) : (
      <Fragment key={`${key}-${index}`}>{teil.text}</Fragment>
    ),
  )
}

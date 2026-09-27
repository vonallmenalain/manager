import {
  MAX_LIST_LEVEL,
  docOfValue,
  hasMarks,
  marksOf,
  splitLinks,
  type RichBlock,
  type RichRun,
} from '@manager/shared'
import { Fragment, useMemo, type ReactNode } from 'react'

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
  className?: string
}) {
  const doc = useMemo(() => docOfValue({ text, rich }), [text, rich])

  return <div className={`richtext ${className}`}>{blockNodes(doc.blocks, links)}</div>
}

/* ------------------------------------------------------------------ */
/* Blöcke und Listen                                                   */
/* ------------------------------------------------------------------ */

function renderBlock(block: RichBlock, key: number, links: boolean): ReactNode {
  // Eine leere Zeile trägt ein <br> wie im Editor – sonst fiele sie zusammen.
  return block.runs.length === 0 ? <br /> : renderRuns(block.runs, `b${key}`, links)
}

function blockNodes(blocks: RichBlock[], links: boolean): ReactNode[] {
  const out: ReactNode[] = []
  let index = 0
  while (index < blocks.length) {
    const block = blocks[index] as RichBlock
    if (!block.list) {
      out.push(<div key={index}>{renderBlock(block, index, links)}</div>)
      index++
      continue
    }
    const result = listNodes(blocks, index, 1, links)
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
  links: boolean,
): { node: ReactNode; next: number } {
  const items: ReactNode[] = []
  let index = start
  while (index < blocks.length) {
    const block = blocks[index] as RichBlock
    const blockLevel = block.list ? Math.min(block.list, MAX_LIST_LEVEL) : 0
    if (blockLevel === 0 || blockLevel < level) break

    if (blockLevel === level) {
      const key = index
      const content = renderBlock(block, key, links)
      let sub: ReactNode = null
      const following = blocks[index + 1]
      if (following?.list && following.list > level) {
        const nested = listNodes(blocks, index + 1, level + 1, links)
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
      // Ebene übersprungen (2 ohne 1): Liste direkt in Liste.
      const nested = listNodes(blocks, index, blockLevel, links)
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

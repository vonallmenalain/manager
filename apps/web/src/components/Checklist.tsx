import {
  blockText,
  checklistFromNote,
  checklistToNote,
  docOfValue,
  normalizeDoc,
  singleLineBlock,
  sortChecklist,
  toRichValue,
  type RichBlock,
  type RichChecklistItem,
  type RichValue,
} from '@manager/shared'
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { RichZeile } from './RichText'
import { RichTextField, type Akzent, type RichTextFieldHandle } from './RichTextField'

/**
 * Die Checkliste – im Haushalt wie in der DocBase dieselbe.
 *
 * Jeder Eintrag ist eine Zeile, die sich formatieren lässt wie der Text einer
 * Notiz: fett, farbig, gross. Ohne Auswahl wirkt ein Griff auf den ganzen
 * Eintrag – genau das, was man auf einer Liste will. Die Kästchen gehören
 * nicht dazu; sie stehen im gespeicherten Text (siehe `checklistToNote`).
 *
 * Verschoben wird am Griff links: festhalten und ziehen. Nur der Griff
 * fängt den Finger – überall sonst blättert die Liste wie gewohnt, und das ist
 * der Grund, warum es ihn gibt (am Startbildschirm und bei den Abteilungen
 * stehen dafür Pfeile, siehe dort). Mit der Tastatur verschieben die Pfeile auf
 * dem Griff. Offenes bleibt dabei bei Offenem und Erledigtes bei Erledigtem:
 * Beim nächsten Abhaken rutschte Erledigtes ohnehin wieder nach unten.
 *
 * Unten steht immer eine Zeile zum Weiterschreiben: Enter beginnt den nächsten
 * Eintrag – mitten im Text geteilt, wie in jedem Editor –, Rücktaste am Anfang
 * führt ihn mit dem darüber zusammen. Mehrere Zeilen einfügen ergibt mehrere
 * Einträge.
 */

/** Ein Eintrag im Fenster – mit einer Kennung, damit Fokus und Ziehen ihm folgen. */
export interface Eintrag extends RichChecklistItem {
  id: string
}

let zaehler = 0
function neueId(): string {
  zaehler += 1
  return `eintrag-${Date.now().toString(36)}-${zaehler}`
}

const LEER: RichValue = { text: '', rich: null }

export function neuerEintrag(value: RichValue = LEER, done = false): Eintrag {
  return { id: neueId(), done, value }
}

/**
 * Die Einträge einer gespeicherten Notiz, Erledigtes unten. Eine frische
 * Liste beginnt mit einer leeren Zeile – sonst müsste man erst „Eintrag
 * hinzufügen" treffen, bevor man tippen kann.
 */
export function eintraegeAus(body: string, rich: string | null | undefined): Eintrag[] {
  const vorhanden = sortChecklist(checklistFromNote(body, rich)).map((item) =>
    neuerEintrag(item.value, item.done),
  )
  return vorhanden.length > 0 ? vorhanden : [neuerEintrag()]
}

/** Was gespeichert wird: Text mit Kästchen und die Formatierung daneben. */
export function alsNotiz(items: readonly Eintrag[]): { body: string; bodyRich: string | null } {
  return checklistToNote(items)
}

/** Ob zwei Stände dieselben Einträge zeigen – für den Verlauf des Fensters. */
export function gleicheEintraege(a: readonly Eintrag[], b: readonly Eintrag[]): boolean {
  return (
    a === b ||
    (a.length === b.length &&
      a.every((item, index) => {
        const other = b[index]
        return (
          other !== undefined &&
          item.id === other.id &&
          item.done === other.done &&
          item.value.text === other.value.text &&
          item.value.rich === other.value.rich
        )
      }))
  )
}

const valueOf = (block: RichBlock): RichValue => toRichValue({ blocks: [block] })

/** Eine Zeile ans Ende einer anderen hängen – für Rücktaste am Anfang. */
function zusammen(oben: RichValue, unten: RichValue): RichValue {
  const a = singleLineBlock(docOfValue(oben))
  const b = singleLineBlock(docOfValue(unten))
  return valueOf(
    normalizeDoc({ blocks: [{ runs: [...a.runs, ...b.runs] }] }).blocks[0] as RichBlock,
  )
}

/** Den Eintrag `id` in seiner Gruppe (offen/erledigt) um einen Platz verschieben. */
function umEinen(items: readonly Eintrag[], id: string, richtung: -1 | 1): Eintrag[] {
  const index = items.findIndex((item) => item.id === id)
  const ziel = index + richtung
  const a = items[index]
  const b = items[ziel]
  if (!a || !b || a.done !== b.done) return [...items]
  const next = [...items]
  next[index] = b
  next[ziel] = a
  return next
}

type Aendern = (update: (items: Eintrag[]) => Eintrag[], gruppe?: string) => void

export function Checklist({
  items,
  onChange,
  akzent = 'brand',
}: {
  items: Eintrag[]
  onChange: Aendern
  akzent?: Akzent
}) {
  const felder = useRef(new Map<string, RichTextFieldHandle>())
  const zeilen = useRef(new Map<string, HTMLLIElement>())
  /** Wohin der Cursor nach dem nächsten Zeichnen springt. */
  const fokusNach = useRef<{ id: string; stelle: number | 'ende' } | null>(null)

  useLayoutEffect(() => {
    const ziel = fokusNach.current
    if (!ziel) return
    const feld = felder.current.get(ziel.id)
    if (!feld) return
    fokusNach.current = null
    feld.fokus(ziel.stelle)
  })

  /* ---------------- Ziehen ---------------- */

  const [zug, setZug] = useState<{ id: string; reihenfolge: string[]; versatz: number } | null>(
    null,
  )
  const zugRef = useRef<{
    id: string
    pointerId: number
    /** Wo im Eintrag der Finger ihn gefasst hat. */
    griff: number
    hoehe: number
    zeigerY: number
    /** Die Mitte jedes Eintrags beim Anfassen – in der Reihenfolge von da. */
    mitten: { id: string; mitte: number }[]
    behaelter: HTMLElement | null
    rollStart: number
    reihenfolge: string[]
    frame: number
  } | null>(null)

  const nachId = new Map(items.map((item) => [item.id, item]))
  const gezeigt = zug
    ? zug.reihenfolge.map((id) => nachId.get(id)).filter((item): item is Eintrag => !!item)
    : items

  /**
   * Wo der gezogene Eintrag hingehört: vor dem ersten Eintrag seiner Gruppe,
   * dessen Mitte unter der Mitte des gezogenen liegt.
   *
   * Gemessen wird an den Plätzen beim Anfassen (samt dem, was seither gerollt
   * wurde), nicht am Bildschirm, wie er gerade dasteht: Der hinkt beim
   * schnellen Ziehen dem Finger ein Zeichnen hinterher, und zwei Einträge
   * tauschten dann hin und her.
   */
  const ordne = () => {
    const laufend = zugRef.current
    if (!laufend) return
    const gerollt = (laufend.behaelter?.scrollTop ?? laufend.rollStart) - laufend.rollStart
    const mitte = laufend.zeigerY - laufend.griff + laufend.hoehe / 2
    const done = nachId.get(laufend.id)?.done
    const andere = laufend.mitten.filter((eintrag) => eintrag.id !== laufend.id)
    const gruppe = andere.flatMap((eintrag, index) =>
      nachId.get(eintrag.id)?.done === done ? [{ ...eintrag, index }] : [],
    )
    const letzte = gruppe[gruppe.length - 1]
    if (!letzte) return
    const darunter = gruppe.find((eintrag) => eintrag.mitte - gerollt > mitte)
    const ziel = darunter ? darunter.index : letzte.index + 1
    const ids = andere.map((eintrag) => eintrag.id)
    ids.splice(ziel, 0, laufend.id)
    if (ids.join('|') !== laufend.reihenfolge.join('|')) laufend.reihenfolge = ids
    folge()
  }

  /** Der gezogene Eintrag folgt dem Finger – gerechnet von seinem Platz aus. */
  const folge = () => {
    const laufend = zugRef.current
    if (!laufend) return
    const zeile = zeilen.current.get(laufend.id)
    setZug((alt) => {
      const bisher = alt?.versatz ?? 0
      const platz = zeile ? zeile.getBoundingClientRect().top - bisher : laufend.zeigerY
      return {
        id: laufend.id,
        reihenfolge: laufend.reihenfolge,
        versatz: laufend.zeigerY - laufend.griff - platz,
      }
    })
  }

  // Nach dem Umordnen steht der Eintrag an einem neuen Platz – der Versatz
  // muss gleich nachgerechnet werden, sonst spränge er eine Zeile weit.
  const reihenfolgeZeichen = zug?.reihenfolge.join('|')
  useLayoutEffect(() => {
    if (zugRef.current) folge()
  }, [reihenfolgeZeichen])

  /** Am Rand des Fensters rollt die Liste mit, solange gezogen wird. */
  const rollen = () => {
    const laufend = zugRef.current
    if (!laufend) return
    const behaelter = laufend.behaelter
    if (behaelter) {
      const rand = behaelter.getBoundingClientRect()
      const zone = 48
      const tempo =
        laufend.zeigerY < rand.top + zone
          ? -Math.ceil((rand.top + zone - laufend.zeigerY) / 6)
          : laufend.zeigerY > rand.bottom - zone
            ? Math.ceil((laufend.zeigerY - (rand.bottom - zone)) / 6)
            : 0
      const vorher = behaelter.scrollTop
      if (tempo !== 0) behaelter.scrollTop += tempo
      if (behaelter.scrollTop !== vorher) ordne()
    }
    laufend.frame = requestAnimationFrame(rollen)
  }

  const zugBeginnen = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return
    const zeile = zeilen.current.get(id)
    if (!zeile) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = zeile.getBoundingClientRect()
    const behaelter = zeile.closest('.overflow-y-auto')
    const fenster = behaelter instanceof HTMLElement ? behaelter : null
    zugRef.current = {
      id,
      pointerId: event.pointerId,
      griff: event.clientY - rect.top,
      hoehe: rect.height,
      zeigerY: event.clientY,
      mitten: items.map((item) => {
        const box = zeilen.current.get(item.id)?.getBoundingClientRect()
        return { id: item.id, mitte: box ? box.top + box.height / 2 : 0 }
      }),
      behaelter: fenster,
      rollStart: fenster?.scrollTop ?? 0,
      reihenfolge: items.map((item) => item.id),
      frame: requestAnimationFrame(rollen),
    }
    setZug({ id, reihenfolge: zugRef.current.reihenfolge, versatz: 0 })
  }

  const zugBewegen = (event: PointerEvent<HTMLButtonElement>) => {
    const laufend = zugRef.current
    if (!laufend || laufend.pointerId !== event.pointerId) return
    laufend.zeigerY = event.clientY
    ordne()
  }

  const zugBeenden = (event: PointerEvent<HTMLButtonElement>) => {
    const laufend = zugRef.current
    if (!laufend || laufend.pointerId !== event.pointerId) return
    cancelAnimationFrame(laufend.frame)
    zugRef.current = null
    setZug(null)
    const reihenfolge = laufend.reihenfolge
    if (reihenfolge.join('|') === items.map((item) => item.id).join('|')) return
    // Ein ganzer Zug ist ein Schritt im Verlauf – nicht jeder Platztausch.
    onChange((alt) => {
      const nach = new Map(alt.map((item) => [item.id, item]))
      const geordnet = reihenfolge
        .map((id) => nach.get(id))
        .filter((item): item is Eintrag => !!item)
      // Was während des Ziehens dazukam, bleibt am Ende stehen.
      const rest = alt.filter((item) => !reihenfolge.includes(item.id))
      return [...geordnet, ...rest]
    })
  }

  const griffTaste = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    onChange((alt) => umEinen(alt, id, event.key === 'ArrowUp' ? -1 : 1))
  }

  /* ---------------- Einträge ---------------- */

  const abhaken = (id: string, done: boolean) =>
    // Beim Abhaken rutscht der Eintrag ans Ende: Oben steht, was noch zu tun
    // ist. Beim Tippen bleibt die Reihenfolge, wie sie ist – sonst spränge
    // die Zeile unter dem Finger weg.
    onChange((alt) => sortChecklist(alt.map((item) => (item.id === id ? { ...item, done } : item))))

  const schreiben = (id: string, value: RichValue, tippen: boolean) =>
    onChange(
      (alt) => alt.map((item) => (item.id === id ? { ...item, value } : item)),
      tippen ? `eintrag:${id}` : undefined,
    )

  /** Enter oder eingefügte Zeilen: Die erste bleibt hier, der Rest wird zu neuen Einträgen. */
  const teilen = (id: string, bloecke: RichBlock[], cursor: number) => {
    const [erste, ...weitere] = bloecke
    if (!erste) return
    const neue = weitere.map((block) => neuerEintrag(valueOf(block)))
    const letzte = neue[neue.length - 1]
    if (letzte) fokusNach.current = { id: letzte.id, stelle: cursor }
    onChange((alt) => {
      const index = alt.findIndex((item) => item.id === id)
      if (index === -1) return alt
      const next = [...alt]
      next.splice(index, 1, { ...(alt[index] as Eintrag), value: valueOf(erste) }, ...neue)
      return next
    })
  }

  /** Rücktaste ganz vorne: mit dem Eintrag darüber zusammen – oder weg, wenn leer. */
  const anfangLoeschen = (id: string) => {
    const index = items.findIndex((item) => item.id === id)
    const item = items[index]
    const oben = items[index - 1]
    if (!item) return
    if (!oben) {
      // Ganz oben gibt es nichts zum Zusammenführen; eine leere erste Zeile
      // räumt sich weg, sofern noch etwas darunter steht.
      const unten = items[index + 1]
      if (item.value.text !== '' || !unten) return
      fokusNach.current = { id: unten.id, stelle: 0 }
      onChange((alt) => alt.filter((entry) => entry.id !== id))
      return
    }
    fokusNach.current = {
      id: oben.id,
      stelle: blockText(singleLineBlock(docOfValue(oben.value))).length,
    }
    onChange((alt) =>
      alt.flatMap((entry) =>
        entry.id === id
          ? []
          : entry.id === oben.id
            ? [{ ...entry, value: zusammen(entry.value, item.value) }]
            : [entry],
      ),
    )
  }

  const entfernen = (id: string) => onChange((alt) => alt.filter((item) => item.id !== id))

  /** Ein neuer Eintrag unter dem letzten offenen – nicht zwischen dem Erledigten. */
  const hinzufuegen = () => {
    const neu = neuerEintrag()
    fokusNach.current = { id: neu.id, stelle: 0 }
    onChange((alt) => {
      const erledigt = alt.findIndex((item) => item.done)
      const next = [...alt]
      next.splice(erledigt === -1 ? alt.length : erledigt, 0, neu)
      return next
    })
  }

  const springen = (id: string, richtung: -1 | 1) => {
    const index = items.findIndex((item) => item.id === id)
    const ziel = items[index + richtung]
    if (ziel) felder.current.get(ziel.id)?.fokus(richtung === -1 ? 'ende' : 0)
  }

  return (
    <ul className={`mt-3 space-y-1 ${zug ? 'select-none' : ''}`}>
      {gezeigt.map((item, index) => {
        const gezogen = zug?.id === item.id
        return (
          <li
            key={item.id}
            ref={(element) => {
              if (element) zeilen.current.set(item.id, element)
              else zeilen.current.delete(item.id)
            }}
            style={gezogen ? { transform: `translateY(${zug.versatz}px)` } : undefined}
            className={`flex items-start gap-1.5 rounded-lg ${
              gezogen
                ? 'relative z-10 bg-white/90 shadow-lg ring-1 ring-black/5 dark:bg-slate-800/90 dark:ring-white/10'
                : ''
            }`}
          >
            <button
              type="button"
              onPointerDown={(event) => zugBeginnen(event, item.id)}
              onPointerMove={zugBewegen}
              onPointerUp={zugBeenden}
              onPointerCancel={zugBeenden}
              onKeyDown={(event) => griffTaste(event, item.id)}
              aria-label={`Eintrag ${index + 1} verschieben – Pfeiltasten hoch und runter`}
              title="Zum Verschieben ziehen"
              className={`grid h-9 w-6 shrink-0 touch-none place-items-center rounded text-slate-300 transition dark:text-slate-600 ${
                gezogen ? 'cursor-grabbing text-slate-500' : 'cursor-grab'
              }`}
            >
              <GriffIcon />
            </button>
            <input
              type="checkbox"
              checked={item.done}
              onChange={(event) => abhaken(item.id, event.target.checked)}
              aria-label={`${item.value.text || 'Eintrag'} erledigt`}
              className={`mt-2 size-5 shrink-0 ${akzent === 'teal' ? 'accent-teal-700' : 'accent-brand-700'}`}
            />
            <RichTextField
              ref={(handle) => {
                if (handle) felder.current.set(item.id, handle)
                else felder.current.delete(item.id)
              }}
              value={item.value}
              onChange={(value, art) => schreiben(item.id, value, art === 'tippen')}
              einzeilig={{
                onZeilen: (bloecke, cursor) => teilen(item.id, bloecke, cursor),
                onAnfangLoeschen: () => anfangLoeschen(item.id),
                onPfeil: (richtung) => springen(item.id, richtung),
              }}
              akzent={akzent}
              aria-label={`Eintrag ${index + 1}`}
              wrapperClassName="min-w-0 flex-1"
              className={`min-h-9 py-1.5 text-base ${
                item.done ? 'text-slate-400 line-through dark:text-slate-500' : ''
              }`}
            />
            <button
              type="button"
              onClick={() => entfernen(item.id)}
              aria-label={`Eintrag ${index + 1} entfernen`}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 transition active:bg-black/5 dark:active:bg-white/10"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </li>
        )
      })}

      <li>
        <button
          type="button"
          onClick={hinzufuegen}
          className="ml-7 flex min-h-11 items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400"
        >
          <span className="grid size-5 place-items-center rounded border border-current text-xs">
            +
          </span>
          Eintrag hinzufügen
        </button>
      </li>
    </ul>
  )
}

/** Sechs Punkte – das übliche Zeichen für „hier anfassen und ziehen". */
function GriffIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

/**
 * Die ersten Einträge einer Checkliste, wie sie in der Übersicht erscheinen –
 * mit ihrer Formatierung.
 */
export function ChecklistPreview({
  body,
  bodyRich,
  max,
  className = 'mt-1 text-sm text-slate-600 dark:text-slate-300',
  links = true,
}: {
  body: string
  bodyRich?: string | null
  max: number
  className?: string
  /** Verweise anklickbar – nicht dort, wo die ganze Vorschau ein Knopf ist. */
  links?: boolean
}) {
  // Auch hier Erledigtes nach unten – für Notizen, die noch aus der Zeit
  // davor stammen und seither nicht angefasst wurden.
  const items = sortChecklist(checklistFromNote(body, bodyRich))
  if (items.length === 0) return null

  const offen = items.filter((item) => !item.done).length

  return (
    <span className={`pointer-events-none relative block ${className}`}>
      {items.slice(0, max).map((item, index) => (
        <span
          key={index}
          className={`block truncate ${item.done ? 'text-slate-400 line-through dark:text-slate-500' : ''}`}
        >
          {item.done ? '☑' : '☐'}{' '}
          <RichZeile text={item.value.text} rich={item.value.rich} links={links} />
        </span>
      ))}
      {items.length > max ? (
        <span className="block text-xs text-slate-400 dark:text-slate-500">
          … {items.length - max} weitere · {offen} offen
        </span>
      ) : null}
    </span>
  )
}

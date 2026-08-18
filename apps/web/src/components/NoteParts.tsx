import { NOTE_COLOR_LABELS, NOTE_COLORS, splitLinks, type NoteColor } from '@manager/shared'
import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Die Bausteine, aus denen eine Notiz besteht – Farbe, Breite, Text.
 *
 * Sie standen bis zuletzt im Bildschirm „Notizen" des Haushalts, weil es nur
 * dort Notizen gab. Seit auch die DocBase welche ablegt, würde jede Zeile
 * davon zweimal existieren – und zwei Fassungen desselben Textfelds sind zwei
 * Gelegenheiten, dass sich das Schreiben in der einen App anders anfühlt als
 * in der anderen. Was hier steht, gilt deshalb für beide; was nur eine App
 * betrifft (Checklisten im Haushalt, die Kategorie in der DocBase), bleibt
 * dort, wo es hingehört.
 */

/** Gedeckte Töne – die Liste soll ruhig bleiben, nicht bunt blinken. */
export const COLOR_STYLES: Record<NoteColor, string> = {
  default: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
  gelb: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
  gruen: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900',
  blau: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900',
  rosa: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900',
}

export const COLOR_SWATCHES: Record<NoteColor, string> = {
  default: 'bg-slate-200 dark:bg-slate-700',
  gelb: 'bg-amber-300',
  gruen: 'bg-emerald-300',
  blau: 'bg-sky-300',
  rosa: 'bg-rose-300',
}

/**
 * Wie breit eine geöffnete Notiz werden darf.
 *
 * Nur am grossen Bildschirm eine Frage: Auf dem Handy ist die volle Breite die
 * einzig sinnvolle Antwort, und die gibt es ohnehin. Am Monitor ist die
 * schmale Spalte gut für einen Merkzettel und zu eng für eine lange Liste.
 */
export const BREITEN = ['standard', 'mittel', 'breit'] as const
export type Breite = (typeof BREITEN)[number]

export const BREITE_LABELS: Record<Breite, string> = {
  standard: 'Standard',
  mittel: 'Mittel',
  breit: 'Breit',
}

export const BREITE_KLASSEN: Record<Breite, string> = {
  standard: 'max-w-lg',
  mittel: 'max-w-3xl',
  breit: 'max-w-6xl',
}

/** Wann zuletzt geschrieben wurde – Datum und Uhrzeit, in Ortszeit. */
export function formatEdited(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '–'

  const zwei = (value: number) => String(value).padStart(2, '0')
  return `${zwei(date.getDate())}.${zwei(date.getMonth() + 1)}.${date.getFullYear()}, ${zwei(
    date.getHours(),
  )}:${zwei(date.getMinutes())}`
}

/**
 * Text, in dem Verweise anklickbar sind.
 *
 * `pointer-events-auto` und `z-10`, weil in der Übersicht die ganze Kachel
 * eine Fläche zum Öffnen der Notiz ist: Der Text lässt Griffe durch, der
 * Verweis fängt seinen eigenen ab. `stopPropagation` hält ausserdem die
 * darunterliegende Fläche davon ab, gleich noch die Notiz zu öffnen.
 */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((teil, index) =>
        teil.href ? (
          <a
            key={index}
            href={teil.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="pointer-events-auto relative z-10 break-words text-brand-700 underline underline-offset-2 dark:text-brand-300"
          >
            {teil.text}
          </a>
        ) : (
          <span key={index}>{teil.text}</span>
        ),
      )}
    </>
  )
}

/**
 * Der Text einer Notiz – zum Lesen mit anklickbaren Verweisen, zum Schreiben
 * ein Textfeld.
 *
 * In einem Textfeld ist ein Verweis nur Text; anklickbar wird er erst, wenn er
 * als Verweis gezeichnet ist. Deshalb zeigt die geöffnete Notiz zunächst den
 * gelesenen Text, und ein Griff hinein macht daraus das Eingabefeld – ausser
 * auf einem Verweis, der führt dorthin, wo er hinführt. Beim Verlassen des
 * Feldes steht wieder der lesbare Text da.
 *
 * Eine frische oder leere Notiz beginnt gleich im Schreibmodus: Dort gibt es
 * nichts zu lesen und nichts anzutippen.
 */
export function NoteText({
  value,
  onChange,
  startInEditing,
}: {
  value: string
  onChange: (value: string) => void
  startInEditing: boolean
}) {
  const [schreibt, setSchreibt] = useState(startInEditing)

  if (schreibt) {
    return (
      <GrowingTextarea
        value={value}
        onChange={onChange}
        autoFocus={!startInEditing}
        onBlur={() => setSchreibt(false)}
      />
    )
  }

  return (
    <div
      onClick={() => setSchreibt(true)}
      className="mt-3 min-h-40 w-full cursor-text whitespace-pre-wrap break-words text-base"
    >
      {value ? <LinkedText text={value} /> : <span className="text-slate-400">Text …</span>}
    </div>
  )
}

/**
 * Das Textfeld wächst mit dem Text.
 *
 * Ein Feld mit fester Zeilenzahl scrollt in sich selbst, während das Fenster
 * darüber noch Platz hätte – man schreibt dann durch ein Guckloch. So wächst
 * stattdessen das Feld, mit ihm das Fenster, und erst wenn das an den
 * Bildschirmrand stösst, bekommt der Inhalt eine Bildlaufleiste.
 */
export function GrowingTextarea({
  value,
  onChange,
  autoFocus,
  onBlur,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  onBlur?: () => void
}) {
  const field = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    // Erst zurücksetzen: Sonst misst scrollHeight die bisherige Höhe mit, und
    // das Feld wächst zwar, schrumpft aber beim Löschen nie wieder.
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])

  // Wer aus dem Lesen ins Schreiben wechselt, will weiterschreiben und nicht
  // vorne beginnen – der Cursor gehört ans Ende.
  useLayoutEffect(() => {
    if (!autoFocus) return
    const element = field.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [autoFocus])

  return (
    <textarea
      ref={field}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder="Text …"
      aria-label="Text"
      // Eine Mindesthöhe, damit auch die leere Notiz eine Fläche hat, die man
      // mit dem Daumen trifft.
      className="mt-3 min-h-40 w-full resize-none overflow-hidden bg-transparent text-base outline-none"
    />
  )
}

/**
 * Die Farbe der Notiz – ein Knopf mit der aktuellen Farbe, der die fünf
 * Möglichkeiten aufklappt.
 *
 * Vorher standen alle Farben ständig im Fuss des Fensters. Das ist viel
 * Aufmerksamkeit für eine Entscheidung, die man einmal trifft und dann
 * jahrelang nicht mehr anfasst – die Notiz selbst hat den Platz nötiger.
 */
export function ColorPicker({
  color,
  onChange,
  akzent = 'text-brand-700',
}: {
  color: NoteColor
  onChange: (color: NoteColor) => void
  /** Der Haken bei der gewählten Farbe – marineblau im Haushalt, petrol hier. */
  akzent?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        // Escape schliesst zuerst die Auswahl – nicht gleich das ganze Fenster.
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Farbe: ${NOTE_COLOR_LABELS[color]}`}
        className="flex min-h-11 items-center gap-0.5 rounded-full px-1.5 text-slate-500 dark:text-slate-400"
      >
        <span className={`size-5 rounded-full border border-black/10 ${COLOR_SWATCHES[color]}`} />
        <svg className="size-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <>
          {/* Fängt den Griff daneben ab – sonst bliebe die Auswahl offen. */}
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Farbauswahl schliessen"
          />
          <ul
            role="listbox"
            aria-label="Farbe"
            className="absolute right-0 top-12 z-20 w-44 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            {NOTE_COLORS.map((option) => (
              <li key={option}>
                <button
                  role="option"
                  aria-selected={color === option}
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition active:bg-black/5 dark:active:bg-white/10"
                >
                  <span
                    className={`size-4 shrink-0 rounded-full border border-black/10 ${COLOR_SWATCHES[option]}`}
                  />
                  {NOTE_COLOR_LABELS[option]}
                  {color === option ? <span className={`ml-auto ${akzent}`}>✓</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

/**
 * Wie breit das Fenster sein darf – drei Stufen, weiter nichts.
 *
 * Steht nur am grossen Bildschirm (`hidden sm:flex`): Auf dem Handy füllt das
 * Fenster ohnehin die Breite, und ein Knopf, der dort nichts bewirkt, ist ein
 * Knopf zu viel.
 */
export function WidthPicker({
  breite,
  onChange,
}: {
  breite: Breite
  onChange: (value: Breite) => void
}) {
  return (
    <div className="hidden items-center gap-0.5 rounded-full bg-black/5 p-0.5 sm:flex dark:bg-white/10">
      {BREITEN.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          aria-pressed={breite === option}
          aria-label={`Breite ${BREITE_LABELS[option]}`}
          title={`Breite ${BREITE_LABELS[option]}`}
          className={`grid size-7 place-items-center rounded-full transition ${
            breite === option
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {/* Drei verschieden breite Balken – das Sinnbild braucht keine Worte. */}
          <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect
              x={option === 'standard' ? 5.5 : option === 'mittel' ? 3.5 : 1.5}
              y="3.5"
              width={option === 'standard' ? 5 : option === 'mittel' ? 9 : 13}
              height="9"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      ))}
    </div>
  )
}

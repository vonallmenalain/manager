import {
  docOfValue,
  NOTE_COLOR_LABELS,
  NOTE_COLORS,
  NOTE_TITLE_MAX,
  removeFile,
  splitLinks,
  toRichValue,
  withWritingLines,
  type Bereich,
  type NoteColor,
  type RichFile,
  type RichValue,
} from '@manager/shared'
import { useImperativeHandle, useRef, useState, type Ref } from 'react'

import { EinfuegenDialog, FortschrittAnzeige, NoteFileViewer } from './NoteFiles'
import { RichText } from './RichText'
import {
  PaperclipIcon,
  RichTextField,
  type Akzent,
  type Einstieg,
  type RichTextFieldHandle,
} from './RichTextField'
import { einlesen } from '../lib/einlesen'
import {
  dateienAlsBloecke,
  inNotizEinsetzen,
  type EinfuegeArt,
  type Fortschritt,
} from '../lib/noteFiles'

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
 * Der Titel einer Notiz – so lang er ist, auf so vielen Zeilen, wie er braucht.
 *
 * Früher ein einzeiliges Eingabefeld: Ein langer Titel – etwa der Name einer
 * geteilten Webseite – lief rechts aus dem Feld, und man sah nur seinen
 * Anfang. Jetzt ein Textfeld, das mit seinem Inhalt wächst
 * (`field-sizing: content`) und umbricht. Eine neue Zeile gibt es trotzdem
 * nicht: Die Eingabetaste tut nichts, und eingefügte Umbrüche werden zu
 * Leerzeichen – ein Titel bleibt eine Zeile, nur eben eine, die umbricht.
 */
export function NoteTitle({
  value,
  onChange,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\s*\n\s*/g, ' '))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.preventDefault()
      }}
      rows={1}
      maxLength={NOTE_TITLE_MAX}
      placeholder="Titel"
      aria-label="Titel"
      enterKeyHint="done"
      autoFocus={autoFocus}
      className="block field-sizing-content w-full resize-none bg-transparent text-lg font-semibold outline-none"
    />
  )
}

/**
 * Wie der Text einer Notiz dasteht – gelesen und geschrieben gleich.
 *
 * Beide Fassungen tragen dieselben Klassen und denselben Aufbau: Beim Wechsel
 * vom einen ins andere rückt keine Zeile, und der Punkt, auf den getippt
 * wurde, trifft im Editor dasselbe Zeichen wie vorher im gelesenen Text.
 */
const ABSTAND = 'mt-3'
const NOTIZTEXT = 'min-h-40 w-full text-base'

/** Was der Text einer Notiz von aussen annimmt: den Griff zur Büroklammer. */
export interface NoteTextHandle {
  /**
   * Öffnet die Auswahl für Bilder und PDFs. Eingefügt wird an der Stelle des
   * Cursors – steht keiner im Text, am Ende der Notiz.
   */
  dateiEinfuegen: () => void
}

/**
 * Der Text einer Notiz – zum Lesen mit anklickbaren Verweisen, zum Schreiben
 * das formatierbare Feld.
 *
 * In einem Eingabefeld ist ein Verweis nur Text; anklickbar wird er erst, wenn
 * er als Verweis gezeichnet ist. Deshalb zeigt die geöffnete Notiz zunächst
 * den gelesenen Text, und ein Griff hinein macht daraus das Eingabefeld –
 * ausser auf einem Verweis, der führt dorthin, wo er hinführt. Beim Verlassen
 * des Feldes steht wieder der lesbare Text da.
 *
 * Der Cursor landet dort, wo getippt wurde, und das Fenster bleibt dabei
 * stehen. Früher sprang er ans Ende, während das Fenster an den Anfang der
 * Notiz rollte – in einer langen Notiz schrieb man dann ausser Sichtweite.
 *
 * Eine frische oder leere Notiz beginnt gleich im Schreibmodus: Dort gibt es
 * nichts zu lesen und nichts anzutippen.
 *
 * Dateien: Mit `bereich` lassen sich Bilder und PDFs einfügen – als ganze
 * Datei, die in der Notiz steht und sich per Tipp öffnet, oder nur ihr
 * erkannter Text. Danach steht der Cursor in der Zeile darunter, und es geht
 * mit Schreiben weiter.
 */
export function NoteText({
  value,
  onChange,
  startInEditing,
  akzent,
  bereich,
  ref,
}: {
  value: RichValue
  onChange: (value: RichValue) => void
  startInEditing: boolean
  /** Die Farbe der Knöpfe im Formatmenü – petrol in der DocBase. */
  akzent?: Akzent
  /** Wohin eingefügte Dateien gehören. Ohne Angabe lassen sich keine einfügen. */
  bereich?: Bereich
  ref?: Ref<NoteTextHandle>
}) {
  // null: gelesen. Sonst geschrieben – mit dem Ort, an den der Cursor gehört;
  // ohne Ort (eine leere Notiz) wartet das Feld, bis man es antippt. `nr`
  // zählt die Einstiege: Nach dem Einfügen einer Datei beginnt das Feld neu,
  // mit dem Cursor unter dem Eingefügten.
  const [schreibt, setSchreibt] = useState<{ einstieg: Einstieg | null; nr: number } | null>(
    startInEditing ? { einstieg: null, nr: 0 } : null,
  )
  /** Stand beim Drücken: War schon etwas markiert, ist der Griff keine neue Markierung. */
  const markiertBeimDruck = useRef(false)
  const feldRef = useRef<RichTextFieldHandle>(null)

  // Der Wert, wie er gerade ist – das Einfügen läuft über Sekunden, und in
  // der Zwischenzeit ist `value` aus dem ersten Aufruf veraltet.
  const valueRef = useRef(value)
  valueRef.current = value

  const [offen, setOffen] = useState<RichFile | null>(null)
  const [gewaehlt, setGewaehlt] = useState<File[] | null>(null)
  const [fortschritt, setFortschritt] = useState<Fortschritt | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Wo eingefügt wird – gemerkt beim Griff zur Büroklammer, bevor der Fokus geht. */
  const stelle = useRef<number | null>(null)
  const abbruch = useRef<AbortController | null>(null)

  /** Das Modell, wie es im Feld steht – mit den Zeilen um jede Datei. */
  const aktuellesModell = () => withWritingLines(docOfValue(valueRef.current))

  const weiterschreiben = (offset: number) =>
    setSchreibt((alt) => ({ einstieg: { offset }, nr: (alt?.nr ?? 0) + 1 }))

  const dateiEinfuegen = () => {
    if (!bereich) return
    stelle.current = feldRef.current?.caret() ?? null
    setMeldung(null)
    inputRef.current?.click()
  }
  const dateiEinfuegenRef = useRef(dateiEinfuegen)
  dateiEinfuegenRef.current = dateiEinfuegen
  useImperativeHandle(ref, () => ({ dateiEinfuegen: () => dateiEinfuegenRef.current() }), [])

  async function einfuegen(files: File[], art: EinfuegeArt) {
    if (!bereich) return
    setGewaehlt(null)
    const controller = new AbortController()
    abbruch.current = controller
    setFortschritt({ art, schritt: 1, von: files.length })
    try {
      const bloecke = await dateienAlsBloecke(files, art, bereich, {
        signal: controller.signal,
        onFortschritt: setFortschritt,
      })
      const { doc, caret, gekuerzt } = inNotizEinsetzen(aktuellesModell(), stelle.current, bloecke)
      onChange(toRichValue(doc))
      weiterschreiben(caret)
      if (gekuerzt) {
        setMeldung('Der erkannte Text war länger, als eine Notiz sein darf – der Rest fehlt.')
      }
    } catch (error) {
      if (controller.signal.aborted) return
      setMeldung(error instanceof Error ? error.message : 'Das Einfügen hat nicht geklappt.')
    } finally {
      if (abbruch.current === controller) abbruch.current = null
      setFortschritt(null)
    }
  }

  const entfernen = (file: RichFile) => {
    if (!window.confirm(`„${file.name}" aus der Notiz entfernen?`)) return
    const { doc, caret } = removeFile(aktuellesModell(), file.id)
    onChange(toRichValue(doc))
    weiterschreiben(caret)
  }

  const oeffnen = (file: RichFile) => {
    // Sonst bliebe die Tastatur über dem Betrachter offen.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setOffen(file)
  }

  return (
    <>
      {meldung ? (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span className="min-w-0 flex-1">{meldung}</span>
          <button
            type="button"
            onClick={() => setMeldung(null)}
            aria-label="Meldung schliessen"
            className="shrink-0 px-1"
          >
            ✕
          </button>
        </p>
      ) : null}

      {schreibt ? (
        <RichTextField
          key={schreibt.nr}
          ref={feldRef}
          value={value}
          onChange={onChange}
          einstieg={schreibt.einstieg}
          onBlur={() => setSchreibt(null)}
          placeholder="Text …"
          aria-label="Text"
          akzent={akzent}
          wrapperClassName={ABSTAND}
          className={NOTIZTEXT}
          onOpenFile={oeffnen}
          onRemoveFile={entfernen}
          onDateiEinfuegen={bereich ? dateiEinfuegen : undefined}
        />
      ) : (
        <div
          role="textbox"
          tabIndex={0}
          aria-label="Text"
          onPointerDown={() => {
            markiertBeimDruck.current = window.getSelection()?.isCollapsed === false
          }}
          onClick={(event) => {
            // Wer eben mit der Maus etwas markiert hat, will es kopieren – nicht
            // mit dem Loslassen in den Schreibmodus fallen. Ein Klick in eine
            // schon bestehende Markierung meint dagegen: hier schreiben.
            const markiert = window.getSelection()?.isCollapsed === false
            if (markiert && !markiertBeimDruck.current) return
            setSchreibt({ einstieg: { x: event.clientX, y: event.clientY }, nr: 0 })
          }}
          onKeyDown={(event) => {
            // Enter auf einer Datei öffnet die Datei, nicht das Schreiben.
            if (event.target !== event.currentTarget) return
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setSchreibt({ einstieg: 'ende', nr: 0 })
          }}
          className={`${ABSTAND} ${NOTIZTEXT} cursor-text whitespace-pre-wrap break-words outline-none`}
        >
          {value.text ? (
            <RichText text={value.text} rich={value.rich} onOpenFile={oeffnen} />
          ) : (
            <span className="text-slate-400">Text …</span>
          )}
        </div>
      )}

      {bereich ? (
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            // Leeren, damit dieselbe Datei gleich nochmals gewählt werden kann.
            event.target.value = ''
            if (files.length === 0) return
            // Sofort einlesen, nicht erst nach der Wahl „ganz oder nur Text":
            // Bis dahin hätte Chrome eine Datei aus Google Drive verloren
            // (siehe `lib/einlesen.ts`).
            void einlesen(files).then(({ dateien, probleme }) => {
              if (probleme.length > 0) setMeldung(probleme.join(' '))
              if (dateien.length > 0) setGewaehlt(dateien)
            })
          }}
        />
      ) : null}

      {gewaehlt ? (
        <EinfuegenDialog
          files={gewaehlt}
          akzent={akzent}
          onWahl={(art) => void einfuegen(gewaehlt, art)}
          onAbbrechen={() => setGewaehlt(null)}
        />
      ) : null}

      {fortschritt ? (
        <FortschrittAnzeige
          fortschritt={fortschritt}
          onAbbrechen={() => abbruch.current?.abort()}
        />
      ) : null}

      {offen ? <NoteFileViewer file={offen} onClose={() => setOffen(null)} /> : null}
    </>
  )
}

/**
 * „Datei einfügen" – ein Bild oder PDF in den Text der Notiz.
 *
 * Der Knopf nimmt den Fokus nicht an: Steht der Cursor gerade im Text, bleibt
 * er dort, und die Datei kommt genau an diese Stelle.
 */
export function DateiKnopf({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-slate-600 transition active:bg-black/5 dark:text-slate-300 dark:active:bg-white/10"
    >
      <PaperclipIcon className="size-5 shrink-0" />
      Datei einfügen
    </button>
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

import {
  NOTE_KIND_LABELS,
  NOTE_KINDS,
  parseChecklist,
  serializeChecklist,
  sortChecklist,
  type ChecklistItem,
  type Note,
  type NoteColor,
  type NoteKind,
} from '@manager/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Modal, ModalCloseButton } from '../components/Modal'
import {
  BREITEN,
  BREITE_KLASSEN,
  COLOR_STYLES,
  ColorPicker,
  formatEdited,
  LinkedText,
  NoteText,
  WidthPicker,
  type Breite,
} from '../components/NoteParts'
import { saveStateLabel, useAutosave } from '../lib/autosave'
import { useLocalSetting } from '../lib/einstellungen'
import { useDeleteNote, useNotes, useSaveNote } from '../lib/household'
import { useEscape } from '../lib/overlay'

const ANSICHTEN = ['liste', 'kacheln'] as const
type Ansicht = (typeof ANSICHTEN)[number]

const ANSICHT_LABELS: Record<Ansicht, string> = {
  liste: 'Liste',
  kacheln: 'Kacheln',
}

const GROESSEN = ['klein', 'komprimiert', 'alles'] as const
type Groesse = (typeof GROESSEN)[number]

const GROESSE_LABELS: Record<Groesse, string> = {
  klein: 'Klein',
  komprimiert: 'Komprimiert',
  alles: 'Alles',
}

/**
 * Wie viel eine Notiz in der Übersicht von sich zeigt.
 *
 * `klein` gibt jeder Notiz dieselbe feste Höhe – die Übersicht bleibt ein
 * Verzeichnis, durch das man scrollt, nicht der Text selbst. `alles` schneidet
 * nichts ab; wer seine Notizen lesen und nicht suchen will, sieht sie ganz.
 *
 * `komprimiert` liegt dazwischen und richtet sich nach dem Inhalt: Wer mehr
 * geschrieben hat, bekommt mehr Platz – aber nur bis zu einer Grenze. Ohne die
 * verdrängt eine einzige lange Notiz alle anderen vom Bildschirm, und genau
 * das soll eine Übersicht ja nicht.
 */
const GROESSE_REGELN: Record<
  Groesse,
  {
    /** Feste Höhe (klein) oder Obergrenze (komprimiert) je Ansicht. */
    hoehe: Record<Ansicht, string>
    /**
     * Wie viele Zeilen Fliesstext stehen bleiben. `line-clamp` bringt seine
     * eigene Anzeigeart mit – daneben darf kein `block` stehen, sonst gewinnt
     * je nach Reihenfolge das eine oder das andere und der Text wird mitten in
     * der Zeile abgeschnitten statt sauber mit „…".
     */
    textZeilen: string
    /** Einträge einer Checkliste. */
    eintraege: number
  }
> = {
  klein: {
    hoehe: { liste: 'h-24', kacheln: 'h-28' },
    textZeilen: 'line-clamp-2',
    eintraege: 2,
  },
  komprimiert: {
    hoehe: { liste: 'max-h-60', kacheln: 'max-h-72' },
    textZeilen: 'line-clamp-6',
    eintraege: 6,
  },
  alles: {
    hoehe: { liste: '', kacheln: '' },
    textZeilen: 'block',
    eintraege: Number.POSITIVE_INFINITY,
  },
}

export function Notes() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Note | NoteKind | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [ansicht, setAnsicht] = useLocalSetting<Ansicht>('notizen.ansicht', ANSICHTEN, 'liste')
  const [groesse, setGroesse] = useLocalSetting<Groesse>(
    'notizen.groesse',
    GROESSEN,
    'komprimiert',
  )
  const query = useNotes({ q: search })

  const notes = query.data?.notes ?? []

  // Vom Startbildschirm kommt man mit `?notiz=<id>` direkt in eine angeheftete
  // Notiz. Der Wunsch wird danach aus der Adresse genommen – sonst öffnete
  // sich dieselbe Notiz nach dem Schliessen sofort wieder.
  const [params, setParams] = useSearchParams()
  const gewuenscht = params.get('notiz')

  useEffect(() => {
    // Erst suchen, wenn es etwas zu durchsuchen gibt: Wer den Wunsch vor dem
    // Eintreffen der Liste verwirft, öffnet nie etwas.
    //
    // `isFetching` statt `isLoading`: Kommt man vom Teilen, ist die Notiz eben
    // erst entstanden und die Liste im Zwischenspeicher noch die von vorhin.
    // Die gilt zwar als geladen, kennt die neue Notiz aber nicht – der Wunsch
    // wäre verworfen, bevor die Antwort da ist, und die frisch geteilte Notiz
    // ginge nicht auf.
    if (!gewuenscht || query.isFetching) return
    const treffer = notes.find((note) => note.id === gewuenscht)
    if (treffer) setEditing(treffer)
    setParams({}, { replace: true })
  }, [gewuenscht, notes, query.isFetching, setParams])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Notizen</h1>
        {/* Wo bisher die Anzahl stand: Die kann man abzählen, die Anzeige
            nicht erraten. */}
        <AnsichtsMenu
          ansicht={ansicht}
          onAnsicht={setAnsicht}
          groesse={groesse}
          onGroesse={setGroesse}
        />
      </div>

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Suchen…"
        aria-label="Notizen durchsuchen"
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900"
      />

      {query.isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      ) : notes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {search ? 'Nichts gefunden.' : 'Noch keine Notizen. Unten rechts anlegen.'}
        </p>
      ) : (
        <ul
          className={
            ansicht === 'kacheln'
              ? // Zwei Spalten, auch am grossen Bildschirm: Die Seite ist
                // überall gleich breit, und drei Spalten liessen von jeder
                // Zeile nur noch ein paar Wörter übrig.
                //
                // items-start: Jede Kachel ist so hoch wie ihr Inhalt. Ohne das
                // zöge die längste Notiz ihre ganze Zeile mit in die Höhe.
                'grid grid-cols-2 items-start gap-2'
              : 'space-y-2'
          }
        >
          {notes.map((note) => (
            <li key={note.id}>
              <NoteCard
                note={note}
                ansicht={ansicht}
                groesse={groesse}
                onOpen={() => setEditing(note)}
              />
            </li>
          ))}
        </ul>
      )}

      {menuOpen ? (
        <>
          <button
            className="fixed inset-0 z-20 bg-slate-900/20"
            onClick={() => setMenuOpen(false)}
            aria-label="Menü schliessen"
          />
          <div className="fixed bottom-36 right-4 z-30 flex flex-col items-end gap-2">
            {NOTE_KINDS.map((kind) => (
              <button
                key={kind}
                onClick={() => {
                  setMenuOpen(false)
                  setEditing(kind)
                }}
                className="min-h-11 rounded-full bg-white px-4 py-2 text-sm font-medium shadow-lg dark:bg-slate-800"
              >
                {NOTE_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <button
        onClick={() => setMenuOpen((open) => !open)}
        className="fixed bottom-20 right-4 z-30 grid size-14 place-items-center rounded-full bg-brand-800 text-white shadow-lg transition active:scale-95"
        aria-label="Notiz anlegen"
        aria-expanded={menuOpen}
      >
        <svg
          className={`size-7 transition-transform ${menuOpen ? 'rotate-45' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {editing ? (
        <NoteEditor
          note={typeof editing === 'string' ? null : editing}
          newKind={typeof editing === 'string' ? editing : 'text'}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * Ein Knopf „Ansicht", hinter dem beides steckt: Form und Grösse.
 *
 * Vorher standen zwei Auswahlfelder nebeneinander im Kopf der Seite. Sie
 * beantworten dieselbe Frage – wie soll das hier aussehen –, und zwei Felder
 * dafür sind ein Feld zu viel; auf einem schmalen Handy drängten sie zudem den
 * Titel an den Rand.
 */
function AnsichtsMenu({
  ansicht,
  onAnsicht,
  groesse,
  onGroesse,
}: {
  ansicht: Ansicht
  onAnsicht: (value: Ansicht) => void
  groesse: Groesse
  onGroesse: (value: Groesse) => void
}) {
  const [open, setOpen] = useState(false)
  useEscape(open, useCallback(() => setOpen(false), []))

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
      >
        Ansicht
        <svg className="size-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <>
          <button
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Ansicht schliessen"
          />
          <div
            role="dialog"
            aria-label="Ansicht"
            className="absolute right-0 top-12 z-30 w-56 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            <Wahl
              titel="Darstellung"
              options={ANSICHTEN}
              labels={ANSICHT_LABELS}
              value={ansicht}
              onChange={onAnsicht}
            />
            <Wahl
              titel="Anzeigegrösse"
              options={GROESSEN}
              labels={GROESSE_LABELS}
              value={groesse}
              onChange={onGroesse}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

/** Eine Gruppe sich ausschliessender Möglichkeiten, zum Antippen. */
function Wahl<T extends string>({
  titel,
  options,
  labels,
  value,
  onChange,
}: {
  titel: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="border-b border-slate-200 py-1 last:border-b-0 dark:border-slate-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{titel}</p>
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition active:bg-black/5 dark:active:bg-white/10 ${
            value === option ? 'font-semibold text-brand-700 dark:text-brand-300' : ''
          }`}
        >
          <span className="w-4 shrink-0">{value === option ? '✓' : ''}</span>
          {labels[option]}
        </button>
      ))}
    </div>
  )
}

/**
 * Eine Notiz in der Übersicht.
 *
 * Titel links, rechts daneben der Stand: wann zuletzt geschrieben wurde und
 * ob die Notiz geteilt oder angeheftet ist. Wie viel darunter zu sehen ist,
 * entscheidet die gewählte Grösse – der Aufbau bleibt in Liste und Kacheln
 * derselbe, damit man nicht zweimal lesen lernen muss.
 */
function NoteCard({
  note,
  ansicht,
  groesse,
  onOpen,
}: {
  note: Note
  ansicht: Ansicht
  groesse: Groesse
  onOpen: () => void
}) {
  const regel = GROESSE_REGELN[groesse]

  return (
    // Die Fläche zum Öffnen liegt als Knopf unter dem Inhalt: So bleibt die
    // ganze Kachel ein Griff, und ein Verweis im Text behält trotzdem sein
    // eigenes Ziel. Ein <a> in einem <button> wäre nicht erlaubt.
    <div
      className={`relative flex w-full flex-col overflow-hidden rounded-2xl border p-3 text-left transition active:scale-[0.99] ${
        COLOR_STYLES[note.color]
      } ${regel.hoehe[ansicht]}`}
    >
      <button
        onClick={onOpen}
        aria-label={`Notiz ${note.title || 'ohne Titel'} öffnen`}
        className="absolute inset-0"
      />

      {/* Der Inhalt lässt Griffe zum Knopf durch – nur Verweise fangen sie ab. */}
      <span className="pointer-events-none relative flex w-full items-start gap-2">
        <span className="min-w-0 flex-1 font-medium">
          {note.title || <span className="text-slate-400">Ohne Titel</span>}
        </span>
        <span className="flex shrink-0 items-start gap-1.5 text-slate-400">
          <span
            className={`text-right text-[10px] leading-tight tabular-nums ${
              // In der Liste ist Platz für eine Zeile; in einer Kachel bricht
              // die Angabe um, statt den Titel wegzudrücken.
              ansicht === 'liste' ? 'whitespace-nowrap' : 'max-w-24'
            }`}
          >
            Bearbeitet am: {formatEdited(note.updatedAt)}
          </span>
          {note.shared ? <span title="Geteilt">👥</span> : null}
          {note.pinned ? <span title="Angeheftet">📌</span> : null}
        </span>
      </span>

      {note.kind === 'liste' ? (
        <ChecklistPreview body={note.body} max={regel.eintraege} />
      ) : note.body ? (
        <span
          className={`pointer-events-none relative mt-0.5 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300 ${regel.textZeilen}`}
        >
          <LinkedText text={note.body} />
        </span>
      ) : null}
    </div>
  )
}

/** Die ersten Einträge einer Checkliste, wie sie in der Übersicht erscheinen. */
function ChecklistPreview({ body, max }: { body: string; max: number }) {
  // Auch hier Erledigtes nach unten – für Notizen, die noch aus der Zeit
  // davor stammen und seither nicht angefasst wurden.
  const items = sortChecklist(parseChecklist(body))
  if (items.length === 0) return null

  const offen = items.filter((item) => !item.done).length

  return (
    <span className="pointer-events-none relative mt-1 block text-sm text-slate-600 dark:text-slate-300">
      {items.slice(0, max).map((item, index) => (
        <span
          key={index}
          className={`block truncate ${item.done ? 'text-slate-400 line-through dark:text-slate-500' : ''}`}
        >
          {item.done ? '☑' : '☐'} <LinkedText text={item.text} />
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

/**
 * Der Notizeditor – ein Fenster über der Liste, kein eigener Bildschirm.
 *
 * Gespeichert wird von selbst: kurz nach dem letzten Tastendruck und noch
 * einmal beim Schliessen. Ein Speichern-Knopf hat hier nichts gewonnen –
 * er war die einzige Möglichkeit, Geschriebenes zu verlieren.
 *
 * Eine neue Notiz entsteht erst beim ersten Speichern. Wer das Fenster ohne
 * Eingabe wieder schliesst, hinterlässt keine leere Notiz in der Liste.
 */
function NoteEditor({
  note,
  newKind,
  onClose,
}: {
  note: Note | null
  newKind: NoteKind
  onClose: () => void
}) {
  const save = useSaveNote()
  const remove = useDeleteNote()

  // Die Art wird beim Anlegen gewählt und bleibt dann, was sie ist.
  const kind = note?.kind ?? newKind
  const [title, setTitle] = useState(note?.title ?? '')
  const [text, setText] = useState(() =>
    (note?.kind ?? newKind) === 'liste' ? '' : (note?.body ?? ''),
  )
  const [items, setItems] = useState<ChecklistItem[]>(() => {
    if ((note?.kind ?? newKind) !== 'liste') return []
    const vorhanden = sortChecklist(parseChecklist(note?.body ?? ''))
    // Eine frische Liste beginnt mit einer leeren Zeile – sonst müsste man
    // erst „Eintrag hinzufügen" treffen, bevor man tippen kann.
    return vorhanden.length > 0 ? vorhanden : [{ text: '', done: false }]
  })
  /** Sobald eine neue Notiz einmal gespeichert ist, lässt sie sich löschen. */
  const [savedId, setSavedId] = useState(note?.id)
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [shared, setShared] = useState(note?.shared ?? false)
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'default')
  // Die Breite gehört zum Gerät, nicht zur Notiz: dieselbe Notiz will am
  // Monitor breit und am Handy schmal gelesen werden.
  const [breite, setBreite] = useLocalSetting<Breite>('notizen.breite', BREITEN, 'standard')

  const body = kind === 'liste' ? serializeChecklist(items) : text
  const leer = title.trim() === '' && body.trim() === ''

  // Ab dem ersten Speichern wird dieselbe Notiz weitergeschrieben, statt eine
  // zweite anzulegen.
  const idRef = useRef(note?.id)

  const autosave = useAutosave(
    // `bereich` und `categoryId` gehören der DocBase: Dort liegt die Notiz in
    // der Sammlung und in einer Schublade darin. Im Haushalt gibt es beides
    // nicht – die Werte stehen trotzdem hier, weil der Server sonst raten
    // müsste, aus welcher App die Notiz kommt.
    { title, body, kind, bereich: 'manager' as const, categoryId: null, pinned, shared, color },
    async (entwurf) => {
      const result = await save.mutateAsync({ id: idRef.current, note: entwurf })
      idRef.current = result.note.id
      setSavedId(result.note.id)
    },
    // Der Server verlangt Titel oder Text. Eine leere Notiz wird deshalb nicht
    // angelegt und eine geleerte behält ihren letzten Stand.
    { savable: (entwurf) => entwurf.title.trim() !== '' || entwurf.body.trim() !== '' },
  )

  return (
    <Modal
      onClose={onClose}
      label={note ? 'Notiz bearbeiten' : 'Neue Notiz'}
      className={COLOR_STYLES[color]}
      width={BREITE_KLASSEN[breite]}
      header={
        <>
          <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {saveStateLabel(autosave.state, leer ? 'Titel oder Text ausfüllen' : undefined)}
          </span>
          <div className="flex items-center gap-1">
            {/* Beschriftet statt nur ein Symbol: Wem eine Notiz gehört und wer
                sie sieht, ist nichts, was man erraten sollte. */}
            <button
              onClick={() => setShared((value) => !value)}
              aria-pressed={shared}
              className={`flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-medium ${
                shared
                  ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {shared ? '👥 Geteilt' : '🔒 Nur für mich'}
            </button>
            <ColorPicker color={color} onChange={setColor} />
            <WidthPicker breite={breite} onChange={setBreite} />
            <button
              onClick={() => setPinned((value) => !value)}
              className={`grid size-11 min-h-11 place-items-center rounded-full text-sm ${pinned ? '' : 'opacity-30'}`}
              aria-label="Anheften"
              aria-pressed={pinned}
            >
              📌
            </button>
            <ModalCloseButton onClick={onClose} label="Notiz schliessen" />
          </div>
        </>
      }
      // Ohne Notiz zum Löschen gibt es nichts zu zeigen – und der Fuss würde
      // dem Text nur Höhe wegnehmen.
      footer={
        savedId ? (
          <div className="flex items-center">
            <button
              onClick={() => {
                if (!window.confirm('Notiz löschen?')) return
                // Verhindert, dass das Speichern beim Schliessen die eben
                // gelöschte Notiz wieder anlegt.
                autosave.stop()
                remove.mutate(savedId, { onSuccess: onClose })
              }}
              className="ml-auto min-h-11 rounded-xl px-3 text-sm font-medium text-red-600 dark:text-red-400"
            >
              Löschen
            </button>
          </div>
        ) : undefined
      }
    >
      <>
        <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Titel"
            aria-label="Titel"
            // Bei einer neuen Notiz steht der Finger schon über der Tastatur.
            autoFocus={!note}
            className="w-full bg-transparent text-lg font-semibold outline-none"
          />

        {kind === 'liste' ? (
          <Checklist items={items} onChange={setItems} />
        ) : (
          <NoteText value={text} onChange={setText} startInEditing={!note || text === ''} />
        )}
      </>
    </Modal>
  )
}

/**
 * Die Einträge einer Checkliste.
 *
 * Unten steht immer eine leere Zeile: Wer tippt, legt damit den nächsten
 * Eintrag an, ohne vorher auf „Hinzufügen" zu zielen. Enter springt weiter,
 * Rücktaste in einer leeren Zeile räumt sie wieder weg.
 */
function Checklist({
  items,
  onChange,
}: {
  items: ChecklistItem[]
  onChange: (items: ChecklistItem[]) => void
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  function update(index: number, changes: Partial<ChecklistItem>) {
    const next = items.map((item, position) => (position === index ? { ...item, ...changes } : item))
    // Beim Abhaken rutscht der Eintrag ans Ende: Oben steht, was noch zu tun
    // ist. Beim Tippen bleibt die Reihenfolge, wie sie ist – sonst spränge
    // die Zeile unter dem Finger weg.
    onChange(changes.done === undefined ? next : sortChecklist(next))
  }

  function insertAfter(index: number) {
    const next = [...items]
    next.splice(index + 1, 0, { text: '', done: false })
    onChange(next)
    // Nach dem Zeichnen in die neue Zeile springen.
    setTimeout(() => inputs.current[index + 1]?.focus(), 0)
  }

  function removeAt(index: number) {
    onChange(items.filter((_, position) => position !== index))
    setTimeout(() => inputs.current[Math.max(0, index - 1)]?.focus(), 0)
  }

  return (
    <ul className="mt-3 space-y-1">
      {items.map((item, index) => (
        <li key={index} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.done}
            onChange={(event) => update(index, { done: event.target.checked })}
            aria-label={`${item.text || 'Eintrag'} erledigt`}
            className="size-5 shrink-0 accent-brand-700"
          />
          <input
            ref={(element) => {
              inputs.current[index] = element
            }}
            value={item.text}
            onChange={(event) => update(index, { text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                insertAfter(index)
              }
              if (event.key === 'Backspace' && item.text === '' && items.length > 1) {
                event.preventDefault()
                removeAt(index)
              }
            }}
            aria-label={`Eintrag ${index + 1}`}
            className={`min-h-9 w-full bg-transparent text-base outline-none ${
              item.done ? 'text-slate-400 line-through dark:text-slate-500' : ''
            }`}
          />
          <button
            onClick={() => removeAt(index)}
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
      ))}

      <li>
        <button
          onClick={() => insertAfter(items.length - 1)}
          className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400"
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

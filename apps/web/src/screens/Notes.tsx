import {
  checklistToText,
  NOTE_COLORS,
  NOTE_KIND_LABELS,
  NOTE_KINDS,
  parseChecklist,
  serializeChecklist,
  type ChecklistItem,
  type Note,
  type NoteColor,
  type NoteKind,
} from '@manager/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useFullScreenOverlay } from '../lib/overlay'
import { useDeleteNote, useNotes, useSaveNote } from '../lib/household'

/** Gedeckte Töne – die Liste soll ruhig bleiben, nicht bunt blinken. */
const COLOR_STYLES: Record<NoteColor, string> = {
  default: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
  gelb: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
  gruen: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900',
  blau: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900',
  rosa: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900',
}

const COLOR_SWATCHES: Record<NoteColor, string> = {
  default: 'bg-slate-200 dark:bg-slate-700',
  gelb: 'bg-amber-300',
  gruen: 'bg-emerald-300',
  blau: 'bg-sky-300',
  rosa: 'bg-rose-300',
}

/** Wie viele Einträge einer Checkliste in der Übersicht stehen. */
const PREVIEW_ITEMS = 4

export function Notes() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Note | NoteKind | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const query = useNotes(search)

  const notes = query.data?.notes ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Notizen</h1>
        {notes.length > 0 ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">{notes.length}</span>
        ) : null}
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
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                onClick={() => setEditing(note)}
                className={`w-full rounded-2xl border p-3 text-left transition active:scale-[0.99] ${COLOR_STYLES[note.color]}`}
              >
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    {note.title ? <span className="block font-medium">{note.title}</span> : null}
                    {note.kind === 'liste' ? (
                      <ChecklistPreview body={note.body} />
                    ) : note.body ? (
                      <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                        {note.body}
                      </span>
                    ) : null}
                  </span>
                  {note.pinned ? (
                    <span className="shrink-0 text-slate-400" aria-label="Angeheftet">
                      📌
                    </span>
                  ) : null}
                </span>
              </button>
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

/** Die ersten Einträge einer Checkliste, wie sie in der Übersicht erscheinen. */
function ChecklistPreview({ body }: { body: string }) {
  const items = parseChecklist(body)
  if (items.length === 0) return null

  const offen = items.filter((item) => !item.done).length

  return (
    <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">
      {items.slice(0, PREVIEW_ITEMS).map((item, index) => (
        <span key={index} className={`block truncate ${item.done ? 'text-slate-400 line-through dark:text-slate-500' : ''}`}>
          {item.done ? '☑' : '☐'} {item.text}
        </span>
      ))}
      {items.length > PREVIEW_ITEMS ? (
        <span className="block text-xs text-slate-400 dark:text-slate-500">
          … {items.length - PREVIEW_ITEMS} weitere · {offen} offen
        </span>
      ) : null}
    </span>
  )
}

/** Wie lange nach dem letzten Tastendruck gewartet wird, bevor gespeichert wird. */
const AUTOSAVE_MS = 900

type SaveState = 'ruht' | 'speichert' | 'gespeichert' | 'fehler'

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
  useFullScreenOverlay()

  const [kind, setKind] = useState<NoteKind>(note?.kind ?? newKind)
  const [title, setTitle] = useState(note?.title ?? '')
  const [text, setText] = useState(() =>
    (note?.kind ?? newKind) === 'liste' ? '' : (note?.body ?? ''),
  )
  const [items, setItems] = useState<ChecklistItem[]>(() => {
    if ((note?.kind ?? newKind) !== 'liste') return []
    const vorhanden = parseChecklist(note?.body ?? '')
    // Eine frische Liste beginnt mit einer leeren Zeile – sonst müsste man
    // erst „Eintrag hinzufügen" treffen, bevor man tippen kann.
    return vorhanden.length > 0 ? vorhanden : [{ text: '', done: false }]
  })
  /** Sobald eine neue Notiz einmal gespeichert ist, lässt sie sich löschen. */
  const [savedId, setSavedId] = useState(note?.id)
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'default')
  const [state, setState] = useState<SaveState>(note ? 'gespeichert' : 'ruht')

  const body = kind === 'liste' ? serializeChecklist(items) : text
  const leer = title.trim() === '' && body.trim() === ''

  // Der jeweils neueste Stand, damit auch das Speichern beim Schliessen ihn
  // sieht – zu dem Zeitpunkt rendert die Komponente nicht mehr.
  const current = useRef({ id: note?.id, title, body, kind, pinned, color })
  current.current = { id: current.current.id ?? note?.id, title, body, kind, pinned, color }

  // Auf Refs statt im Zustand: Beides darf das Fenster nicht neu zeichnen,
  // und beides muss auch nach dem Ausblenden noch stimmen.
  const dirty = useRef(false)
  const running = useRef(false)
  const removed = useRef(false)
  // Die Mutation wechselt bei jeder Änderung ihre Identität – über eine Ref
  // bleibt `flush` stabil, sonst liefe das Speichern bei jedem Zeichen einmal.
  const saveRef = useRef(save)
  saveRef.current = save

  const flush = useCallback(async () => {
    const entry = current.current
    if (removed.current || !dirty.current || running.current) return
    // Der Server verlangt Titel oder Text. Eine leere Notiz wird deshalb nicht
    // angelegt und eine geleerte behält ihren letzten Stand.
    if (entry.title.trim() === '' && entry.body.trim() === '') return

    running.current = true
    dirty.current = false
    setState('speichert')

    try {
      const result = await saveRef.current.mutateAsync({
        id: entry.id,
        note: {
          title: entry.title,
          body: entry.body,
          kind: entry.kind,
          pinned: entry.pinned,
          color: entry.color,
        },
      })
      // Ab jetzt wird dieselbe Notiz weitergeschrieben statt eine zweite anzulegen.
      current.current.id = result.note.id
      setSavedId(result.note.id)
      setState('gespeichert')
    } catch {
      dirty.current = true
      setState('fehler')
    } finally {
      running.current = false
      // Wurde während des Speicherns weitergetippt, gleich nochmals.
      if (dirty.current) void flush()
    }
  }, [])

  // Beim ersten Durchlauf ist noch nichts geändert – ohne diese Bremse
  // schriebe schon das Öffnen einer Notiz sie unverändert zurück.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }

    dirty.current = true
    const timer = setTimeout(() => void flush(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [title, body, kind, pinned, color, flush])

  // Beim Schliessen – auch über die Zurück-Geste – das Angefangene sichern.
  useEffect(() => () => void flush(), [flush])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function switchKind(next: NoteKind) {
    if (next === kind) return
    if (next === 'liste') setItems(parseChecklist(text))
    else setText(checklistToText(serializeChecklist(items)))
    setKind(next)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        // Der Klick im Fenster darf nicht bis zum Hintergrund durchfallen,
        // sonst schlösse jeder Tastendruck auf ein Feld die Notiz.
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={note ? 'Notiz bearbeiten' : 'Neue Notiz'}
        className={`flex max-h-[85dvh] w-full max-w-lg flex-col rounded-2xl border shadow-xl ${COLOR_STYLES[color]}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
          <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {leer
              ? 'Titel oder Text ausfüllen'
              : state === 'speichert'
                ? 'Speichert …'
                : state === 'fehler'
                  ? 'Nicht gespeichert'
                  : state === 'gespeichert'
                    ? 'Gespeichert'
                    : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPinned((value) => !value)}
              className={`grid size-11 min-h-11 place-items-center rounded-full text-sm ${pinned ? '' : 'opacity-30'}`}
              aria-label="Anheften"
              aria-pressed={pinned}
            >
              📌
            </button>
            <button
              onClick={onClose}
              aria-label="Notiz schliessen"
              className="grid size-11 min-h-11 place-items-center rounded-full text-slate-500 transition active:bg-black/5 dark:active:bg-white/10"
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Text …"
              aria-label="Text"
              rows={8}
              className="mt-3 w-full resize-none bg-transparent text-base outline-none"
            />
          )}
        </div>

        <div className="space-y-3 border-t border-black/5 px-4 py-3 dark:border-white/10">
          <div className="flex gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/10">
            {NOTE_KINDS.map((option) => (
              <button
                key={option}
                onClick={() => switchKind(option)}
                aria-pressed={kind === option}
                className={`min-h-11 flex-1 rounded-lg text-sm font-medium transition ${
                  kind === option ? 'bg-white shadow-sm dark:bg-slate-800' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {NOTE_KIND_LABELS[option]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {NOTE_COLORS.map((option) => (
              <button
                key={option}
                onClick={() => setColor(option)}
                aria-label={`Farbe ${option}`}
                aria-pressed={color === option}
                className={`size-8 rounded-full ${COLOR_SWATCHES[option]} ${
                  color === option ? 'ring-2 ring-brand-600 ring-offset-2 dark:ring-offset-slate-950' : ''
                }`}
              />
            ))}

            {savedId ? (
              <button
                onClick={() => {
                  if (!window.confirm('Notiz löschen?')) return
                  // Verhindert, dass das Speichern beim Schliessen die eben
                  // gelöschte Notiz wieder anlegt.
                  removed.current = true
                  remove.mutate(savedId, { onSuccess: onClose })
                }}
                className="ml-auto min-h-11 rounded-xl px-3 text-sm font-medium text-red-600 dark:text-red-400"
              >
                Löschen
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
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
    onChange(items.map((item, position) => (position === index ? { ...item, ...changes } : item)))
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

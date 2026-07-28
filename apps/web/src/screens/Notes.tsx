import {
  NOTE_COLORS,
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
import { useRef, useState } from 'react'

import { Modal, ModalCloseButton } from '../components/Modal'
import { saveStateLabel, useAutosave } from '../lib/autosave'
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
                  <span className="flex shrink-0 items-center gap-1 text-slate-400">
                    {note.shared ? <span title="Geteilt">👥</span> : null}
                    {note.pinned ? <span title="Angeheftet">📌</span> : null}
                  </span>
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
  // Auch hier Erledigtes nach unten – für Notizen, die noch aus der Zeit
  // davor stammen und seither nicht angefasst wurden.
  const items = sortChecklist(parseChecklist(body))
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

  const body = kind === 'liste' ? serializeChecklist(items) : text
  const leer = title.trim() === '' && body.trim() === ''

  // Ab dem ersten Speichern wird dieselbe Notiz weitergeschrieben, statt eine
  // zweite anzulegen.
  const idRef = useRef(note?.id)

  const autosave = useAutosave(
    { title, body, kind, pinned, shared, color },
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
      footer={
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
                autosave.stop()
                remove.mutate(savedId, { onSuccess: onClose })
              }}
              className="ml-auto min-h-11 rounded-xl px-3 text-sm font-medium text-red-600 dark:text-red-400"
            >
              Löschen
            </button>
          ) : null}
        </div>
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
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Text …"
            aria-label="Text"
            rows={8}
            className="mt-3 w-full resize-none bg-transparent text-base outline-none"
          />
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

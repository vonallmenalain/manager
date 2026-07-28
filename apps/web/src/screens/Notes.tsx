import { NOTE_COLORS, type Note, type NoteColor } from '@manager/shared'
import { type FormEvent, useState } from 'react'

import { Button } from '../components/Button'
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

export function Notes() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Note | 'neu' | null>(null)
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
                    {note.title ? (
                      <span className="block font-medium">{note.title}</span>
                    ) : null}
                    {note.body ? (
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

      <button
        onClick={() => setEditing('neu')}
        className="fixed bottom-20 right-4 z-20 grid size-14 place-items-center rounded-full bg-brand-800 text-white shadow-lg transition active:scale-95"
        aria-label="Notiz anlegen"
      >
        <svg className="size-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {editing ? (
        <NoteEditor
          note={editing === 'neu' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}

function NoteEditor({ note, onClose }: { note: Note | null; onClose: () => void }) {
  const save = useSaveNote()
  const remove = useDeleteNote()

  const [form, setForm] = useState({
    title: note?.title ?? '',
    body: note?.body ?? '',
    pinned: note?.pinned ?? false,
    color: note?.color ?? ('default' as NoteColor),
  })

  const leer = !form.title.trim() && !form.body.trim()

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (leer) return
    save.mutate({ id: note?.id, note: form }, { onSuccess: onClose })
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
      <div className="pt-safe flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <button onClick={onClose} className="text-sm font-medium text-slate-500">
          Abbrechen
        </button>
        <span className="text-sm font-semibold">{note ? 'Notiz' : 'Neue Notiz'}</span>
        <button
          onClick={() => setForm({ ...form, pinned: !form.pinned })}
          className={`text-sm ${form.pinned ? '' : 'opacity-30'}`}
          aria-label="Anheften"
          aria-pressed={form.pinned}
        >
          📌
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col p-4">
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="Titel"
          aria-label="Titel"
          className="w-full bg-transparent text-lg font-semibold outline-none"
        />
        <textarea
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
          placeholder="Text …"
          aria-label="Text"
          className="mt-3 min-h-0 flex-1 w-full resize-none bg-transparent text-base outline-none"
        />

        <div className="mt-3 flex items-center gap-2">
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setForm({ ...form, color })}
              aria-label={`Farbe ${color}`}
              aria-pressed={form.color === color}
              className={`size-8 rounded-full ${COLOR_SWATCHES[color]} ${
                form.color === color ? 'ring-2 ring-brand-600 ring-offset-2 dark:ring-offset-slate-950' : ''
              }`}
            />
          ))}
        </div>

        <div className="pb-safe mt-4 flex gap-2">
          {note ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Notiz löschen?')) {
                  remove.mutate(note.id, { onSuccess: onClose })
                }
              }}
              className="min-h-12 rounded-xl px-4 text-sm font-medium text-red-600 dark:text-red-400"
            >
              Löschen
            </button>
          ) : null}
          <Button type="submit" loading={save.isPending} disabled={leer}>
            Speichern
          </Button>
        </div>
      </form>
    </div>
  )
}

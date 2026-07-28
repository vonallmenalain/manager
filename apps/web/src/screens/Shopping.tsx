import { STORE_SECTIONS, type ShoppingItem, type StoreSection } from '@manager/shared'
import { type FormEvent, useState } from 'react'

import {
  useAddShoppingItem,
  useClearDoneShoppingItems,
  useDeleteShoppingItem,
  useShoppingList,
  useUpdateShoppingItem,
} from '../lib/household'
import { useHouseholdUsers } from '../lib/documents'

export function Shopping() {
  const list = useShoppingList()
  const users = useHouseholdUsers()
  const clearDone = useClearDoneShoppingItems()

  const items = list.data?.items ?? []
  const open = items.filter((item) => !item.done)
  const done = items.filter((item) => item.done)

  // Nach Abteilung gruppiert, in der Reihenfolge des Ladenrundgangs.
  const bySection = STORE_SECTIONS.map((section) => ({
    section,
    items: open.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Einkauf</h1>
        {open.length > 0 ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {open.length} offen
          </span>
        ) : null}
      </div>

      {list.isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Die Liste ist leer. Unten eintippen und mit Enter hinzufügen.
        </p>
      ) : (
        <>
          {bySection.map(({ section, items: sectionItems }) => (
            <section key={section}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {section}
              </h2>
              <ul className="space-y-1.5">
                {sectionItems.map((item) => (
                  <Row key={item.id} item={item} users={users.data?.users ?? []} />
                ))}
              </ul>
            </section>
          ))}

          {done.length > 0 ? (
            <section>
              <div className="mb-1.5 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Erledigt ({done.length})
                </h2>
                <button
                  onClick={() => clearDone.mutate(undefined)}
                  className="text-sm font-medium text-slate-500 dark:text-slate-400"
                >
                  Aufräumen
                </button>
              </div>
              <ul className="space-y-1.5">
                {done.map((item) => (
                  <Row key={item.id} item={item} users={users.data?.users ?? []} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <AddField />
    </div>
  )
}

function Row({
  item,
  users,
}: {
  item: ShoppingItem
  users: { id: string; name: string }[]
}) {
  const update = useUpdateShoppingItem()
  const remove = useDeleteShoppingItem()
  const [editing, setEditing] = useState(false)

  const doneByName = item.doneBy ? users.find((u) => u.id === item.doneBy)?.name : null

  return (
    <li className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
      {/* Die ganze Zeile ist die Trefferfläche – im Laden trifft man kein
          kleines Kästchen. */}
      <button
        onClick={() => update.mutate({ id: item.id, changes: { done: !item.done } })}
        className="flex min-h-12 flex-1 items-center gap-3 text-left"
      >
        <span
          className={`grid size-6 shrink-0 place-items-center rounded-full border-2 transition ${
            item.done
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-slate-300 dark:border-slate-600'
          }`}
          aria-hidden="true"
        >
          {item.done ? (
            <svg className="size-4" viewBox="0 0 24 24" fill="none">
              <path d="m5 12 5 5 9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={item.done ? 'text-slate-400 line-through' : ''}>{item.text}</span>
          {doneByName ? (
            <span className="ml-2 text-xs text-slate-400">von {doneByName}</span>
          ) : null}
        </span>
      </button>

      <button
        onClick={() => setEditing((value) => !value)}
        className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400"
        aria-label="Abteilung ändern"
      >
        ⋯
      </button>

      {editing ? (
        <SectionPicker
          text={item.text}
          current={item.section}
          onPick={(section) => {
            update.mutate({ id: item.id, changes: { section } })
            setEditing(false)
          }}
          onDelete={() => {
            remove.mutate(item.id)
            setEditing(false)
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </li>
  )
}

/**
 * Auswahl der Abteilung. Die Korrektur hier ist zugleich das, was die Liste
 * lernt – beim nächsten Mal steht derselbe Artikel gleich richtig.
 */
function SectionPicker({
  text,
  current,
  onPick,
  onDelete,
  onClose,
}: {
  text: string
  current: StoreSection
  onPick: (section: StoreSection) => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <>
      <button className="fixed inset-0 z-20 bg-slate-900/30" onClick={onClose} aria-label="Schliessen" />
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
        {/* Der Name steht dabei: Die Auswahl deckt die Zeile zu, auf die sie
            sich bezieht. */}
        <p className="mb-3 text-sm font-semibold">
          „{text}“ – in welche Abteilung?
        </p>
        <div className="flex flex-wrap gap-2">
          {STORE_SECTIONS.map((section) => (
            <button
              key={section}
              onClick={() => onPick(section)}
              className={`rounded-full px-3 py-2 text-sm font-medium ${
                section === current
                  ? 'bg-brand-800 text-white'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {section}
            </button>
          ))}
        </div>
        <button
          onClick={onDelete}
          className="mt-4 w-full py-2 text-sm font-medium text-red-600 dark:text-red-400"
        >
          Eintrag löschen
        </button>
      </div>
    </>
  )
}

/**
 * Immer erreichbar am unteren Rand, direkt über der Navigation. Nach dem
 * Absenden bleibt der Fokus im Feld – man trägt selten nur eine Sache ein.
 */
function AddField() {
  const add = useAddShoppingItem()
  const [text, setText] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    add.mutate({ text: value })
    setText('')
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="pb-safe fixed inset-x-0 bottom-16 z-10 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
    >
      <div className="mx-auto flex max-w-2xl gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Was fehlt?"
          aria-label="Neuer Eintrag"
          enterKeyHint="done"
          className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="grid min-h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-800 text-white transition active:scale-95 disabled:opacity-40"
          aria-label="Hinzufügen"
        >
          <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </form>
  )
}

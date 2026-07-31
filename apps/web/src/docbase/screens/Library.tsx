import { UNCATEGORIZED, UNCATEGORIZED_LABEL, type ManagedDocument } from '@manager/shared'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import { NewCategoryDialog } from '../../components/CategoryPicker'
import { DocumentIcon } from '../../components/icons'
import { SearchSnippet } from '../../components/SearchSnippet'
import { UploadControls } from '../../components/UploadControls'
import { useLocalJson } from '../../lib/einstellungen'
import { useCategories, useDocuments } from '../../lib/documents'
import { useEscape } from '../../lib/overlay'

/**
 * Die Sammlung.
 *
 * Was hier liegt, wird nicht abgearbeitet, sondern nachgeschlagen: Studien,
 * Kursunterlagen, eigene Notizen. Deshalb steht die Suche ganz oben und nicht
 * hinter einem Knopf – sie ist der eigentliche Zweck der Seite. Alles, was im
 * Haushalt eine Liste zu erledigender Post braucht (Status, Zuständigkeit,
 * Fälligkeit), fehlt hier vollständig: Ein Feld, das nie einen anderen Wert
 * bekommt, ist eine Frage, die niemand gestellt hat.
 */
export function Library() {
  const [search, setSearch] = useState('')
  const [kategorien, setKategorien] = useLocalJson<string[]>(
    'docbase.kategorien',
    [],
    (raw) => (Array.isArray(raw) ? raw.filter((e): e is string => typeof e === 'string') : []),
  )

  const categories = useCategories('docbase')
  const query = useDocuments({
    bereich: 'docbase',
    q: search || undefined,
    categoryId: kategorien.length > 0 ? kategorien : undefined,
  })

  const documents = query.data?.documents ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Sammlung</h1>
        <CategoryFilter
          categories={categories.data?.categories ?? []}
          gewaehlt={kategorien}
          onChange={setKategorien}
        />
      </div>

      <SearchField value={search} onChange={setSearch} />

      {query.isLoading ? (
        <ListSkeleton />
      ) : documents.length === 0 ? (
        <EmptyState gefiltert={Boolean(search) || kategorien.length > 0} />
      ) : (
        <ul className="space-y-2">
          {documents.map((document) => (
            <Row
              key={document.id}
              document={document}
              categoryName={
                categories.data?.categories.find((c) => c.id === document.categoryId)?.name
              }
            />
          ))}
        </ul>
      )}

      {/* Dieselben Wege wie im Manager – Scannen, Foto, Datei –, aber nur mit
          der Kategorie als Angabe. */}
      <UploadControls bereich="docbase" felder={['kategorie']} akzent="bg-teal-700" />
    </div>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Im Inhalt suchen…"
        aria-label="Sammlung durchsuchen"
        // text-base verhindert das automatische Hineinzoomen beim Fokus.
        className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-base outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/40 dark:border-slate-700 dark:bg-slate-900"
      />
    </div>
  )
}

/**
 * Der einzige Filter, den es hier gibt.
 *
 * Im Manager stehen dahinter Status, Zuständigkeit, Zeitraum und Papierkorb –
 * lauter Fragen an ein Stück Post. An eine Studie stellt man nur eine: in
 * welche Schublade sie gehört.
 */
function CategoryFilter({
  categories,
  gewaehlt,
  onChange,
}: {
  categories: readonly { id: string; name: string }[]
  gewaehlt: readonly string[]
  onChange: (value: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  useEscape(open && !creating, useCallback(() => setOpen(false), []))

  function toggle(id: string) {
    onChange(gewaehlt.includes(id) ? gewaehlt.filter((e) => e !== id) : [...gewaehlt, id])
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
      >
        <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 6h16M7 12h10M10 18h4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        Kategorie
        {gewaehlt.length > 0 ? (
          <span className="grid size-5 place-items-center rounded-full bg-teal-700 text-xs font-bold text-white">
            {gewaehlt.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Auswahl schliessen"
          />
          <div
            role="dialog"
            aria-label="Nach Kategorie filtern"
            className="absolute right-0 top-12 z-30 max-h-[70dvh] w-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            <Haken checked={gewaehlt.includes(UNCATEGORIZED)} onChange={() => toggle(UNCATEGORIZED)}>
              {UNCATEGORIZED_LABEL}
            </Haken>
            {categories.map((category) => (
              <Haken
                key={category.id}
                checked={gewaehlt.includes(category.id)}
                onChange={() => toggle(category.id)}
              >
                {category.name}
              </Haken>
            ))}

            <button
              onClick={() => setCreating(true)}
              className="flex min-h-10 items-center gap-2 text-sm font-medium text-teal-700 dark:text-teal-300"
            >
              <span aria-hidden="true">+</span>
              Neue Kategorie
            </button>

            <button
              onClick={() => onChange([])}
              disabled={gewaehlt.length === 0}
              className="mt-2 min-h-10 w-full rounded-xl border-t border-slate-200 pt-2 text-sm font-medium text-slate-600 disabled:opacity-40 dark:border-slate-800 dark:text-slate-300"
            >
              Auswahl zurücksetzen
            </button>
          </div>
        </>
      ) : null}

      {creating ? (
        <NewCategoryDialog
          bereich="docbase"
          onClose={() => setCreating(false)}
          onCreated={(category) => {
            toggle(category.id)
            setCreating(false)
          }}
        />
      ) : null}
    </div>
  )
}

function Haken({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 accent-teal-700"
      />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  )
}

function Row({
  document,
  categoryName,
}: {
  document: ManagedDocument
  categoryName?: string
}) {
  return (
    <li>
      <Link
        to={`/${document.id}`}
        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
          <DocumentIcon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{document.title}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
            {document.docDate}
            {categoryName ? ` · ${categoryName}` : ''}
          </span>
          {document.snippet ? <SearchSnippet snippet={document.snippet} /> : null}
          <OcrHint status={document.ocrStatus} />
        </span>
      </Link>
    </li>
  )
}

function ListSkeleton() {
  return (
    <ul className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <li key={index} className="h-16 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      ))}
    </ul>
  )
}

function EmptyState({ gefiltert }: { gefiltert: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      <p className="font-medium">{gefiltert ? 'Nichts gefunden' : 'Noch nichts abgelegt'}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {gefiltert
          ? 'Andere Suche oder Kategorie zurücksetzen.'
          : 'Unten rechts hinzufügen – PDF, Foto oder Scan. Gesucht wird danach im ganzen Text.'}
      </p>
    </div>
  )
}

/**
 * Nur sichtbar, solange die Texterkennung läuft oder gescheitert ist – hier
 * wiegt sie schwerer als im Haushalt: Eine Studie, die nicht durchsuchbar ist,
 * findet man in einer Sammlung praktisch nicht wieder.
 */
function OcrHint({ status }: { status: ManagedDocument['ocrStatus'] }) {
  if (status === 'pending' || status === 'running') {
    return (
      <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
        <span className="size-1.5 animate-pulse rounded-full bg-slate-400" aria-hidden="true" />
        Text wird gelesen …
      </span>
    )
  }

  if (status === 'failed') {
    return (
      <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
        Texterkennung fehlgeschlagen – Inhalt nicht durchsuchbar
      </span>
    )
  }

  return null
}

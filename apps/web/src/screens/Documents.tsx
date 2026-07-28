import {
  formatAmount,
  UNCATEGORIZED,
  UNCATEGORIZED_LABEL,
  type ManagedDocument,
} from '@manager/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { DocumentIcon } from '../components/icons'
import { SearchSnippet } from '../components/SearchSnippet'
import { StatusBadge } from '../components/StatusBadge'
import { UploadControls } from '../components/UploadControls'
import {
  useCategories,
  useDocuments,
  useHouseholdUsers,
  type DocumentFilters,
} from '../lib/documents'

export function Documents() {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<DocumentFilters>({})

  const query = useDocuments({ ...filters, q: search || undefined })
  const categories = useCategories()
  const users = useHouseholdUsers()

  const documents = query.data?.documents ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Dokumente</h1>
        {query.data ? (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {query.data.total} {query.data.total === 1 ? 'Eintrag' : 'Einträge'}
          </span>
        ) : null}
      </div>

      <SearchField value={search} onChange={setSearch} />

      <FilterChips
        filters={filters}
        onChange={setFilters}
        categories={categories.data?.categories ?? []}
        users={users.data?.users ?? []}
      />

      {query.isLoading ? (
        <ListSkeleton />
      ) : documents.length === 0 ? (
        <EmptyState hasFilters={Boolean(search) || Object.keys(filters).length > 0} />
      ) : (
        <ul className="space-y-2">
          {documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              categoryName={
                categories.data?.categories.find((c) => c.id === document.categoryId)?.name
              }
              assigneeName={users.data?.users.find((u) => u.id === document.assignedTo)?.name}
            />
          ))}
        </ul>
      )}

      <UploadControls />
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
        placeholder="Suchen…"
        aria-label="Dokumente durchsuchen"
        // text-base verhindert das automatische Hineinzoomen beim Fokus.
        className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-base outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900"
      />
    </div>
  )
}

interface FilterChipsProps {
  filters: DocumentFilters
  onChange: (filters: DocumentFilters) => void
  categories: { id: string; name: string }[]
  users: { id: string; name: string }[]
}

function FilterChips({ filters, onChange, categories, users }: FilterChipsProps) {
  function toggle<K extends keyof DocumentFilters>(key: K, value: DocumentFilters[K]) {
    const next = { ...filters }
    if (next[key] === value) delete next[key]
    else next[key] = value
    onChange(next)
  }

  return (
    // Waagrecht scrollbar statt umbrechend: Auf einem Handy sollen die Filter
    // nicht die halbe Höhe fressen.
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Chip active={filters.pending === true} onClick={() => toggle('pending', true)}>
        Pendent
      </Chip>
      {users.map((user) => (
        <Chip
          key={user.id}
          active={filters.assignedTo === user.id}
          onClick={() => toggle('assignedTo', user.id)}
        >
          {user.name}
        </Chip>
      ))}
      {/* Unsortiert steht zuerst und ist keine Zeile in der Kategorientabelle,
          sondern das Fehlen einer Zuordnung – die Liste dessen, was nach dem
          Hochladen noch einsortiert werden will. */}
      <Chip
        active={filters.categoryId === UNCATEGORIZED}
        onClick={() => toggle('categoryId', UNCATEGORIZED)}
      >
        {UNCATEGORIZED_LABEL}
      </Chip>
      {categories.map((category) => (
        <Chip
          key={category.id}
          active={filters.categoryId === category.id}
          onClick={() => toggle('categoryId', category.id)}
        >
          {category.name}
        </Chip>
      ))}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-brand-800 text-white'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      {children}
    </button>
  )
}

function DocumentRow({
  document,
  categoryName,
  assigneeName,
}: {
  document: ManagedDocument
  categoryName?: string
  assigneeName?: string
}) {
  const details = [
    categoryName,
    assigneeName ?? 'beide',
    document.amountCents !== null ? `CHF ${formatAmount(document.amountCents)}` : null,
  ].filter(Boolean)

  return (
    <li>
      <Link
        to={`/dokumente/${document.id}`}
        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <DocumentIcon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{document.title}</span>
            <StatusBadge status={document.status} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
            {document.docDate}
            {details.length > 0 ? ` · ${details.join(' · ')}` : ''}
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

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      <p className="font-medium">{hasFilters ? 'Nichts gefunden' : 'Noch keine Dokumente'}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {hasFilters
          ? 'Andere Suche oder Filter zurücksetzen.'
          : 'Unten rechts hinzufügen – PDF oder Foto.'}
      </p>
    </div>
  )
}

/**
 * Nur sichtbar, solange die Texterkennung noch läuft oder gescheitert ist.
 * Im Normalfall – Text erkannt – steht hier bewusst nichts: Ein Häkchen an
 * jedem Eintrag wäre reines Rauschen.
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

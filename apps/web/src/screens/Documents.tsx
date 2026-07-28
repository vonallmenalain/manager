import { formatAmount, type ManagedDocument } from '@manager/shared'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { DocumentIcon } from '../components/icons'
import { StatusBadge } from '../components/StatusBadge'
import { ApiRequestError } from '../lib/api'
import {
  useCategories,
  useDocuments,
  useHouseholdUsers,
  useUploadDocument,
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

      <UploadButton />
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
 * Schwebende Schaltfläche unten rechts, über der Navigationsleiste. Der
 * versteckte Datei-Dialog erlaubt Mehrfachauswahl; jede Datei geht als eigene
 * Anfrage raus, damit eine defekte nicht alle anderen mitreisst.
 */
function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useUploadDocument()
  const [message, setMessage] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setMessage(null)
    setPendingCount(files.length)

    let uploaded = 0
    const problems: string[] = []

    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync({ file })
        uploaded += 1
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'duplicate') {
          problems.push(`${file.name}: liegt bereits in der Ablage`)
        } else {
          problems.push(`${file.name}: ${error instanceof Error ? error.message : 'Fehler'}`)
        }
      }
      setPendingCount((count) => count - 1)
    }

    setMessage(
      problems.length === 0
        ? `${uploaded} ${uploaded === 1 ? 'Dokument' : 'Dokumente'} hinzugefügt.`
        : problems.join(' · '),
    )
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      {message ? (
        <p
          role="status"
          // bottom-40 statt bottom-24: Die Plus-Schaltfläche reicht bis rund
          // 8.5rem hinauf, darunter läge die Meldung teilweise verdeckt.
          className="fixed inset-x-4 bottom-40 z-20 mx-auto max-w-md rounded-xl bg-slate-900 px-4 py-3 text-center text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
          onClick={() => setMessage(null)}
        >
          {message}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={pendingCount > 0}
        className="fixed bottom-20 right-4 z-20 grid size-14 place-items-center rounded-full bg-brand-800 text-white shadow-lg transition active:scale-95 disabled:opacity-70"
        aria-label="Dokument hinzufügen"
      >
        {pendingCount > 0 ? (
          <svg className="size-6 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg className="size-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </>
  )
}

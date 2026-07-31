import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUSES,
  formatAmount,
  UNASSIGNED,
  UNASSIGNED_LABEL,
  UNCATEGORIZED,
  UNCATEGORIZED_LABEL,
  type ManagedDocument,
} from '@manager/shared'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import { NewCategoryDialog } from '../components/CategoryPicker'
import { DocumentIcon } from '../components/icons'
import { useEscape } from '../lib/overlay'
import { SearchSnippet } from '../components/SearchSnippet'
import { StatusBadge } from '../components/StatusBadge'
import { UploadControls } from '../components/UploadControls'
import {
  countFilters,
  sanitizeFilters,
  useCategories,
  useDocuments,
  useHouseholdUsers,
  type DocumentFilters,
} from '../lib/documents'
import { useLocalJson } from '../lib/einstellungen'

export function Documents() {
  const [search, setSearch] = useState('')
  // Die Filter bleiben am Gerät stehen: Wer die Liste auf „Steuererklärung"
  // eingestellt hat, kommt am nächsten Tag dorthin zurück, wo er aufgehört
  // hat. Die Suche nicht – ein Suchbegriff von gestern beantwortet die Frage
  // von heute nicht, und eine leere Liste beim Öffnen wäre ein Rätsel.
  const [filters, setFilters] = useLocalJson<DocumentFilters>(
    'dokumente.filter',
    {},
    sanitizeFilters,
  )

  const query = useDocuments({ ...filters, q: search || undefined })
  const categories = useCategories()
  const users = useHouseholdUsers()

  const documents = query.data?.documents ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dokumente</h1>
        <FilterMenu
          filters={filters}
          onChange={setFilters}
          categories={categories.data?.categories ?? []}
          users={users.data?.users ?? []}
        />
      </div>

      <SearchField value={search} onChange={setSearch} />

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

const PAPIERKORB = [
  { wert: 'ohne', label: 'Ausblenden' },
  { wert: 'mit', label: 'Mit anzeigen' },
  { wert: 'nur', label: 'Nur Gelöschte' },
] as const satisfies readonly { wert: NonNullable<DocumentFilters['deleted']>; label: string }[]

interface FilterMenuProps {
  filters: DocumentFilters
  onChange: (filters: DocumentFilters) => void
  categories: { id: string; name: string }[]
  users: { id: string; name: string }[]
}

/**
 * Alle Filter hinter einem Knopf.
 *
 * Vorher stand hier eine Reihe von Chips – Pendent, jede Person, jede
 * Kategorie –, die waagrecht aus dem Bild lief und immer nur eines davon
 * gelten liess. Mit Häkchen lassen sich mehrere anhaken („Alain oder Annina"),
 * und die Reihe nimmt keinen Platz mehr weg, solange man sie nicht braucht.
 *
 * Die Zahl am Knopf sagt, wie viele Häkchen gerade gesetzt sind: Ein Filter,
 * den man nicht sieht, muss sich bemerkbar machen – sonst sucht man nach einem
 * Dokument, das die Liste aus gutem Grund nicht zeigt.
 */
function FilterMenu({ filters, onChange, categories, users }: FilterMenuProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const anzahl = countFilters(filters)

  // Nicht, solange das Fenster für die neue Kategorie offen ist: Escape gehört
  // dann diesem Fenster, sonst schlösse eine Taste beides auf einmal.
  useEscape(open && !creating, useCallback(() => setOpen(false), []))

  function toggle(key: 'status' | 'categoryId' | 'assignedTo', value: string) {
    const current = filters[key] ?? []
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]

    const geaendert = { ...filters }
    if (next.length === 0) delete geaendert[key]
    else geaendert[key] = next
    onChange(geaendert)
  }

  function setDatum(key: 'uploadedFrom' | 'uploadedTo', value: string) {
    const geaendert = { ...filters }
    if (value) geaendert[key] = value
    else delete geaendert[key]
    onChange(geaendert)
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
        Filter
        {anzahl > 0 ? (
          <span className="grid size-5 place-items-center rounded-full bg-brand-800 text-xs font-bold text-white">
            {anzahl}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Filter schliessen"
          />
          <div
            role="dialog"
            aria-label="Dokumente filtern"
            className="absolute right-0 top-12 z-30 max-h-[70dvh] w-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            {/* Status und Zuständigkeit tragen kurze Namen und stehen deshalb
                zweispaltig – sonst wäre das Menü länger als der Bildschirm,
                bevor man bei den Kategorien ist. */}
            <Gruppe titel="Status" spalten>
              {DOCUMENT_STATUSES.map((status) => (
                <Haken
                  key={status}
                  checked={(filters.status ?? []).includes(status)}
                  onChange={() => toggle('status', status)}
                >
                  {DOCUMENT_STATUS_LABELS[status]}
                </Haken>
              ))}
            </Gruppe>

            <Gruppe titel="Zuständig" spalten>
              {users.map((user) => (
                <Haken
                  key={user.id}
                  checked={(filters.assignedTo ?? []).includes(user.id)}
                  onChange={() => toggle('assignedTo', user.id)}
                >
                  {user.name}
                </Haken>
              ))}
              <Haken
                checked={(filters.assignedTo ?? []).includes(UNASSIGNED)}
                onChange={() => toggle('assignedTo', UNASSIGNED)}
              >
                {UNASSIGNED_LABEL}
              </Haken>
            </Gruppe>

            <Gruppe titel="Kategorie">
              {/* Unsortiert steht zuerst und ist keine Zeile in der
                  Kategorientabelle, sondern das Fehlen einer Zuordnung – die
                  Liste dessen, was nach dem Hochladen noch einsortiert werden
                  will. */}
              <Haken
                checked={(filters.categoryId ?? []).includes(UNCATEGORIZED)}
                onChange={() => toggle('categoryId', UNCATEGORIZED)}
              >
                {UNCATEGORIZED_LABEL}
              </Haken>
              {categories.map((category) => (
                <Haken
                  key={category.id}
                  checked={(filters.categoryId ?? []).includes(category.id)}
                  onChange={() => toggle('categoryId', category.id)}
                >
                  {category.name}
                </Haken>
              ))}
              {/* Auch hier anlegen zu können, klingt zunächst verkehrt – man
                  filtert ja, man legt nicht ab. Es ist aber die Liste, in der
                  man merkt, dass eine Schublade fehlt: Sie steht vollständig
                  vor einem. Die neue Kategorie wird gleich angehakt, sonst
                  wäre der Griff folgenlos. */}
              <button
                onClick={() => setCreating(true)}
                className="flex min-h-10 items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-300"
              >
                <span aria-hidden="true">+</span>
                Neue Kategorie
              </button>
            </Gruppe>

            {/* Der Papierkorb ist kein eigener Bildschirm, sondern eine
                Einstellung dieser Liste: Suche und Filter gelten dort genauso,
                und man muss nicht erst wissen, wo er steht. */}
            <Gruppe titel="Papierkorb">
              {PAPIERKORB.map((option) => (
                <label key={option.wert} className="flex min-h-10 items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name="papierkorb"
                    checked={(filters.deleted ?? 'ohne') === option.wert}
                    onChange={() => {
                      const geaendert = { ...filters }
                      if (option.wert === 'ohne') delete geaendert.deleted
                      else geaendert.deleted = option.wert
                      onChange(geaendert)
                    }}
                    className="size-4 shrink-0 accent-brand-700"
                  />
                  <span className="min-w-0 truncate">{option.label}</span>
                </label>
              ))}
            </Gruppe>

            <Gruppe titel="Hochgeladen">
              <label className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="text-slate-500 dark:text-slate-400">von</span>
                <input
                  type="date"
                  value={filters.uploadedFrom ?? ''}
                  onChange={(event) => setDatum('uploadedFrom', event.target.value)}
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="text-slate-500 dark:text-slate-400">bis</span>
                <input
                  type="date"
                  value={filters.uploadedTo ?? ''}
                  onChange={(event) => setDatum('uploadedTo', event.target.value)}
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </Gruppe>

            <button
              onClick={() => onChange({})}
              disabled={anzahl === 0}
              className="mt-2 min-h-10 w-full rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 dark:text-slate-300"
            >
              Alle Filter zurücksetzen
            </button>
          </div>
        </>
      ) : null}

      {creating ? (
        <NewCategoryDialog
          onClose={() => setCreating(false)}
          onCreated={(category) => {
            toggle('categoryId', category.id)
            setCreating(false)
          }}
        />
      ) : null}
    </div>
  )
}

function Gruppe({
  titel,
  spalten,
  children,
}: {
  titel: string
  spalten?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-slate-200 py-2 last:border-b-0 dark:border-slate-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{titel}</p>
      <div className={spalten ? 'grid grid-cols-2 gap-x-2' : ''}>{children}</div>
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
        className="size-4 shrink-0 accent-brand-700"
      />
      <span className="min-w-0 truncate">{children}</span>
    </label>
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
            <span className={`truncate font-medium ${document.deletedAt ? 'line-through' : ''}`}>
              {document.title}
            </span>
            {document.deletedAt ? (
              <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                Papierkorb
              </span>
            ) : (
              <StatusBadge status={document.status} />
            )}
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

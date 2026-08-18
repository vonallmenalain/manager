import {
  categoryLabel,
  groupCategories,
  UNCATEGORIZED,
  UNCATEGORIZED_LABEL,
  type Category,
  type ManagedDocument,
} from '@manager/shared'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import { NewCategoryDialog } from '../../components/CategoryPicker'
import { DocumentTile } from '../../components/DocumentTile'
import { DocumentIcon } from '../../components/icons'
import { SearchSnippet } from '../../components/SearchSnippet'
import { UploadControls } from '../../components/UploadControls'
import { useLocalJson, useLocalSetting } from '../../lib/einstellungen'
import { useCategories, useDocuments, withoutFilters } from '../../lib/documents'
import { useEscape } from '../../lib/overlay'

/**
 * Wie die Sammlung angezeigt wird.
 *
 * Die Liste beantwortet „wie heisst es", die Kacheln „wie sieht es aus". Beides
 * ist berechtigt und hängt davon ab, wonach man gerade sucht – deshalb eine
 * Einstellung und keine Entscheidung. Sie hängt am Gerät und nicht am Konto:
 * Auf dem Handy will man anderes sehen als am grossen Bildschirm.
 */
const ANSICHTEN = ['liste', 'kacheln'] as const
type Ansicht = (typeof ANSICHTEN)[number]

/**
 * Wie viele Kacheln nebeneinander stehen.
 *
 * Eins ist keine Kachelansicht mehr, sondern eine Liste mit grossen Bildern –
 * und genau das will man auf dem Handy manchmal. Vier ist die Grenze, ab der
 * auf einem Telefon nichts mehr zu erkennen wäre.
 */
const SPALTEN = ['1', '2', '3', '4'] as const
type Spalten = (typeof SPALTEN)[number]

const SPALTEN_KLASSE: Record<Spalten, string> = {
  '1': 'grid-cols-1',
  '2': 'grid-cols-2',
  '3': 'grid-cols-3',
  '4': 'grid-cols-4',
}

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
  const [ansicht, setAnsicht] = useLocalSetting<Ansicht>('docbase.ansicht', ANSICHTEN, 'liste')
  const [spalten, setSpalten] = useLocalSetting<Spalten>('docbase.spalten', SPALTEN, '2')

  const categories = useCategories('docbase')
  const gesucht = {
    bereich: 'docbase' as const,
    q: search || undefined,
    categoryId: kategorien.length > 0 ? kategorien : undefined,
  }
  const query = useDocuments(gesucht)

  const documents = query.data?.documents ?? []
  const alleKategorien = categories.data?.categories ?? []

  // Bleibt die Sammlung leer, obwohl Kategorien angehakt sind, läuft dieselbe
  // Suche ein zweites Mal ohne sie. Erst dann: Solange etwas zu sehen ist,
  // holte sie bei jedem Tastendruck eine zweite Liste ohne Nutzen.
  const leer = !query.isLoading && documents.length === 0
  const ohneFilter = useDocuments(withoutFilters(gesucht), leer && kategorien.length > 0)
  const ausgeblendet = leer ? (ohneFilter.data?.documents ?? []) : []

  /** „Notfall › Medikamente" – ohne die Hauptkategorie fehlt die Hälfte. */
  function kategorieName(document: ManagedDocument): string | undefined {
    return document.categoryId ? categoryLabel(alleKategorien, document.categoryId) : undefined
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Sammlung</h1>
        <div className="flex items-center gap-2">
          <CategoryFilter
            categories={alleKategorien}
            gewaehlt={kategorien}
            onChange={setKategorien}
          />
          <ViewMenu
            ansicht={ansicht}
            onAnsichtChange={setAnsicht}
            spalten={spalten}
            onSpaltenChange={setSpalten}
          />
        </div>
      </div>

      <SearchField value={search} onChange={setSearch} />

      {query.isLoading ? (
        <ListSkeleton />
      ) : documents.length === 0 ? (
        <>
          <EmptyState
            gefiltert={Boolean(search) || kategorien.length > 0}
            ausgeblendet={ausgeblendet.length}
          />
          {ausgeblendet.length > 0 ? (
            <AusgeblendetVomFilter
              documents={ausgeblendet}
              total={ohneFilter.data?.total ?? ausgeblendet.length}
              ansicht={ansicht}
              spalten={spalten}
              kategorieName={kategorieName}
              onReset={() => setKategorien([])}
            />
          ) : null}
        </>
      ) : (
        <Sammlung
          documents={documents}
          ansicht={ansicht}
          spalten={spalten}
          kategorieName={kategorieName}
        />
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
 *
 * Eine Hauptkategorie steht für alles, was darunter liegt: Wer „Notfall"
 * anhakt, sieht auch die Dokumente aus „Notfall › Medikamente". Das erledigt
 * der Server – hier steht nur, was angehakt ist.
 */
function CategoryFilter({
  categories,
  gewaehlt,
  onChange,
}: {
  categories: readonly Category[]
  gewaehlt: readonly string[]
  onChange: (value: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  useEscape(open && !creating, useCallback(() => setOpen(false), []))

  function toggle(id: string) {
    onChange(gewaehlt.includes(id) ? gewaehlt.filter((e) => e !== id) : [...gewaehlt, id])
  }

  const gruppen = groupCategories(categories)

  return (
    <div className="relative">
      <FilterButton
        label="Kategorie"
        open={open}
        anzahl={gewaehlt.length}
        onClick={() => setOpen((value) => !value)}
      >
        <path
          d="M4 6h16M7 12h10M10 18h4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </FilterButton>

      {open ? (
        <Panel label="Nach Kategorie filtern" onClose={() => setOpen(false)}>
          <Haken checked={gewaehlt.includes(UNCATEGORIZED)} onChange={() => toggle(UNCATEGORIZED)}>
            {UNCATEGORIZED_LABEL}
          </Haken>
          {gruppen.map((gruppe) => (
            <div key={gruppe.category.id}>
              <Haken
                checked={gewaehlt.includes(gruppe.category.id)}
                onChange={() => toggle(gruppe.category.id)}
              >
                {gruppe.category.name}
              </Haken>
              {gruppe.children.map((child) => (
                <Haken
                  key={child.id}
                  eingerueckt
                  checked={gewaehlt.includes(child.id)}
                  onChange={() => toggle(child.id)}
                >
                  {child.name}
                </Haken>
              ))}
            </div>
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
        </Panel>
      ) : null}

      {creating ? (
        <NewCategoryDialog
          bereich="docbase"
          categories={categories}
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

/**
 * Wie angezeigt wird – nicht was.
 *
 * Bewusst neben und nicht in den Kategorienfilter: Das eine bestimmt, welche
 * Dokumente man sieht, das andere, wie sie aussehen. In einem Menü
 * zusammengelegt stünde die Frage „welche Kategorie" neben „wie viele Kacheln
 * pro Reihe", und beim Zurücksetzen wäre nie klar, was zurückgesetzt wird.
 */
function ViewMenu({
  ansicht,
  onAnsichtChange,
  spalten,
  onSpaltenChange,
}: {
  ansicht: Ansicht
  onAnsichtChange: (value: Ansicht) => void
  spalten: Spalten
  onSpaltenChange: (value: Spalten) => void
}) {
  const [open, setOpen] = useState(false)
  useEscape(open, useCallback(() => setOpen(false), []))

  return (
    <div className="relative">
      <FilterButton label="Ansicht" open={open} onClick={() => setOpen((value) => !value)}>
        <path
          d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </FilterButton>

      {open ? (
        <Panel label="Ansicht wählen" onClose={() => setOpen(false)}>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              Darstellung
            </legend>
            <Radio
              name="docbase-ansicht"
              checked={ansicht === 'liste'}
              onChange={() => onAnsichtChange('liste')}
            >
              Liste
            </Radio>
            <Radio
              name="docbase-ansicht"
              checked={ansicht === 'kacheln'}
              onChange={() => onAnsichtChange('kacheln')}
            >
              Kacheln
            </Radio>
          </fieldset>

          {/* Nur bei Kacheln sichtbar: Bei einer Liste gibt es keine Reihen,
              und eine Einstellung ohne Wirkung ist eine Falle. */}
          {ansicht === 'kacheln' ? (
            <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                Kacheln pro Reihe
              </p>
              <div className="flex gap-1" role="group" aria-label="Kacheln pro Reihe">
                {SPALTEN.map((wert) => (
                  <button
                    key={wert}
                    onClick={() => onSpaltenChange(wert)}
                    aria-pressed={spalten === wert}
                    className={`min-h-10 flex-1 rounded-lg text-sm font-semibold tabular-nums transition ${
                      spalten === wert
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {wert}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}

function FilterButton({
  label,
  open,
  anzahl = 0,
  onClick,
  children,
}: {
  label: string
  open: boolean
  anzahl?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
    >
      <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {children}
      </svg>
      {label}
      {anzahl > 0 ? (
        <span className="grid size-5 place-items-center rounded-full bg-teal-700 text-xs font-bold text-white">
          {anzahl}
        </span>
      ) : null}
    </button>
  )
}

/** Das aufgeklappte Feld unter einem der beiden Knöpfe. */
function Panel({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <button
        className="fixed inset-0 z-20 cursor-default"
        onClick={onClose}
        aria-label="Auswahl schliessen"
      />
      <div
        role="dialog"
        aria-label={label}
        className="absolute right-0 top-12 z-30 max-h-[70dvh] w-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        {children}
      </div>
    </>
  )
}

function Haken({
  checked,
  onChange,
  eingerueckt = false,
  children,
}: {
  checked: boolean
  onChange: () => void
  eingerueckt?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`flex min-h-10 items-center gap-3 text-sm ${eingerueckt ? 'pl-5' : ''}`}>
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

function Radio({
  name,
  checked,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 text-sm">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 accent-teal-700"
      />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  )
}

/**
 * Die Sammlung selbst – als Liste oder als Kacheln.
 *
 * Eigene Komponente, weil sie an zwei Stellen steht: als Ergebnis und noch
 * einmal unter „Nichts gefunden" für das, was der Filter zurückhält. Beides
 * folgt derselben Einstellung; ein Wechsel auf Kacheln, der nur die eine
 * Hälfte erwischte, wäre schwer zu erklären.
 */
function Sammlung({
  documents,
  ansicht,
  spalten,
  kategorieName,
}: {
  documents: ManagedDocument[]
  ansicht: Ansicht
  spalten: Spalten
  kategorieName: (document: ManagedDocument) => string | undefined
}) {
  if (ansicht === 'kacheln') {
    return (
      <ul className={`grid gap-2 ${SPALTEN_KLASSE[spalten]}`}>
        {documents.map((document) => (
          <DocumentTile
            key={document.id}
            document={document}
            categoryName={kategorieName(document)}
          />
        ))}
      </ul>
    )
  }

  return (
    <ul className="space-y-2">
      {documents.map((document) => (
        <Row key={document.id} document={document} categoryName={kategorieName(document)} />
      ))}
    </ul>
  )
}

/**
 * Was die Suche gefunden hätte, wären da nicht die angehakten Kategorien.
 *
 * Hier wiegt das schwerer als im Haushalt: Die Kategorien bleiben am Gerät
 * stehen, und wer in einer Sammlung sucht, sucht quer durch alles – „nicht
 * gefunden" heisst dann leicht „gibt es nicht", obwohl es nur woanders
 * einsortiert ist.
 */
function AusgeblendetVomFilter({
  documents,
  total,
  ansicht,
  spalten,
  kategorieName,
  onReset,
}: {
  documents: ManagedDocument[]
  total: number
  ansicht: Ansicht
  spalten: Spalten
  kategorieName: (document: ManagedDocument) => string | undefined
  onReset: () => void
}) {
  // Mehr Treffer als Zeilen: Der Server liefert höchstens fünfzig auf einmal.
  const weitere = total - documents.length

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          Von der Kategorie ausgeblendet
        </h2>
        <button
          onClick={onReset}
          className="shrink-0 text-sm font-medium text-teal-700 dark:text-teal-300"
        >
          Zurücksetzen
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {total === 1
          ? 'Ein Treffer ausserhalb der angehakten Kategorien.'
          : `${total} Treffer ausserhalb der angehakten Kategorien.`}
      </p>

      <Sammlung
        documents={documents}
        ansicht={ansicht}
        spalten={spalten}
        kategorieName={kategorieName}
      />

      {weitere > 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          … und {weitere} weitere. Zurücksetzen zeigt alle.
        </p>
      ) : null}
    </section>
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

/**
 * `ausgeblendet` sagt, ob unter diesem Kasten noch Treffer stehen. Dann ist
 * der Rat „andere Suche" falsch – die Suche stimmte ja, nur die Kategorie nicht.
 */
function EmptyState({ gefiltert, ausgeblendet }: { gefiltert: boolean; ausgeblendet: number }) {
  const hinweis = !gefiltert
    ? 'Unten rechts hinzufügen – PDF, Foto oder Scan. Gesucht wird danach im ganzen Text.'
    : ausgeblendet > 0
      ? 'Nicht in den angehakten Kategorien. Weiter unten steht, was ohne sie da wäre.'
      : 'Andere Suche oder Kategorie zurücksetzen.'

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      <p className="font-medium">{gefiltert ? 'Nichts gefunden' : 'Noch nichts abgelegt'}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{hinweis}</p>
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

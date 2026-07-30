import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUSES,
  formatFileSize,
  UNASSIGNED_LABEL,
  UNCATEGORIZED_LABEL,
  type Category,
  type DocumentStatus,
  type PublicUser,
} from '@manager/shared'
import { createPortal } from 'react-dom'

import { useFullScreenOverlay } from '../lib/overlay'
import type { ScanPage } from '../lib/scan/pages'

/**
 * Was am Dokument festgelegt wird, bevor es abgelegt wird.
 *
 * Kategorie und Zuständigkeit sind leer, solange nichts gewählt ist – das ist
 * kein fehlender Wert, sondern „unsortiert" und „beide".
 */
export interface TrayDetails {
  title: string
  categoryId: string | null
  assignedTo: string | null
  status: DocumentStatus
}

/**
 * Die gesammelten Seiten, bevor sie ein Dokument werden.
 *
 * Hängt über ein Portal direkt am <body>: Als Kind der Dokumentenliste wäre
 * die Fläche zwar auch bildschirmfüllend, läge aber im selben Stapel wie die
 * Navigationsleiste am unteren Rand – und die blieb sichtbar.
 *
 * Der Schritt, der vorher fehlte: Eine Aufnahme ging bisher direkt in die
 * Ablage, und ein zweiseitiger Brief wurde zwangsläufig zu zwei Dokumenten.
 * Hier liegen die Seiten so lange nebeneinander, bis sie vollständig sind –
 * danach werden sie zu einer einzigen PDF-Datei zusammengefügt.
 *
 * Nichts davon ist auf dem Server. Wer die App schliesst, bevor er hochlädt,
 * verliert die Seiten – deshalb fragt „Verwerfen" nach.
 */
export function PageTray({
  pages,
  details,
  onDetailsChange,
  defaultTitle,
  categories,
  users,
  busy,
  onAddPage,
  onRemove,
  onMove,
  onRotate,
  onDiscard,
  onUpload,
}: {
  pages: readonly ScanPage[]
  details: TrayDetails
  onDetailsChange: (details: TrayDetails) => void
  /** Was ohne Eingabe im Archiv stehen würde. */
  defaultTitle: string
  /** Zur Auswahl stehende Kategorien; leer, solange sie nicht geladen sind. */
  categories: readonly Category[]
  users: readonly PublicUser[]
  busy: boolean
  onAddPage: () => void
  onRemove: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  /** Dreht eine einzelne Seite um eine Vierteldrehung. */
  onRotate: (id: string) => void
  onDiscard: () => void
  onUpload: () => void
}) {
  useFullScreenOverlay()
  const bytes = pages.reduce((sum, page) => sum + page.blob.size, 0)

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-slate-950">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] dark:border-slate-800">
        <button
          onClick={onDiscard}
          disabled={busy}
          className="min-h-11 rounded-full px-3 text-sm font-medium text-slate-600 disabled:opacity-50 dark:text-slate-400"
        >
          Verwerfen
        </button>
        <p className="text-sm font-semibold">
          {pages.length} {pages.length === 1 ? 'Seite' : 'Seiten'}
          <span className="ml-2 font-normal text-slate-500 tabular-nums dark:text-slate-400">
            {formatFileSize(bytes)}
          </span>
        </p>
        <span className="w-20" />
      </header>

      <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-900">
        {pages.map((page, index) => (
          <li key={page.id} className="flex items-center gap-3 px-4 py-3">
            {/* object-contain statt -cover: Eine quer liegende Seite soll auf
                der Vorschau quer aussehen – sonst sieht man nicht, welche
                gedreht gehört. */}
            <img
              src={page.url}
              alt={`Seite ${index + 1}`}
              className="h-20 w-15 shrink-0 rounded-lg border border-slate-200 bg-slate-50 object-contain dark:border-slate-800 dark:bg-slate-900"
            />
            {/* Die Knöpfe stehen unter der Beschriftung und nicht daneben: Zu
                viert nähmen sie sonst die halbe Zeilenbreite. */}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Seite {index + 1}</p>
              <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {formatFileSize(page.blob.size)}
              </p>

              <div className="mt-2 flex gap-1.5">
                {/* Drehen steht zuerst: Eine quer liegende Seite sieht man auf
                    der Vorschau daneben sofort, und der Griff gehört dorthin,
                    wo der Blick ohnehin hinfällt. */}
                <TrayButton
                  label={`Seite ${index + 1} drehen`}
                  disabled={busy}
                  onClick={() => onRotate(page.id)}
                >
                  <path d="M4 12a8 8 0 1 1 2.5 5.8" />
                  <path d="M4 7v5h5" />
                </TrayButton>
                <TrayButton
                  label={`Seite ${index + 1} nach oben`}
                  disabled={index === 0 || busy}
                  onClick={() => onMove(page.id, -1)}
                >
                  <path d="m6 14 6-6 6 6" />
                </TrayButton>
                <TrayButton
                  label={`Seite ${index + 1} nach unten`}
                  disabled={index === pages.length - 1 || busy}
                  onClick={() => onMove(page.id, 1)}
                >
                  <path d="m6 10 6 6 6-6" />
                </TrayButton>
                <TrayButton
                  label={`Seite ${index + 1} entfernen`}
                  disabled={busy}
                  onClick={() => onRemove(page.id)}
                >
                  <path d="M5 7h14M10 7V5h4v2m-7 0 .8 12h8.4L17 7" />
                </TrayButton>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t border-slate-200 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 dark:border-slate-800">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Titel
          </span>
          <input
            value={details.title}
            onChange={(event) => onDetailsChange({ ...details, title: event.target.value })}
            disabled={busy}
            maxLength={200}
            // Beim Tippen von Titeln wie „Rechnung Krankenkasse" hilft die
            // Autokorrektur mehr, als sie stört – anders als bei Passwörtern.
            autoCapitalize="sentences"
            enterKeyHint="done"
            placeholder={defaultTitle}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        {/* Dieselben drei Angaben wie oben in der Detailansicht, nur eine
            Station früher: Wer die Post gerade in der Hand hatte, weiss in
            diesem Moment, in welche Kategorie sie gehört und wen sie angeht.
            Danach hiesse es, das Dokument in der Liste wiederzufinden und
            dreimal auszuwählen – und meistens bleibt es dann liegen. */}
        <div className="grid grid-cols-3 gap-2">
          <TraySelect
            label="Kategorie"
            value={details.categoryId ?? ''}
            disabled={busy}
            onChange={(value) => onDetailsChange({ ...details, categoryId: value || null })}
            options={[
              { value: '', label: UNCATEGORIZED_LABEL },
              ...categories.map((entry) => ({ value: entry.id, label: entry.name })),
            ]}
          />
          <TraySelect
            label="Zuständig"
            value={details.assignedTo ?? ''}
            disabled={busy}
            onChange={(value) => onDetailsChange({ ...details, assignedTo: value || null })}
            options={[
              { value: '', label: UNASSIGNED_LABEL },
              ...users.map((entry) => ({ value: entry.id, label: entry.name })),
            ]}
          />
          <TraySelect
            label="Status"
            value={details.status}
            disabled={busy}
            onChange={(value) => onDetailsChange({ ...details, status: value as DocumentStatus })}
            options={DOCUMENT_STATUSES.map((status) => ({
              value: status,
              label: DOCUMENT_STATUS_LABELS[status],
            }))}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={onAddPage}
            disabled={busy}
            className="min-h-12 flex-1 rounded-xl border border-slate-300 text-base font-semibold disabled:opacity-50 dark:border-slate-700"
          >
            Weitere Seite
          </button>
          <button
            onClick={onUpload}
            disabled={busy || pages.length === 0}
            className="min-h-12 flex-1 rounded-xl bg-brand-800 text-base font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Wird abgelegt …' : 'Ablegen'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Eines der drei Auswahlfelder unter dem Titel.
 *
 * Bewusst ein <select> und keine Reihe von Knöpfen: Die Kategorienliste eines
 * Haushalts hat ein Dutzend Einträge, und die Auswahl des Systems ist auf dem
 * Telefon die, die sich mit einer Hand bedienen lässt.
 */
function TraySelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function TrayButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-11 min-h-11 shrink-0 place-items-center rounded-xl border border-slate-200 transition active:bg-slate-100 disabled:opacity-30 dark:border-slate-800 dark:active:bg-slate-800"
    >
      <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </g>
      </svg>
    </button>
  )
}

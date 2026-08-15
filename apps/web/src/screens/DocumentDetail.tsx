import {
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  formatAmount,
  formatFileSize,
  parseAmountToCents,
  type DocumentDetail,
  type DocumentStatus,
  type UpdateDocumentInput,
} from '@manager/shared'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { CategorySelect } from '../components/CategoryPicker'
import { DocumentPreview } from '../components/DocumentPreview'
import { StatusBadge } from '../components/StatusBadge'
import { DownloadIcon, PencilIcon } from '../components/icons'
import { saveStateLabel, useAutosave } from '../lib/autosave'
import {
  fileUrl,
  useCategories,
  useDeleteDocument,
  useDocument,
  useHouseholdUsers,
  useRestoreDocument,
  useRetryOcr,
  useUpdateDocument,
} from '../lib/documents'

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const query = useDocument(id)
  const update = useUpdateDocument(id ?? '')
  const remove = useDeleteDocument()
  const restore = useRestoreDocument()
  const retryOcr = useRetryOcr(id ?? '')
  const categories = useCategories()
  const users = useHouseholdUsers()

  const [editing, setEditing] = useState(false)

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
  }

  const document = query.data?.document
  if (!document) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">Dokument nicht gefunden</p>
        <button
          onClick={() => navigate('/dokumente')}
          className="mt-3 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          Zurück zur Liste
        </button>
      </div>
    )
  }

  const uploader = users.data?.users.find((u) => u.id === document.uploadedBy)

  async function handleDelete() {
    if (!id) return
    // Bewusst eine harte Rückfrage: Löschen ist der einzige Weg, an dem
    // versehentlich Inhalt verschwindet – auch wenn er im Papierkorb landet.
    if (!window.confirm(`„${document?.title}" in den Papierkorb legen?`)) return
    await remove.mutateAsync(id)
    navigate('/dokumente')
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/dokumente')}
        className="-ml-1 flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400"
      >
        <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Dokumente
      </button>

      <div className="flex items-start gap-2">
        <h1 className="min-w-0 flex-1 text-xl font-bold">{document.title}</h1>
        {document.deletedAt ? null : <StatusBadge status={document.status} />}
        {/* Herunterladen und Bearbeiten standen als zwei breite Knöpfe unter
            der Vorschau – zwei Handgriffe, die man selten braucht, an der
            Stelle, an der das Dokument selbst stehen sollte. */}
        <a
          href={fileUrl(document.id, true)}
          aria-label="Herunterladen"
          title="Herunterladen"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition active:bg-black/5 dark:text-slate-400 dark:active:bg-white/10"
        >
          <DownloadIcon className="size-5" />
        </a>
        {/* Was im Papierkorb liegt, wird nicht bearbeitet – erst zurückholen. */}
        {document.deletedAt ? null : (
          <button
            onClick={() => setEditing((value) => !value)}
            aria-label={editing ? 'Bearbeiten schliessen' : 'Bearbeiten'}
            aria-pressed={editing}
            title="Bearbeiten"
            className={`grid size-9 shrink-0 place-items-center rounded-lg transition active:bg-black/5 dark:active:bg-white/10 ${
              editing ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <PencilIcon className="size-5" />
          </button>
        )}
      </div>

      {document.deletedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-slate-600 dark:text-slate-300">
            Liegt seit {formatDateTime(document.deletedAt)} im Papierkorb.
          </p>
          <button
            onClick={() => restore.mutate(document.id)}
            disabled={restore.isPending}
            className="min-h-10 rounded-xl bg-brand-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {restore.isPending ? 'Wird zurückgeholt …' : 'Wiederherstellen'}
          </button>
        </div>
      ) : null}

      {/* Zuschneiden erscheint erst im Bearbeitungsmodus – und nie im
          Papierkorb: Was gelöscht ist, wird nicht bearbeitet. */}
      <DocumentPreview
        id={document.id}
        mimeType={document.mimeType}
        title={document.title}
        zuschneidbar={editing && !document.deletedAt}
      />

      {/* Die drei Angaben, die sich im Alltag ändern – direkt hier, ohne den
          Umweg über „Bearbeiten". Gespeichert wird beim Loslassen der Auswahl;
          ein Knopf dafür wäre eine Gelegenheit, es zu vergessen. */}
      <div className={`grid grid-cols-3 gap-2 ${document.deletedAt ? 'hidden' : ''}`}>
        {/* Die Kategorienauswahl kann auch anlegen: Wer hier merkt, dass die
            passende fehlt, soll sie nicht woanders suchen müssen. */}
        <CategorySelect
          categories={categories.data?.categories ?? []}
          value={document.categoryId ?? ''}
          onChange={(value) => update.mutate({ categoryId: value || null })}
        />
        <QuickSelect
          label="Zuständig"
          value={document.assignedTo ?? ''}
          onChange={(value) => update.mutate({ assignedTo: value || null })}
          options={[
            { value: '', label: 'beide' },
            ...(users.data?.users ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
        />
        <QuickSelect
          label="Status"
          value={document.status}
          onChange={(value) => update.mutate({ status: value as DocumentStatus })}
          options={DOCUMENT_STATUSES.map((status) => ({
            value: status,
            label: DOCUMENT_STATUS_LABELS[status],
          }))}
        />
      </div>

      {editing ? (
        <EditForm
          key={document.id}
          document={document}
          onSave={(changes) => update.mutateAsync(changes).then(() => undefined)}
        />
      ) : (
        // Kategorie und Zuständigkeit stehen nicht mehr hier: Sie sind eine
        // Zeile weiter oben zu sehen – und dort auch zu ändern.
        <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          <Row label="Datum" value={document.docDate} />
          <Row label="Fällig" value={document.dueDate ?? '–'} />
          <Row
            label="Betrag"
            value={document.amountCents !== null ? `CHF ${formatAmount(document.amountCents)}` : '–'}
          />
          <Row label="Absender" value={document.vendor ?? '–'} />
          <Row label="Notiz" value={document.notes ?? '–'} />
          <Row label="Datei" value={formatFileSize(document.sizeBytes)} />
        </dl>
      )}

      <RecognisedText
        status={document.ocrStatus}
        text={document.ocrText}
        method={document.ocrMethod}
        error={document.ocrError}
        onRetry={() => retryOcr.mutate()}
        retrying={retryOcr.isPending}
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Verlauf</h2>
        <ol className="space-y-2">
          {document.activity.map((entry) => (
            <li key={entry.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700" />
              <span className="min-w-0">
                <span className="block">{entry.summary}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {entry.userName} · {formatDateTime(entry.createdAt)}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {uploader ? (
          <p className="mt-3 text-xs text-slate-400">
            Hochgeladen von {uploader.name} am {formatDateTime(document.uploadedAt)}
          </p>
        ) : null}
      </section>

      {document.deletedAt ? null : (
        <button
          onClick={() => void handleDelete()}
          className="w-full py-3 text-sm font-medium text-red-600 dark:text-red-400"
        >
          In den Papierkorb
        </button>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Ein Auswahlfeld, das sofort speichert. */
function QuickSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
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

interface EditFormProps {
  document: {
    title: string
    docDate: string
    dueDate: string | null
    amountCents: number | null
    vendor: string | null
    notes: string | null
  }
  onSave: (changes: UpdateDocumentInput) => Promise<void>
}

/**
 * Die übrigen Angaben – Titel, Daten, Betrag, Absender, Notiz.
 *
 * Ohne Speichern-Knopf: Geschrieben wird kurz nach dem letzten Tastendruck und
 * noch einmal beim Schliessen, wie bei den Notizen. Kategorie, Zuständigkeit
 * und Status stehen nicht mehr hier – sie sind oben in einem Griff erreichbar.
 */
function EditForm({ document, onSave }: EditFormProps) {
  const [form, setForm] = useState(() => ({
    title: document.title,
    docDate: document.docDate,
    dueDate: document.dueDate ?? '',
    amount: document.amountCents !== null ? (document.amountCents / 100).toFixed(2) : '',
    vendor: document.vendor ?? '',
    notes: document.notes ?? '',
  }))

  // Ein Titel darf nicht leer werden – der Server lehnte das ab, und die
  // Änderung wäre still verloren.
  const lesbar = form.title.trim() !== '' && (form.amount.trim() === '' || parseAmountToCents(form.amount) !== null)

  const autosave = useAutosave(
    form,
    async (stand) => {
      await onSave({
        title: stand.title.trim(),
        docDate: stand.docDate,
        dueDate: stand.dueDate || null,
        amountCents: stand.amount.trim() === '' ? null : parseAmountToCents(stand.amount),
        vendor: stand.vendor || null,
        notes: stand.notes || null,
      })
    },
    {
      savable: (stand) =>
        stand.title.trim() !== '' &&
        (stand.amount.trim() === '' || parseAmountToCents(stand.amount) !== null),
    },
  )

  return (
    <form
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      onSubmit={(event) => event.preventDefault()}
    >
      <p className="text-right text-xs text-slate-500 dark:text-slate-400">
        {saveStateLabel(autosave.state, lesbar ? undefined : 'Titel oder Betrag prüfen')}
      </p>

      <Labelled label="Titel">
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          className={inputClass}
          required
        />
      </Labelled>

      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Datum">
          <input
            type="date"
            value={form.docDate}
            onChange={(event) => setForm({ ...form, docDate: event.target.value })}
            className={inputClass}
            required
          />
        </Labelled>
        <Labelled label="Fällig">
          <input
            type="date"
            value={form.dueDate}
            onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            className={inputClass}
          />
        </Labelled>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Betrag CHF">
          <input
            // 'decimal' statt 'numeric': blendet auf dem Handy die Tastatur
            // mit Komma ein.
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
            placeholder="0.00"
            className={inputClass}
          />
        </Labelled>
        <Labelled label="Absender">
          <input
            value={form.vendor}
            onChange={(event) => setForm({ ...form, vendor: event.target.value })}
            className={inputClass}
          />
        </Labelled>
      </div>

      <Labelled label="Notiz">
        <textarea
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          rows={3}
          className={inputClass}
        />
      </Labelled>
    </form>
  )
}

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-950'

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}

/**
 * Der erkannte Text, eingeklappt.
 *
 * Ausgeklappt braucht er den halben Bildschirm, und im Alltag will man ihn
 * fast nie sehen – er arbeitet unsichtbar in der Suche. Sichtbar sein muss
 * nur, ob die Erkennung gelaufen ist, und im Fehlerfall der Weg zurück.
 */
function RecognisedText({
  status,
  text,
  method,
  error,
  onRetry,
  retrying,
}: {
  status: DocumentDetail['ocrStatus']
  text: string | null
  method: string | null
  error: string | null
  onRetry: () => void
  retrying: boolean
}) {
  if (status === 'pending' || status === 'running') {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="size-2 animate-pulse rounded-full bg-slate-400" aria-hidden="true" />
        Der Text wird gerade gelesen. Danach ist das Dokument über seinen Inhalt auffindbar.
      </p>
    )
  }

  if (status === 'failed') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/50">
        <p className="font-medium text-amber-900 dark:text-amber-200">
          Texterkennung fehlgeschlagen
        </p>
        <p className="mt-1 text-amber-800 dark:text-amber-300">
          Das Dokument ist gespeichert, aber nicht über seinen Inhalt auffindbar.
        </p>
        {error ? (
          <p className="mt-2 break-words font-mono text-xs text-amber-700 dark:text-amber-400">
            {error}
          </p>
        ) : null}
        <button
          onClick={onRetry}
          disabled={retrying}
          className="mt-3 text-sm font-medium text-amber-900 underline disabled:opacity-60 dark:text-amber-200"
        >
          {retrying ? 'Wird erneut versucht …' : 'Nochmals versuchen'}
        </button>
      </div>
    )
  }

  if (!text) return null

  return (
    <details className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Erkannter Text{' '}
        <span className="font-normal text-slate-500 dark:text-slate-400">
          {method === 'textebene' ? 'aus dem PDF gelesen' : 'per Texterkennung'} ·{' '}
          {text.length.toLocaleString('de-CH')} Zeichen
        </span>
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 px-4 py-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-400">
        {text}
      </pre>
    </details>
  )
}

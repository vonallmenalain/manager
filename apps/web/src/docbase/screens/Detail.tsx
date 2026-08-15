import { formatFileSize, type DocumentDetail } from '@manager/shared'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { CategorySelect } from '../../components/CategoryPicker'
import { DocumentPreview } from '../../components/DocumentPreview'
import { DownloadIcon, PencilIcon } from '../../components/icons'
import { saveStateLabel, useAutosave } from '../../lib/autosave'
import {
  fileUrl,
  useCategories,
  useDeleteDocument,
  useDocument,
  useRetryOcr,
  useUpdateDocument,
} from '../../lib/documents'

/**
 * Ein Dokument der Sammlung.
 *
 * Deutlich karger als im Haushalt, und das ist der Punkt: Eine Studie hat
 * keinen Absender, keinen Betrag, keine Fälligkeit und niemanden, der
 * zuständig wäre. Was bleibt, ist die Frage „was ist das, wann ist es von wann
 * und wo gehört es hin" – dazu der erkannte Text, über den es wiederzufinden
 * ist.
 */
export function Detail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const query = useDocument(id)
  const update = useUpdateDocument(id ?? '')
  const remove = useDeleteDocument()
  const retryOcr = useRetryOcr(id ?? '')
  const categories = useCategories('docbase')

  const [editing, setEditing] = useState(false)

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
  }

  const document = query.data?.document
  if (!document) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">Nicht gefunden</p>
        <button
          onClick={() => navigate('/')}
          className="mt-3 text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
        >
          Zurück zur Sammlung
        </button>
      </div>
    )
  }

  async function handleDelete() {
    if (!id) return
    if (!window.confirm(`„${document?.title}" löschen?`)) return
    await remove.mutateAsync(id)
    navigate('/')
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/')}
        className="-ml-1 flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-400"
      >
        <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="m14 6-6 6 6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Sammlung
      </button>

      <div className="flex items-start gap-2">
        <h1 className="min-w-0 flex-1 text-xl font-bold">{document.title}</h1>
        <a
          href={fileUrl(document.id, true)}
          aria-label="Herunterladen"
          title="Herunterladen"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition active:bg-black/5 dark:text-slate-400 dark:active:bg-white/10"
        >
          <DownloadIcon className="size-5" />
        </a>
        <button
          onClick={() => setEditing((value) => !value)}
          aria-label={editing ? 'Bearbeiten schliessen' : 'Bearbeiten'}
          aria-pressed={editing}
          title="Bearbeiten"
          className={`grid size-9 shrink-0 place-items-center rounded-lg transition active:bg-black/5 dark:active:bg-white/10 ${
            editing ? 'text-teal-700 dark:text-teal-300' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <PencilIcon className="size-5" />
        </button>
      </div>

      {/* Zuschneiden erscheint erst im Bearbeitungsmodus: Es ersetzt die Datei,
          und das ist nichts, was man beim blossen Nachschlagen antippt. */}
      <DocumentPreview
        id={document.id}
        mimeType={document.mimeType}
        title={document.title}
        zuschneidbar={editing}
        akzent="bg-teal-700"
      />

      {/* Die einzige Angabe, die sich im Alltag ändert – und sie speichert
          beim Loslassen, ohne Umweg über „Bearbeiten". */}
      <CategorySelect
        bereich="docbase"
        categories={categories.data?.categories ?? []}
        value={document.categoryId ?? ''}
        onChange={(value) => update.mutate({ categoryId: value || null })}
      />

      {editing ? (
        <EditForm
          key={document.id}
          document={document}
          onSave={(changes) => update.mutateAsync(changes).then(() => undefined)}
        />
      ) : (
        <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          <Row label="Datum" value={document.docDate} />
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

      <p className="text-xs text-slate-400">Abgelegt am {formatDateTime(document.uploadedAt)}</p>

      <button
        onClick={() => void handleDelete()}
        className="w-full py-3 text-sm font-medium text-red-600 dark:text-red-400"
      >
        Löschen
      </button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Titel, Datum und Notiz – mehr gibt es hier nicht zu ändern.
 *
 * Die Notiz bleibt, obwohl Betrag und Absender weggefallen sind: Sie fliesst
 * in die Suche ein und ist damit der Ort für das, was im Dokument selbst nicht
 * steht – „Vorlesung 3. Semester", „Quelle: NEJM 2024".
 */
function EditForm({
  document,
  onSave,
}: {
  document: { title: string; docDate: string; notes: string | null }
  onSave: (changes: { title: string; docDate: string; notes: string | null }) => Promise<void>
}) {
  const [form, setForm] = useState(() => ({
    title: document.title,
    docDate: document.docDate,
    notes: document.notes ?? '',
  }))

  const lesbar = form.title.trim() !== ''

  const autosave = useAutosave(
    form,
    async (stand) => {
      await onSave({
        title: stand.title.trim(),
        docDate: stand.docDate,
        notes: stand.notes || null,
      })
    },
    { savable: (stand) => stand.title.trim() !== '' },
  )

  return (
    <form
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      onSubmit={(event) => event.preventDefault()}
    >
      <p className="text-right text-xs text-slate-500 dark:text-slate-400">
        {saveStateLabel(autosave.state, lesbar ? undefined : 'Titel fehlt')}
      </p>

      <Labelled label="Titel">
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          className={inputClass}
          required
        />
      </Labelled>

      <Labelled label="Datum">
        <input
          type="date"
          value={form.docDate}
          onChange={(event) => setForm({ ...form, docDate: event.target.value })}
          className={inputClass}
          required
        />
      </Labelled>

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
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/40 dark:border-slate-700 dark:bg-slate-950'

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}

/** Wie im Manager: eingeklappt, sichtbar ist nur, ob die Erkennung lief. */
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

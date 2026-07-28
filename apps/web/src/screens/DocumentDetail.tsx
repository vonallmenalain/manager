import {
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  formatAmount,
  formatFileSize,
  parseAmountToCents,
  UNCATEGORIZED_LABEL,
  type DocumentDetail,
  type DocumentStatus,
  type UpdateDocumentInput,
} from '@manager/shared'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { Button } from '../components/Button'
import { DocumentPreview } from '../components/DocumentPreview'
import { StatusBadge } from '../components/StatusBadge'
import {
  fileUrl,
  useCategories,
  useDeleteDocument,
  useDocument,
  useHouseholdUsers,
  useRetryOcr,
  useUpdateDocument,
} from '../lib/documents'

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const query = useDocument(id)
  const update = useUpdateDocument(id ?? '')
  const remove = useDeleteDocument()
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

  const category = categories.data?.categories.find((c) => c.id === document.categoryId)
  const assignee = users.data?.users.find((u) => u.id === document.assignedTo)
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

      <div className="flex items-start gap-3">
        <h1 className="flex-1 text-xl font-bold">{document.title}</h1>
        <StatusBadge status={document.status} />
      </div>

      <DocumentPreview id={document.id} mimeType={document.mimeType} title={document.title} />

      <div className="flex gap-2">
        <a
          href={fileUrl(document.id, true)}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold transition active:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
        >
          Herunterladen
        </a>
        <button
          onClick={() => setEditing((value) => !value)}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-brand-800 px-4 text-sm font-semibold text-white transition active:bg-brand-900"
        >
          {editing ? 'Schliessen' : 'Bearbeiten'}
        </button>
      </div>

      {editing ? (
        <EditForm
          document={document}
          categories={categories.data?.categories ?? []}
          users={users.data?.users ?? []}
          saving={update.isPending}
          onSave={async (changes) => {
            await update.mutateAsync(changes)
            setEditing(false)
          }}
        />
      ) : (
        <dl className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          <Row label="Datum" value={document.docDate} />
          <Row label="Kategorie" value={category?.name ?? UNCATEGORIZED_LABEL} />
          <Row label="Zuständig" value={assignee?.name ?? 'beide'} />
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

      <button
        onClick={() => void handleDelete()}
        className="w-full py-3 text-sm font-medium text-red-600 dark:text-red-400"
      >
        In den Papierkorb
      </button>
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

interface EditFormProps {
  document: {
    title: string
    status: DocumentStatus
    categoryId: string | null
    assignedTo: string | null
    docDate: string
    dueDate: string | null
    amountCents: number | null
    vendor: string | null
    notes: string | null
  }
  categories: { id: string; name: string }[]
  users: { id: string; name: string }[]
  saving: boolean
  onSave: (changes: UpdateDocumentInput) => Promise<void>
}

function EditForm({ document, categories, users, saving, onSave }: EditFormProps) {
  const [form, setForm] = useState({
    title: document.title,
    status: document.status,
    categoryId: document.categoryId ?? '',
    assignedTo: document.assignedTo ?? '',
    docDate: document.docDate,
    dueDate: document.dueDate ?? '',
    amount: document.amountCents !== null ? (document.amountCents / 100).toFixed(2) : '',
    vendor: document.vendor ?? '',
    notes: document.notes ?? '',
  })

  useEffect(() => {
    setForm({
      title: document.title,
      status: document.status,
      categoryId: document.categoryId ?? '',
      assignedTo: document.assignedTo ?? '',
      docDate: document.docDate,
      dueDate: document.dueDate ?? '',
      amount: document.amountCents !== null ? (document.amountCents / 100).toFixed(2) : '',
      vendor: document.vendor ?? '',
      notes: document.notes ?? '',
    })
  }, [document])

  return (
    <form
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      onSubmit={(event) => {
        event.preventDefault()
        void onSave({
          title: form.title,
          status: form.status,
          categoryId: form.categoryId || null,
          assignedTo: form.assignedTo || null,
          docDate: form.docDate,
          dueDate: form.dueDate || null,
          amountCents: parseAmountToCents(form.amount),
          vendor: form.vendor || null,
          notes: form.notes || null,
        })
      }}
    >
      <Labelled label="Titel">
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          className={inputClass}
          required
        />
      </Labelled>

      <Labelled label="Status">
        <select
          value={form.status}
          onChange={(event) => setForm({ ...form, status: event.target.value as DocumentStatus })}
          className={inputClass}
        >
          {DOCUMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {DOCUMENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </Labelled>

      <Labelled label="Kategorie">
        <select
          value={form.categoryId}
          onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
          className={inputClass}
        >
          <option value="">{UNCATEGORIZED_LABEL}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Labelled>

      <Labelled label="Zuständig">
        <select
          value={form.assignedTo}
          onChange={(event) => setForm({ ...form, assignedTo: event.target.value })}
          className={inputClass}
        >
          <option value="">beide</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
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

      <Button type="submit" loading={saving}>
        Speichern
      </Button>
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

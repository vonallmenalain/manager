import { DOCUMENT_STATUS_LABELS, type DocumentStatus } from '@manager/shared'

const STYLES: Record<DocumentStatus, string> = {
  // Offen ist bewusst kein Rot: Ein Stapel unerledigter Post ist der
  // Normalzustand, keine Störung.
  offen: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  in_arbeit: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  erledigt: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  archiviert: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {DOCUMENT_STATUS_LABELS[status]}
    </span>
  )
}

import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUSES,
  UNASSIGNED_LABEL,
  type Bereich,
  type DocumentStatus,
} from '@manager/shared'

import { CategorySelect } from './CategoryPicker'
import { TraySelect, type TrayField } from './PageTray'
import type { AblageAngaben } from '../lib/ablegen'
import { useCategories, useHouseholdUsers } from '../lib/documents'

/**
 * Die Angaben unter dem Titel, bevor ein Dokument abgelegt wird: Kategorie,
 * Zuständigkeit, Status, Fälligkeit und Notiz.
 *
 * Dieselben Felder nach dem Teilen und vor dem Hochladen über „Datei wählen",
 * damit sich Ablegen überall gleich anfühlt. Wer in diesem Moment weiss, dass
 * die Rechnung pendent ist und wen sie angeht, soll es jetzt sagen können –
 * nicht erst, nachdem er das Dokument in der Liste wiedergefunden hat. Der
 * Titel gehört nicht dazu: Nach dem Teilen hat jede Datei ihren eigenen, und
 * wie er dasteht, entscheidet die Seite drumherum.
 */
export function AblageFelder({
  angaben,
  onChange,
  felder,
  faellig,
  bereich,
  disabled,
}: {
  angaben: Omit<AblageAngaben, 'titel'>
  onChange: (changes: Partial<Omit<AblageAngaben, 'titel'>>) => void
  /** Welche Auswahlfelder erscheinen – in der DocBase nur die Kategorie. */
  felder: readonly TrayField[]
  /** Ob „Fällig" erscheint – nur der Haushalt kennt Fälligkeiten. */
  faellig: boolean
  bereich: Bereich
  disabled: boolean
}) {
  // Kategorien und Personen ändern sich praktisch nie und liegen deshalb meist
  // schon im Zwischenspeicher – hier entsteht dadurch keine neue Anfrage.
  const categories = useCategories(bereich)
  const users = useHouseholdUsers()

  return (
    <>
      <div className={`grid gap-2 ${felder.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {felder.includes('kategorie') ? (
          <div className={felder.length > 1 ? 'col-span-2' : ''}>
            <CategorySelect
              categories={categories.data?.categories ?? []}
              bereich={bereich}
              value={angaben.categoryId ?? ''}
              disabled={disabled}
              onChange={(value) => onChange({ categoryId: value || null })}
            />
          </div>
        ) : null}
        {felder.includes('zustaendig') ? (
          <TraySelect
            label="Zuständig"
            value={angaben.assignedTo ?? ''}
            disabled={disabled}
            onChange={(value) => onChange({ assignedTo: value || null })}
            options={[
              { value: '', label: UNASSIGNED_LABEL },
              ...(users.data?.users ?? []).map((user) => ({ value: user.id, label: user.name })),
            ]}
          />
        ) : null}
        {felder.includes('status') ? (
          <TraySelect
            label="Status"
            value={angaben.status}
            disabled={disabled}
            onChange={(value) => onChange({ status: value as DocumentStatus })}
            options={DOCUMENT_STATUSES.map((status) => ({
              value: status,
              label: DOCUMENT_STATUS_LABELS[status],
            }))}
          />
        ) : null}
        {faellig ? (
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Fällig
            </span>
            <input
              type="date"
              value={angaben.faellig}
              onChange={(event) => onChange({ faellig: event.target.value })}
              disabled={disabled}
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        ) : null}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
          Notiz
        </span>
        <textarea
          value={angaben.notiz}
          onChange={(event) => onChange({ notiz: event.target.value })}
          disabled={disabled}
          rows={2}
          maxLength={2000}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
        />
      </label>
    </>
  )
}

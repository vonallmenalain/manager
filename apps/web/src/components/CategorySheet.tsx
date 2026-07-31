import { DEFAULT_BEREICH, type Bereich, type Category } from '@manager/shared'
import { useState, type FormEvent } from 'react'

import { Button } from './Button'
import { Field } from './Field'
import { Modal, ModalCloseButton } from './Modal'
import { ApiRequestError } from '../lib/api'
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
} from '../lib/documents'

/**
 * Die Kategorien des Haushalts, an einem Ort.
 *
 * Anlegen kann hier jeder – dieselbe Möglichkeit gibt es in jeder Auswahl,
 * mitten im Ablegen. Umbenennen und Löschen sieht nur der Verwalter: Beides
 * greift in die Ordnerstruktur auf dem NAS ein und betrifft die Dokumente der
 * anderen Person mit. Der Server prüft dasselbe noch einmal; ein
 * ausgeblendeter Knopf ist keine Sperre.
 */
export function CategorySheet({
  isAdmin,
  onClose,
  bereich = DEFAULT_BEREICH,
}: {
  isAdmin: boolean
  onClose: () => void
  bereich?: Bereich
}) {
  const categories = useCategories(bereich)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <Modal
      onClose={onClose}
      label="Kategorien"
      header={
        <>
          <span className="text-sm font-semibold">Kategorien</span>
          <ModalCloseButton onClick={onClose} label="Fenster schliessen" />
        </>
      }
    >
      {notice ? (
        <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          {notice}
        </p>
      ) : null}

      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {(categories.data?.categories ?? []).map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            isAdmin={isAdmin}
            onNotice={setNotice}
          />
        ))}
      </ul>

      {categories.isSuccess && categories.data.categories.length === 0 ? (
        <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
          Noch keine Kategorie. Unsortiert geht auch – aber gesucht ist es schneller mit.
        </p>
      ) : null}

      <AddCategoryForm bereich={bereich} />
    </Modal>
  )
}

function CategoryRow({
  category,
  isAdmin,
  onNotice,
}: {
  category: Category
  isAdmin: boolean
  onNotice: (message: string) => void
}) {
  const [name, setName] = useState<string | null>(null)
  const rename = useRenameCategory()
  const remove = useDeleteCategory()
  const error = rename.error instanceof ApiRequestError ? rename.error : null

  function save(event: FormEvent) {
    event.preventDefault()
    const gewuenscht = (name ?? '').trim()
    if (!gewuenscht) return
    if (gewuenscht === category.name) {
      setName(null)
      return
    }
    rename.mutate({ id: category.id, name: gewuenscht }, { onSuccess: () => setName(null) })
  }

  function handleDelete() {
    // Harte Rückfrage: Betroffen ist nicht nur die Zeile in der Liste, sondern
    // jedes Dokument darin – und auf dem NAS ein ganzer Ordner.
    if (
      !window.confirm(
        `Kategorie „${category.name}" löschen? Die Dokumente darin bleiben erhalten und werden unsortiert.`,
      )
    ) {
      return
    }

    remove.mutate(category.id, {
      onSuccess: ({ unsorted }) => {
        onNotice(
          unsorted === 0
            ? `„${category.name}" gelöscht.`
            : `„${category.name}" gelöscht – ${unsorted} ${
                unsorted === 1 ? 'Dokument ist' : 'Dokumente sind'
              } jetzt unsortiert.`,
        )
      },
    })
  }

  if (name !== null) {
    return (
      <li className="py-2">
        <form onSubmit={save} className="space-y-2" noValidate>
          <Field
            label={`„${category.name}" umbenennen`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            autoFocus
            error={error?.fields.name}
          />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setName(null)}>
              Abbrechen
            </Button>
            <Button type="submit" loading={rename.isPending}>
              Speichern
            </Button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="flex min-h-12 items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
      {isAdmin ? (
        <>
          <RowButton label={`„${category.name}" umbenennen`} onClick={() => setName(category.name)}>
            <path d="M4 20h4l10-10-4-4L4 16v4Z" />
            <path d="m14.5 5.5 4 4" />
          </RowButton>
          {/* Bewusst nicht rot: In einer Liste stünde bei jeder Zeile ein
              Warnzeichen, und fünf davon untereinander warnen vor nichts mehr.
              Das Gewicht trägt die Rückfrage, nicht die Farbe. */}
          <RowButton
            label={`„${category.name}" löschen`}
            onClick={handleDelete}
            disabled={remove.isPending}
          >
            <path d="M5 7h14M10 7V5h4v2m-7 0 .8 12h8.4L17 7" />
          </RowButton>
        </>
      ) : null}
    </li>
  )
}

function RowButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-11 min-h-11 shrink-0 place-items-center rounded-xl text-slate-500 transition active:bg-black/5 disabled:opacity-40 dark:text-slate-400 dark:active:bg-white/10"
    >
      <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </g>
      </svg>
    </button>
  )
}

/** Anlegen darf jeder – deshalb steht dieses Feld ohne Bedingung darunter. */
function AddCategoryForm({ bereich }: { bereich: Bereich }) {
  const [name, setName] = useState('')
  const create = useCreateCategory(bereich)
  const error = create.error instanceof ApiRequestError ? create.error : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate(name, { onSuccess: () => setName('') })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
      noValidate
    >
      <Field
        label="Neue Kategorie"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={40}
        autoCapitalize="sentences"
        enterKeyHint="done"
        placeholder="z. B. Versicherungen"
        error={error?.fields.name}
      />
      {error && Object.keys(error.fields).length === 0 ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
      ) : null}
      <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
        Hinzufügen
      </Button>
    </form>
  )
}

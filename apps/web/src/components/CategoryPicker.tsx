import {
  DEFAULT_BEREICH,
  groupCategories,
  UNCATEGORIZED_LABEL,
  type Bereich,
  type Category,
} from '@manager/shared'
import { useState, type FormEvent } from 'react'

import { Button } from './Button'
import { Field } from './Field'
import { Modal, ModalCloseButton } from './Modal'
import { ApiRequestError } from '../lib/api'
import { useCreateCategory } from '../lib/documents'

/**
 * Der Wert des letzten Eintrags in der Auswahl.
 *
 * Kein Wert, den eine Kategorie je haben kann: Kennungen sind UUIDs. Er steht
 * nur einen Wimpernschlag im Auswahlfeld – die Auswahl ist gesteuert, springt
 * also sofort auf das Bisherige zurück, während das Fenster aufgeht.
 */
const NEW_CATEGORY = '__neue-kategorie__'

/** Wie eine Unterkategorie in der Auswahl eingerückt wird. */
const INDENT = '   '

/**
 * Kategorie wählen – oder auf der Stelle eine anlegen.
 *
 * Der letzte Eintrag heisst „Neue Kategorie …". Das ist der eigentliche Punkt:
 * Wer die Post gerade in der Hand hat, merkt genau dann, dass die passende
 * Schublade fehlt. Ohne diesen Eintrag hiesse es, das Ablegen abzubrechen,
 * die Kategorie woanders anzulegen und von vorn zu beginnen – und meistens
 * bliebe das Dokument dann einfach unsortiert.
 *
 * Haupt- und Unterkategorien stehen in einer Liste, die Unterkategorien
 * eingerückt. Bewusst kein <optgroup>: Dessen Überschrift ist nicht wählbar,
 * und ein Dokument muss auch direkt in „Notfall" gehören können, ohne in eine
 * seiner Unterschubladen zu passen.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  label = 'Kategorie',
  disabled = false,
  bereich = DEFAULT_BEREICH,
}: {
  categories: readonly Category[]
  /** Leer heisst „Unsortiert" – das Fehlen einer Zuordnung, keine Kategorie. */
  value: string
  onChange: (value: string) => void
  label?: string
  disabled?: boolean
  /** In welcher Sammlung eine neu angelegte Kategorie entsteht. */
  bereich?: Bereich
}) {
  const [creating, setCreating] = useState(false)
  const gruppen = groupCategories(categories)

  return (
    <>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </span>
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === NEW_CATEGORY) setCreating(true)
            else onChange(event.target.value)
          }}
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">{UNCATEGORIZED_LABEL}</option>
          {gruppen.flatMap((gruppe) => [
            <option key={gruppe.category.id} value={gruppe.category.id}>
              {gruppe.category.name}
            </option>,
            ...gruppe.children.map((child) => (
              <option key={child.id} value={child.id}>
                {`${INDENT}${child.name}`}
              </option>
            )),
          ])}
          <option value={NEW_CATEGORY}>+ Neue Kategorie …</option>
        </select>
      </label>

      {creating ? (
        <NewCategoryDialog
          bereich={bereich}
          categories={categories}
          // Wer gerade in „Notfall" steht und etwas anlegt, meint fast immer
          // eine Unterkategorie davon – das Feld ist trotzdem änderbar.
          defaultParentId={parentSuggestion(categories, value)}
          onClose={() => setCreating(false)}
          onCreated={(category) => {
            // Direkt auswählen: Wer sie gerade angelegt hat, will sie auch
            // nutzen – sonst stünde sie in der Liste und das Dokument bliebe
            // unsortiert.
            onChange(category.id)
            setCreating(false)
          }}
        />
      ) : null}
    </>
  )
}

/**
 * Unter welcher Hauptkategorie eine neue Kategorie vorgeschlagen wird.
 *
 * Steht die Auswahl auf einer Hauptkategorie, ist sie es. Steht sie auf einer
 * Unterkategorie, deren Hauptkategorie – eine dritte Ebene gibt es nicht.
 */
function parentSuggestion(
  categories: readonly Category[],
  selectedId: string,
): string | null {
  const selected = categories.find((category) => category.id === selectedId)
  if (!selected) return null
  return selected.parentId ?? selected.id
}

/**
 * Das Fenster hinter „Neue Kategorie".
 *
 * Bewusst ein eigenes Fenster und kein Eingabefeld, das sich in der Liste
 * aufklappt: Eine Kategorie anzulegen betrifft den ganzen Haushalt und ist
 * nichts, was nebenbei passieren sollte, während man eigentlich filtert.
 */
export function NewCategoryDialog({
  onClose,
  onCreated,
  bereich = DEFAULT_BEREICH,
  categories = [],
  defaultParentId = null,
}: {
  onClose: () => void
  onCreated: (category: Category) => void
  bereich?: Bereich
  /**
   * Die bestehenden Kategorien – nur, um daraus die möglichen
   * Hauptkategorien anzubieten. Ohne sie entsteht immer eine Hauptkategorie.
   */
  categories?: readonly Category[]
  defaultParentId?: string | null
}) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string>(defaultParentId ?? '')
  const create = useCreateCategory(bereich)
  const error = create.error instanceof ApiRequestError ? create.error : null

  // Nur Hauptkategorien kommen als übergeordnete infrage: zwei Ebenen, nicht drei.
  const hauptkategorien = groupCategories(categories).map((gruppe) => gruppe.category)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate(
      { name, parentId: parentId || null },
      { onSuccess: ({ category }) => onCreated(category) },
    )
  }

  return (
    <Modal
      onClose={onClose}
      label="Neue Kategorie"
      header={
        <>
          <span className="text-sm font-semibold">Neue Kategorie</span>
          <ModalCloseButton onClick={onClose} label="Fenster schliessen" />
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <Field
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          autoCapitalize="sentences"
          enterKeyHint="done"
          autoFocus
          required
          hint="Wird für alle sichtbar und ist zugleich der Ordnername in der Ablage."
          error={error?.fields.name}
        />

        {hauptkategorien.length > 0 ? (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Gehört zu
            </span>
            <select
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">Eigene Hauptkategorie</option>
              {hauptkategorien.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Eine Unterkategorie liegt in der Ablage im Ordner ihrer Hauptkategorie.
            </span>
          </label>
        ) : null}

        {error?.fields.parentId ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error.fields.parentId}</p>
        ) : null}
        {error && Object.keys(error.fields).length === 0 ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error.message}</p>
        ) : null}
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
          Hinzufügen
        </Button>
      </form>
    </Modal>
  )
}

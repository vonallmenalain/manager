import { UNCATEGORIZED_LABEL, type Category } from '@manager/shared'
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

/**
 * Kategorie wählen – oder auf der Stelle eine anlegen.
 *
 * Der letzte Eintrag heisst „Neue Kategorie …". Das ist der eigentliche Punkt:
 * Wer die Post gerade in der Hand hat, merkt genau dann, dass die passende
 * Schublade fehlt. Ohne diesen Eintrag hiesse es, das Ablegen abzubrechen,
 * die Kategorie woanders anzulegen und von vorn zu beginnen – und meistens
 * bliebe das Dokument dann einfach unsortiert.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  label = 'Kategorie',
  disabled = false,
}: {
  categories: readonly Category[]
  /** Leer heisst „Unsortiert" – das Fehlen einer Zuordnung, keine Kategorie. */
  value: string
  onChange: (value: string) => void
  label?: string
  disabled?: boolean
}) {
  const [creating, setCreating] = useState(false)

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
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
          <option value={NEW_CATEGORY}>+ Neue Kategorie …</option>
        </select>
      </label>

      {creating ? (
        <NewCategoryDialog
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
 * Das Fenster hinter „Neue Kategorie".
 *
 * Bewusst ein eigenes Fenster und kein Eingabefeld, das sich in der Liste
 * aufklappt: Eine Kategorie anzulegen betrifft den ganzen Haushalt und ist
 * nichts, was nebenbei passieren sollte, während man eigentlich filtert.
 */
export function NewCategoryDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (category: Category) => void
}) {
  const [name, setName] = useState('')
  const create = useCreateCategory()
  const error = create.error instanceof ApiRequestError ? create.error : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate(name, { onSuccess: ({ category }) => onCreated(category) })
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

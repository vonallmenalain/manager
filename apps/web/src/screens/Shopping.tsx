import {
  catchAllSection,
  type ShoppingItem,
  type ShoppingSection,
  type UpdateShoppingItemInput,
} from '@manager/shared'
import { type FormEvent, useState } from 'react'

import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Modal, ModalCloseButton } from '../components/Modal'
import { ApiRequestError } from '../lib/api'
import { erledigtAm, nachAbteilung } from '../lib/einkauf'
import {
  useAddShoppingItem,
  useAddShoppingSection,
  useClearDoneShoppingItems,
  useDeleteShoppingItem,
  useDeleteShoppingSection,
  useRenameShoppingSection,
  useReorderShoppingSections,
  useShoppingList,
  useShoppingSections,
  useUpdateShoppingItem,
} from '../lib/household'
import { useHouseholdUsers } from '../lib/documents'

export function Shopping() {
  const list = useShoppingList()
  const sections = useShoppingSections()
  const users = useHouseholdUsers()
  const clearDone = useClearDoneShoppingItems()
  const [abteilungen, setAbteilungen] = useState(false)

  const items = list.data?.items ?? []
  const open = items.filter((item) => !item.done)
  const done = items.filter((item) => item.done)

  const alleAbteilungen = sections.data?.sections ?? []
  const bySection = nachAbteilung(open, alleAbteilungen)

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Einkauf</h1>
        <div className="flex items-baseline gap-3">
          {open.length > 0 ? (
            <span className="text-sm text-slate-500 dark:text-slate-400">{open.length} offen</span>
          ) : null}
          <button
            onClick={() => setAbteilungen(true)}
            className="text-sm font-medium text-brand-700 dark:text-brand-300"
          >
            Abteilungen
          </button>
        </div>
      </div>

      {list.isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Die Liste ist leer. Unten eintippen und mit Enter hinzufügen.
        </p>
      ) : (
        <>
          {bySection.map(({ key, title, items: sectionItems }) => (
            <section key={key}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {title}
              </h2>
              <ul className="space-y-1.5">
                {sectionItems.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    sections={alleAbteilungen}
                    users={users.data?.users ?? []}
                  />
                ))}
              </ul>
            </section>
          ))}

          {done.length > 0 ? (
            <section>
              <div className="mb-1.5 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Erledigt ({done.length})
                </h2>
                <button
                  onClick={() => clearDone.mutate(undefined)}
                  className="text-sm font-medium text-slate-500 dark:text-slate-400"
                >
                  Aufräumen
                </button>
              </div>
              <ul className="space-y-1.5">
                {done.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    sections={alleAbteilungen}
                    users={users.data?.users ?? []}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <AddField />

      {abteilungen ? (
        <SectionSheet sections={alleAbteilungen} onClose={() => setAbteilungen(false)} />
      ) : null}
    </div>
  )
}

function Row({
  item,
  sections,
  users,
}: {
  item: ShoppingItem
  sections: readonly ShoppingSection[]
  users: { id: string; name: string }[]
}) {
  const update = useUpdateShoppingItem()
  const remove = useDeleteShoppingItem()
  const [editing, setEditing] = useState(false)

  const doneByName = item.doneBy ? users.find((u) => u.id === item.doneBy)?.name : null
  const zeitpunkt = item.done && item.doneAt ? erledigtAm(item.doneAt) : ''

  return (
    <li className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
      {/* Die ganze Zeile ist die Trefferfläche – im Laden trifft man kein
          kleines Kästchen. */}
      <button
        onClick={() => update.mutate({ id: item.id, changes: { done: !item.done } })}
        className="flex min-h-12 flex-1 items-center gap-3 text-left"
      >
        <span
          className={`grid size-6 shrink-0 place-items-center rounded-full border-2 transition ${
            item.done
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-slate-300 dark:border-slate-600'
          }`}
          aria-hidden="true"
        >
          {item.done ? (
            <svg className="size-4" viewBox="0 0 24 24" fill="none">
              <path d="m5 12 5 5 9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={item.done ? 'text-slate-400 line-through' : ''}>{item.text}</span>
          {/* „von Annina · gestern 18:40" – wer und wann in einer Zeile, klein
              genug, dass der Eintrag selbst die Zeile behält. */}
          {doneByName || zeitpunkt ? (
            <span className="ml-2 text-xs text-slate-400">
              {[doneByName ? `von ${doneByName}` : '', zeitpunkt].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </span>
      </button>

      <button
        onClick={() => setEditing((value) => !value)}
        className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400"
        aria-label={`„${item.text}“ bearbeiten`}
      >
        ⋯
      </button>

      {editing ? (
        <ItemSheet
          item={item}
          sections={sections}
          onSave={(changes) => update.mutate({ id: item.id, changes })}
          onDelete={() => {
            remove.mutate(item.id)
            setEditing(false)
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </li>
  )
}

/**
 * Ein Eintrag zum Nachbessern: Name und Abteilung.
 *
 * Beides ist dieselbe Handbewegung – „das stimmt so nicht" –, und beides
 * gehört deshalb hinter denselben Griff. Vorher stand hier nur die Abteilung;
 * wer sich vertippt hatte oder „Milch" zu „Vollmilch" präzisieren wollte,
 * musste den Eintrag löschen und neu tippen.
 *
 * Gespeichert wird ohne Knopf: beim Schliessen, beim Enter und beim Wählen
 * einer Abteilung. Letzteres schickt beides in einem Zug – so lernt das
 * Gedächtnis der Liste die Abteilung gleich unter dem neuen Namen.
 */
function ItemSheet({
  item,
  sections,
  onSave,
  onDelete,
  onClose,
}: {
  item: ShoppingItem
  sections: readonly ShoppingSection[]
  onSave: (changes: UpdateShoppingItemInput) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [text, setText] = useState(item.text)
  const [neueAbteilung, setNeueAbteilung] = useState<string | null>(null)
  const anlegen = useAddShoppingSection()
  const fehler = anlegen.error instanceof ApiRequestError ? anlegen.error : null

  /** Der geänderte Name – oder nichts, wenn er stehen geblieben ist. */
  function namensAenderung(): UpdateShoppingItemInput {
    const wert = text.trim()
    // Ein leerer Name wäre kein Eintrag mehr; dann bleibt der alte stehen.
    return wert && wert !== item.text ? { text: wert } : {}
  }

  function schliessen() {
    const changes = namensAenderung()
    if (changes.text) onSave(changes)
    onClose()
  }

  /**
   * Eine fehlende Abteilung mitten im Einsortieren anlegen – und den Eintrag
   * gleich hineinlegen. Wer beim Einordnen merkt, dass die passende Abteilung
   * fehlt, soll nicht erst ein anderes Fenster suchen müssen.
   */
  function abteilungAnlegen(event: FormEvent) {
    event.preventDefault()
    const name = (neueAbteilung ?? '').trim()
    if (!name) return

    anlegen.mutate(name, {
      onSuccess: ({ section }) => {
        onSave({ ...namensAenderung(), sectionId: section.id })
        onClose()
      },
    })
  }

  return (
    <>
      <button
        className="fixed inset-0 z-20 bg-slate-900/30"
        onClick={schliessen}
        aria-label="Schliessen"
      />
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            schliessen()
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Eintrag
            </span>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={120}
              enterKeyHint="done"
              aria-label="Eintrag umbenennen"
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </form>

        <p className="mb-2 mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">
          In welche Abteilung?
        </p>
        <div className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => {
                onSave({ ...namensAenderung(), sectionId: section.id })
                onClose()
              }}
              className={`rounded-full px-3 py-2 text-sm font-medium ${
                section.id === item.sectionId
                  ? 'bg-brand-800 text-white'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {section.name}
            </button>
          ))}

          {neueAbteilung === null ? (
            <button
              onClick={() => setNeueAbteilung('')}
              className="rounded-full border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-500 dark:border-slate-600 dark:text-slate-400"
            >
              + Neue Abteilung
            </button>
          ) : null}
        </div>

        {neueAbteilung !== null ? (
          <form onSubmit={abteilungAnlegen} className="mt-3 flex gap-2" noValidate>
            <input
              value={neueAbteilung}
              onChange={(event) => setNeueAbteilung(event.target.value)}
              maxLength={40}
              autoFocus
              enterKeyHint="done"
              placeholder="z. B. Fertiggerichte"
              aria-label="Name der neuen Abteilung"
              className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="submit"
              disabled={!neueAbteilung.trim() || anlegen.isPending}
              className="min-h-12 shrink-0 rounded-xl bg-brand-800 px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              Anlegen
            </button>
          </form>
        ) : null}

        {fehler ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
            {fehler.fields.name ?? fehler.message}
          </p>
        ) : null}

        <button
          onClick={onDelete}
          className="mt-4 w-full py-2 text-sm font-medium text-red-600 dark:text-red-400"
        >
          Eintrag löschen
        </button>
      </div>
    </>
  )
}

/**
 * Die Abteilungen des Ladens: anlegen, umbenennen, umordnen, löschen.
 *
 * Die Reihenfolge ist der Rundgang – deshalb stellt man sie hier so ein, wie
 * man den Laden abläuft, und nicht alphabetisch. Zwei Pfeile statt Ziehen mit
 * dem Finger: dieselbe Überlegung wie beim Startbildschirm, denn eine
 * Ziehgeste kollidiert auf dem Handy mit dem Blättern der Seite.
 */
function SectionSheet({
  sections,
  onClose,
}: {
  sections: readonly ShoppingSection[]
  onClose: () => void
}) {
  const reorder = useReorderShoppingSections()
  const [hinweis, setHinweis] = useState<string | null>(null)

  function verschieben(index: number, richtung: -1 | 1) {
    const ziel = index + richtung
    if (ziel < 0 || ziel >= sections.length) return

    const ids = sections.map((section) => section.id)
    const [bewegt] = ids.splice(index, 1)
    if (bewegt) ids.splice(ziel, 0, bewegt)
    reorder.mutate(ids)
  }

  return (
    <Modal
      onClose={onClose}
      label="Abteilungen"
      header={
        <>
          <span className="text-sm font-semibold">Abteilungen</span>
          <ModalCloseButton onClick={onClose} label="Fenster schliessen" />
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Die Reihenfolge ist der Rundgang durch den Laden – so, wie sie hier stehen, stehen sie
        auch auf der Einkaufsliste.
      </p>

      {hinweis ? (
        <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          {hinweis}
        </p>
      ) : null}

      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {sections.map((section, index) => (
          <SectionRow
            key={section.id}
            section={section}
            // Wohin die Einträge beim Löschen wandern – dieselbe Regel wie auf
            // dem Server, damit die Rückfrage den Ort nennen kann statt „eine
            // andere Abteilung". Fehlt sie, ist es die letzte, und die bleibt
            // stehen: Ohne Abteilung hätte kein Eintrag mehr einen Platz.
            ziel={catchAllSection(sections, section.id)?.name}
            nachOben={index > 0 ? () => verschieben(index, -1) : undefined}
            nachUnten={index < sections.length - 1 ? () => verschieben(index, 1) : undefined}
            onNotice={setHinweis}
          />
        ))}
      </ul>

      <AddSectionForm />
    </Modal>
  )
}

function SectionRow({
  section,
  ziel,
  nachOben,
  nachUnten,
  onNotice,
}: {
  section: ShoppingSection
  /** Wohin die Einträge wandern; ohne Ziel lässt sich die Abteilung nicht löschen. */
  ziel?: string
  nachOben?: () => void
  nachUnten?: () => void
  onNotice: (hinweis: string) => void
}) {
  const [name, setName] = useState<string | null>(null)
  const rename = useRenameShoppingSection()
  const remove = useDeleteShoppingSection()
  const fehler = rename.error instanceof ApiRequestError ? rename.error : null

  function speichern(event: FormEvent) {
    event.preventDefault()
    const gewuenscht = (name ?? '').trim()
    if (!gewuenscht) return
    if (gewuenscht === section.name) {
      setName(null)
      return
    }
    rename.mutate({ id: section.id, name: gewuenscht }, { onSuccess: () => setName(null) })
  }

  function loeschen() {
    // Rückfrage, weil die Einträge darin nicht verschwinden, sondern umziehen –
    // und man das vorher wissen soll, nicht hinterher beim Suchen.
    if (
      !ziel ||
      !window.confirm(
        `Abteilung „${section.name}" löschen? Was darin liegt, wandert nach „${ziel}".`,
      )
    ) {
      return
    }

    remove.mutate(section.id, {
      onSuccess: ({ moved, into }) => {
        onNotice(
          moved === 0
            ? `„${section.name}" gelöscht.`
            : `„${section.name}" gelöscht – ${moved} ${
                moved === 1 ? 'Eintrag liegt' : 'Einträge liegen'
              } jetzt unter „${into}".`,
        )
      },
    })
  }

  if (name !== null) {
    return (
      <li className="py-2">
        <form onSubmit={speichern} className="space-y-2" noValidate>
          <Field
            label={`„${section.name}" umbenennen`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            autoFocus
            error={fehler?.fields.name}
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
    <li className="flex min-h-12 items-center gap-1 py-1">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{section.name}</span>

      <RowButton
        label={`„${section.name}" nach oben`}
        onClick={nachOben}
        disabled={!nachOben}
      >
        <path d="M12 19V5m0 0-6 6m6-6 6 6" />
      </RowButton>
      <RowButton
        label={`„${section.name}" nach unten`}
        onClick={nachUnten}
        disabled={!nachUnten}
      >
        <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
      </RowButton>
      <RowButton label={`„${section.name}" umbenennen`} onClick={() => setName(section.name)}>
        <path d="M4 20h4l10-10-4-4L4 16v4Z" />
        <path d="m14.5 5.5 4 4" />
      </RowButton>
      {/* Bewusst nicht rot: In einer Liste stünde bei jeder Zeile ein
          Warnzeichen, und fünf davon untereinander warnen vor nichts mehr. */}
      <RowButton
        label={`„${section.name}" löschen`}
        onClick={loeschen}
        disabled={!ziel || remove.isPending}
      >
        <path d="M5 7h14M10 7V5h4v2m-7 0 .8 12h8.4L17 7" />
      </RowButton>
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
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-11 min-h-11 shrink-0 place-items-center rounded-xl text-slate-500 transition active:bg-black/5 disabled:opacity-25 dark:text-slate-400 dark:active:bg-white/10"
    >
      <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </g>
      </svg>
    </button>
  )
}

/** Neue Abteilungen hängen sich hinten an – nach oben schiebt man sie mit den Pfeilen. */
function AddSectionForm() {
  const [name, setName] = useState('')
  const anlegen = useAddShoppingSection()
  const fehler = anlegen.error instanceof ApiRequestError ? anlegen.error : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    anlegen.mutate(name, { onSuccess: () => setName('') })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
      noValidate
    >
      <Field
        label="Neue Abteilung"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={40}
        autoCapitalize="sentences"
        enterKeyHint="done"
        placeholder="z. B. Fertiggerichte"
        error={fehler?.fields.name}
      />
      {fehler && Object.keys(fehler.fields).length === 0 ? (
        <p className="text-sm text-red-600 dark:text-red-400">{fehler.message}</p>
      ) : null}
      <Button type="submit" loading={anlegen.isPending} disabled={!name.trim()}>
        Hinzufügen
      </Button>
    </form>
  )
}

/**
 * Immer erreichbar am unteren Rand, direkt über der Navigation. Nach dem
 * Absenden bleibt der Fokus im Feld – man trägt selten nur eine Sache ein.
 */
function AddField() {
  const add = useAddShoppingItem()
  const [text, setText] = useState('')

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    add.mutate({ text: value })
    setText('')
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="pb-safe fixed inset-x-0 bottom-16 z-10 border-t border-slate-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
    >
      <div className="mx-auto flex max-w-2xl gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Was fehlt?"
          aria-label="Neuer Eintrag"
          enterKeyHint="done"
          className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="grid min-h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-800 text-white transition active:scale-95 disabled:opacity-40"
          aria-label="Hinzufügen"
        >
          <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </form>
  )
}

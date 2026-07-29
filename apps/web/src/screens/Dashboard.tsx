import { formatAmount, monthListLabel, type PublicUser } from '@manager/shared'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { PencilIcon } from '../components/icons'
import { Modal, ModalCloseButton } from '../components/Modal'
import { api } from '../lib/api'
import { useDocuments } from '../lib/documents'
import { useLocalOrder } from '../lib/einstellungen'
import { useNotes, useShoppingList } from '../lib/household'

/**
 * Der Startbildschirm ist eine Übersicht, kein Arbeitsplatz.
 *
 * Jede Kachel beantwortet eine Frage in zwei, drei Zeilen und führt beim
 * Antippen dorthin, wo man damit weiterarbeitet. Deshalb steht in keiner
 * Kachel mehr ein „Alle ansehen": Die Kachel selbst ist der Weg.
 *
 * Welche Kacheln erscheinen und in welcher Reihenfolge, entscheidet jeder für
 * sich – hinter dem Stift beim Gruss. Was den einen morgens interessiert
 * (Einkaufsliste), ist für den anderen nur Rauschen.
 */
const KACHELN = ['dokumente', 'zehnter', 'einkauf', 'notizen'] as const
type KachelId = (typeof KACHELN)[number]

const KACHEL_LABELS: Record<KachelId, string> = {
  dokumente: 'Pendente Dokumente',
  zehnter: 'Zehnter',
  einkauf: 'Einkaufsliste',
  notizen: 'Angeheftete Notizen',
}

const STANDARD: readonly { id: KachelId; sichtbar: boolean }[] = [
  { id: 'dokumente', sichtbar: true },
  { id: 'zehnter', sichtbar: true },
  { id: 'einkauf', sichtbar: true },
  { id: 'notizen', sichtbar: true },
]

export function Dashboard({ user }: { user: PublicUser }) {
  const [layout, setLayout] = useLocalOrder<KachelId>('dashboard.kacheln', STANDARD)
  const [anpassen, setAnpassen] = useState(false)

  const sichtbar = layout.filter((kachel) => kachel.sichtbar)

  return (
    <div className="space-y-4">
      <section className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {greeting()}, {user.name.split(' ')[0]}.
        </h1>
        <button
          onClick={() => setAnpassen(true)}
          aria-label="Dashboard anpassen"
          className="grid size-10 shrink-0 place-items-center rounded-xl text-slate-400 transition active:bg-black/5 dark:active:bg-white/10"
        >
          <PencilIcon className="size-5" />
        </button>
      </section>

      {sichtbar.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Keine Kachel ausgewählt. Oben rechts lässt sich einstellen, was hier steht.
        </p>
      ) : (
        sichtbar.map((kachel) => <Kachelinhalt key={kachel.id} id={kachel.id} />)
      )}

      {anpassen ? (
        <DashboardEditor layout={layout} onChange={setLayout} onClose={() => setAnpassen(false)} />
      ) : null}
    </div>
  )
}

function Kachelinhalt({ id }: { id: KachelId }) {
  if (id === 'dokumente') return <DocumentsCard />
  if (id === 'zehnter') return <TithingCard />
  if (id === 'einkauf') return <ShoppingCard />
  return <NotesCard />
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Gute Nacht'
  if (hour < 11) return 'Guten Morgen'
  if (hour < 18) return 'Hallo'
  return 'Guten Abend'
}

/**
 * Die Hülle jeder Kachel.
 *
 * Der Titel ist der Verweis, und sein `::after` legt sich über die ganze
 * Kachel: Antippen führt von überall zum Bereich. Das ist ein echter Link –
 * mit Ziel in der Statusleiste und Öffnen im neuen Tab –, kein `onClick` auf
 * einem Kasten. Zeilen mit eigenem Ziel (eine Notiz) heben sich mit `z-10`
 * darüber und behalten ihres.
 */
function Kachel({
  titel,
  to,
  badge,
  children,
}: {
  titel: string
  to: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="relative rounded-2xl border border-slate-200 bg-white p-4 transition active:scale-[0.995] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">
          <Link to={to} className="after:absolute after:inset-0 after:rounded-2xl">
            {titel}
          </Link>
        </h2>
        {badge}
      </div>
      {children}
    </section>
  )
}

function Ladeplatz() {
  return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
}

/** Wie viele Zeilen eine Kachel höchstens zeigt. Sie ist eine Übersicht. */
const ZEILEN = 4

/**
 * Beantwortet die Frage, für die man die App am ehesten öffnet: Was ist noch
 * offen? Fälligkeiten stehen zuerst, danach der Rest.
 */
function DocumentsCard() {
  const pending = useDocuments({ pending: true })
  if (pending.isLoading) return <Ladeplatz />

  const documents = pending.data?.documents ?? []
  const total = pending.data?.total ?? documents.length
  const today = new Date().toISOString().slice(0, 10)

  // Mit Frist zuerst, die dringendste oben – der Rest in der Reihenfolge, in
  // der er ohnehin kommt.
  const sortiert = [...documents].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return 0
  })

  return (
    <Kachel
      titel="Pendent"
      to="/dokumente"
      badge={
        total > 0 ? (
          <span className="text-sm font-semibold tabular-nums">
            {total} {total === 1 ? 'Dokument' : 'Dokumente'}
          </span>
        ) : null
      }
    >
      {documents.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nichts offen. Angenehm.</p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {sortiert.slice(0, ZEILEN).map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{document.title}</span>
                {document.dueDate ? (
                  <span
                    className={`shrink-0 text-xs font-medium ${
                      document.dueDate < today
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {document.dueDate < today ? 'überfällig' : `bis ${formatDate(document.dueDate)}`}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {total > ZEILEN ? <Rest anzahl={total - ZEILEN} /> : null}
        </>
      )}
    </Kachel>
  )
}

/**
 * Der Zehnten-Stand des laufenden Jahres. Steht hier, weil man ihn sonst
 * nur beim Nachsehen bemerkt – und dann ist der Monat oft schon vorbei.
 */
function TithingCard() {
  const year = new Date().getFullYear()
  const finance = useQuery({
    queryKey: ['finanzen', year],
    queryFn: () => api.getFinanceYear(year),
  })

  if (finance.isLoading) return <Ladeplatz />
  if (!finance.data) return null

  const { figures } = finance.data

  return (
    <Kachel titel={`Zehnter ${year}`} to="/finanzen">
      {figures.lastEnteredMonth === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Für {year} ist noch kein Einkommen erfasst.
        </p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            CHF {formatAmount(figures.openTithingCents)}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {figures.openMonths.length === 0
              ? 'Alles Erfasste ist abgerechnet.'
              : `offen für ${monthListLabel(figures.openMonths)}`}
          </p>
        </>
      )}
    </Kachel>
  )
}

/** Was noch im Wagen fehlt – die Liste selbst steht einen Griff entfernt. */
function ShoppingCard() {
  const shopping = useShoppingList()
  if (shopping.isLoading) return <Ladeplatz />

  const offen = (shopping.data?.items ?? []).filter((item) => !item.done)

  return (
    <Kachel
      titel="Einkauf"
      to="/einkauf"
      badge={
        offen.length > 0 ? (
          <span className="text-sm font-semibold tabular-nums">
            {offen.length} {offen.length === 1 ? 'Eintrag' : 'Einträge'}
          </span>
        ) : null
      }
    >
      {offen.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Die Liste ist leer.</p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {offen.slice(0, ZEILEN).map((item) => (
              <li key={item.id} className="truncate text-sm">
                {item.text}
              </li>
            ))}
          </ul>
          {offen.length > ZEILEN ? <Rest anzahl={offen.length - ZEILEN} /> : null}
        </>
      )}
    </Kachel>
  )
}

/**
 * Die angehefteten Notizen – nur die Titel.
 *
 * Hier hat jede Zeile ein eigenes Ziel: Angeheftet ist, was man im Griff
 * behalten will, und dann soll ein Tipp auch dorthin führen und nicht in die
 * Liste aller Notizen.
 */
function NotesCard() {
  const notes = useNotes('')
  if (notes.isLoading) return <Ladeplatz />

  const angeheftet = (notes.data?.notes ?? []).filter((note) => note.pinned)

  return (
    <Kachel titel="Angeheftet" to="/notizen">
      {angeheftet.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Nichts angeheftet. In einer Notiz das Reissbrettstift-Zeichen antippen.
        </p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {angeheftet.slice(0, ZEILEN).map((note) => (
              <li key={note.id}>
                <Link
                  to={`/notizen?notiz=${note.id}`}
                  className="relative z-10 block truncate text-sm"
                >
                  📌 {note.title || note.body.split('\n')[0] || 'Ohne Titel'}
                </Link>
              </li>
            ))}
          </ul>
          {angeheftet.length > ZEILEN ? <Rest anzahl={angeheftet.length - ZEILEN} /> : null}
        </>
      )}
    </Kachel>
  )
}

function Rest({ anzahl }: { anzahl: number }) {
  return (
    <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">… und {anzahl} weitere</p>
  )
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return day && month && year ? `${day}.${month}.` : iso
}

/**
 * Was auf dem Startbildschirm steht und in welcher Reihenfolge.
 *
 * Häkchen und zwei Pfeile – mehr braucht es nicht. Ziehen mit dem Finger wäre
 * die schönere Geste und auf dem Handy die unzuverlässigere: Sie kollidiert
 * mit dem Blättern der Seite.
 */
function DashboardEditor({
  layout,
  onChange,
  onClose,
}: {
  layout: { id: KachelId; sichtbar: boolean }[]
  onChange: (layout: { id: KachelId; sichtbar: boolean }[]) => void
  onClose: () => void
}) {
  function verschieben(index: number, richtung: -1 | 1) {
    const ziel = index + richtung
    if (ziel < 0 || ziel >= layout.length) return
    const next = [...layout]
    const [kachel] = next.splice(index, 1)
    if (kachel) next.splice(ziel, 0, kachel)
    onChange(next)
  }

  return (
    <Modal
      onClose={onClose}
      label="Dashboard anpassen"
      header={
        <>
          <span className="text-sm font-semibold">Dashboard anpassen</span>
          <ModalCloseButton onClick={onClose} label="Fenster schliessen" />
        </>
      }
    >
      <ul className="space-y-1.5">
        {layout.map((kachel, index) => (
          <li
            key={kachel.id}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900"
          >
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
              <input
                type="checkbox"
                checked={kachel.sichtbar}
                onChange={() =>
                  onChange(
                    layout.map((eintrag, position) =>
                      position === index
                        ? { ...eintrag, sichtbar: !eintrag.sichtbar }
                        : eintrag,
                    ),
                  )
                }
                className="size-5 shrink-0 accent-brand-700"
              />
              <span className="truncate text-sm font-medium">{KACHEL_LABELS[kachel.id]}</span>
            </label>

            <button
              onClick={() => verschieben(index, -1)}
              disabled={index === 0}
              aria-label={`${KACHEL_LABELS[kachel.id]} nach oben`}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition active:bg-black/5 disabled:opacity-25 dark:active:bg-white/10"
            >
              ↑
            </button>
            <button
              onClick={() => verschieben(index, 1)}
              disabled={index === layout.length - 1}
              aria-label={`${KACHEL_LABELS[kachel.id]} nach unten`}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition active:bg-black/5 disabled:opacity-25 dark:active:bg-white/10"
            >
              ↓
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Die Wahl gilt für dieses Gerät. Jede Kachel führt beim Antippen in den zugehörigen
        Bereich.
      </p>
    </Modal>
  )
}

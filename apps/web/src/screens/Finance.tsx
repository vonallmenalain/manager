import {
  DONATION_LABELS,
  formatAmount,
  monthName,
  MONTH_NAMES,
  parseAmountToCents,
  type IncomeEntry,
  type MonthFigures,
} from '@manager/shared'
import { type FormEvent, type ReactNode, useMemo, useState } from 'react'

import { Button } from '../components/Button'
import { Modal, ModalCloseButton } from '../components/Modal'
import { API_BASE, type FinanceYear } from '../lib/api'
import { saveStateLabel, useAutosave } from '../lib/autosave'
import { useHouseholdUsers } from '../lib/documents'
import {
  useAddPayment,
  useDeleteDonation,
  useFinanceYear,
  useSaveFinanceMonth,
  useSaveFinanceSettings,
} from '../lib/finance'

export function Finance() {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [sheet, setSheet] = useState<SheetState>(null)

  const query = useFinanceYear(year)
  const users = useHouseholdUsers()
  const data = query.data

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Finanzen</h1>
        <YearPicker year={year} onChange={setYear} />
      </div>

      {query.isLoading || !data ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      ) : (
        <>
          <StatusCard data={data} onPay={() => setSheet({ kind: 'zahlung' })} />

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Monate
            </h2>
            <ul className="space-y-1.5">
              {data.figures.months.map((figures) => (
                <MonthRow
                  key={figures.month}
                  figures={figures}
                  settled={figures.month <= data.figures.settledThroughMonth}
                  onClick={() => setSheet({ kind: 'monat', month: figures.month })}
                />
              ))}
            </ul>
          </section>

          <Payments data={data} year={year} />

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setSheet({ kind: 'steuern' })}>
              Steuern
            </Button>
            <a
              href={`${API_BASE}/api/finanzen/${year}/export.csv`}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              CSV laden
            </a>
          </div>
        </>
      )}

      {data && sheet?.kind === 'monat' ? (
        <MonthEditor
          data={data}
          month={sheet.month}
          users={users.data?.users ?? []}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {data && sheet?.kind === 'zahlung' ? (
        <PaymentEditor data={data} onClose={() => setSheet(null)} />
      ) : null}

      {data && sheet?.kind === 'steuern' ? (
        <TaxEditor data={data} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  )
}

type SheetState = null | { kind: 'monat'; month: number } | { kind: 'zahlung' } | { kind: 'steuern' }

function YearPicker({ year, onChange }: { year: number; onChange: (year: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700">
      <button
        onClick={() => onChange(year - 1)}
        className="grid size-10 place-items-center text-slate-500"
        aria-label="Vorheriges Jahr"
      >
        ‹
      </button>
      <span className="min-w-14 text-center text-base font-semibold tabular-nums">{year}</span>
      <button
        onClick={() => onChange(year + 1)}
        className="grid size-10 place-items-center text-slate-500"
        aria-label="Nächstes Jahr"
      >
        ›
      </button>
    </div>
  )
}

/**
 * Die Kachel, wegen der man den Bildschirm öffnet – und deshalb ganz oben.
 *
 * Sie beantwortet die ganze Abrechnung in einer Spalte: Was kam herein, was
 * wurde an Steuern verrechnet, was ist davon der Zehnte, was ist bezahlt, was
 * bleibt offen.
 */
function StatusCard({ data, onPay }: { data: FinanceYear; onPay: () => void }) {
  const { figures } = data

  return (
    <section className="rounded-2xl bg-brand-800 p-4 text-white">
      <p className="text-sm text-white/70">
        {figures.lastEnteredMonth === 0
          ? `Stand ${data.year}`
          : `Stand bis und mit ${monthName(figures.lastEnteredMonth)}`}
      </p>
      <p className="mt-1 text-3xl font-bold tabular-nums">
        CHF {formatAmount(figures.openTithingCents)}
      </p>
      <p className="text-sm text-white/70">Zehnter noch offen</p>

      <dl className="mt-4 space-y-1 border-t border-white/20 pt-3 text-sm tabular-nums">
        <Row label="Einkommen" value={figures.totalIncomeCents} tone="soft" />
        <Row label="− Steuern verrechnet" value={figures.taxAppliedCents} tone="soft" />
        <Row label="= Basis" value={figures.baseCents} tone="soft" />
        <Row label="Zehnter (10 %)" value={figures.owedTithingCents} />
        <Row label="− bereits bezahlt" value={figures.paidTithingCents} tone="soft" />
        <Row label="= offen" value={figures.openTithingCents} />
      </dl>

      <p className="mt-3 text-xs text-white/70">
        {figures.taxTotalCents > 0
          ? `Steuern: CHF ${formatAmount(figures.taxAppliedCents)} von ${formatAmount(figures.taxTotalCents)} verrechnet, CHF ${formatAmount(figures.taxOpenCents)} noch offen.`
          : 'Noch kein Steuerbetrag hinterlegt – unter „Steuern" eintragen.'}
        {figures.paidFastOfferingCents > 0
          ? ` Fastopfer bezahlt: CHF ${formatAmount(figures.paidFastOfferingCents)}.`
          : ''}
      </p>

      <p className="mt-1 text-xs text-white/70">
        {figures.settledThroughMonth === 0
          ? 'Noch nichts abgerechnet.'
          : `Abgerechnet bis und mit ${monthName(figures.settledThroughMonth)}.`}
        {figures.openMonths.length > 0
          ? ` Offen: ${figures.openMonths.map(monthName).join(', ')}.`
          : ''}
      </p>

      <button
        onClick={onPay}
        className="mt-3 min-h-11 w-full rounded-xl bg-white/15 text-sm font-semibold backdrop-blur transition active:scale-[0.99]"
      >
        Zahlung erfassen
      </button>
    </section>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'soft'
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={tone === 'soft' ? 'text-white/70' : 'font-semibold'}>{label}</dt>
      <dd className={tone === 'soft' ? 'text-white/70' : 'font-semibold'}>{formatAmount(value)}</dd>
    </div>
  )
}

function MonthRow({
  figures,
  settled,
  onClick,
}: {
  figures: MonthFigures
  settled: boolean
  onClick: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="flex min-h-14 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left dark:border-slate-800 dark:bg-slate-900"
      >
        <span className="w-24 shrink-0 font-medium">{monthName(figures.month)}</span>

        {figures.entered ? (
          <>
            <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {formatAmount(figures.incomeCents)}
            </span>
            <span className="shrink-0 text-right font-semibold tabular-nums">
              {formatAmount(figures.tithingCents)}
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-slate-400">nichts erfasst</span>
        )}

        {/* Die Spalte ist immer gleich breit, ob abgehakt oder nicht – sonst
            springen die Zahlen von Zeile zu Zeile. */}
        <span
          className="w-5 shrink-0 text-center text-emerald-600 dark:text-emerald-400"
          aria-label={settled && figures.entered ? 'abgerechnet' : undefined}
          aria-hidden={settled && figures.entered ? undefined : true}
        >
          {settled && figures.entered ? '✓' : ''}
        </span>
      </button>
    </li>
  )
}

function Payments({ data, year }: { data: FinanceYear; year: number }) {
  const remove = useDeleteDonation(year)
  if (data.donations.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Zahlungen
      </h2>
      <ul className="space-y-1.5">
        {data.donations.map((donation) => (
          <li
            key={donation.id}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {DONATION_LABELS[donation.kind]}
                {donation.coversThroughMonth
                  ? ` bis ${monthName(donation.coversThroughMonth)}`
                  : ''}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatDate(donation.paidOn)}
                {donation.taxAppliedCents > 0
                  ? ` · Steuern ${formatAmount(donation.taxAppliedCents)}`
                  : ''}
                {donation.note ? ` · ${donation.note}` : ''}
              </p>
            </div>
            <span className="shrink-0 font-semibold tabular-nums">
              {formatAmount(donation.amountCents)}
            </span>
            <button
              onClick={() => {
                if (window.confirm('Diese Zahlung löschen?')) remove.mutate(donation.id)
              }}
              className="shrink-0 px-1 text-slate-400"
              aria-label={`Zahlung vom ${formatDate(donation.paidOn)} löschen`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return day && month && year ? `${day}.${month}.${year}` : iso
}

// ---------------------------------------------------------------- Fenster

/** Betragsfeld: numerische Tastatur, akzeptiert 8'450.00 genauso wie 8450. */
function AmountField({
  label,
  value,
  onChange,
  hint,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        placeholder="0.00"
        autoFocus={autoFocus}
        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-right text-lg tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900"
      />
      {hint ? (
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
      ) : null}
    </label>
  )
}

/** Liest ein Betragsfeld: leer ist erlaubt, Unlesbares nicht. */
function readAmount(raw: string): number | null | 'fehler' {
  if (raw.trim() === '') return null
  return parseAmountToCents(raw) ?? 'fehler'
}

function MonthEditor({
  data,
  month,
  users,
  onClose,
}: {
  data: FinanceYear
  month: number
  users: { id: string; name: string }[]
  onClose: () => void
}) {
  const save = useSaveFinanceMonth(data.year)

  // Ein Feld je Haushaltsmitglied, vorbelegt mit dem bereits Erfassten.
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {}
    for (const user of users) {
      const entry = data.entries.find(
        (candidate) => candidate.month === month && candidate.userId === user.id && !candidate.label,
      )
      start[user.id] = entry ? formatAmount(entry.amountCents) : ''
    }
    return start
  })

  const [extras, setExtras] = useState<{ userId: string; label: string; amount: string }[]>(() =>
    data.entries
      .filter((entry) => entry.month === month && entry.label)
      .map((entry) => ({
        userId: entry.userId,
        label: entry.label,
        amount: formatAmount(entry.amountCents),
      })),
  )

  /** Alle Felder zusammen, wie sie gespeichert würden – oder null bei Unlesbarem. */
  const entries = useMemo(() => {
    const result: { userId: string; label: string; amountCents: number }[] = []

    for (const user of users) {
      const cents = readAmount(amounts[user.id] ?? '')
      if (cents === 'fehler') return null
      // Leer heisst „nicht erfasst" und wird weggelassen; eine ausdrückliche
      // 0 bleibt erhalten – sie ist eine Angabe.
      if (cents === null) continue
      result.push({ userId: user.id, label: '', amountCents: cents })
    }

    for (const extra of extras) {
      const cents = readAmount(extra.amount)
      if (cents === 'fehler') return null
      if (cents === null) continue
      result.push({ userId: extra.userId, label: extra.label.trim(), amountCents: cents })
    }

    return result
  }, [amounts, extras, users])

  const autosave = useAutosave(
    { entries },
    async (stand) => {
      if (!stand.entries) return
      await save.mutateAsync({ month, input: { entries: stand.entries } })
    },
    { savable: (stand) => stand.entries !== null },
  )

  /**
   * Was die Eingabe bedeutet – gerechnet mit derselben Funktion wie die Liste,
   * nicht mit einer vereinfachten Formel. So kann hier keine andere Zahl
   * stehen als gleich danach im Jahr.
   */
  const vorschau = useMemo(() => {
    if (!entries || entries.length === 0) return null
    const geplant: IncomeEntry[] = entries.map((entry, index) => ({
      id: String(index),
      year: data.year,
      month,
      userId: entry.userId,
      label: entry.label,
      amountCents: entry.amountCents,
    }))
    const ohneDiesenMonat = data.entries.filter((entry) => entry.month !== month)
    return computeMonth([...ohneDiesenMonat, ...geplant], month)
  }, [entries, data, month])

  return (
    <Modal
      onClose={onClose}
      label={`${monthName(month)} ${data.year}`}
      header={
        <>
          <span className="text-sm font-semibold">
            {monthName(month)} {data.year}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {saveStateLabel(
                autosave.state,
                entries === null ? 'Betrag nicht lesbar' : undefined,
              )}
            </span>
            <ModalCloseButton onClick={onClose} label="Monat schliessen" />
          </div>
        </>
      }
      footer={
        vorschau ? (
          <dl className="space-y-1 text-sm tabular-nums">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Einkommen</dt>
              <dd>{formatAmount(vorschau.incomeCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-semibold">
              <dt>Zehnter (10 %)</dt>
              <dd>{formatAmount(vorschau.tithingCents)}</dd>
            </div>
          </dl>
        ) : null
      }
    >
      <div className="space-y-4">
        {users.map((user) => (
          <AmountField
            key={user.id}
            label={`Einkommen ${user.name}`}
            value={amounts[user.id] ?? ''}
            onChange={(value) => setAmounts((current) => ({ ...current, [user.id]: value }))}
          />
        ))}

        {extras.map((extra, index) => (
          <div key={index} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex gap-2">
              <input
                value={extra.label}
                onChange={(event) =>
                  setExtras((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
                placeholder="Bezeichnung, z. B. Bonus"
                aria-label="Bezeichnung der weiteren Einnahme"
                className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base outline-none dark:border-slate-700 dark:bg-slate-900"
              />
              <button
                type="button"
                onClick={() => setExtras((current) => current.filter((_, i) => i !== index))}
                className="shrink-0 px-2 text-slate-400"
                aria-label="Weitere Einnahme entfernen"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-2">
              <select
                value={extra.userId}
                onChange={(event) =>
                  setExtras((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, userId: event.target.value } : item,
                    ),
                  )
                }
                aria-label="Wem gehört diese Einnahme"
                className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900"
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <input
                value={extra.amount}
                onChange={(event) =>
                  setExtras((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, amount: event.target.value } : item,
                    ),
                  )
                }
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Betrag der weiteren Einnahme"
                className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-right text-base tabular-nums dark:border-slate-700 dark:bg-slate-900"
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setExtras((current) => [...current, { userId: users[0]?.id ?? '', label: '', amount: '' }])
          }
          className="text-left text-sm font-medium text-brand-700 dark:text-brand-400"
        >
          + weitere Einnahme
        </button>
      </div>
    </Modal>
  )
}

/** Der Monatswert, wie ihn die Jahresrechnung sieht. */
function computeMonth(entries: readonly IncomeEntry[], month: number): MonthFigures {
  const incomeCents = entries
    .filter((entry) => entry.month === month)
    .reduce((sum, entry) => sum + entry.amountCents, 0)
  return { month, incomeCents, tithingCents: Math.round(incomeCents / 10), entered: true }
}

/**
 * Zahlung erfassen – Zehnter und Fastopfer in einem Vorgang.
 *
 * Als Einziges hier ohne Autospeichern: Eine Zahlung ist ein Ereignis, kein
 * Text, an dem man arbeitet. Würde beim Tippen gespeichert, entstünde für
 * jeden Zwischenstand ein Beleg.
 */
function PaymentEditor({ data, onClose }: { data: FinanceYear; onClose: () => void }) {
  const add = useAddPayment(data.year)
  const { figures } = data

  const [tithing, setTithing] = useState(() =>
    figures.openTithingCents > 0 ? formatAmount(figures.openTithingCents) : '',
  )
  const [fastOffering, setFastOffering] = useState('')
  const [tax, setTax] = useState('')
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [covers, setCovers] = useState(() => Math.max(figures.lastEnteredMonth, 1))
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const betraege = {
      tithingCents: readAmount(tithing),
      fastOfferingCents: readAmount(fastOffering),
      taxAppliedCents: readAmount(tax),
    }

    for (const wert of Object.values(betraege)) {
      if (wert === 'fehler') {
        setError('Bitte einen lesbaren Betrag eingeben.')
        return
      }
    }

    const tithingCents = betraege.tithingCents === 'fehler' ? 0 : (betraege.tithingCents ?? 0)
    const fastOfferingCents =
      betraege.fastOfferingCents === 'fehler' ? 0 : (betraege.fastOfferingCents ?? 0)
    const taxAppliedCents = betraege.taxAppliedCents === 'fehler' ? 0 : (betraege.taxAppliedCents ?? 0)

    if (tithingCents === 0 && fastOfferingCents === 0 && taxAppliedCents === 0) {
      setError('Bitte einen Betrag eingeben.')
      return
    }

    add.mutate(
      {
        tithingCents,
        fastOfferingCents,
        taxAppliedCents,
        paidOn,
        note: note.trim(),
        coversThroughMonth: tithingCents > 0 || taxAppliedCents > 0 ? covers : null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal
      onClose={onClose}
      label="Zahlung erfassen"
      header={
        <>
          <span className="text-sm font-semibold">Zahlung erfassen</span>
          <ModalCloseButton onClick={onClose} label="Fenster schliessen" />
        </>
      }
    >
      <form id="zahlung" onSubmit={handleSubmit} className="space-y-4">
        <AmountField
          label="Betrag Zehnten"
          value={tithing}
          onChange={setTithing}
          autoFocus
          hint={
            figures.openTithingCents > 0
              ? `Offen sind CHF ${formatAmount(figures.openTithingCents)}.`
              : undefined
          }
        />

        <AmountField label="Betrag Fastopfer" value={fastOffering} onChange={setFastOffering} />

        <AmountField
          label="Steuern verrechnen"
          value={tax}
          onChange={setTax}
          hint={
            figures.taxTotalCents > 0
              ? `Von CHF ${formatAmount(figures.taxTotalCents)} sind noch CHF ${formatAmount(figures.taxOpenCents)} nicht verrechnet.`
              : 'Noch kein Steuerbetrag hinterlegt – unter „Steuern" eintragen.'
          }
        />

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Bezahlt am</span>
          <input
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Rechnet ab bis und mit</span>
          <select
            value={covers}
            onChange={(event) => setCovers(Number(event.target.value))}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base dark:border-slate-700 dark:bg-slate-900"
          >
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Notiz (freiwillig)</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <Button type="submit" loading={add.isPending}>
          Zahlung erfassen
        </Button>
      </form>
    </Modal>
  )
}

/**
 * Die Steuern des Jahres – das Einzige, was zu einem Jahr eingestellt wird.
 *
 * Wie viel davon abgezogen wird, steht hier bewusst nicht: Das entscheidet
 * sich bei jeder Zahlung.
 */
function TaxEditor({ data, onClose }: { data: FinanceYear; onClose: () => void }) {
  const save = useSaveFinanceSettings(data.year)
  const [tax, setTax] = useState(() => formatAmount(data.settings.taxCents))

  const cents = readAmount(tax)
  const lesbar = cents !== 'fehler'

  const autosave = useAutosave(
    { tax },
    async (stand) => {
      const wert = readAmount(stand.tax)
      if (wert === 'fehler') return
      await save.mutateAsync({ taxCents: wert ?? 0 })
    },
    { savable: (stand) => readAmount(stand.tax) !== 'fehler' },
  )

  return (
    <Modal
      onClose={onClose}
      label={`Steuern ${data.year}`}
      header={
        <>
          <span className="text-sm font-semibold">Steuern {data.year}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {saveStateLabel(autosave.state, lesbar ? undefined : 'Betrag nicht lesbar')}
            </span>
            <ModalCloseButton onClick={onClose} label="Fenster schliessen" />
          </div>
        </>
      }
    >
      <div className="space-y-3">
        <AmountField
          label={`Steuern für das ganze Jahr ${data.year}`}
          value={tax}
          onChange={setTax}
          autoFocus
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Dieser Betrag wird nicht von selbst abgezogen. Beim Erfassen einer Zahlung lässt sich
          bestimmen, wie viel davon verrechnet wird – ganz oder in Teilen.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Bisher verrechnet: CHF {formatAmount(data.figures.taxAppliedCents)}.
        </p>
      </div>
    </Modal>
  )
}

import {
  computeYear,
  DONATION_LABELS,
  formatAmount,
  monthName,
  MONTH_NAMES,
  parseAmountToCents,
  sumDonations,
  type CreateDonationInput,
  type DonationKind,
  type FinanceSettings,
  type IncomeEntry,
  type MonthFigures,
} from '@manager/shared'
import { type FormEvent, type ReactNode, useMemo, useState } from 'react'

import { Button } from '../components/Button'
import { API_BASE, type FinanceYear } from '../lib/api'
import { useHouseholdUsers } from '../lib/documents'
import {
  useAddDonation,
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
          <StatusCard data={data} onSettle={() => setSheet({ kind: 'zahlung', art: 'zehnten' })} />

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Monate
            </h2>
            <ul className="space-y-1.5">
              {data.figures.months.map((figures) => (
                <MonthRow
                  key={figures.month}
                  figures={figures}
                  settled={figures.month <= data.settings.settledThroughMonth}
                  onClick={() => setSheet({ kind: 'monat', month: figures.month })}
                />
              ))}
            </ul>
          </section>

          <YearTotals data={data} />
          <Fastopfer data={data} onAdd={() => setSheet({ kind: 'zahlung', art: 'fastopfer' })} />
          <Payments data={data} year={year} />

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setSheet({ kind: 'einstellungen' })}>
              Einstellungen
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
        <PaymentEditor
          data={data}
          kind={sheet.art}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {data && sheet?.kind === 'einstellungen' ? (
        <SettingsEditor data={data} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  )
}

type SheetState =
  | null
  | { kind: 'monat'; month: number }
  | { kind: 'zahlung'; art: DonationKind }
  | { kind: 'einstellungen' }

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
 * Die eine Zahl, wegen der man den Bildschirm öffnet: Was ist noch offen und
 * bis wann ist abgerechnet.
 */
function StatusCard({ data, onSettle }: { data: FinanceYear; onSettle: () => void }) {
  const { figures, settings } = data
  const offen = figures.openTithingCents

  return (
    <section className="rounded-2xl bg-brand-800 p-4 text-white">
      <p className="text-sm text-white/70">Zehnter noch offen</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">CHF {formatAmount(offen)}</p>

      <p className="mt-3 text-sm text-white/80">
        {settings.settledThroughMonth === 0
          ? 'Noch nichts abgerechnet.'
          : `Abgerechnet bis und mit ${monthName(settings.settledThroughMonth)}.`}
        {figures.openMonths.length > 0
          ? ` Offen: ${figures.openMonths.map(monthName).join(', ')}.`
          : figures.lastEnteredMonth === 0
            ? ' Noch kein Einkommen erfasst.'
            : ' Alles Erfasste ist abgerechnet.'}
      </p>

      {offen > 0 ? (
        <button
          onClick={onSettle}
          className="mt-3 min-h-11 w-full rounded-xl bg-white/15 text-sm font-semibold backdrop-blur transition active:scale-[0.99]"
        >
          Zahlung erfassen
        </button>
      ) : null}
    </section>
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
            {/* Nicht umbrechen: Eine Zeile je Monat lässt sich überfliegen,
                zwei nicht mehr. Wird es zu eng, kürzt truncate von rechts. */}
            <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {formatAmount(figures.incomeCents)}
              {figures.taxShareCents > 0 ? (
                <span className="text-slate-400"> − {formatAmount(figures.taxShareCents)}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-right tabular-nums font-semibold">
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

function YearTotals({ data }: { data: FinanceYear }) {
  const { figures, settings } = data
  if (figures.lastEnteredMonth === 0) return null

  // Zwei verschiedene Zahlen, absichtlich beide sichtbar: „abgerechnet" folgt
  // dem Monatsstand, „einbezahlt" ist die Summe der erfassten Zahlungen.
  // Gehen sie auseinander, ist irgendwo ein Beleg zu viel oder zu wenig – und
  // das merkt man am besten hier, nicht im Dezember.
  const einbezahlt = sumDonations(data.donations, 'zehnten')
  const abweichung = einbezahlt - figures.settledTithingCents

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-2 font-semibold">
        Stand bis und mit {monthName(figures.lastEnteredMonth)}
      </h2>
      <dl className="space-y-1.5 tabular-nums">
        <Line label="Einkommen" value={figures.totalIncomeCents} />
        {settings.deductTax ? (
          <Line label="− Steueranteil" value={figures.totalTaxCents} />
        ) : null}
        <Line label="= Basis" value={figures.totalBaseCents} />
        <Line
          label={`Zehnter (${(settings.rateBasisPoints / 100).toLocaleString('de-CH')} %)`}
          value={figures.totalTithingCents}
          strong
        />
        <Line label="davon abgerechnet" value={figures.settledTithingCents} />
        <Line label="einbezahlt" value={einbezahlt} />
      </dl>

      {abweichung !== 0 ? (
        <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-amber-700 dark:border-slate-800 dark:text-amber-500">
          {abweichung > 0
            ? `Es sind CHF ${formatAmount(abweichung)} mehr einbezahlt als bis ${monthName(settings.settledThroughMonth)} abgerechnet.`
            : `Es fehlen CHF ${formatAmount(-abweichung)} gegenüber dem Abrechnungsstand.`}
        </p>
      ) : null}
    </section>
  )
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500 dark:text-slate-400'}>{label}</dt>
      <dd>{formatAmount(value)}</dd>
    </div>
  )
}

function Fastopfer({ data, onAdd }: { data: FinanceYear; onAdd: () => void }) {
  const total = sumDonations(data.donations, 'fastopfer')

  return (
    <section className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="font-semibold">Fastopfer {data.year}</h2>
        <p className="text-sm tabular-nums text-slate-500 dark:text-slate-400">
          CHF {formatAmount(total)}
        </p>
      </div>
      <button
        onClick={onAdd}
        className="min-h-11 shrink-0 rounded-xl bg-slate-100 px-4 text-sm font-semibold dark:bg-slate-800"
      >
        Erfassen
      </button>
    </section>
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
                {donation.note ? ` · ${donation.note}` : ''}
              </p>
            </div>
            <span className="shrink-0 tabular-nums font-semibold">
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

// ---------------------------------------------------------------- Editoren

function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
      <div className="pt-safe border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">{children}</div>
    </div>
  )
}

/** Betragsfeld: numerische Tastatur, akzeptiert 8'450.00 genauso wie 8450. */
function AmountField({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (value: string) => void
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
    </label>
  )
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

  const [error, setError] = useState<string | null>(null)

  /**
   * Was die Eingabe bedeutet – gerechnet mit derselben Funktion wie die Liste,
   * nicht mit einer vereinfachten Formel. So kann hier keine andere Zahl
   * stehen als gleich danach im Jahr.
   */
  const vorschau = useMemo(() => {
    const geplant: IncomeEntry[] = []
    for (const [userId, raw] of Object.entries(amounts)) {
      const cents = raw.trim() === '' ? null : parseAmountToCents(raw)
      if (cents === null) continue
      geplant.push({ id: '', year: data.year, month, userId, label: '', amountCents: cents })
    }
    for (const extra of extras) {
      const cents = extra.amount.trim() === '' ? null : parseAmountToCents(extra.amount)
      if (cents === null) continue
      geplant.push({
        id: '',
        year: data.year,
        month,
        userId: extra.userId,
        label: extra.label,
        amountCents: cents,
      })
    }
    if (geplant.length === 0) return null

    const ohneDiesenMonat = data.entries.filter((entry) => entry.month !== month)
    return computeYear([...ohneDiesenMonat, ...geplant], data.settings).months[month - 1] ?? null
  }, [amounts, extras, data, month])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const entries: { userId: string; label: string; amountCents: number }[] = []

    for (const user of users) {
      const raw = amounts[user.id]?.trim() ?? ''
      // Leer heisst „nicht erfasst" und wird weggelassen; eine ausdrückliche
      // 0 bleibt erhalten – sie ist eine Angabe.
      if (raw === '') continue
      const cents = parseAmountToCents(raw)
      if (cents === null) {
        setError(`Betrag von ${user.name} nicht lesbar: „${raw}"`)
        return
      }
      entries.push({ userId: user.id, label: '', amountCents: cents })
    }

    for (const extra of extras) {
      if (extra.amount.trim() === '') continue
      const cents = parseAmountToCents(extra.amount)
      if (cents === null) {
        setError(`Betrag nicht lesbar: „${extra.amount}"`)
        return
      }
      entries.push({ userId: extra.userId, label: extra.label.trim(), amountCents: cents })
    }

    save.mutate({ month, input: { entries } }, { onSuccess: onClose })
  }

  return (
    <Sheet title={`${monthName(month)} ${data.year}`}>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
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
            setExtras((current) => [
              ...current,
              { userId: users[0]?.id ?? '', label: '', amount: '' },
            ])
          }
          className="text-left text-sm font-medium text-brand-700 dark:text-brand-400"
        >
          + weitere Einnahme
        </button>

        {vorschau ? (
          <dl className="space-y-1 rounded-xl bg-slate-100 p-3 text-sm tabular-nums dark:bg-slate-900">
            <Line label="Einkommen" value={vorschau.incomeCents} />
            {vorschau.taxShareCents !== 0 ? (
              <Line label="− Steueranteil" value={vorschau.taxShareCents} />
            ) : null}
            <Line label="Zehnter" value={vorschau.tithingCents} strong />
          </dl>
        ) : null}

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="mt-auto flex gap-2 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={save.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function PaymentEditor({
  data,
  kind,
  onClose,
}: {
  data: FinanceYear
  kind: DonationKind
  onClose: () => void
}) {
  const add = useAddDonation(data.year)

  const [amount, setAmount] = useState(() =>
    kind === 'zehnten' && data.figures.openTithingCents > 0
      ? formatAmount(data.figures.openTithingCents)
      : '',
  )
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [covers, setCovers] = useState(() =>
    kind === 'zehnten' ? Math.max(data.figures.lastEnteredMonth, 1) : 0,
  )
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const cents = parseAmountToCents(amount)
    if (cents === null || cents === 0) {
      setError('Bitte einen Betrag eingeben.')
      return
    }

    const donation: CreateDonationInput = {
      kind,
      amountCents: cents,
      paidOn,
      note: note.trim(),
      coversThroughMonth: kind === 'zehnten' ? covers : null,
    }
    add.mutate(donation, { onSuccess: onClose })
  }

  return (
    <Sheet title={`${DONATION_LABELS[kind]} erfassen`}>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
        <AmountField label="Betrag" value={amount} onChange={setAmount} autoFocus />

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Bezahlt am</span>
          <input
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        {kind === 'zehnten' ? (
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
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Damit steht auf dem Bildschirm, bis wann ihr abgerechnet habt.
            </span>
          </label>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Notiz (freiwillig)</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="mt-auto flex gap-2 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={add.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function SettingsEditor({ data, onClose }: { data: FinanceYear; onClose: () => void }) {
  const save = useSaveFinanceSettings(data.year)

  const [tax, setTax] = useState(() => formatAmount(data.settings.taxCents))
  const [deductTax, setDeductTax] = useState(data.settings.deductTax)
  const [rate, setRate] = useState(() =>
    (data.settings.rateBasisPoints / 100).toString().replace('.', ','),
  )
  const [settled, setSettled] = useState(data.settings.settledThroughMonth)
  const [error, setError] = useState<string | null>(null)

  const vorschau = useMemo(() => {
    const taxCents = parseAmountToCents(tax) ?? 0
    return deductTax ? formatAmount(Math.round(taxCents / 12)) : null
  }, [tax, deductTax])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const taxCents = tax.trim() === '' ? 0 : parseAmountToCents(tax)
    if (taxCents === null) {
      setError(`Steuerbetrag nicht lesbar: „${tax}"`)
      return
    }

    const rateValue = Number(rate.replace(',', '.'))
    if (!Number.isFinite(rateValue) || rateValue < 0 || rateValue > 100) {
      setError('Der Satz muss zwischen 0 und 100 liegen.')
      return
    }

    const settings: FinanceSettings = {
      taxCents,
      deductTax,
      rateBasisPoints: Math.round(rateValue * 100),
      settledThroughMonth: settled,
    }
    save.mutate(settings, { onSuccess: onClose })
  }

  return (
    <Sheet title={`Einstellungen ${data.year}`}>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
        <AmountField label="Steuern für das ganze Jahr" value={tax} onChange={setTax} />

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <input
            type="checkbox"
            checked={deductTax}
            onChange={(event) => setDeductTax(event.target.checked)}
            className="mt-1 size-5 shrink-0 accent-brand-800"
          />
          <span>
            <span className="block text-sm font-medium">
              Steuern vor dem Zehnten abziehen
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              {vorschau
                ? `Pro Monat werden CHF ${vorschau} vom Einkommen abgezogen.`
                : 'Der Zehnte wird auf dem vollen erfassten Einkommen gerechnet.'}
            </span>
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Satz in Prozent</span>
          <input
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            inputMode="decimal"
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-right text-lg tabular-nums dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Zehnter abgerechnet bis und mit</span>
          <select
            value={settled}
            onChange={(event) => setSettled(Number(event.target.value))}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base dark:border-slate-700 dark:bg-slate-900"
          >
            <option value={0}>noch nichts</option>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="mt-auto flex gap-2 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={save.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

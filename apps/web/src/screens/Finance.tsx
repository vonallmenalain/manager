import {
  computePayment,
  DONATION_LABELS,
  formatAmount,
  monthListLabel,
  monthName,
  parseAmountToCents,
  taxCreditFor,
  type Donation,
  type IncomeEntry,
  type MonthFigures,
  type TaxYearFigures,
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
  useSaveTaxes,
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
                  settled={data.figures.settledMonths.includes(figures.month)}
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
  const steuerjahr = data.taxYears.find((tax) => tax.year === data.year)
  const andereOffen = data.taxYears.filter((tax) => tax.year !== data.year && tax.openCents > 0)

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
        <Row label="Zehnter (10 %)" value={figures.owedTithingCents} />
        <Row label="− Steuern verrechnet" value={figures.taxCreditAppliedCents} tone="soft" />
        <Row label="− bereits bezahlt" value={figures.paidTithingCents} tone="soft" />
        <Row label="= offen" value={figures.openTithingCents} />
      </dl>

      <p className="mt-3 text-xs text-white/70">
        {figures.taxTotalCents > 0
          ? `Steuern ${data.year} CHF ${formatAmount(figures.taxTotalCents)}, davon verrechenbar CHF ${formatAmount(figures.taxCreditTotalCents)} (10 %): CHF ${formatAmount(steuerjahr?.appliedCents ?? 0)} verrechnet, CHF ${formatAmount(figures.taxCreditOpenCents)} noch offen.`
          : `Für ${data.year} sind noch keine Steuern hinterlegt – unter „Steuern" eintragen.`}
        {andereOffen.length > 0
          ? ` Aus anderen Steuerjahren noch zu verrechnen: ${andereOffen
              .map((tax) => `${tax.year} CHF ${formatAmount(tax.openCents)}`)
              .join(', ')}.`
          : ''}
        {figures.paidFastOfferingCents > 0
          ? ` Fastopfer bezahlt: CHF ${formatAmount(figures.paidFastOfferingCents)}.`
          : ''}
      </p>

      <p className="mt-1 text-xs text-white/70">
        {figures.settledMonths.length === 0
          ? 'Noch nichts abgerechnet.'
          : `Abgerechnet: ${monthListLabel(figures.settledMonths)}.`}
        {figures.openMonths.length > 0 ? ` Offen: ${monthListLabel(figures.openMonths)}.` : ''}
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
                {donation.coversMonths.length > 0
                  ? ` · ${monthListLabel(donation.coversMonths)}`
                  : ''}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatDate(donation.paidOn)}
                {donation.taxAppliedCents > 0 ? ` · ${taxAppliedLabel(donation)}` : ''}
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

/** „Steuern 2025: 1'200.00 verrechnet" – samt den Steuerjahren, aus denen es stammt. */
function taxAppliedLabel(donation: Donation): string {
  const jahre = yearListLabel(donation.taxCredits.map((credit) => credit.taxYear))
  return `Steuern ${jahre ? `${jahre}: ` : ''}${formatAmount(donation.taxAppliedCents)} verrechnet`
}

/** Jahre so, wie man sie ausspricht: „2025", „2024 und 2025", „2023, 2024 und 2025". */
function yearListLabel(years: readonly number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b).map(String)
  const last = sorted.pop()
  if (last === undefined) return ''
  return sorted.length > 0 ? `${sorted.join(', ')} und ${last}` : last
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
 * Zahlung erfassen – man hakt die offenen Monate ab, alles andere rechnet
 * sich daraus.
 *
 * Eingegeben wird nur, was man wirklich weiss: welche Monate abgerechnet
 * werden, wie hoch das Fastopfer je Monat ist, wie viel Steuerguthaben
 * verrechnet wird und wann bezahlt wurde. Der Zehnte steht nicht zur Eingabe:
 * Er ist ein Zehntel des erfassten Einkommens dieser Monate, und ein Feld
 * dafür wäre bloss eine Gelegenheit, sich zu vertippen.
 *
 * Die Steuern lassen sich auf zwei Arten verrechnen: ein Steuerjahr anhaken,
 * dann steht sein ganzes offenes Guthaben im Feld – oder einen Betrag von Hand
 * eintragen, der dann aus dem ältesten offenen Jahr zuerst kommt. Ein Betrag
 * bei angehakten Jahren bleibt in diesen Jahren.
 *
 * Als Einziges hier ohne Autospeichern: Eine Zahlung ist ein Ereignis, kein
 * Text, an dem man arbeitet. Würde beim Tippen gespeichert, entstünde für
 * jeden Zwischenstand ein Beleg.
 */
function PaymentEditor({ data, onClose }: { data: FinanceYear; onClose: () => void }) {
  const add = useAddPayment(data.year)
  const { figures } = data

  // Vorgewählt ist alles Offene – das ist der Normalfall. Wer nur einen Teil
  // zahlt, hakt ab, was er nicht zahlt.
  const [months, setMonths] = useState<number[]>(() => figures.openMonths)
  const [fastOffering, setFastOffering] = useState('')
  const [tax, setTax] = useState('')
  const [taxYears, setTaxYears] = useState<number[]>([])
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState<string | null>(null)

  const fastCents = readAmount(fastOffering)
  const taxCents = readAmount(tax)
  const lesbar = fastCents !== 'fehler' && taxCents !== 'fehler'

  /**
   * Die Vorschau – gerechnet mit derselben Funktion, die gleich danach auf
   * dem Server den Beleg schreibt. So steht hier keine andere Zahl als dort.
   */
  const rechnung = useMemo(
    () =>
      computePayment(
        data.entries,
        {
          months,
          fastOfferingPerMonthCents: fastCents === 'fehler' ? 0 : (fastCents ?? 0),
          taxAppliedCents: taxCents === 'fehler' ? 0 : (taxCents ?? 0),
          taxYears,
        },
        data.taxYears,
      ),
    [data.entries, months, fastCents, taxCents, taxYears, data.taxYears],
  )

  /** Die Steuerjahre, in denen noch etwas zu verrechnen ist – das älteste zuerst. */
  const offeneJahre = data.taxYears.filter((steuerjahr) => steuerjahr.openCents > 0)

  function toggleMonth(month: number) {
    setMonths((current) =>
      current.includes(month) ? current.filter((item) => item !== month) : [...current, month],
    )
  }

  /**
   * Anhaken verrechnet ein Jahr ganz: Ins Feld kommt, was die angehakten
   * Jahre zusammen noch offen haben. Wer weniger will, ändert danach den
   * Betrag – er kommt dann weiter aus den angehakten Jahren.
   */
  function toggleTaxYear(year: number) {
    const next = taxYears.includes(year)
      ? taxYears.filter((item) => item !== year)
      : [...taxYears, year]
    const summe = offeneJahre
      .filter((steuerjahr) => next.includes(steuerjahr.year))
      .reduce((total, steuerjahr) => total + steuerjahr.openCents, 0)

    setTaxYears(next)
    setTax(summe > 0 ? formatAmount(summe) : '')
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!lesbar) {
      setError('Bitte einen lesbaren Betrag eingeben.')
      return
    }
    if (months.length === 0) {
      setError('Bitte mindestens einen Monat anhaken.')
      return
    }

    add.mutate(
      {
        months: rechnung.months,
        // Nach der Prüfung oben sind beide Felder lesbar; leer heisst 0.
        fastOfferingPerMonthCents: fastCents ?? 0,
        taxAppliedCents: rechnung.taxAppliedCents,
        // Die Auswahl so, wie sie angehakt ist: Auch ein Jahr, das inzwischen
        // aufgebraucht ist, gehört dazu. Fiele es weg, wäre die Liste leer –
        // und leer hiesse beim Server „aus allen Jahren".
        taxYears,
        paidOn,
      },
      { onSuccess: onClose },
    )
  }

  const monatsWort = months.length === 1 ? '1 Monat' : `${months.length} Monate`

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
      footer={
        <div className="space-y-3">
          <PaymentSummary rechnung={rechnung} monatsWort={monatsWort} fastCents={fastCents} />

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <Button
            type="submit"
            form="zahlung"
            loading={add.isPending}
            disabled={figures.openMonths.length === 0}
          >
            Zahlung erfassen
          </Button>
        </div>
      }
    >
      <form id="zahlung" onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Monate abrechnen</legend>
          {figures.openMonths.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {figures.lastEnteredMonth === 0
                ? 'Für dieses Jahr ist noch kein Einkommen erfasst.'
                : 'Alle erfassten Monate sind abgerechnet.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {figures.months
                .filter((month) => figures.openMonths.includes(month.month))
                .map((month) => (
                  <MonthCheck
                    key={month.month}
                    figures={month}
                    checked={months.includes(month.month)}
                    onToggle={() => toggleMonth(month.month)}
                  />
                ))}
            </ul>
          )}
        </fieldset>

        <AmountField
          label="Fastopfer pro Monat"
          value={fastOffering}
          onChange={setFastOffering}
          hint={
            rechnung.fastOfferingCents > 0
              ? `${monatsWort} × ${formatAmount(fastCents === 'fehler' ? 0 : (fastCents ?? 0))} = CHF ${formatAmount(rechnung.fastOfferingCents)}.`
              : undefined
          }
        />

        <div>
          <AmountField label="Steuern verrechnen" value={tax} onChange={setTax} />

          {offeneJahre.length > 0 ? (
            <ul
              className="mt-2 space-y-1.5"
              aria-label="Steuerjahre, die noch nicht verrechnet sind"
            >
              {offeneJahre.map((steuerjahr) => (
                <TaxYearCheck
                  key={steuerjahr.year}
                  figures={steuerjahr}
                  checked={taxYears.includes(steuerjahr.year)}
                  onToggle={() => toggleTaxYear(steuerjahr.year)}
                />
              ))}
            </ul>
          ) : null}

          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {taxHint({
              data,
              rechnung,
              wunschCents: taxCents === 'fehler' ? 0 : (taxCents ?? 0),
              angehakt: taxYears.length > 0,
              offen: offeneJahre.length > 0,
            })}
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Bezahlt am</span>
          <input
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
      </form>
    </Modal>
  )
}

/**
 * Was unter den Steuerjahren steht: woher das Verrechnete stammt, und warum
 * es weniger ist als eingetragen, wenn es gedeckelt wurde.
 */
function taxHint({
  data,
  rechnung,
  wunschCents,
  angehakt,
  offen,
}: {
  data: FinanceYear
  rechnung: ReturnType<typeof computePayment>
  wunschCents: number
  angehakt: boolean
  offen: boolean
}): string {
  if (!offen) {
    return data.taxYears.some((steuerjahr) => steuerjahr.taxCents > 0)
      ? 'Alle hinterlegten Steuern sind verrechnet.'
      : 'Noch keine Steuern hinterlegt – unter „Steuern" eintragen.'
  }
  if (wunschCents === 0) {
    return 'Ein Jahr anhaken verrechnet alles, was dort noch offen ist. Ein Betrag von Hand kommt aus dem ältesten Jahr zuerst.'
  }

  const saetze: string[] = []

  // Mit angehakten Jahren sagen die Häkchen schon, woher es kommt. Von Hand
  // wählt die App das Jahr – das soll man sehen, bevor man bezahlt.
  if (!angehakt && rechnung.taxCredits.length > 0) {
    const teile = rechnung.taxCredits.map(
      (credit) => `${credit.taxYear} (CHF ${formatAmount(credit.amountCents)})`,
    )
    const letzter = teile.pop()
    saetze.push(
      `Verrechnet wird aus ${teile.length > 0 ? `${teile.join(', ')} und ${letzter}` : letzter}.`,
    )
  }

  if (wunschCents > rechnung.taxAppliedCents) {
    saetze.push(
      rechnung.tithingCents < rechnung.availableTaxCreditCents
        ? `Diese Zahlung trägt höchstens CHF ${formatAmount(rechnung.maxTaxCreditCents)} – der Rest bleibt für die nächste stehen.`
        : angehakt
          ? `In den angehakten Jahren sind nur CHF ${formatAmount(rechnung.availableTaxCreditCents)} offen.`
          : `Offen sind insgesamt nur CHF ${formatAmount(rechnung.availableTaxCreditCents)}.`,
    )
  }

  return saetze.join(' ')
}

/** Ein Steuerjahr zum Anhaken: woraus es besteht und was davon noch offen ist. */
function TaxYearCheck({
  figures,
  checked,
  onToggle,
}: {
  figures: TaxYearFigures
  checked: boolean
  onToggle: () => void
}) {
  const herkunft = [
    figures.labels.join(', '),
    `10 % von ${formatAmount(figures.taxCents)}`,
    figures.appliedCents > 0 ? `${formatAmount(figures.appliedCents)} schon verrechnet` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="size-5 shrink-0 accent-brand-700"
        />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Steuern {figures.year}</span>
          {/* Umbrechen statt abschneiden: Hier steht, wovon die 10 % gerechnet
              sind. Und eine Zeile ohne Umbruch machte das Fenster breiter als
              den Bildschirm – das Raster des Fensters richtet sich nach ihr. */}
          <span className="block text-xs break-words text-slate-500 dark:text-slate-400">
            {herkunft}
          </span>
        </span>
        <span className="shrink-0 text-right font-semibold tabular-nums">
          {formatAmount(figures.openCents)}
        </span>
      </label>
    </li>
  )
}

/** Ein Monat zum Abhaken: Name, Einkommen, Zehnter. */
function MonthCheck({
  figures,
  checked,
  onToggle,
}: {
  figures: MonthFigures
  checked: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="size-5 shrink-0 accent-brand-700"
        />
        <span className="min-w-0 flex-1 font-medium">{monthName(figures.month)}</span>
        <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {formatAmount(figures.incomeCents)}
        </span>
        <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
          {formatAmount(figures.tithingCents)}
        </span>
      </label>
    </li>
  )
}

/**
 * Die Kachel unter dem Formular: was zu überweisen ist, und woraus es
 * besteht. Sie steht im Fuss des Fensters und bleibt deshalb sichtbar,
 * während man oben die Monate anhakt.
 */
function PaymentSummary({
  rechnung,
  monatsWort,
  fastCents,
}: {
  rechnung: ReturnType<typeof computePayment>
  monatsWort: string
  fastCents: number | null | 'fehler'
}) {
  const jeMonat = fastCents === 'fehler' ? 0 : (fastCents ?? 0)

  return (
    <section className="rounded-xl bg-brand-800 p-3 text-white">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-white/70">Zu bezahlen</span>
        <span className="text-2xl font-bold tabular-nums">
          CHF {formatAmount(rechnung.totalCents)}
        </span>
      </div>

      <dl className="mt-2 space-y-1 border-t border-white/20 pt-2 text-xs tabular-nums">
        <Row label={`Zehnter (${monatsWort})`} value={rechnung.tithingCents} tone="soft" />
        <Row
          label={
            rechnung.taxCredits.length > 0
              ? `− Steuern ${yearListLabel(rechnung.taxCredits.map((credit) => credit.taxYear))} verrechnet`
              : '− Steuern verrechnet'
          }
          value={rechnung.taxAppliedCents}
          tone="soft"
        />
        <Row
          label={jeMonat > 0 ? `Fastopfer (${monatsWort} × ${formatAmount(jeMonat)})` : 'Fastopfer'}
          value={rechnung.fastOfferingCents}
          tone="soft"
        />
      </dl>
    </section>
  )
}

/** Eine Zeile im Fenster „Steuern", so wie sie getippt wird. */
interface TaxRow {
  label: string
  amount: string
  /** Eben mit „+ weiterer Betrag" angelegt – bekommt den Cursor. */
  neu?: boolean
}

/**
 * Die Steuern eines Jahres – ein Betrag je Zeile, etwa Bundessteuer und
 * Staats- und Gemeindesteuer. Verrechenbar ist ein Zehntel ihrer Summe.
 *
 * Wann das Guthaben daraus verrechnet wird, steht hier bewusst nicht: Das
 * entscheidet sich bei jeder Zahlung – oft erst im Jahr danach, wenn die
 * Steuerrechnung da ist.
 */
function TaxEditor({ data, onClose }: { data: FinanceYear; onClose: () => void }) {
  const save = useSaveTaxes(data.year)

  // Eine Zeile steht immer da: Wer „Steuern" öffnet, will einen Betrag
  // eintragen und nicht zuerst eine Zeile anlegen.
  const [rows, setRows] = useState<TaxRow[]>(() => {
    const bestehend = data.taxEntries.map((entry) => ({
      label: entry.label,
      amount: formatAmount(entry.amountCents),
    }))
    return bestehend.length > 0 ? bestehend : [{ label: '', amount: '' }]
  })

  /** Die Zeilen, wie sie gespeichert würden – oder null bei Unlesbarem. */
  const entries = useMemo(() => {
    const result: { label: string; amountCents: number }[] = []

    for (const row of rows) {
      const cents = readAmount(row.amount)
      if (cents === 'fehler') return null
      // Ohne Betrag keine Steuer – eine Bezeichnung allein wird nicht
      // gespeichert. Eine ausdrückliche 0 bleibt, wie beim Einkommen.
      if (cents === null) continue
      result.push({ label: row.label.trim(), amountCents: cents })
    }

    return result
  }, [rows])

  const autosave = useAutosave(
    { entries },
    async (stand) => {
      if (!stand.entries) return
      await save.mutateAsync({ entries: stand.entries })
    },
    { savable: (stand) => stand.entries !== null },
  )

  const summe = entries?.reduce((total, entry) => total + entry.amountCents, 0) ?? 0
  const verrechnet = data.taxYears.find((tax) => tax.year === data.year)?.appliedCents ?? 0

  function updateRow(index: number, patch: Partial<TaxRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function removeRow(index: number) {
    setRows((current) => {
      const rest = current.filter((_, i) => i !== index)
      return rest.length > 0 ? rest : [{ label: '', amount: '' }]
    })
  }

  return (
    <Modal
      onClose={onClose}
      label={`Steuern ${data.year}`}
      header={
        <>
          <span className="text-sm font-semibold">Steuern {data.year}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {saveStateLabel(autosave.state, entries === null ? 'Betrag nicht lesbar' : undefined)}
            </span>
            <ModalCloseButton onClick={onClose} label="Fenster schliessen" />
          </div>
        </>
      }
      footer={
        summe > 0 || verrechnet > 0 ? (
          <dl className="space-y-1 text-sm tabular-nums">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400">Steuern {data.year}</dt>
              <dd>{formatAmount(summe)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-semibold">
              <dt>Verrechenbar (10 %)</dt>
              <dd>{formatAmount(taxCreditFor(summe))}</dd>
            </div>
            {verrechnet > 0 ? (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">davon schon verrechnet</dt>
                <dd>{formatAmount(verrechnet)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null
      }
    >
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={index} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex gap-2">
              <input
                value={row.label}
                onChange={(event) => updateRow(index, { label: event.target.value })}
                placeholder="Bezeichnung, z. B. Bundessteuer"
                aria-label="Bezeichnung der Steuer"
                // Mehr nimmt der Server nicht an – und ein Autospeichern, das
                // immer wieder abgewiesen wird, speichert gar nichts mehr.
                maxLength={60}
                autoFocus={row.neu || (data.taxEntries.length === 0 && index === 0)}
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900"
              />
              {rows.length > 1 || row.label || row.amount ? (
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="shrink-0 px-2 text-slate-400"
                  aria-label={row.label ? `${row.label} entfernen` : 'Betrag entfernen'}
                >
                  ✕
                </button>
              ) : null}
            </div>
            <input
              value={row.amount}
              onChange={(event) => updateRow(index, { amount: event.target.value })}
              inputMode="decimal"
              placeholder="0.00"
              aria-label={row.label ? `Betrag ${row.label}` : 'Betrag'}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-right text-lg tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
        ))}

        <button
          type="button"
          onClick={() => setRows((current) => [...current, { label: '', amount: '', neu: true }])}
          className="text-left text-sm font-medium text-brand-700 dark:text-brand-400"
        >
          + weiterer Betrag
        </button>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Steuern mindern nicht die Zahlung, sondern das Einkommen, auf das der Zehnte gerechnet
          wird. Verrechnen lässt sich davon deshalb ein Zehntel – von der Summe aller Beträge
          dieses Jahres.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Verrechnet wird beim Erfassen einer Zahlung, ganz oder in Teilen – auch mit einer
          Zahlung im Jahr danach, wenn die Steuerrechnung erst dann kommt.
        </p>
      </div>
    </Modal>
  )
}

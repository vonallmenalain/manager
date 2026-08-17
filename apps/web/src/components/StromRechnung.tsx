import {
  BILL_KINDS,
  BILL_KIND_LABELS,
  COST_GROUPS,
  COST_GROUP_LABELS,
  formatAmount,
  formatKwh,
  formatPeriod,
  formatRappen,
  parseAmountToCents,
  TARIFF_LABELS,
  type BillInput,
  type BillKind,
  type ElectricityBill,
  type MeterReading,
  type Tariff,
} from '@manager/shared'
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'

import { Button } from './Button'

/**
 * Das Formular, in dem eine Rechnung steht – nach dem Auslesen eines PDFs, beim
 * Nachbessern und beim Erfassen von Hand.
 *
 * Ein Formular für alle drei Wege, weil alle drei dasselbe Ergebnis haben
 * sollen. Die Vorschau nach dem Import ist deshalb kein Bericht zum Abnicken,
 * sondern bereits die Eingabemaske: Was der Automat falsch gelesen hat, wird
 * an Ort und Stelle korrigiert, statt später an einer zweiten Stelle.
 *
 * Zwischentotal und Rechnungsbetrag stehen nicht als Felder darin, sondern
 * werden gerechnet. Zwei Zahlen, die auseinanderlaufen können, wären eine
 * Fehlerquelle ohne Gegenwert – auf der Rechnung ergeben sie sich genauso aus
 * den drei Blöcken und dem Akontoabzug.
 */

interface Draft {
  kind: BillKind
  invoiceNumber: string
  invoiceDate: string
  periodStart: string
  periodEnd: string
  customerNumber: string
  meterPoint: string
  meterNumber: string
  hochKwh: string
  niederKwh: string
  hochStart: string
  hochEnd: string
  niederStart: string
  niederEnd: string
  energie: string
  netz: string
  abgaben: string
  akonto: string
  mwst: string
  note: string
}

/** Rappen als schlichte Eingabe: „1090.15", ohne Tausendertrennung. */
function toAmountInput(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2)
}

function toNumberInput(value: number | null): string {
  return value === null ? '' : String(value)
}

function readAmount(input: string): number {
  return parseAmountToCents(input) ?? 0
}

function readCount(input: string): number | null {
  const cleaned = input.replace(/['’\s]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

function readingOf(bill: BillInput | null, tariff: Tariff): MeterReading | undefined {
  return bill?.readings.find((reading) => reading.tariff === tariff)
}

function toDraft(bill: BillInput | null): Draft {
  const hoch = readingOf(bill, 'hoch')
  const nieder = readingOf(bill, 'nieder')

  return {
    kind: bill?.kind ?? 'abrechnung',
    invoiceNumber: bill?.invoiceNumber ?? '',
    invoiceDate: bill?.invoiceDate ?? '',
    periodStart: bill?.periodStart ?? '',
    periodEnd: bill?.periodEnd ?? '',
    customerNumber: bill?.customerNumber ?? '',
    meterPoint: bill?.meterPoint ?? '',
    meterNumber: bill?.meterNumber ?? '',
    hochKwh: toNumberInput(hoch?.kwh ?? null),
    niederKwh: toNumberInput(nieder?.kwh ?? null),
    hochStart: toNumberInput(hoch?.startValue ?? null),
    hochEnd: toNumberInput(hoch?.endValue ?? null),
    niederStart: toNumberInput(nieder?.startValue ?? null),
    niederEnd: toNumberInput(nieder?.endValue ?? null),
    energie: toAmountInput(bill?.energyCents ?? 0),
    netz: toAmountInput(bill?.gridCents ?? 0),
    abgaben: toAmountInput(bill?.leviesCents ?? 0),
    akonto: toAmountInput(bill?.prepaidCents ?? 0),
    mwst: toAmountInput(bill?.vatCents ?? 0),
    note: bill?.note ?? '',
  }
}

function toBill(draft: Draft, vorlage: BillInput | null): BillInput {
  const readings: MeterReading[] = []
  const hochKwh = readCount(draft.hochKwh)
  const niederKwh = readCount(draft.niederKwh)

  if (hochKwh !== null) {
    readings.push({
      tariff: 'hoch',
      kwh: hochKwh,
      startValue: readCount(draft.hochStart),
      endValue: readCount(draft.hochEnd),
    })
  }
  if (niederKwh !== null) {
    readings.push({
      tariff: 'nieder',
      kwh: niederKwh,
      startValue: readCount(draft.niederStart),
      endValue: readCount(draft.niederEnd),
    })
  }

  const energyCents = readAmount(draft.energie)
  const gridCents = readAmount(draft.netz)
  const leviesCents = readAmount(draft.abgaben)
  const prepaidCents = readAmount(draft.akonto)
  const subtotalCents = energyCents + gridCents + leviesCents

  return {
    kind: draft.kind,
    invoiceNumber: draft.invoiceNumber.trim(),
    invoiceDate: draft.invoiceDate,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    customerNumber: draft.customerNumber.trim() || null,
    meterPoint: draft.meterPoint.trim() || null,
    meterNumber: draft.meterNumber.trim() || null,
    readings,
    // Die einzelnen Zeilen der Rechnung kommen aus dem PDF und bleiben, wie sie
    // sind: Sie sind das Abbild des Papiers. Von Hand ändert man die Summen.
    positions: vorlage?.positions ?? [],
    energyCents,
    gridCents,
    leviesCents,
    subtotalCents,
    prepaidCents,
    totalCents: Math.max(0, subtotalCents - prepaidCents),
    vatCents: readAmount(draft.mwst),
    sourceFile: vorlage?.sourceFile ?? null,
    note: draft.note.trim(),
  }
}

export function RechnungFormular({
  bill,
  fields,
  saving,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** Die Vorlage: aus dem PDF gelesen, aus der Liste geöffnet – oder nichts. */
  bill: BillInput | null
  /** Feldbezogene Meldungen der API, etwa bei doppelter Rechnungsnummer. */
  fields?: Record<string, string>
  saving?: boolean
  submitLabel: string
  onSubmit: (bill: BillInput) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(bill))
  const set = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }))

  const zwischentotal =
    readAmount(draft.energie) + readAmount(draft.netz) + readAmount(draft.abgaben)
  const rechnungsbetrag = Math.max(0, zwischentotal - readAmount(draft.akonto))
  const verbrauch = (readCount(draft.hochKwh) ?? 0) + (readCount(draft.niederKwh) ?? 0)

  const fehlt = !draft.invoiceNumber.trim() || !draft.invoiceDate || !draft.periodStart || !draft.periodEnd

  function submit(event: FormEvent) {
    event.preventDefault()
    if (fehlt) return
    onSubmit(toBill(draft, bill))
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="space-y-3">
        <Legende>Rechnung</Legende>

        <div className="grid grid-cols-2 gap-2">
          {BILL_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => set({ kind })}
              aria-pressed={draft.kind === kind}
              className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition ${
                draft.kind === kind
                  ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-900/40 dark:text-brand-100'
                  : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'
              }`}
            >
              {BILL_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Eine Akontorechnung ist eine Vorauszahlung ohne eigenen Verbrauch. Sie zählt bei den
          Zahlungen mit, nicht beim Strom.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Feld
            label="Rechnung Nr."
            value={draft.invoiceNumber}
            onChange={(value) => set({ invoiceNumber: value })}
            error={fields?.invoiceNumber}
            required
          />
          <Feld
            label="Rechnungsdatum"
            type="date"
            value={draft.invoiceDate}
            onChange={(value) => set({ invoiceDate: value })}
            required
          />
          <Feld
            label="Periode von"
            type="date"
            value={draft.periodStart}
            onChange={(value) => set({ periodStart: value })}
            required
          />
          <Feld
            label="Periode bis"
            type="date"
            value={draft.periodEnd}
            onChange={(value) => set({ periodEnd: value })}
            required
          />
        </div>
      </fieldset>

      {draft.kind === 'abrechnung' ? (
        <fieldset className="space-y-3">
          <Legende>Verbrauch</Legende>
          <div className="grid grid-cols-2 gap-3">
            <Feld
              label="Hochtarif kWh"
              inputMode="numeric"
              value={draft.hochKwh}
              onChange={(value) => set({ hochKwh: value })}
            />
            <Feld
              label="Niedertarif kWh"
              inputMode="numeric"
              value={draft.niederKwh}
              onChange={(value) => set({ niederKwh: value })}
            />
          </div>
          <Summenzeile label="Verbrauch gesamt" value={`${formatKwh(verbrauch)} kWh`} />

          <details className="rounded-xl border border-slate-200 dark:border-slate-700">
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              Zählerstände
            </summary>
            <div className="grid grid-cols-2 gap-3 px-3 pb-3">
              <Feld
                label="Hochtarif alt"
                inputMode="numeric"
                value={draft.hochStart}
                onChange={(value) => set({ hochStart: value })}
              />
              <Feld
                label="Hochtarif neu"
                inputMode="numeric"
                value={draft.hochEnd}
                onChange={(value) => set({ hochEnd: value })}
              />
              <Feld
                label="Niedertarif alt"
                inputMode="numeric"
                value={draft.niederStart}
                onChange={(value) => set({ niederStart: value })}
              />
              <Feld
                label="Niedertarif neu"
                inputMode="numeric"
                value={draft.niederEnd}
                onChange={(value) => set({ niederEnd: value })}
              />
            </div>
          </details>
        </fieldset>
      ) : null}

      <fieldset className="space-y-3">
        <Legende>Kosten in Franken</Legende>
        <div className="grid grid-cols-2 gap-3">
          <Feld
            label="Energie"
            inputMode="decimal"
            value={draft.energie}
            onChange={(value) => set({ energie: value })}
          />
          <Feld
            label="Netznutzung"
            inputMode="decimal"
            value={draft.netz}
            onChange={(value) => set({ netz: value })}
          />
          <Feld
            label="Abgaben"
            inputMode="decimal"
            value={draft.abgaben}
            onChange={(value) => set({ abgaben: value })}
          />
          <Feld
            label="Akontoabzug"
            inputMode="decimal"
            value={draft.akonto}
            onChange={(value) => set({ akonto: value })}
          />
          <Feld
            label="MWST"
            inputMode="decimal"
            value={draft.mwst}
            onChange={(value) => set({ mwst: value })}
          />
        </div>

        <div className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <Summenzeile label="Zwischentotal" value={`CHF ${formatAmount(zwischentotal)}`} />
          <Summenzeile
            label="Rechnungsbetrag"
            value={`CHF ${formatAmount(rechnungsbetrag)}`}
            stark
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <Legende>Weitere Angaben</Legende>
        <div className="grid gap-3">
          <Feld
            label="Kundennummer"
            value={draft.customerNumber}
            onChange={(value) => set({ customerNumber: value })}
          />
          <Feld
            label="Messpunkt"
            value={draft.meterPoint}
            onChange={(value) => set({ meterPoint: value })}
          />
          <Feld
            label="Zähler Nr."
            value={draft.meterNumber}
            onChange={(value) => set({ meterNumber: value })}
          />
          <Feld
            label="Notiz"
            value={draft.note}
            onChange={(value) => set({ note: value })}
          />
        </div>
      </fieldset>

      {bill && bill.positions.length > 0 ? (
        <fieldset className="space-y-2">
          <Legende>Aus dem PDF gelesene Positionen</Legende>
          <Positionstabelle positions={bill.positions} />
        </fieldset>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit" loading={saving} disabled={fehlt}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

// ------------------------------------------------------------------ Bausteine

function Legende({ children }: { children: ReactNode }) {
  return (
    <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </legend>
  )
}

function Feld({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  error,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  inputMode?: 'numeric' | 'decimal'
  error?: string
  required?: boolean
}) {
  const id = useId()

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        // text-base: Alles darunter lässt mobile Browser beim Fokus hineinzoomen.
        className={`w-full rounded-xl border bg-white px-3 py-2.5 text-base outline-none transition
          focus:ring-2 focus:ring-brand-500/40 dark:bg-slate-900
          ${
            error
              ? 'border-red-400 focus:border-red-500'
              : 'border-slate-300 focus:border-brand-500 dark:border-slate-700'
          }`}
      />
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  )
}

function Summenzeile({
  label,
  value,
  stark,
}: {
  label: string
  value: string
  stark?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-sm ${stark ? 'font-semibold' : ''} text-slate-600 dark:text-slate-300`}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          stark ? 'text-base font-bold' : 'text-sm font-semibold'
        } text-slate-900 dark:text-slate-100`}
      >
        {value}
      </span>
    </div>
  )
}

// ------------------------------------------------------------------- Ansicht

/**
 * Alle Werte einer Rechnung zum Nachlesen.
 *
 * Die Diagramme zeigen die Entwicklung, hier steht das Papier: jede Position
 * mit Menge, Ansatz und Steuersatz. Ohne diese Ansicht wäre eine Farbe im
 * Diagramm die einzige Quelle für einen Wert – und das ist keine.
 */
export function RechnungDetail({ bill }: { bill: ElectricityBill }) {
  const gruppen = useMemo(
    () =>
      COST_GROUPS.map((group) => ({
        group,
        positions: bill.positions.filter((position) => position.group === group),
      })).filter((eintrag) => eintrag.positions.length > 0),
    [bill.positions],
  )

  const verbrauch = bill.readings.reduce((sum, reading) => sum + reading.kwh, 0)

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Angabe label="Art" value={BILL_KIND_LABELS[bill.kind]} />
        <Angabe label="Rechnung Nr." value={bill.invoiceNumber} />
        <Angabe label="Periode" value={formatPeriod(bill.periodStart, bill.periodEnd)} weit />
        <Angabe label="Rechnungsdatum" value={formatDateLabel(bill.invoiceDate)} />
        {bill.meterNumber ? <Angabe label="Zähler Nr." value={bill.meterNumber} /> : null}
        {bill.customerNumber ? <Angabe label="Kundennummer" value={bill.customerNumber} /> : null}
        {bill.meterPoint ? <Angabe label="Messpunkt" value={bill.meterPoint} weit /> : null}
      </dl>

      {bill.readings.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Zählerstände
          </h3>
          <Tabelle
            kopf={['Tarif', 'Stand alt', 'Stand neu', 'kWh']}
            zeilen={bill.readings.map((reading) => [
              TARIFF_LABELS[reading.tariff],
              reading.startValue === null ? '–' : formatKwh(reading.startValue),
              reading.endValue === null ? '–' : formatKwh(reading.endValue),
              formatKwh(reading.kwh),
            ])}
            fuss={['Gesamt', '', '', formatKwh(verbrauch)]}
          />
        </section>
      ) : null}

      {gruppen.map((eintrag) => (
        <section key={eintrag.group} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {COST_GROUP_LABELS[eintrag.group]}
          </h3>
          <Tabelle
            kopf={['Position', 'Menge', 'Ansatz', 'CHF']}
            zeilen={eintrag.positions.map((position) => [
              position.label,
              `${formatKwh(position.quantity)} ${position.unit}`,
              position.rateHundredths === null
                ? '–'
                : `${formatRappen(position.rateHundredths)} ${position.rateUnit ?? ''}${
                    position.durationMonths ? ` · ${position.durationMonths} Mt.` : ''
                  }`,
              formatAmount(position.grossCents),
            ])}
          />
        </section>
      ))}

      <section className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
        <Summenzeile label="Energie" value={formatAmount(bill.energyCents)} />
        <Summenzeile label="Netznutzung" value={formatAmount(bill.gridCents)} />
        <Summenzeile label="Abgaben & Förderbeiträge" value={formatAmount(bill.leviesCents)} />
        <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
        <Summenzeile label="Zwischentotal" value={formatAmount(bill.subtotalCents)} />
        {bill.prepaidCents > 0 ? (
          <Summenzeile label="Akontoabzug" value={`−${formatAmount(bill.prepaidCents)}`} />
        ) : null}
        <Summenzeile label="Rechnungsbetrag" value={formatAmount(bill.totalCents)} stark />
        {bill.vatCents > 0 ? (
          <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">
            Darin enthalten CHF {formatAmount(bill.vatCents)} MWST.
          </p>
        ) : null}
      </section>

      {bill.note ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {bill.note}
        </p>
      ) : null}

      {bill.sourceFile ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Ausgelesen aus {bill.sourceFile}
        </p>
      ) : null}
    </div>
  )
}

function formatDateLabel(iso: string): string {
  const [year, month, day] = iso.split('-')
  return year && month && day ? `${day}.${month}.${year}` : iso
}

function Angabe({ label, value, weit }: { label: string; value: string; weit?: boolean }) {
  return (
    <div className={weit ? 'col-span-2' : ''}>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  )
}

function Positionstabelle({ positions }: { positions: ElectricityBill['positions'] }) {
  return (
    <Tabelle
      kopf={['Position', 'Menge', 'CHF']}
      zeilen={positions.map((position) => [
        position.label,
        `${formatKwh(position.quantity)} ${position.unit}`,
        formatAmount(position.grossCents),
      ])}
    />
  )
}

/**
 * Eine schmale Tabelle, die auf einem Handy waagrecht rollt statt die Seite
 * mitzuziehen – lange Positionsnamen sollen nicht den ganzen Bildschirm
 * verschieben.
 */
function Tabelle({
  kopf,
  zeilen,
  fuss,
}: {
  kopf: string[]
  zeilen: string[][]
  fuss?: string[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            {kopf.map((titel, index) => (
              <th
                key={titel}
                scope="col"
                className={`py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 ${
                  index === 0 ? 'text-left' : 'text-right'
                }`}
              >
                {titel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zeilen.map((zeile, index) => (
            <tr key={index} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              {zeile.map((zelle, spalte) => (
                <td
                  key={spalte}
                  className={`py-1.5 ${
                    spalte === 0
                      ? 'pr-2 text-slate-700 dark:text-slate-200'
                      : 'pl-2 text-right tabular-nums text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {zelle}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {fuss ? (
          <tfoot>
            <tr className="border-t border-slate-200 dark:border-slate-700">
              {fuss.map((zelle, index) => (
                <td
                  key={index}
                  className={`py-1.5 font-semibold ${
                    index === 0 ? 'text-left' : 'text-right tabular-nums'
                  } text-slate-900 dark:text-slate-100`}
                >
                  {zelle}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}

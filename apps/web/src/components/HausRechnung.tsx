import {
  BILL_KINDS,
  BILL_KIND_LABELS,
  COST_GROUPS,
  COST_GROUP_LABELS,
  DIVISIONS,
  DIVISION_LABELS,
  DIVISION_UNITS,
  formatAmount,
  formatMenge,
  formatPeriod,
  formatRappen,
  parseAmountToCents,
  TARIFF_LABELS,
  type BillInput,
  type BillKind,
  type BillSection,
  type CostGroup,
  type Division,
  type MeterReading,
  type UtilityBill,
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
 * werden gerechnet – aus den Sparten und dem Akontoabzug. Zwei Zahlen, die
 * auseinanderlaufen können, wären eine Fehlerquelle ohne Gegenwert.
 */

interface SectionDraft {
  division: Division
  /** Nur bei Sparten ohne Blöcke: der Betrag der Sparte. */
  amount: string
  /** Nur beim Strom: die drei Blöcke. */
  groups: Record<CostGroup, string>
  /** Menge je Tarif – beim Strom zwei, sonst eine. */
  quantities: Record<string, string>
  starts: Record<string, string>
  ends: Record<string, string>
  /** Was aus dem PDF kam und unverändert bleibt. */
  positions: BillSection['positions']
  meterPoint: string | null
  meterNumber: string | null
}

interface Draft {
  kind: BillKind
  invoiceNumber: string
  invoiceDate: string
  periodStart: string
  periodEnd: string
  customerNumber: string
  akonto: string
  mwst: string
  note: string
  sections: SectionDraft[]
}

/** Welche Tarife eine Sparte kennt. Wasser hat nur einen Zähler. */
function tariffsOf(division: Division): Array<MeterReading['tariff']> {
  if (DIVISION_UNITS[division] === null) return []
  return division === 'strom' ? ['hoch', 'nieder'] : ['einzel']
}

/** Rappen als schlichte Eingabe: „1090.15", ohne Tausendertrennung. */
function toAmountInput(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2)
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

function emptyGroups(): Record<CostGroup, string> {
  return { energie: '', netznutzung: '', abgaben: '' }
}

function toSectionDraft(section: BillSection): SectionDraft {
  const quantities: Record<string, string> = {}
  const starts: Record<string, string> = {}
  const ends: Record<string, string> = {}

  for (const tariff of tariffsOf(section.division)) {
    const reading = section.readings.find((entry) => entry.tariff === tariff)
    quantities[tariff] = reading ? String(reading.quantity) : ''
    starts[tariff] = reading?.startValue === null || reading?.startValue === undefined ? '' : String(reading.startValue)
    ends[tariff] = reading?.endValue === null || reading?.endValue === undefined ? '' : String(reading.endValue)
  }

  const groups = emptyGroups()
  for (const entry of section.groups) groups[entry.group] = toAmountInput(entry.amountCents)

  return {
    division: section.division,
    amount: toAmountInput(section.amountCents),
    groups,
    quantities,
    starts,
    ends,
    positions: section.positions,
    meterPoint: section.meterPoint,
    meterNumber: section.meterNumber,
  }
}

function neueSektion(division: Division): SectionDraft {
  const quantities: Record<string, string> = {}
  const starts: Record<string, string> = {}
  const ends: Record<string, string> = {}
  for (const tariff of tariffsOf(division)) {
    quantities[tariff] = ''
    starts[tariff] = ''
    ends[tariff] = ''
  }

  return {
    division,
    amount: '',
    groups: emptyGroups(),
    quantities,
    starts,
    ends,
    positions: [],
    meterPoint: null,
    meterNumber: null,
  }
}

function toDraft(bill: BillInput | null): Draft {
  return {
    kind: bill?.kind ?? 'abrechnung',
    invoiceNumber: bill?.invoiceNumber ?? '',
    invoiceDate: bill?.invoiceDate ?? '',
    periodStart: bill?.periodStart ?? '',
    periodEnd: bill?.periodEnd ?? '',
    customerNumber: bill?.customerNumber ?? '',
    akonto: toAmountInput(bill?.prepaidCents ?? 0),
    mwst: toAmountInput(bill?.vatCents ?? 0),
    note: bill?.note ?? '',
    sections: bill?.sections.map(toSectionDraft) ?? [neueSektion('strom')],
  }
}

/** Der Betrag einer Sparte: beim Strom die Summe der Blöcke, sonst das Feld. */
function sectionCents(section: SectionDraft): number {
  if (section.division === 'strom') {
    return COST_GROUPS.reduce((sum, group) => sum + readAmount(section.groups[group]), 0)
  }
  return readAmount(section.amount)
}

function toBill(draft: Draft, vorlage: BillInput | null): BillInput {
  const sections: BillSection[] = draft.sections.map((section) => {
    const readings: MeterReading[] = []
    for (const tariff of tariffsOf(section.division)) {
      const quantity = readCount(section.quantities[tariff] ?? '')
      if (quantity === null) continue
      readings.push({
        tariff,
        label: TARIFF_LABELS[tariff],
        unit: DIVISION_UNITS[section.division] ?? '',
        startValue: readCount(section.starts[tariff] ?? ''),
        endValue: readCount(section.ends[tariff] ?? ''),
        quantity,
      })
    }

    return {
      division: section.division,
      amountCents: sectionCents(section),
      groups:
        section.division === 'strom'
          ? COST_GROUPS.map((group) => ({ group, amountCents: readAmount(section.groups[group]) }))
          : [],
      readings,
      // Die einzelnen Zeilen der Rechnung kommen aus dem PDF und bleiben, wie
      // sie sind: Sie sind das Abbild des Papiers. Von Hand ändert man die Summen.
      positions: section.positions,
      meterPoint: section.meterPoint,
      meterNumber: section.meterNumber,
    }
  })

  const subtotalCents = sections.reduce((sum, section) => sum + section.amountCents, 0)
  const prepaidCents = readAmount(draft.akonto)

  return {
    kind: draft.kind,
    invoiceNumber: draft.invoiceNumber.trim(),
    invoiceDate: draft.invoiceDate,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    customerNumber: draft.customerNumber.trim() || null,
    sections,
    subtotalCents,
    prepaidCents,
    totalCents: Math.max(0, subtotalCents - prepaidCents),
    vatCents: readAmount(draft.mwst),
    documentId: vorlage?.documentId ?? null,
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

  const setSection = (division: Division, changes: Partial<SectionDraft>) =>
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.division === division ? { ...section, ...changes } : section,
      ),
    }))

  const zwischentotal = draft.sections.reduce((sum, section) => sum + sectionCents(section), 0)
  const rechnungsbetrag = Math.max(0, zwischentotal - readAmount(draft.akonto))

  const fehlt =
    !draft.invoiceNumber.trim() ||
    !draft.invoiceDate ||
    !draft.periodStart ||
    !draft.periodEnd ||
    draft.sections.length === 0

  function toggleDivision(division: Division) {
    setDraft((current) => {
      const vorhanden = current.sections.some((section) => section.division === division)
      const sections = vorhanden
        ? current.sections.filter((section) => section.division !== division)
        : [...current.sections, neueSektion(division)]
      return {
        ...current,
        sections: DIVISIONS.filter((d) => sections.some((s) => s.division === d)).map(
          (d) => sections.find((s) => s.division === d) as SectionDraft,
        ),
      }
    })
  }

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
          Zahlungen mit, nicht beim Verbrauch.
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

      <fieldset className="space-y-2">
        <Legende>Sparten auf dieser Rechnung</Legende>
        <div className="flex flex-wrap gap-1.5">
          {DIVISIONS.map((division) => {
            const aktiv = draft.sections.some((section) => section.division === division)
            return (
              <button
                key={division}
                type="button"
                onClick={() => toggleDivision(division)}
                aria-pressed={aktiv}
                className={`min-h-9 rounded-full border px-3 text-sm font-medium transition ${
                  aktiv
                    ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-900/40 dark:text-brand-100'
                    : 'border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400'
                }`}
              >
                {DIVISION_LABELS[division]}
              </button>
            )
          })}
        </div>
      </fieldset>

      {draft.sections.map((section) => (
        <SektionsFelder
          key={section.division}
          section={section}
          kind={draft.kind}
          onChange={(changes) => setSection(section.division, changes)}
        />
      ))}

      <fieldset className="space-y-3">
        <Legende>Rechnungsabschluss</Legende>
        <div className="grid grid-cols-2 gap-3">
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
          <Summenzeile label="Rechnungsbetrag" value={`CHF ${formatAmount(rechnungsbetrag)}`} stark />
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
          <Feld label="Notiz" value={draft.note} onChange={(value) => set({ note: value })} />
        </div>
      </fieldset>

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

function SektionsFelder({
  section,
  kind,
  onChange,
}: {
  section: SectionDraft
  kind: BillKind
  onChange: (changes: Partial<SectionDraft>) => void
}) {
  const einheit = DIVISION_UNITS[section.division]
  const tarife = tariffsOf(section.division)
  const menge = tarife.reduce((sum, tariff) => sum + (readCount(section.quantities[tariff] ?? '') ?? 0), 0)

  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <Legende>{DIVISION_LABELS[section.division]}</Legende>

      {section.division === 'strom' ? (
        <div className="grid grid-cols-2 gap-3">
          {COST_GROUPS.map((group) => (
            <Feld
              key={group}
              label={`${COST_GROUP_LABELS[group]} CHF`}
              inputMode="decimal"
              value={section.groups[group]}
              onChange={(value) => onChange({ groups: { ...section.groups, [group]: value } })}
            />
          ))}
        </div>
      ) : (
        <Feld
          label="Betrag CHF"
          inputMode="decimal"
          value={section.amount}
          onChange={(value) => onChange({ amount: value })}
        />
      )}

      {kind === 'abrechnung' && einheit !== null ? (
        <>
          <div className={`grid gap-3 ${tarife.length > 1 ? 'grid-cols-2' : ''}`}>
            {tarife.map((tariff) => (
              <Feld
                key={tariff}
                label={`${tarife.length > 1 ? TARIFF_LABELS[tariff] : 'Verbrauch'} ${einheit}`}
                inputMode="numeric"
                value={section.quantities[tariff] ?? ''}
                onChange={(value) =>
                  onChange({ quantities: { ...section.quantities, [tariff]: value } })
                }
              />
            ))}
          </div>
          {tarife.length > 1 ? (
            <Summenzeile label="Verbrauch gesamt" value={`${formatMenge(menge)} ${einheit}`} />
          ) : null}

          <details className="rounded-xl border border-slate-200 dark:border-slate-700">
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              Zählerstände
            </summary>
            <div className="grid grid-cols-2 gap-3 px-3 pb-3">
              {tarife.map((tariff) => (
                <div key={tariff} className="contents">
                  <Feld
                    label={`${tarife.length > 1 ? TARIFF_LABELS[tariff] : 'Stand'} alt`}
                    inputMode="numeric"
                    value={section.starts[tariff] ?? ''}
                    onChange={(value) => onChange({ starts: { ...section.starts, [tariff]: value } })}
                  />
                  <Feld
                    label={`${tarife.length > 1 ? TARIFF_LABELS[tariff] : 'Stand'} neu`}
                    inputMode="numeric"
                    value={section.ends[tariff] ?? ''}
                    onChange={(value) => onChange({ ends: { ...section.ends, [tariff]: value } })}
                  />
                </div>
              ))}
            </div>
          </details>
        </>
      ) : null}

      {section.positions.length > 0 ? (
        <details className="rounded-xl border border-slate-200 dark:border-slate-700">
          <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            {section.positions.length} Positionen aus dem PDF
          </summary>
          <div className="px-3 pb-3">
            <Tabelle
              kopf={['Position', 'Menge', 'CHF']}
              zeilen={section.positions.map((position) => [
                position.label,
                `${formatMenge(position.quantity)} ${position.unit}`,
                formatAmount(position.grossCents),
              ])}
            />
          </div>
        </details>
      ) : null}
    </fieldset>
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

function Summenzeile({ label, value, stark }: { label: string; value: string; stark?: boolean }) {
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
 * Die Diagramme zeigen die Entwicklung, hier steht das Papier: je Sparte jede
 * Position mit Menge, Ansatz und Steuersatz. Ohne diese Ansicht wäre eine
 * Farbe im Diagramm die einzige Quelle für einen Wert – und das ist keine.
 */
export function RechnungDetail({ bill }: { bill: UtilityBill }) {
  const sektionen = useMemo(
    () => DIVISIONS.flatMap((division) => bill.sections.filter((s) => s.division === division)),
    [bill.sections],
  )

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Angabe label="Art" value={BILL_KIND_LABELS[bill.kind]} />
        <Angabe label="Rechnung Nr." value={bill.invoiceNumber} />
        <Angabe label="Periode" value={formatPeriod(bill.periodStart, bill.periodEnd)} weit />
        <Angabe label="Rechnungsdatum" value={formatDateLabel(bill.invoiceDate)} />
        {bill.customerNumber ? <Angabe label="Kundennummer" value={bill.customerNumber} /> : null}
      </dl>

      {sektionen.map((section) => (
        <section key={section.division} className="space-y-2">
          <h3 className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-1 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {DIVISION_LABELS[section.division]}
            </span>
            <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              CHF {formatAmount(section.amountCents)}
            </span>
          </h3>

          {section.readings.length > 0 ? (
            <Tabelle
              kopf={['Tarif', 'Stand alt', 'Stand neu', 'Menge']}
              zeilen={section.readings.map((reading) => [
                TARIFF_LABELS[reading.tariff],
                reading.startValue === null ? '–' : formatMenge(reading.startValue),
                reading.endValue === null ? '–' : formatMenge(reading.endValue),
                `${formatMenge(reading.quantity)} ${reading.unit}`,
              ])}
            />
          ) : null}

          {section.positions.length > 0 ? (
            <Tabelle
              kopf={['Position', 'Menge', 'Ansatz', 'CHF']}
              zeilen={section.positions.map((position) => [
                position.group
                  ? `${position.label} · ${COST_GROUP_LABELS[position.group]}`
                  : position.label,
                `${formatMenge(position.quantity)} ${position.unit}`,
                position.rateHundredths === null
                  ? '–'
                  : `${formatRappen(position.rateHundredths)} ${position.rateUnit ?? ''}${
                      position.durationMonths ? ` · ${position.durationMonths} Mt.` : ''
                    }`,
                formatAmount(position.grossCents),
              ])}
            />
          ) : null}

          {section.meterPoint ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Messpunkt {section.meterPoint}
              {section.meterNumber ? ` · Zähler ${section.meterNumber}` : ''}
            </p>
          ) : null}
        </section>
      ))}

      <section className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
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
          {bill.documentId ? ' · als Dokument abgelegt' : ''}
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

/**
 * Eine schmale Tabelle, die auf einem Handy waagrecht rollt statt die Seite
 * mitzuziehen – lange Positionsnamen sollen nicht den ganzen Bildschirm
 * verschieben.
 */
function Tabelle({ kopf, zeilen }: { kopf: string[]; zeilen: string[][] }) {
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
      </table>
    </div>
  )
}

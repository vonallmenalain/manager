import {
  analyse,
  billYear,
  BILL_KIND_LABELS,
  findPreviousYearBill,
  formatAmount,
  formatKwh,
  formatPercentChange,
  formatPeriod,
  formatRappen,
  shortPeriodLabel,
  summarize,
  trendBetween,
  type BillFigures,
  type BillInput,
  type ElectricityBill,
  type ImportResult,
  type PeriodSummary,
  type Trend,
} from '@manager/shared'
import { useMemo, useRef, useState, type ReactNode } from 'react'

import { Button } from '../components/Button'
import { Modal, ModalCloseButton } from '../components/Modal'
import { ShareBar, StromChart, SERIES_COLORS, type ChartPoint } from '../components/StromChart'
import { RechnungDetail, RechnungFormular } from '../components/StromRechnung'
import { API_BASE, ApiRequestError } from '../lib/api'
import {
  useAddStromBill,
  useDeleteStromBill,
  useImportStromBill,
  useStromBills,
  useUpdateStromBill,
} from '../lib/strom'

/**
 * Der Bereich Strom: was das Haus verbraucht, was es kostet und wohin es sich
 * bewegt.
 *
 * Aufgebaut wie die Frage, mit der man ihn öffnet: Zuerst der Preis je
 * Kilowattstunde – die eine Zahl, an der sich alles ablesen lässt –, dann die
 * Kennzahlen des gewählten Zeitraums, dann die Entwicklung als Diagramm, und
 * ganz unten die Rechnungen selbst. Wer nur wissen will, ob es teurer wird,
 * hört nach dem ersten Bildschirm auf zu scrollen.
 */
export function Strom() {
  const query = useStromBills()
  const [zeitraum, setZeitraum] = useState<Zeitraum>('alle')
  const [sheet, setSheet] = useState<SheetState>(null)

  const bills = query.data?.bills
  const { abrechnungen, akonto, years } = useMemo(() => analyse(bills ?? []), [bills])

  const gewaehlt = filterByZeitraum(abrechnungen, zeitraum)
  const vergleichsjahr = typeof zeitraum === 'number' ? zeitraum - 1 : null
  const vorjahr = vergleichsjahr === null ? [] : filterByZeitraum(abrechnungen, vergleichsjahr)

  const summe = summarize(gewaehlt)
  const vergleich = vorjahr.length > 0 ? summarize(vorjahr) : null

  const punkte = useMemo(() => toChartPoints(gewaehlt), [gewaehlt])

  if (query.isLoading || !bills) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Strom</h1>
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
        <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      </div>
    )
  }

  return (
    // Die Aktualisierung nach einer Änderung soll den Bildschirm nicht
    // zurücksetzen: Statt eines neuen Skeletts wird das Bisherige blasser.
    <div
      className={`space-y-5 pb-4 transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Strom</h1>
        {bills.length > 0 ? (
          <ZeitraumWahl years={years} value={zeitraum} onChange={setZeitraum} />
        ) : null}
      </div>

      {bills.length === 0 ? (
        <Leerzustand onImport={() => setSheet({ kind: 'import' })} onManuell={() => setSheet({ kind: 'neu' })} />
      ) : (
        <>
          <PreisKarte summe={summe} vergleich={vergleich} vergleichsjahr={vergleichsjahr} bills={gewaehlt} />

          <Kennzahlen summe={summe} vergleich={vergleich} vergleichsjahr={vergleichsjahr} />

          {punkte.length > 0 ? (
            <Abschnitt
              titel="Entwicklung"
              hinweis="Reihen lassen sich unten ein- und ausblenden. Eine Spalte antippen zeigt ihre Werte."
            >
              <StromChart points={punkte} />
            </Abschnitt>
          ) : null}

          {summe.totalCostCents > 0 ? (
            <Abschnitt titel="Woher die Kosten kommen">
              <ShareBar
                total={summe.totalCostCents / 100}
                slices={[
                  { label: 'Energie', value: summe.energyCents / 100, color: SERIES_COLORS.energie },
                  { label: 'Netznutzung', value: summe.gridCents / 100, color: SERIES_COLORS.netz },
                  { label: 'Abgaben & Förderbeiträge', value: summe.leviesCents / 100, color: SERIES_COLORS.abgaben },
                ]}
              />
              {summe.totalKwh ? (
                <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Verbrauch nach Tarif in kWh
                  </p>
                  <ShareBar
                    total={summe.totalKwh}
                    digits={0}
                    slices={[
                      { label: 'Hochtarif', value: summe.highKwh ?? 0, color: SERIES_COLORS.hoch },
                      { label: 'Niedertarif', value: summe.lowKwh ?? 0, color: SERIES_COLORS.nieder },
                    ]}
                  />
                </div>
              ) : null}
            </Abschnitt>
          ) : null}

          <Vorjahresvergleich alle={abrechnungen} gewaehlt={gewaehlt} />

          <Zahlungen abrechnungen={gewaehlt} akonto={filterByZeitraum(akonto, zeitraum)} />

          <Rechnungsliste
            bills={[...gewaehlt, ...filterByZeitraum(akonto, zeitraum)].sort((links, rechts) =>
              rechts.bill.periodStart.localeCompare(links.bill.periodStart),
            )}
            onOpen={(bill) => setSheet({ kind: 'detail', bill })}
          />

          <div className="grid gap-2">
            <Button onClick={() => setSheet({ kind: 'import' })}>Rechnung importieren</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setSheet({ kind: 'neu' })}>
                Von Hand
              </Button>
              <a
                href={`${API_BASE}/api/strom/export.csv`}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                CSV laden
              </a>
            </div>
          </div>
        </>
      )}

      {sheet?.kind === 'import' ? <ImportDialog onClose={() => setSheet(null)} /> : null}

      {sheet?.kind === 'neu' ? (
        <ErfassenDialog onClose={() => setSheet(null)} />
      ) : null}

      {sheet?.kind === 'detail' ? (
        <DetailDialog
          bill={sheet.bill}
          onClose={() => setSheet(null)}
          onEdit={() => setSheet({ kind: 'bearbeiten', bill: sheet.bill })}
        />
      ) : null}

      {sheet?.kind === 'bearbeiten' ? (
        <BearbeitenDialog bill={sheet.bill} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  )
}

type Zeitraum = 'alle' | number

type SheetState =
  | null
  | { kind: 'import' }
  | { kind: 'neu' }
  | { kind: 'detail'; bill: ElectricityBill }
  | { kind: 'bearbeiten'; bill: ElectricityBill }

function filterByZeitraum(figures: BillFigures[], zeitraum: Zeitraum): BillFigures[] {
  if (zeitraum === 'alle') return figures
  return figures.filter((entry) => billYear(entry.bill) === zeitraum)
}

function toChartPoints(figures: BillFigures[]): ChartPoint[] {
  return figures.map((entry) => ({
    id: entry.bill.id,
    label: shortPeriodLabel(entry.bill.periodStart, entry.bill.periodEnd),
    periodLabel: formatPeriod(entry.bill.periodStart, entry.bill.periodEnd),
    hoch: entry.highKwh,
    nieder: entry.lowKwh,
    energie: entry.energyCents / 100,
    netz: entry.gridCents / 100,
    abgaben: entry.leviesCents / 100,
    preis: entry.pricePerKwhHundredths === null ? null : entry.pricePerKwhHundredths / 100,
  }))
}

// ------------------------------------------------------------------- Zeitraum

/**
 * Die eine Filterzeile über allem, was sie betrifft.
 *
 * Sie schaltet den ganzen Bildschirm um, nicht nur ein Diagramm: Zwei Kacheln,
 * die sich auf verschiedene Zeiträume beziehen, sind schlimmer als eine
 * Angabe zu wenig.
 */
function ZeitraumWahl({
  years,
  value,
  onChange,
}: {
  years: number[]
  value: Zeitraum
  onChange: (value: Zeitraum) => void
}) {
  const optionen: Zeitraum[] = ['alle', ...years]

  return (
    <div className="-mx-1 flex max-w-[60%] gap-1 overflow-x-auto px-1">
      {optionen.map((option) => (
        <button
          key={String(option)}
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold transition ${
            value === option
              ? 'bg-brand-800 text-white'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {option === 'alle' ? 'Alles' : option}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Kennzahlen

/**
 * Die Kachel, wegen der man den Bildschirm öffnet.
 *
 * Der Preis je Kilowattstunde ist die einzige Zahl, die zwischen Halbjahren
 * verschiedener Länge und schwankendem Verbrauch vergleichbar bleibt – und
 * genau die, die der Haushalt bisher von Hand aus der Rechnung gerechnet hat.
 * Gebildet wird er aus dem Zwischentotal, nicht aus dem Rechnungsbetrag: Der
 * Akontoabzug ist eine Vorauszahlung und kein Strompreis.
 */
function PreisKarte({
  summe,
  vergleich,
  vergleichsjahr,
  bills,
}: {
  summe: PeriodSummary
  vergleich: PeriodSummary | null
  vergleichsjahr: number | null
  bills: BillFigures[]
}) {
  const trend = trendBetween(summe.pricePerKwhHundredths, vergleich?.pricePerKwhHundredths ?? null)
  const spanne = bills.length > 0
    ? `${bills.length} ${bills.length === 1 ? 'Abrechnung' : 'Abrechnungen'} · ${formatPeriod(
        bills[0]?.bill.periodStart ?? '',
        bills[bills.length - 1]?.bill.periodEnd ?? '',
      )}`
    : 'Noch keine Abrechnung erfasst'

  return (
    <section className="rounded-2xl bg-brand-800 p-4 text-white">
      <p className="text-sm text-white/70">Ø Strompreis</p>
      <p className="mt-1 flex items-baseline gap-2">
        {/* Der Blickfang der Seite – bewusst mit den normalen Ziffernbreiten:
            Gleich breite Ziffern wirken bei dieser Grösse auseinandergezogen. */}
        <span className="text-5xl font-bold">{formatRappen(summe.pricePerKwhHundredths)}</span>
        <span className="text-lg text-white/70">Rp./kWh</span>
      </p>

      {trend.ratio !== null && vergleichsjahr !== null ? (
        <p className="mt-2 text-sm">
          <TrendZeichen trend={trend} hell />
          <span className="text-white/80"> gegenüber {vergleichsjahr}</span>
        </p>
      ) : null}

      <p className="mt-3 border-t border-white/15 pt-3 text-sm text-white/70">{spanne}</p>
    </section>
  )
}

function Kennzahlen({
  summe,
  vergleich,
  vergleichsjahr,
}: {
  summe: PeriodSummary
  vergleich: PeriodSummary | null
  vergleichsjahr: number | null
}) {
  const proMonat = summe.annualCostCents === null ? null : summe.annualCostCents / 12
  const vergleichProMonat =
    vergleich?.annualCostCents === undefined || vergleich?.annualCostCents === null
      ? null
      : vergleich.annualCostCents / 12

  /**
   * Ob sich die beiden Zeiträume überhaupt als Summe vergleichen lassen.
   *
   * Liegt für ein Jahr nur ein Halbjahr vor, ist das folgende ganze Jahr
   * natürlich „+91 %" – und diese Zahl sagt nichts über den Verbrauch, sondern
   * nur darüber, wie viele Rechnungen erfasst sind. Bei mehr als einem Zehntel
   * Unterschied in der abgedeckten Zeit steht deshalb kein Pfeil, sondern der
   * Grund. Die hochgerechneten Kacheln daneben bleiben davon unberührt: Sie
   * sind gerade für diesen Fall gebaut.
   */
  const spanne = Math.max(summe.days, vergleich?.days ?? 0)
  const summenVergleichbar =
    vergleich !== null &&
    summe.days > 0 &&
    vergleich.days > 0 &&
    Math.abs(summe.days - vergleich.days) / spanne <= 0.1

  const ungleich =
    vergleich !== null && vergleichsjahr !== null && !summenVergleichbar
      ? `${vergleichsjahr} deckt ${vergleich.days} statt ${summe.days} Tage ab`
      : undefined

  return (
    <div className="grid grid-cols-2 gap-2">
      <Kachel
        label="Verbrauch"
        wert={formatKwh(summe.totalKwh)}
        einheit="kWh"
        trend={
          summenVergleichbar
            ? trendBetween(summe.totalKwh, vergleich?.totalKwh ?? null)
            : LEERER_TREND
        }
        vergleichsjahr={vergleichsjahr}
        gutIstWeniger
        hinweis={ungleich}
      />
      <Kachel
        label="Kosten"
        wert={formatAmount(summe.totalCostCents)}
        einheit="CHF"
        trend={
          summenVergleichbar
            ? trendBetween(summe.totalCostCents, vergleich?.totalCostCents ?? null)
            : LEERER_TREND
        }
        vergleichsjahr={vergleichsjahr}
        gutIstWeniger
        hinweis={ungleich}
      />
      <Kachel
        label="Kosten pro Monat"
        wert={proMonat === null ? '–' : formatAmount(Math.round(proMonat))}
        einheit="CHF"
        trend={trendBetween(proMonat, vergleichProMonat)}
        vergleichsjahr={vergleichsjahr}
        gutIstWeniger
        hinweis="Aus der Periodenlänge hochgerechnet"
      />
      <Kachel
        label="Verbrauch pro Tag"
        wert={summe.kwhPerDay === null ? '–' : formatKwh(summe.kwhPerDay, 1)}
        einheit="kWh"
        trend={trendBetween(summe.kwhPerDay, vergleich?.kwhPerDay ?? null)}
        vergleichsjahr={vergleichsjahr}
        gutIstWeniger
        hinweis="Macht ungleich lange Perioden vergleichbar"
      />
    </div>
  )
}

const LEERER_TREND: Trend = { ratio: null, direction: 'gleich', delta: null }

function Kachel({
  label,
  wert,
  einheit,
  trend,
  vergleichsjahr,
  gutIstWeniger,
  hinweis,
}: {
  label: string
  wert: string
  einheit: string
  trend: Trend
  vergleichsjahr: number | null
  gutIstWeniger?: boolean
  hinweis?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="text-xl font-bold text-slate-900 dark:text-slate-100">{wert}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">{einheit}</span>
      </p>
      {trend.ratio !== null && vergleichsjahr !== null ? (
        <p className="mt-1 text-xs">
          <TrendZeichen trend={trend} gutIstWeniger={gutIstWeniger} />
          <span className="text-slate-400 dark:text-slate-500"> vs. {vergleichsjahr}</span>
        </p>
      ) : hinweis ? (
        <p className="mt-1 text-[11px] leading-tight text-slate-400 dark:text-slate-500">{hinweis}</p>
      ) : null}
    </div>
  )
}

/**
 * Richtung und Ausmass einer Veränderung.
 *
 * Der Pfeil steht neben der Zahl und nicht statt ihr: Farbe allein sagt einem
 * farbfehlsichtigen Auge nichts, und „mehr" ist beim Stromverbrauch etwas
 * anderes als „besser".
 */
function TrendZeichen({
  trend,
  gutIstWeniger,
  hell,
}: {
  trend: Trend
  gutIstWeniger?: boolean
  hell?: boolean
}) {
  if (trend.ratio === null) return null

  const pfeil = trend.direction === 'steigend' ? '▲' : trend.direction === 'sinkend' ? '▼' : '▬'
  const gut = gutIstWeniger ? trend.direction === 'sinkend' : trend.direction === 'steigend'

  const farbe = hell
    ? 'text-white'
    : trend.direction === 'gleich'
      ? 'text-slate-500 dark:text-slate-400'
      : gut
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-amber-700 dark:text-amber-400'

  return (
    <span className={`font-semibold tabular-nums ${farbe}`}>
      <span aria-hidden="true">{pfeil} </span>
      {formatPercentChange(trend.ratio)}
    </span>
  )
}

// -------------------------------------------------------------- Jahresvergleich

/**
 * Jede Abrechnung neben derselben Jahreszeit des Vorjahres.
 *
 * Der ehrlichste Vergleich, den die Daten hergeben: Ein Winterhalbjahr gegen
 * ein Sommerhalbjahr zu stellen, hiesse die Heizung mit dem Rasenmäher zu
 * vergleichen. Gesucht wird deshalb die Rechnung, deren Periode ein Jahr früher
 * begann.
 */
function Vorjahresvergleich({ alle, gewaehlt }: { alle: BillFigures[]; gewaehlt: BillFigures[] }) {
  const paare = gewaehlt
    .map((entry) => ({ jetzt: entry, davor: findPreviousYearBill(alle, entry) }))
    .filter((paar): paar is { jetzt: BillFigures; davor: BillFigures } => paar.davor !== null)
    .reverse()

  if (paare.length === 0) return null

  return (
    <Abschnitt titel="Gegenüber dem Vorjahr">
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {paare.map(({ jetzt, davor }) => (
          <li key={jetzt.bill.id} className="py-2.5 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {formatPeriod(jetzt.bill.periodStart, jetzt.bill.periodEnd)}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              verglichen mit {formatPeriod(davor.bill.periodStart, davor.bill.periodEnd)}
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              <VergleichsWert
                label="Verbrauch"
                trend={trendBetween(jetzt.totalKwh, davor.totalKwh)}
                wert={`${formatKwh(jetzt.totalKwh)} kWh`}
              />
              <VergleichsWert
                label="Kosten"
                trend={trendBetween(jetzt.periodCostCents, davor.periodCostCents)}
                wert={`${formatAmount(jetzt.periodCostCents)}`}
              />
              <VergleichsWert
                label="Ø Preis"
                trend={trendBetween(jetzt.pricePerKwhHundredths, davor.pricePerKwhHundredths)}
                wert={`${formatRappen(jetzt.pricePerKwhHundredths)} Rp.`}
              />
            </dl>
          </li>
        ))}
      </ul>
    </Abschnitt>
  )
}

function VergleichsWert({ label, wert, trend }: { label: string; wert: string; trend: Trend }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {wert}
      </dd>
      <dd className="text-[11px]">
        <TrendZeichen trend={trend} gutIstWeniger />
      </dd>
    </div>
  )
}

// ------------------------------------------------------------------ Zahlungen

/**
 * Was tatsächlich überwiesen wurde – getrennt von dem, was verbraucht wurde.
 *
 * Akontorechnungen sind Vorauszahlungen auf denselben Strom; in der
 * Verbrauchsauswertung hätten sie nichts verloren, weil sie jede Summe
 * verdoppelten. Hier gehören sie hin.
 */
function Zahlungen({ abrechnungen, akonto }: { abrechnungen: BillFigures[]; akonto: BillFigures[] }) {
  if (abrechnungen.length === 0 && akonto.length === 0) return null

  const akontoTotal = akonto.reduce((sum, entry) => sum + entry.bill.totalCents, 0)
  const schluss = abrechnungen.reduce((sum, entry) => sum + entry.bill.totalCents, 0)
  const angerechnet = abrechnungen.reduce((sum, entry) => sum + entry.bill.prepaidCents, 0)

  return (
    <Abschnitt titel="Zahlungen">
      <dl className="space-y-1.5 text-sm">
        <Zeile
          label={`Akontorechnungen (${akonto.length})`}
          value={`CHF ${formatAmount(akontoTotal)}`}
        />
        <Zeile
          label={`Schlussabrechnungen (${abrechnungen.length})`}
          value={`CHF ${formatAmount(schluss)}`}
        />
        <div className="border-t border-slate-100 pt-1.5 dark:border-slate-800">
          <Zeile label="Total überwiesen" value={`CHF ${formatAmount(akontoTotal + schluss)}`} stark />
        </div>
      </dl>
      {angerechnet > 0 ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Auf den Schlussabrechnungen sind CHF {formatAmount(angerechnet)} an Akontozahlungen
          bereits abgezogen.
        </p>
      ) : null}
    </Abschnitt>
  )
}

function Zeile({ label, value, stark }: { label: string; value: string; stark?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`text-slate-600 dark:text-slate-300 ${stark ? 'font-semibold' : ''}`}>
        {label}
      </dt>
      <dd
        className={`tabular-nums text-slate-900 dark:text-slate-100 ${
          stark ? 'font-bold' : 'font-semibold'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------- Rechnungen

function Rechnungsliste({
  bills,
  onOpen,
}: {
  bills: BillFigures[]
  onOpen: (bill: ElectricityBill) => void
}) {
  if (bills.length === 0) return null

  return (
    <Abschnitt titel="Rechnungen" hinweis="Alle Werte im Detail – antippen zum Öffnen.">
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {bills.map((entry) => (
          <li key={entry.bill.id}>
            <button
              onClick={() => onOpen(entry.bill)}
              className="flex w-full items-center justify-between gap-3 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                  {formatPeriod(entry.bill.periodStart, entry.bill.periodEnd)}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {BILL_KIND_LABELS[entry.bill.kind]} Nr. {entry.bill.invoiceNumber}
                  {entry.totalKwh !== null ? ` · ${formatKwh(entry.totalKwh)} kWh` : ''}
                  {entry.pricePerKwhHundredths !== null
                    ? ` · ${formatRappen(entry.pricePerKwhHundredths)} Rp./kWh`
                    : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatAmount(entry.bill.totalCents)}
                </span>
                <span className="block text-[11px] text-slate-400 dark:text-slate-500">CHF</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Abschnitt>
  )
}

// ------------------------------------------------------------------- Fenster

function DetailDialog({
  bill,
  onClose,
  onEdit,
}: {
  bill: ElectricityBill
  onClose: () => void
  onEdit: () => void
}) {
  const loeschen = useDeleteStromBill()
  const [sicher, setSicher] = useState(false)

  return (
    <Modal
      onClose={onClose}
      label={`Rechnung ${bill.invoiceNumber}`}
      width="max-w-xl"
      header={
        <>
          <p className="px-2 text-sm font-semibold">Rechnung {bill.invoiceNumber}</p>
          <ModalCloseButton onClick={onClose} label="Schliessen" />
        </>
      }
      footer={
        <div className="grid grid-cols-2 gap-2">
          {sicher ? (
            <>
              <Button variant="secondary" onClick={() => setSicher(false)}>
                Behalten
              </Button>
              <LoeschKnopf
                disabled={loeschen.isPending}
                onClick={() => loeschen.mutate(bill.id, { onSuccess: onClose })}
              >
                Wirklich löschen
              </LoeschKnopf>
            </>
          ) : (
            <>
              <LoeschKnopf onClick={() => setSicher(true)}>Löschen</LoeschKnopf>
              <Button onClick={onEdit}>Bearbeiten</Button>
            </>
          )}
        </div>
      }
    >
      <RechnungDetail bill={bill} />
    </Modal>
  )
}

/**
 * Löschen trägt die Warnfarbe in der Schrift und nicht als Fläche – so hält es
 * die App überall, wo etwas verschwindet. Ein roter Block neben dem blauen
 * Knopf sähe aus wie die zweite Hauptsache.
 */
function LoeschKnopf({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-12 rounded-xl px-5 text-base font-semibold text-red-600 transition
        disabled:opacity-60 active:bg-red-50 dark:text-red-400 dark:active:bg-red-950/40"
    >
      {children}
    </button>
  )
}

function BearbeitenDialog({ bill, onClose }: { bill: ElectricityBill; onClose: () => void }) {
  const speichern = useUpdateStromBill()
  const fehler = speichern.error instanceof ApiRequestError ? speichern.error : null

  return (
    <Modal
      onClose={onClose}
      label="Rechnung bearbeiten"
      width="max-w-xl"
      header={
        <>
          <p className="px-2 text-sm font-semibold">Rechnung bearbeiten</p>
          <ModalCloseButton onClick={onClose} label="Schliessen" />
        </>
      }
    >
      {fehler ? <Fehlerbalken text={fehler.message} /> : null}
      <RechnungFormular
        bill={bill}
        fields={fehler?.fields}
        saving={speichern.isPending}
        submitLabel="Speichern"
        onCancel={onClose}
        onSubmit={(geaendert) =>
          speichern.mutate({ id: bill.id, bill: geaendert }, { onSuccess: onClose })
        }
      />
    </Modal>
  )
}

function ErfassenDialog({ onClose }: { onClose: () => void }) {
  const anlegen = useAddStromBill()
  const fehler = anlegen.error instanceof ApiRequestError ? anlegen.error : null

  return (
    <Modal
      onClose={onClose}
      label="Rechnung erfassen"
      width="max-w-xl"
      header={
        <>
          <p className="px-2 text-sm font-semibold">Rechnung erfassen</p>
          <ModalCloseButton onClick={onClose} label="Schliessen" />
        </>
      }
    >
      {fehler ? <Fehlerbalken text={fehler.message} /> : null}
      <RechnungFormular
        bill={null}
        fields={fehler?.fields}
        saving={anlegen.isPending}
        submitLabel="Erfassen"
        onCancel={onClose}
        onSubmit={(bill) => anlegen.mutate(bill, { onSuccess: onClose })}
      />
    </Modal>
  )
}

// --------------------------------------------------------------------- Import

interface ImportEintrag {
  fileName: string
  result: ImportResult
}

/**
 * PDFs auslesen und der Reihe nach bestätigen.
 *
 * Bewusst zweistufig: Der Server liest, der Mensch entscheidet. Was der
 * Automat nicht sicher lesen konnte, steht als Hinweis über dem Formular –
 * und lässt sich dort gleich richtigstellen, statt dass eine falsche Zahl
 * still in der Statistik landet.
 */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const auslesen = useImportStromBill()
  const anlegen = useAddStromBill()
  const dateiwahl = useRef<HTMLInputElement>(null)

  const [eintraege, setEintraege] = useState<ImportEintrag[]>([])
  const [index, setIndex] = useState(0)
  const [laeuft, setLaeuft] = useState(false)

  const aktuell = eintraege[index]
  const fehler = anlegen.error instanceof ApiRequestError ? anlegen.error : null

  async function dateienLesen(files: FileList) {
    setLaeuft(true)
    const gelesen: ImportEintrag[] = []

    // Eine Datei nach der anderen: Beim gleichzeitigen Hochladen von fünf
    // Rechnungen bringt der Server nichts schneller zustande, und ein Fehler
    // bei einer soll die anderen nicht mitreissen.
    for (const file of Array.from(files)) {
      try {
        gelesen.push({ fileName: file.name, result: await auslesen.mutateAsync(file) })
      } catch (error) {
        gelesen.push({
          fileName: file.name,
          result: {
            bill: null,
            hinweise: [
              error instanceof ApiRequestError ? error.message : 'Die Datei liess sich nicht lesen.',
            ],
            bereitsVorhanden: false,
          },
        })
      }
    }

    setEintraege(gelesen)
    setIndex(0)
    setLaeuft(false)
  }

  function weiter() {
    anlegen.reset()
    if (index + 1 < eintraege.length) setIndex(index + 1)
    else onClose()
  }

  return (
    <Modal
      onClose={onClose}
      label="Rechnung importieren"
      width="max-w-xl"
      header={
        <>
          <p className="px-2 text-sm font-semibold">
            Rechnung importieren
            {eintraege.length > 1 ? (
              <span className="ml-1.5 font-normal text-slate-500">
                {index + 1} von {eintraege.length}
              </span>
            ) : null}
          </p>
          <ModalCloseButton onClick={onClose} label="Schliessen" />
        </>
      }
    >
      <input
        ref={dateiwahl}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(event) => {
          const files = event.target.files
          if (files && files.length > 0) void dateienLesen(files)
        }}
      />

      {eintraege.length === 0 ? (
        <div className="space-y-4 py-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Die Rechnung als PDF auswählen. Rechnungsnummer, Periode, Verbrauch und Beträge werden
            daraus gelesen – geprüft und gespeichert wird erst im nächsten Schritt.
          </p>
          <Button loading={laeuft} onClick={() => dateiwahl.current?.click()}>
            {laeuft ? 'Wird gelesen …' : 'PDF auswählen'}
          </Button>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mehrere Dateien auf einmal sind möglich; sie werden nacheinander vorgelegt.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{aktuell?.fileName}</p>

          {aktuell?.result.bereitsVorhanden ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Diese Rechnungsnummer ist bereits erfasst. Ein zweites Mal übernehmen geht nicht –
              zum Ändern die Rechnung in der Liste öffnen.
            </p>
          ) : null}

          {(aktuell?.result.hinweise.length ?? 0) > 0 ? (
            <ul className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {aktuell?.result.hinweise.map((hinweis) => (
                <li key={hinweis}>{hinweis}</li>
              ))}
            </ul>
          ) : null}

          {fehler ? <Fehlerbalken text={fehler.message} /> : null}

          {aktuell?.result.bill ? (
            <RechnungFormular
              // Ein Wechsel zur nächsten Datei muss das Formular neu aufsetzen,
              // sonst blieben die Werte der vorherigen Rechnung stehen.
              key={index}
              bill={aktuell.result.bill}
              fields={fehler?.fields}
              saving={anlegen.isPending}
              submitLabel={index + 1 < eintraege.length ? 'Übernehmen und weiter' : 'Übernehmen'}
              onCancel={weiter}
              onSubmit={(bill: BillInput) => anlegen.mutate(bill, { onSuccess: weiter })}
            />
          ) : (
            <Button variant="secondary" onClick={weiter}>
              {index + 1 < eintraege.length ? 'Nächste Datei' : 'Schliessen'}
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ Bausteine

function Abschnitt({
  titel,
  hinweis,
  children,
}: {
  titel: string
  hinweis?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{titel}</h2>
      {hinweis ? (
        <p className="mb-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hinweis}</p>
      ) : (
        <div className="mb-3" />
      )}
      {children}
    </section>
  )
}

function Fehlerbalken({ text }: { text: string }) {
  return (
    <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
      {text}
    </p>
  )
}

function Leerzustand({ onImport, onManuell }: { onImport: () => void; onManuell: () => void }) {
  return (
    <div className="space-y-4 rounded-2xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Noch keine Stromrechnung erfasst. Ein PDF des Energieversorgers genügt – Periode,
        Verbrauch, Tarife und Beträge werden daraus gelesen.
      </p>
      <div className="grid gap-2">
        <Button onClick={onImport}>Rechnung importieren</Button>
        <Button variant="secondary" onClick={onManuell}>
          Von Hand erfassen
        </Button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Ältere Perioden aus einer eigenen Tabelle lassen sich von Hand nachtragen – sie zählen in
        der Auswertung genauso mit.
      </p>
    </div>
  )
}

import {
  buildQuarters,
  effectiveRate,
  formatAmount,
  formatDate,
  formatMonths,
  formatPeriod,
  formatRate,
  LOAN_KIND_LABELS,
  LOAN_KIND_SHORT,
  LOAN_KINDS,
  loanSlots,
  mortgageStatus,
  mortgageYears,
  nextOpenQuarter,
  parseAmountToCents,
  parseRate,
  quarterLabel,
  shortQuarterLabel,
  suggestedQuarter,
  summarizeAmortization,
  trendBetween,
  type AmortizationPayment,
  type AmortizationSummary,
  type HypothekDaten,
  type HypothekImportResult,
  type LoanKind,
  type LoanStatus,
  type MortgageLoan,
  type MortgageStatus,
  type MortgageYear,
  type Quarter,
  type QuarterRow,
} from '@manager/shared'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { Button } from '../components/Button'
import { Field } from '../components/Field'
import {
  Abschnitt,
  AbschnittKnopf,
  Abzeichen,
  Fehlerbalken,
  Fortschritt,
  Kachel,
  LoeschKnopf,
  Zeile,
  ZeitraumWahl,
  type Zeitraum,
} from '../components/HausBausteine'
import { HausChart, ShareBar, type ChartData, type ChartSeries } from '../components/HausChart'
import { Modal, ModalCloseButton } from '../components/Modal'
import { API_BASE, ApiRequestError } from '../lib/api'
import {
  useDeleteTranche,
  useDeleteVertrag,
  useHypothek,
  useImportHypothekExcel,
  useSaveGrunddaten,
  useSaveQuartal,
  useSaveTranche,
  useSaveVertrag,
  useUebernehmeHypothek,
} from '../lib/hypothek'

/**
 * Die Sparte Hypothek: was die Hypothek kostet und wie weit sie amortisiert ist.
 *
 * Aufgebaut wie die Nebenkosten daneben – zuoberst der Stand heute, darunter
 * die Kennzahlen des gewählten Jahres, dann die einzelnen Hypotheken mit ihrer
 * Laufzeit, die Zinsen Quartal für Quartal und zuletzt die Amortisation. Was
 * noch nicht bezahlt ist, steht als Prognose daneben und ist als solche
 * gekennzeichnet; erfasst wird, was die Bank tatsächlich abgebucht hat.
 */
export function Hypothek({ spartenWahl }: { spartenWahl: ReactNode }) {
  const query = useHypothek()
  const [zeitraum, setZeitraum] = useState<Zeitraum>('alle')
  const [fenster, setFenster] = useState<Fenster>(null)
  const heute = heuteIso()

  const daten = query.data
  const auswertung = useMemo(() => (daten ? auswerten(daten, heute) : null), [daten, heute])

  if (query.isLoading || !daten || !auswertung) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Haus</h1>
        {spartenWahl}
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
        <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      </div>
    )
  }

  const { status, quartale, amortisation, jahre, farben } = auswertung
  const leer = daten.loans.length === 0 && daten.amortizations.length === 0
  const jahr = typeof zeitraum === 'number' ? (jahre.find((j) => j.year === zeitraum) ?? null) : null
  const quartaleGewaehlt =
    typeof zeitraum === 'number' ? quartale.filter((row) => row.year === zeitraum) : quartale

  const erfassen = () => {
    const vorschlag = suggestedQuarter(quartale)
    if (vorschlag) setFenster({ art: 'quartal', year: vorschlag.year, quarter: vorschlag.quarter })
  }

  return (
    <div className={`space-y-5 pb-4 transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Haus</h1>
        {!leer && jahre.length > 0 ? (
          <ZeitraumWahl years={jahre.map((j) => j.year)} value={zeitraum} onChange={setZeitraum} />
        ) : null}
      </div>

      {spartenWahl}

      {leer ? (
        <Leerzustand
          onImport={() => setFenster({ art: 'import' })}
          onManuell={() => setFenster({ art: 'vertrag', loan: null })}
        />
      ) : (
        <>
          <Leitzahl status={status} />

          <Kennzahlen
            zeitraum={zeitraum}
            jahr={jahr}
            jahre={jahre}
            status={status}
            quartale={quartale}
            amortisation={amortisation}
          />

          <Hypotheken
            status={status}
            farben={farben}
            referenz={daten.settings.referenceRateMillipercent}
            onOpen={(loan) => setFenster({ art: 'vertrag', loan })}
            onNeu={() => setFenster({ art: 'vertrag', loan: null })}
          />

          {quartaleGewaehlt.length > 0 ? (
            <Abschnitt
              titel="Zinsen pro Quartal"
              hinweis="Schraffiert ist, was noch nicht bezahlt ist – aus Betrag und Zinssatz geschätzt. Eine Spalte antippen zeigt ihre Werte."
            >
              <HausChart data={zinsDiagramm(quartaleGewaehlt, farben)} />
            </Abschnitt>
          ) : null}

          <Quartale
            quartale={quartaleGewaehlt}
            jahre={jahre}
            onOpen={(row) => setFenster({ art: 'quartal', year: row.year, quarter: row.quarter })}
            onErfassen={erfassen}
          />

          <Amortisation
            amortisation={amortisation}
            plan={daten.settings.amortizationPerYearCents}
            zeitraum={zeitraum}
            onOpen={(payment) => setFenster({ art: 'tranche', payment, year: payment.year })}
            onNeu={(year) => setFenster({ art: 'tranche', payment: null, year })}
            onGrunddaten={() => setFenster({ art: 'grunddaten' })}
          />

          {zeitraum === 'alle' && jahre.length > 1 ? <ProJahr jahre={jahre} /> : null}

          <div className="grid gap-2">
            <Button onClick={erfassen} disabled={quartale.length === 0}>
              Zinsen erfassen
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                setFenster({
                  art: 'tranche',
                  payment: null,
                  year: typeof zeitraum === 'number' ? zeitraum : Number(heute.slice(0, 4)),
                })
              }
            >
              Amortisation erfassen
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={`${API_BASE}/api/haus/hypothek/export.csv`}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                CSV laden
              </a>
              <Button variant="secondary" onClick={() => setFenster({ art: 'grunddaten' })}>
                Grunddaten
              </Button>
            </div>
          </div>
        </>
      )}

      {fenster?.art === 'quartal' ? (
        <QuartalDialog
          quartale={quartale}
          start={{ year: fenster.year, quarter: fenster.quarter }}
          onClose={() => setFenster(null)}
        />
      ) : null}
      {fenster?.art === 'vertrag' ? (
        <VertragDialog
          loan={fenster.loan}
          daten={daten}
          onClose={() => setFenster(null)}
        />
      ) : null}
      {fenster?.art === 'grunddaten' ? (
        <GrunddatenDialog daten={daten} status={status} onClose={() => setFenster(null)} />
      ) : null}
      {fenster?.art === 'tranche' ? (
        <TrancheDialog
          payment={fenster.payment}
          year={fenster.year}
          amortisation={amortisation}
          heute={heute}
          onClose={() => setFenster(null)}
        />
      ) : null}
      {fenster?.art === 'import' ? <ImportDialog onClose={() => setFenster(null)} /> : null}
    </div>
  )
}

type Fenster =
  | null
  | { art: 'quartal'; year: number; quarter: Quarter }
  | { art: 'vertrag'; loan: MortgageLoan | null }
  | { art: 'grunddaten' }
  | { art: 'tranche'; payment: AmortizationPayment | null; year: number }
  | { art: 'import' }

interface Auswertung {
  status: MortgageStatus
  quartale: QuarterRow[]
  amortisation: AmortizationSummary
  jahre: MortgageYear[]
  /** Je Hypothek ihre Farbe – fest, egal welches Jahr gewählt ist. */
  farben: Map<string, string>
}

const FARBPLAETZE = 6

function auswerten(daten: HypothekDaten, heute: string): Auswertung {
  const quartale = buildQuarters(daten, heute)
  const amortisation = summarizeAmortization(daten, heute)
  const plaetze = loanSlots(daten.loans)
  return {
    status: mortgageStatus(daten, heute),
    quartale,
    amortisation,
    jahre: mortgageYears(quartale, amortisation),
    farben: new Map(
      daten.loans.map((loan) => [loan.id, `var(--hypothek-${((plaetze.get(loan.id) ?? 0) % FARBPLAETZE) + 1})`]),
    ),
  }
}

/** Das heutige Datum in der Zeitzone des Geräts – nicht in UTC. */
function heuteIso(): string {
  const jetzt = new Date()
  return `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`
}

/** „872'000" – ganze Franken für grosse, runde Beträge. */
function franken(cents: number): string {
  return (cents / 100).toLocaleString('de-CH', { maximumFractionDigits: 0 })
}

/** „Fest 0003" – die Kurzform in einer Zeile mit mehreren Hypotheken. */
function kurzname(loan: MortgageLoan): string {
  const nummer = /\b(\d{3,})\b/.exec(loan.name)?.[1]
  return nummer ? `${LOAN_KIND_SHORT[loan.kind]} ${nummer}` : loan.name
}

/** Ganze Prozent, die Belehnung braucht keine Nachkommastellen. */
function prozent(anteil: number): string {
  return `${Math.round(anteil * 100)} %`
}

// ------------------------------------------------------------------ Kopf

function Leitzahl({ status }: { status: MortgageStatus }) {
  const proMonat = status.monthlyInterestCents + status.monthlyAmortizationCents

  return (
    <section className="rounded-2xl bg-brand-800 p-4 text-white">
      <p className="text-sm text-white/70">Hypothek heute</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-5xl font-bold">{franken(status.totalCents)}</span>
        <span className="text-lg text-white/70">CHF</span>
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {/* Ein Schnitt braucht keine dritte Nachkommastelle – die Verträge schon. */}
        <Fakt
          label="Ø Zinssatz"
          wert={`${formatRate(
            status.averageRateMillipercent === null ? null : Math.round(status.averageRateMillipercent / 10) * 10,
          )} %`}
        />
        <Fakt label="Belehnung" wert={status.loanToValue === null ? '–' : prozent(status.loanToValue)} />
        <Fakt label="Hypotheken" wert={String(status.active.length)} />
      </dl>

      <div className="mt-3 border-t border-white/15 pt-3">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-white/70">Pro Monat</span>
          <span>
            <span className="text-2xl font-bold">{formatAmount(Math.round(proMonat))}</span>
            <span className="ml-1 text-sm text-white/70">CHF</span>
          </span>
        </p>
        <p className="mt-0.5 text-right text-xs text-white/70">
          Zins {formatAmount(Math.round(status.monthlyInterestCents))} · Amortisation{' '}
          {formatAmount(Math.round(status.monthlyAmortizationCents))}
        </p>
      </div>
    </section>
  )
}

function Fakt({ label, wert }: { label: string; wert: string }) {
  return (
    <div>
      <dt className="text-xs text-white/70">{label}</dt>
      <dd className="text-base font-semibold">{wert}</dd>
    </div>
  )
}

/**
 * Die Kennzahlen des gewählten Zeitraums.
 *
 * Verglichen wird ein angefangenes Jahr nur mit denselben Quartalen des
 * Vorjahres: Drei bezahlte Quartale gegen vier wären „−25 %" und eine Aussage
 * über den Kalender, nicht über den Zins.
 */
function Kennzahlen({
  zeitraum,
  jahr,
  jahre,
  status,
  quartale,
  amortisation,
}: {
  zeitraum: Zeitraum
  jahr: MortgageYear | null
  jahre: MortgageYear[]
  status: MortgageStatus
  quartale: QuarterRow[]
  amortisation: AmortizationSummary
}) {
  const naechstes = nextOpenQuarter(quartale)

  if (zeitraum === 'alle' || !jahr) {
    const bezahlt = quartale.reduce((sum, row) => sum + (row.actualCents ?? 0), 0)
    const erstes = quartale.find((row) => row.actualCents !== null)
    return (
      <div className="grid grid-cols-2 gap-2">
        <Kachel
          label="Zinsen bezahlt"
          wert={formatAmount(bezahlt)}
          einheit="CHF"
          hinweis={erstes ? `Seit ${erstes.label}` : 'Noch keine erfasst'}
        />
        <Kachel
          label="Zinsen pro Jahr"
          wert={formatAmount(Math.round(status.monthlyInterestCents * 12))}
          einheit="CHF"
          hinweis="Zu den heutigen Zinssätzen"
        />
        <Kachel
          label="Amortisiert"
          wert={formatAmount(amortisation.amortizedCents)}
          einheit="CHF"
          hinweis={
            amortisation.ratio === null
              ? 'Grunddaten fehlen'
              : `${prozent(amortisation.ratio)} der 2. Hypothek`
          }
        />
        <Kachel
          label="Nächste Zinszahlung"
          wert={naechstes ? formatAmount(naechstes.expectedCents) : '–'}
          einheit="CHF"
          hinweis={naechstes ? `${naechstes.label}, geschätzt` : 'Alles bezahlt'}
        />
      </div>
    )
  }

  // Dieselben Quartale ein Jahr früher – nur, wenn dort alle bezahlt sind.
  const vorjahr = jahre.find((j) => j.year === jahr.year - 1)
  const fertig = jahr.quarters.filter((row) => row.complete).map((row) => row.quarter)
  const davor = vorjahr?.quarters.filter((row) => fertig.includes(row.quarter)) ?? []
  const vergleichbar = fertig.length > 0 && davor.length === fertig.length && davor.every((row) => row.complete)
  const bezahltFertig = jahr.quarters
    .filter((row) => row.complete)
    .reduce((sum, row) => sum + (row.actualCents ?? 0), 0)
  const bezahltDavor = davor.reduce((sum, row) => sum + (row.actualCents ?? 0), 0)
  const vergleich = vergleichbar
    ? fertig.length === 4
      ? String(jahr.year - 1)
      : `${quartalsSpanne(fertig)} ${jahr.year - 1}`
    : null

  const offen = jahr.quarters.filter((row) => !row.complete)
  const amort = jahr.amortization

  return (
    <div className="grid grid-cols-2 gap-2">
      <Kachel
        label={`Zinsen ${jahr.year}`}
        wert={formatAmount(jahr.interestPaidCents)}
        einheit="CHF"
        trend={vergleichbar ? trendBetween(bezahltFertig, bezahltDavor) : undefined}
        vergleich={vergleich}
        hinweis={`${jahr.quartersComplete} von ${jahr.quartersTotal} Quartalen bezahlt`}
      />
      <Kachel
        label="Im ganzen Jahr"
        wert={formatAmount(jahr.interestExpectedCents)}
        einheit="CHF"
        hinweis={
          offen.length === 0
            ? 'Alle Quartale bezahlt'
            : `Mit Prognose für ${offen.map((row) => `Q${row.quarter}`).join(', ')}`
        }
      />
      <Kachel
        label={`Amortisiert ${jahr.year}`}
        wert={formatAmount(amort?.paidCents ?? 0)}
        einheit="CHF"
        hinweis={
          amort === null || amort.targetCents === 0
            ? 'Kein Soll für dieses Jahr'
            : amort.openCents > 0
              ? `Soll ${formatAmount(amort.targetCents)} · offen ${formatAmount(amort.openCents)}`
              : `Soll ${formatAmount(amort.targetCents)} erfüllt`
        }
      />
      <Kachel
        label="Zinsen + Amortisation"
        wert={formatAmount(jahr.interestPaidCents + (amort?.paidCents ?? 0))}
        einheit="CHF"
        hinweis={`Bezahlt für ${jahr.year}`}
      />
    </div>
  )
}

/** „Q1–Q3" aus [1, 2, 3], „Q1, Q3" aus [1, 3]. */
function quartalsSpanne(quartale: Quarter[]): string {
  const sortiert = [...quartale].sort((a, b) => a - b)
  const erstes = sortiert[0]
  const letztes = sortiert.at(-1)
  if (erstes === undefined || letztes === undefined) return ''
  const lueckenlos = letztes - erstes + 1 === sortiert.length
  if (sortiert.length === 1) return `Q${erstes}`
  return lueckenlos ? `Q${erstes}–Q${letztes}` : sortiert.map((q) => `Q${q}`).join(', ')
}

// ------------------------------------------------------------- Hypotheken

function Hypotheken({
  status,
  farben,
  referenz,
  onOpen,
  onNeu,
}: {
  status: MortgageStatus
  farben: Map<string, string>
  referenz: number
  onOpen: (loan: MortgageLoan) => void
  onNeu: () => void
}) {
  const laufend = status.loans.filter((eintrag) => eintrag.state !== 'abgelaufen')
  const abgelaufen = status.loans.filter((eintrag) => eintrag.state === 'abgelaufen').reverse()

  return (
    <Abschnitt
      titel="Hypotheken"
      hinweis="Antippen zum Bearbeiten. Der Balken zeigt, wie viel der Laufzeit verstrichen ist."
      aktion={<AbschnittKnopf onClick={onNeu}>Hinzufügen</AbschnittKnopf>}
    >
      {status.active.length > 1 ? (
        <div className="mb-3">
          <ShareBar
            total={status.totalCents / 100}
            digits={0}
            slices={status.active.map((eintrag) => ({
              label: eintrag.loan.name,
              value: eintrag.loan.amountCents / 100,
              color: farben.get(eintrag.loan.id) ?? 'var(--hypothek-1)',
            }))}
          />
        </div>
      ) : null}

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {laufend.map((eintrag) => (
          <li key={eintrag.loan.id}>
            <HypothekZeile
              eintrag={eintrag}
              farbe={farben.get(eintrag.loan.id) ?? 'var(--hypothek-1)'}
              referenz={referenz}
              onOpen={() => onOpen(eintrag.loan)}
            />
          </li>
        ))}
      </ul>

      {abgelaufen.length > 0 ? (
        <details className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <summary className="min-h-9 cursor-pointer py-2 text-sm font-medium text-slate-500 dark:text-slate-400">
            Abgelaufen ({abgelaufen.length})
          </summary>
          <ul className="divide-y divide-slate-100 opacity-75 dark:divide-slate-800">
            {abgelaufen.map((eintrag) => (
              <li key={eintrag.loan.id}>
                <HypothekZeile
                  eintrag={eintrag}
                  farbe={farben.get(eintrag.loan.id) ?? 'var(--hypothek-1)'}
                  referenz={referenz}
                  onOpen={() => onOpen(eintrag.loan)}
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Abschnitt>
  )
}

function HypothekZeile({
  eintrag,
  farbe,
  referenz,
  onOpen,
}: {
  eintrag: LoanStatus
  farbe: string
  referenz: number
  onOpen: () => void
}) {
  const { loan, state, monthsLeft, elapsed } = eintrag
  const bald = state === 'aktiv' && monthsLeft !== null && monthsLeft <= 12

  const satz =
    loan.kind === 'saron'
      ? `SARON ${formatRate(referenz)} % + Marge ${formatRate(loan.rateMillipercent)} % = ${formatRate(eintrag.effectiveRateMillipercent)} %`
      : `${formatRate(loan.rateMillipercent)} % fest`

  return (
    <button type="button" onClick={onOpen} className="block w-full py-3 text-left">
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: farbe }} aria-hidden="true" />
          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{loan.name}</span>
          <Abzeichen>{LOAN_KIND_SHORT[loan.kind]}</Abzeichen>
          {state === 'kuenftig' ? <Abzeichen ton="hinweis">ab {formatDate(loan.startDate)}</Abzeichen> : null}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {formatAmount(loan.amountCents)}
        </span>
      </span>
      <span className="mt-0.5 block pl-4.5 text-xs text-slate-500 dark:text-slate-400">
        {satz} · CHF {formatAmount(Math.round(eintrag.monthlyInterestCents))} pro Monat
      </span>

      <span className="mt-2 block pl-4.5">
        {loan.endDate !== null ? (
          <>
            <Fortschritt
              anteil={elapsed ?? 1}
              farbe={farbe}
              label={`${loan.name}: ${Math.round((elapsed ?? 1) * 100)} % der Laufzeit verstrichen`}
            />
            <span className="mt-1 flex justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>{formatDate(loan.startDate)}</span>
              <span className={bald ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}>
                {state === 'abgelaufen'
                  ? `lief bis ${formatDate(loan.endDate)}`
                  : `bis ${formatDate(loan.endDate)}${monthsLeft !== null ? ` · noch ${formatMonths(monthsLeft)}` : ''}`}
                {bald ? ' – Anschluss planen' : ''}
              </span>
            </span>
          </>
        ) : (
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
            Seit {formatDate(loan.startDate)} · ohne festes Ende
          </span>
        )}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- Diagramm

/**
 * Die Zinsen Quartal für Quartal, gestapelt nach Hypothek, und darunter der
 * Ø Zinssatz, den sie bedeuten.
 *
 * Der Satz ist aus den bezahlten Beträgen gerechnet und nicht aus den
 * Grunddaten: Nur so sieht man, wie der SARON-Zins über die Quartale gesunken
 * oder gestiegen ist – die Grunddaten kennen nur den von heute.
 */
function zinsDiagramm(quartale: QuarterRow[], farben: Map<string, string>): ChartData {
  const hypotheken = [
    ...new Map(quartale.flatMap((row) => row.loans.map((zeile) => [zeile.loan.id, zeile.loan]))).values(),
  ]
  // In der Reihenfolge der Farbplätze – so liegen im Stapel nur Farben
  // nebeneinander, die sich auch nebeneinander unterscheiden.
  const platz = (loan: MortgageLoan) => farben.get(loan.id) ?? ''
  hypotheken.sort((a, b) => platz(a).localeCompare(platz(b)) || a.startDate.localeCompare(b.startDate))

  const serien: ChartSeries[] = hypotheken.map((loan) => ({
    key: `zins-${loan.id}`,
    label: kurzname(loan),
    color: farben.get(loan.id) ?? 'var(--hypothek-1)',
    values: quartale.map((row) => {
      const zeile = row.loans.find((eintrag) => eintrag.loan.id === loan.id)
      return zeile?.actualCents === null || zeile === undefined ? null : zeile.actualCents / 100
    }),
  }))

  serien.push({
    key: 'prognose',
    label: 'Prognose',
    color: 'var(--hypothek-marke)',
    art: 'provisorisch',
    values: quartale.map((row) => {
      const offen = row.loans
        .filter((zeile) => zeile.actualCents === null)
        .reduce((sum, zeile) => sum + zeile.forecastCents, 0)
      return offen > 0 ? offen / 100 : null
    }),
  })

  const satz = quartale.map((row) => {
    const bezahlt = row.loans.filter((zeile) => zeile.actualCents !== null && zeile.forecastCents > 0)
    const betrag = bezahlt.reduce((sum, zeile) => sum + zeile.loan.amountCents, 0)
    const zins = bezahlt.reduce((sum, zeile) => sum + (zeile.actualCents ?? 0), 0)
    return betrag > 0 ? (zins * 4 * 100) / betrag : null
  })

  return {
    labels: quartale.map((row) => shortQuarterLabel(row.year, row.quarter)),
    periods: quartale.map((row) => `${row.label} · ${formatPeriod(row.start, row.end)}`),
    panels: [
      { id: 'zinsen', title: 'Zinsen', unit: 'CHF', kind: 'stapel', digits: 2, series: serien },
      {
        id: 'satz',
        title: 'Ø Zinssatz',
        unit: '%',
        kind: 'linie',
        digits: 2,
        series: [{ key: 'satz', label: 'Ø Zinssatz', color: 'var(--haus-preis)', values: satz }],
      },
    ],
  }
}

// ---------------------------------------------------------------- Quartale

function Quartale({
  quartale,
  jahre,
  onOpen,
  onErfassen,
}: {
  quartale: QuarterRow[]
  jahre: MortgageYear[]
  onOpen: (row: QuarterRow) => void
  onErfassen: () => void
}) {
  if (quartale.length === 0) return null
  const jahreDarin = jahre.filter((jahr) => quartale.some((row) => row.year === jahr.year))

  return (
    <Abschnitt
      titel="Quartale"
      hinweis="Antippen, um die bezahlten Zinsen einzutragen oder zu ändern."
      aktion={<AbschnittKnopf onClick={onErfassen}>Erfassen</AbschnittKnopf>}
    >
      <div className="space-y-1">
        {jahreDarin.map((jahr, index) => (
          <details key={jahr.year} open={index === 0 || jahreDarin.length === 1} className="group">
            <summary className="flex min-h-10 cursor-pointer list-none items-baseline justify-between gap-3 py-2 text-sm">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                <span className="mr-1 inline-block text-slate-400 transition group-open:rotate-90" aria-hidden="true">
                  ›
                </span>
                {jahr.year}
              </span>
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {formatAmount(jahr.interestPaidCents)} bezahlt
                {jahr.interestExpectedCents > jahr.interestPaidCents
                  ? ` · ≈ ${formatAmount(jahr.interestExpectedCents)} im Jahr`
                  : ''}
              </span>
            </summary>
            <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
              {quartale
                .filter((row) => row.year === jahr.year)
                .reverse()
                .map((row) => (
                  <li key={row.key}>
                    <QuartalZeile row={row} onOpen={() => onOpen(row)} />
                  </li>
                ))}
            </ul>
          </details>
        ))}
      </div>
    </Abschnitt>
  )
}

function QuartalZeile({ row, onOpen }: { row: QuarterRow; onOpen: () => void }) {
  const fehlt = !row.complete && row.time === 'vergangen'
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
          {row.label}
          {row.time === 'laufend' ? <Abzeichen>läuft</Abzeichen> : null}
          {row.time === 'kommend' ? <Abzeichen>kommt</Abzeichen> : null}
          {fehlt ? <Abzeichen ton="hinweis">offen</Abzeichen> : null}
        </span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
          {row.loans
            .filter((zeile) => zeile.actualCents !== null || zeile.forecastCents > 0)
            .map((zeile) => `${kurzname(zeile.loan)} ${formatAmount(zeile.actualCents ?? zeile.forecastCents)}`)
            .join(' · ')}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {row.complete ? '' : '≈ '}
          {formatAmount(row.expectedCents)}
        </span>
        <span className="block text-[11px] text-slate-400 dark:text-slate-500">
          {row.complete ? 'bezahlt' : row.actualCents !== null ? 'teils Prognose' : 'Prognose'}
        </span>
      </span>
    </button>
  )
}

// ------------------------------------------------------------ Amortisation

function Amortisation({
  amortisation,
  plan,
  zeitraum,
  onOpen,
  onNeu,
  onGrunddaten,
}: {
  amortisation: AmortizationSummary
  plan: number
  zeitraum: Zeitraum
  onOpen: (payment: AmortizationPayment) => void
  onNeu: (year: number) => void
  onGrunddaten: () => void
}) {
  const jahre =
    typeof zeitraum === 'number'
      ? amortisation.years.filter((jahr) => jahr.year === zeitraum)
      : amortisation.years
  const neuesJahr = typeof zeitraum === 'number' ? zeitraum : (amortisation.years[0]?.year ?? new Date().getFullYear())

  return (
    <Abschnitt
      titel="Amortisation 2. Hypothek"
      aktion={<AbschnittKnopf onClick={() => onNeu(neuesJahr)}>Tranche erfassen</AbschnittKnopf>}
    >
      {amortisation.secondMortgageCents > 0 ? (
        <div>
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Amortisiert</span>
            <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {formatAmount(amortisation.amortizedCents)}
              <span className="font-normal text-slate-500 dark:text-slate-400">
                {' '}
                von {formatAmount(amortisation.secondMortgageCents)}
              </span>
            </span>
          </p>
          <div className="mt-2">
            <Fortschritt anteil={amortisation.ratio ?? 0} label="Anteil der 2. Hypothek, der amortisiert ist" />
          </div>
          <p className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{prozent(amortisation.ratio ?? 0)}</span>
            <span>noch {formatAmount(amortisation.remainingCents)} offen</span>
          </p>
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            {amortisation.remainingCents === 0
              ? 'Die 2. Hypothek ist vollständig amortisiert.'
              : plan > 0 && amortisation.endYear !== null && amortisation.yearsLeft !== null
                ? `Bei CHF ${formatAmount(plan)} pro Jahr ist die 2. Hypothek voraussichtlich ${amortisation.endYear} amortisiert – noch rund ${amortisation.yearsLeft.toLocaleString('de-CH', { maximumFractionDigits: 1 })} Jahre.`
                : 'Ohne Amortisation pro Jahr in den Grunddaten lässt sich kein Ende rechnen.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          <p>
            Wie viel zu amortisieren ist, ergibt sich aus Hypothek total und 1. Hypothek – beides steht
            noch nicht in den Grunddaten.
          </p>
          <button type="button" onClick={onGrunddaten} className="mt-2 font-semibold text-brand-700 dark:text-brand-300">
            Grunddaten ergänzen
          </button>
        </div>
      )}

      <ul className="mt-4 space-y-4">
        {jahre.map((jahr) => (
          <li key={jahr.year}>
            <p className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{jahr.year}</span>
              <span className="tabular-nums text-slate-700 dark:text-slate-200">
                {formatAmount(jahr.paidCents)}
                {jahr.targetCents > 0 ? (
                  <span className="text-slate-500 dark:text-slate-400"> / {formatAmount(jahr.targetCents)}</span>
                ) : null}
              </span>
            </p>
            {jahr.targetCents > 0 ? (
              <div className="mt-1.5">
                <Fortschritt
                  anteil={jahr.paidCents / jahr.targetCents}
                  label={`Amortisation ${jahr.year}: ${formatAmount(jahr.paidCents)} von ${formatAmount(jahr.targetCents)}`}
                  farbe={jahr.openCents === 0 ? 'var(--hypothek-3)' : undefined}
                />
              </div>
            ) : null}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {jahr.targetCents === 0
                ? `${jahr.payments.length} ${jahr.payments.length === 1 ? 'Tranche' : 'Tranchen'}`
                : jahr.openCents > 0
                  ? `Noch ${formatAmount(jahr.openCents)} offen`
                  : jahr.paidCents > jahr.targetCents
                    ? `Soll erfüllt, ${formatAmount(jahr.paidCents - jahr.targetCents)} mehr als verlangt`
                    : 'Soll erfüllt'}
            </p>
            {jahr.payments.length > 0 ? (
              <ul className="mt-1.5 divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                {jahr.payments.map((payment) => (
                  <li key={payment.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(payment)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                    >
                      <span className="min-w-0 text-sm text-slate-700 dark:text-slate-200">
                        {formatDate(payment.paidOn)}
                        {payment.note ? (
                          <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">{payment.note}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatAmount(payment.amountCents)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      {amortisation.carriedOverCents > 0 ? (
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Darin ein Übertrag von CHF {formatAmount(amortisation.carriedOverCents)}
          {amortisation.carriedOverDate ? ` per ${formatDate(amortisation.carriedOverDate)}` : ''} – was
          amortisiert war, bevor hier einzeln erfasst wurde.
        </p>
      ) : null}
    </Abschnitt>
  )
}

/** Je Jahr, was die Hypothek gekostet hat – Zinsen und Amortisation nebeneinander. */
function ProJahr({ jahre }: { jahre: MortgageYear[] }) {
  return (
    <Abschnitt titel="Pro Jahr" hinweis="≈ heisst: mit Prognose für die Quartale, die noch nicht bezahlt sind.">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
            <th className="pb-2 font-medium">Jahr</th>
            <th className="pb-2 text-right font-medium">Zinsen</th>
            <th className="pb-2 text-right font-medium">Amortisation</th>
            <th className="pb-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {jahre.map((jahr) => {
            const vollstaendig = jahr.quartersComplete === jahr.quartersTotal
            const amort = jahr.amortization?.paidCents ?? 0
            return (
              <tr key={jahr.year} className="tabular-nums text-slate-900 dark:text-slate-100">
                <td className="py-2 font-medium">{jahr.year}</td>
                <td className="py-2 text-right">
                  {vollstaendig ? '' : '≈ '}
                  {formatAmount(jahr.interestExpectedCents)}
                </td>
                <td className="py-2 text-right">{amort > 0 ? formatAmount(amort) : '–'}</td>
                <td className="py-2 text-right font-semibold">
                  {formatAmount(jahr.interestExpectedCents + amort)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Abschnitt>
  )
}

// ---------------------------------------------------------------- Fenster

function Dialogfenster({
  titel,
  onClose,
  footer,
  children,
}: {
  titel: string
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <Modal
      onClose={onClose}
      label={titel}
      header={
        <>
          <p className="px-2 text-sm font-semibold">{titel}</p>
          <ModalCloseButton onClick={onClose} label="Schliessen" />
        </>
      }
      footer={footer}
    >
      {children}
    </Modal>
  )
}

/** Ein Betrag als Text fürs Eingabefeld – „1’875.00", wie ihn die Bank schreibt. */
function betragText(cents: number | null): string {
  return cents === null ? '' : formatAmount(cents)
}

/**
 * Die Zinsen eines Quartals eintragen.
 *
 * Vorausgefüllt mit dem, was schon erfasst ist, sonst mit der Prognose: Bei
 * einer Festhypothek stimmt sie auf den Rappen, und man bestätigt nur noch.
 * Ein leeres Feld heisst „noch nicht bezahlt".
 */
function QuartalDialog({
  quartale,
  start,
  onClose,
}: {
  quartale: QuarterRow[]
  start: { year: number; quarter: Quarter }
  onClose: () => void
}) {
  const [index, setIndex] = useState(() =>
    Math.max(0, quartale.findIndex((row) => row.year === start.year && row.quarter === start.quarter)),
  )
  const row = quartale[index]

  return (
    <Dialogfenster titel="Zinsen erfassen" onClose={onClose}>
      {row ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIndex(Math.max(0, index - 1))}
              disabled={index === 0}
              aria-label="Voriges Quartal"
              className="grid size-10 place-items-center rounded-xl text-xl text-slate-600 disabled:opacity-30 dark:text-slate-300"
            >
              ‹
            </button>
            <p className="text-center">
              <span className="block text-base font-semibold">{row.label}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {formatPeriod(row.start, row.end)}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setIndex(Math.min(quartale.length - 1, index + 1))}
              disabled={index === quartale.length - 1}
              aria-label="Nächstes Quartal"
              className="grid size-10 place-items-center rounded-xl text-xl text-slate-600 disabled:opacity-30 dark:text-slate-300"
            >
              ›
            </button>
          </div>
          {/* Ein neues Quartal setzt das Formular neu auf – sonst blieben die
              Beträge des vorigen stehen. */}
          <QuartalFormular key={row.key} row={row} onDone={onClose} />
        </>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">Zuerst eine Hypothek erfassen.</p>
      )}
    </Dialogfenster>
  )
}

function QuartalFormular({ row, onDone }: { row: QuarterRow; onDone: () => void }) {
  const speichern = useSaveQuartal()
  const fehler = speichern.error instanceof ApiRequestError ? speichern.error : null
  const [werte, setWerte] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      row.loans.map((zeile) => [
        zeile.loan.id,
        betragText(zeile.actualCents ?? (zeile.forecastCents > 0 ? zeile.forecastCents : null)),
      ]),
    ),
  )
  const [ungueltig, setUngueltig] = useState<Set<string>>(new Set())

  const summe = row.loans.reduce((sum, zeile) => sum + (parseAmountToCents(werte[zeile.loan.id] ?? '') ?? 0), 0)

  function submit(event: FormEvent) {
    event.preventDefault()
    const falsch = new Set<string>()
    const entries = row.loans.flatMap((zeile) => {
      const text = (werte[zeile.loan.id] ?? '').trim()
      if (!text) return []
      const amountCents = parseAmountToCents(text)
      if (amountCents === null) {
        falsch.add(zeile.loan.id)
        return []
      }
      return [{ loanId: zeile.loan.id, amountCents }]
    })
    setUngueltig(falsch)
    if (falsch.size > 0) return
    speichern.mutate({ year: row.year, quarter: row.quarter, input: { entries } }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {fehler ? <Fehlerbalken text={fehler.message} /> : null}
      {row.loans.map((zeile) => (
        <Field
          key={zeile.loan.id}
          label={zeile.loan.name}
          inputMode="decimal"
          value={werte[zeile.loan.id] ?? ''}
          onChange={(event) => setWerte({ ...werte, [zeile.loan.id]: event.target.value })}
          placeholder="noch nicht bezahlt"
          error={ungueltig.has(zeile.loan.id) ? 'Bitte einen gültigen Betrag eingeben' : undefined}
          hint={
            zeile.forecastCents > 0
              ? `Prognose CHF ${formatAmount(zeile.forecastCents)}${zeile.actualCents !== null ? ` · erfasst ${formatAmount(zeile.actualCents)}` : ''}`
              : 'Läuft in diesem Quartal nicht mehr'
          }
        />
      ))}
      <dl className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
        <Zeile label={`Total ${row.label}`} value={`CHF ${formatAmount(summe)}`} stark />
      </dl>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Leer lassen, was noch nicht bezahlt ist – dort zählt weiter die Prognose.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" loading={speichern.isPending}>
          Speichern
        </Button>
      </div>
    </form>
  )
}

/** Eine Hypothek erfassen oder bearbeiten. */
function VertragDialog({
  loan,
  daten,
  onClose,
}: {
  loan: MortgageLoan | null
  daten: HypothekDaten
  onClose: () => void
}) {
  const speichern = useSaveVertrag()
  const loeschen = useDeleteVertrag()
  const fehler = speichern.error instanceof ApiRequestError ? speichern.error : null
  const felder = fehler?.fields ?? {}

  const [kind, setKind] = useState<LoanKind>(loan?.kind ?? 'fest')
  const [name, setName] = useState(loan?.name ?? '')
  const [betrag, setBetrag] = useState(betragText(loan?.amountCents ?? null))
  const [satz, setSatz] = useState(loan ? formatRate(loan.rateMillipercent) : '')
  const [beginn, setBeginn] = useState(loan?.startDate ?? '')
  const [ende, setEnde] = useState(loan?.endDate ?? '')
  const [notiz, setNotiz] = useState(loan?.note ?? '')
  const [sicher, setSicher] = useState(false)
  const [lokal, setLokal] = useState<Record<string, string>>({})

  const zinsen = loan ? daten.interest.filter((entry) => entry.loanId === loan.id).length : 0
  const satzWert = parseRate(satz)
  const heute =
    satzWert === null ? null : effectiveRate({ kind, rateMillipercent: satzWert }, daten.settings)

  function submit(event: FormEvent) {
    event.preventDefault()
    const amountCents = parseAmountToCents(betrag)
    const fehlt: Record<string, string> = {}
    if (!name.trim()) fehlt.name = 'Bitte einen Namen eingeben'
    if (amountCents === null || amountCents <= 0) fehlt.amountCents = 'Bitte einen Betrag eingeben'
    if (satzWert === null) fehlt.rateMillipercent = 'Bitte einen Zinssatz in Prozent eingeben, etwa 1.25'
    if (!beginn) fehlt.startDate = 'Bitte den Beginn angeben'
    setLokal(fehlt)
    if (Object.keys(fehlt).length > 0 || amountCents === null || satzWert === null) return

    speichern.mutate(
      {
        id: loan?.id ?? null,
        loan: {
          name: name.trim(),
          kind,
          amountCents,
          rateMillipercent: satzWert,
          startDate: beginn,
          endDate: ende || null,
          note: notiz.trim(),
        },
      },
      { onSuccess: onClose },
    )
  }

  const meldung = (feld: string) => lokal[feld] ?? felder[feld]

  return (
    <Dialogfenster
      titel={loan ? 'Hypothek bearbeiten' : 'Hypothek erfassen'}
      onClose={onClose}
      footer={
        loan ? (
          <div className="grid grid-cols-2 gap-2">
            {sicher ? (
              <>
                <Button variant="secondary" onClick={() => setSicher(false)}>
                  Behalten
                </Button>
                <LoeschKnopf
                  disabled={loeschen.isPending}
                  onClick={() => loeschen.mutate(loan.id, { onSuccess: onClose })}
                >
                  Wirklich löschen
                </LoeschKnopf>
              </>
            ) : (
              <LoeschKnopf onClick={() => setSicher(true)}>Löschen</LoeschKnopf>
            )}
          </div>
        ) : undefined
      }
    >
      {sicher ? (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {zinsen > 0
            ? `Mit der Hypothek gehen ihre ${zinsen} erfassten Quartalszinsen. Eine abgelaufene Hypothek muss nicht weg – sie steht dann unter „Abgelaufen".`
            : 'Die Hypothek wird gelöscht.'}
        </p>
      ) : null}
      {fehler && Object.keys(felder).length === 0 ? <Fehlerbalken text={fehler.message} /> : null}

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {LOAN_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              aria-pressed={kind === option}
              className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition ${
                kind === option
                  ? 'border-brand-800 bg-brand-800 text-white'
                  : 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200'
              }`}
            >
              {LOAN_KIND_LABELS[option]}
            </button>
          ))}
        </div>

        <Field
          label="Bezeichnung"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === 'saron' ? 'SARON-Hypothek 0005' : 'Festhypothek 0003'}
          error={meldung('name')}
        />
        <Field
          label="Betrag in CHF"
          inputMode="decimal"
          value={betrag}
          onChange={(event) => setBetrag(event.target.value)}
          error={meldung('amountCents')}
        />
        <Field
          label={kind === 'saron' ? 'Marge in %' : 'Zinssatz in %'}
          inputMode="decimal"
          value={satz}
          onChange={(event) => setSatz(event.target.value)}
          error={meldung('rateMillipercent')}
          hint={
            kind === 'saron'
              ? `Heute ${formatRate(heute)} % – SARON ${formatRate(daten.settings.referenceRateMillipercent)} % aus den Grunddaten plus Marge.`
              : undefined
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Beginn"
            type="date"
            value={beginn}
            onChange={(event) => setBeginn(event.target.value)}
            error={meldung('startDate')}
          />
          <Field
            label={kind === 'saron' ? 'Ende (falls fest)' : 'Laufzeit bis'}
            type="date"
            value={ende}
            onChange={(event) => setEnde(event.target.value)}
            error={meldung('endDate')}
          />
        </div>
        <Field label="Notiz" value={notiz} onChange={(event) => setNotiz(event.target.value)} />

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={speichern.isPending}>
            {loan ? 'Speichern' : 'Erfassen'}
          </Button>
        </div>
      </form>
    </Dialogfenster>
  )
}

/**
 * Was für die ganze Hypothek gilt. Wo sich ein Wert aus anderen ergibt –
 * die 1. Hypothek aus dem Liegenschaftswert, das Total aus den laufenden
 * Hypotheken –, bietet das Formular ihn zum Übernehmen an, statt ihn still
 * einzusetzen.
 */
function GrunddatenDialog({
  daten,
  status,
  onClose,
}: {
  daten: HypothekDaten
  status: MortgageStatus
  onClose: () => void
}) {
  const speichern = useSaveGrunddaten()
  const fehler = speichern.error instanceof ApiRequestError ? speichern.error : null
  const s = daten.settings

  const [wert, setWert] = useState(betragText(s.propertyValueCents || null))
  const [total, setTotal] = useState(betragText(s.mortgageTotalCents || null))
  const [erste, setErste] = useState(betragText(s.firstMortgageCents || null))
  const [plan, setPlan] = useState(betragText(s.amortizationPerYearCents || null))
  const [uebertrag, setUebertrag] = useState(betragText(s.carriedOverCents || null))
  const [per, setPer] = useState(s.carriedOverDate ?? '')
  const [saron, setSaron] = useState(formatRate(s.referenceRateMillipercent))
  const [ungueltig, setUngueltig] = useState<Set<string>>(new Set())

  const lies = (text: string) => (text.trim() ? parseAmountToCents(text) : 0)
  const zweite = Math.max(0, (lies(total) ?? 0) - (lies(erste) ?? 0))
  // Auf ganze Franken – so steht die 1. Hypothek in jedem Vertrag.
  const zweiDrittel = Math.round(((lies(wert) ?? 0) * 2) / 3 / 100) * 100

  function submit(event: FormEvent) {
    event.preventDefault()
    const felder = { wert, total, erste, plan, uebertrag }
    const falsch = new Set(Object.entries(felder).filter(([, text]) => lies(text) === null).map(([key]) => key))
    const referenz = parseRate(saron || '0')
    if (referenz === null) falsch.add('saron')
    setUngueltig(falsch)
    if (falsch.size > 0) return

    speichern.mutate(
      {
        propertyValueCents: lies(wert) ?? 0,
        mortgageTotalCents: lies(total) ?? 0,
        firstMortgageCents: lies(erste) ?? 0,
        amortizationPerYearCents: lies(plan) ?? 0,
        carriedOverCents: lies(uebertrag) ?? 0,
        carriedOverDate: per || null,
        referenceRateMillipercent: referenz ?? 0,
      },
      { onSuccess: onClose },
    )
  }

  const falsch = (key: string) => (ungueltig.has(key) ? 'Bitte einen gültigen Betrag eingeben' : undefined)

  return (
    <Dialogfenster titel="Grunddaten" onClose={onClose}>
      {fehler ? <Fehlerbalken text={fehler.message} /> : null}
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Liegenschaftswert in CHF"
          inputMode="decimal"
          value={wert}
          onChange={(event) => setWert(event.target.value)}
          error={falsch('wert')}
          hint="Grundlage der Belehnung."
        />
        <div>
          <Field
            label="Hypothek total in CHF"
            inputMode="decimal"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            error={falsch('total')}
            hint="Die Ausgangslage der Amortisation – bleibt stehen, auch wenn Hypotheken auslaufen."
          />
          {status.totalCents > 0 && lies(total) !== status.totalCents ? (
            <Vorschlag onClick={() => setTotal(betragText(status.totalCents))}>
              Laufende Hypotheken übernehmen: {formatAmount(status.totalCents)}
            </Vorschlag>
          ) : null}
        </div>
        <div>
          <Field
            label="1. Hypothek in CHF"
            inputMode="decimal"
            value={erste}
            onChange={(event) => setErste(event.target.value)}
            error={falsch('erste')}
          />
          {zweiDrittel > 0 && lies(erste) !== zweiDrittel ? (
            <Vorschlag onClick={() => setErste(betragText(zweiDrittel))}>
              Zwei Drittel des Liegenschaftswerts: {formatAmount(zweiDrittel)}
            </Vorschlag>
          ) : null}
        </div>
        <dl className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          <Zeile label="Zu amortisieren (2. Hypothek)" value={`CHF ${formatAmount(zweite)}`} stark />
        </dl>
        <Field
          label="Amortisation pro Jahr in CHF"
          inputMode="decimal"
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          error={falsch('plan')}
        />
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Bereits amortisiert"
            inputMode="decimal"
            value={uebertrag}
            onChange={(event) => setUebertrag(event.target.value)}
            error={falsch('uebertrag')}
          />
          <Field label="per" type="date" value={per} onChange={(event) => setPer(event.target.value)} />
        </div>
        <p className="-mt-2 text-sm text-slate-500 dark:text-slate-400">
          Der Übertrag aus der eigenen Tabelle. Die Tranchen danach erfasst du einzeln.
        </p>
        <Field
          label="SARON in %"
          inputMode="decimal"
          value={saron}
          onChange={(event) => setSaron(event.target.value)}
          error={ungueltig.has('saron') ? 'Bitte einen Zinssatz in Prozent eingeben' : undefined}
          hint="So, wie ihn die Bank für die SARON-Hypotheken verrechnet. Gilt für die Prognose."
        />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={speichern.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </Dialogfenster>
  )
}

function Vorschlag({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 min-h-9 text-left text-sm font-semibold text-brand-700 dark:text-brand-300"
    >
      {children}
    </button>
  )
}

/**
 * Eine Tranche der Amortisation – vorausgefüllt mit dem, was im Jahr noch
 * fehlt. Wer in zwei Hälften zahlt, bekommt beim zweiten Mal genau den Rest.
 */
function TrancheDialog({
  payment,
  year,
  amortisation,
  heute,
  onClose,
}: {
  payment: AmortizationPayment | null
  year: number
  amortisation: AmortizationSummary
  heute: string
  onClose: () => void
}) {
  const speichern = useSaveTranche()
  const loeschen = useDeleteTranche()
  const fehler = speichern.error instanceof ApiRequestError ? speichern.error : null
  const offen = amortisation.years.find((jahr) => jahr.year === year)?.openCents ?? 0

  const [datum, setDatum] = useState(payment?.paidOn ?? heute)
  const [betrag, setBetrag] = useState(betragText(payment?.amountCents ?? (offen > 0 ? offen : null)))
  const [jahr, setJahr] = useState(String(payment?.year ?? year))
  const [notiz, setNotiz] = useState(payment?.note ?? '')
  const [lokal, setLokal] = useState<Record<string, string>>({})
  const [sicher, setSicher] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    const amountCents = parseAmountToCents(betrag)
    const jahrZahl = Number(jahr)
    const fehlt: Record<string, string> = {}
    if (amountCents === null || amountCents <= 0) fehlt.betrag = 'Bitte einen Betrag eingeben'
    if (!datum) fehlt.datum = 'Bitte den Zahltag angeben'
    if (!Number.isInteger(jahrZahl) || jahrZahl < 2000 || jahrZahl > 2100) fehlt.jahr = 'Bitte ein Jahr angeben'
    setLokal(fehlt)
    if (Object.keys(fehlt).length > 0 || amountCents === null) return

    speichern.mutate(
      {
        id: payment?.id ?? null,
        input: { year: jahrZahl, paidOn: datum, amountCents, note: notiz.trim() },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialogfenster
      titel={payment ? 'Tranche bearbeiten' : 'Tranche erfassen'}
      onClose={onClose}
      footer={
        payment ? (
          <div className="grid grid-cols-2 gap-2">
            {sicher ? (
              <>
                <Button variant="secondary" onClick={() => setSicher(false)}>
                  Behalten
                </Button>
                <LoeschKnopf
                  disabled={loeschen.isPending}
                  onClick={() => loeschen.mutate(payment.id, { onSuccess: onClose })}
                >
                  Wirklich löschen
                </LoeschKnopf>
              </>
            ) : (
              <LoeschKnopf onClick={() => setSicher(true)}>Löschen</LoeschKnopf>
            )}
          </div>
        ) : undefined
      }
    >
      {fehler ? <Fehlerbalken text={fehler.message} /> : null}
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Betrag in CHF"
          inputMode="decimal"
          value={betrag}
          onChange={(event) => setBetrag(event.target.value)}
          error={lokal.betrag ?? fehler?.fields.amountCents}
          hint={!payment && offen > 0 ? `Für ${year} sind noch ${formatAmount(offen)} offen.` : undefined}
        />
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Bezahlt am"
            type="date"
            value={datum}
            onChange={(event) => {
              setDatum(event.target.value)
              // Das Jahr folgt dem Datum, solange niemand es eigens geändert hat.
              if (!payment && event.target.value && jahr === String(year)) setJahr(event.target.value.slice(0, 4))
            }}
            error={lokal.datum ?? fehler?.fields.paidOn}
          />
          <Field
            label="Zählt für"
            inputMode="numeric"
            value={jahr}
            onChange={(event) => setJahr(event.target.value)}
            error={lokal.jahr ?? fehler?.fields.year}
          />
        </div>
        <Field
          label="Notiz"
          value={notiz}
          onChange={(event) => setNotiz(event.target.value)}
          placeholder="z. B. 1. Tranche"
        />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={speichern.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </Dialogfenster>
  )
}

/**
 * Die eigene Excel-Tabelle übernehmen – in zwei Schritten wie beim
 * Rechnungsimport: Der Server liest, der Mensch schaut nach und übernimmt.
 */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const auslesen = useImportHypothekExcel()
  const uebernehmen = useUebernehmeHypothek()
  const dateiwahl = useRef<HTMLInputElement>(null)
  const [ergebnis, setErgebnis] = useState<HypothekImportResult | null>(null)

  const lesefehler = auslesen.error instanceof ApiRequestError ? auslesen.error : null
  const speicherfehler = uebernehmen.error instanceof ApiRequestError ? uebernehmen.error : null
  const daten = ergebnis?.daten ?? null

  return (
    <Dialogfenster titel="Excel-Tabelle übernehmen" onClose={onClose}>
      <input
        ref={dateiwahl}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) auslesen.mutate(file, { onSuccess: setErgebnis })
          event.target.value = ''
        }}
      />

      {!ergebnis ? (
        <div className="space-y-4 py-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Die eigene Excel-Tabelle (.xlsx) auswählen. Gelesen werden die Hypotheken mit Betrag,
            Zinssatz und Laufzeit, die bezahlten Zinsen je Quartal, Liegenschaftswert, Amortisation
            und was schon amortisiert ist – gespeichert wird erst im nächsten Schritt.
          </p>
          {lesefehler ? <Fehlerbalken text={lesefehler.message} /> : null}
          <Button loading={auslesen.isPending} onClick={() => dateiwahl.current?.click()}>
            {auslesen.isPending ? 'Wird gelesen …' : 'Excel-Datei auswählen'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {ergebnis.bereitsVorhanden ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Es ist schon eine Hypothek erfasst. Übernommen wird nur in eine leere Sparte – sonst
              stünde jede Hypothek doppelt da.
            </p>
          ) : null}
          {ergebnis.hinweise.length > 0 ? (
            <ul className="space-y-1.5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {ergebnis.hinweise.map((hinweis) => (
                <li key={hinweis}>{hinweis}</li>
              ))}
            </ul>
          ) : null}
          {speicherfehler ? <Fehlerbalken text={speicherfehler.message} /> : null}

          {daten ? (
            <>
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Hypotheken
                </h3>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {daten.loans.map((loan) => {
                    const zinsen = loan.interest.reduce((sum, entry) => sum + entry.amountCents, 0)
                    return (
                      <li key={loan.name} className="py-2">
                        <p className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{loan.name}</span>
                          <span className="font-semibold tabular-nums">{formatAmount(loan.amountCents)}</span>
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {loan.kind === 'saron'
                            ? `Marge ${formatRate(loan.rateMillipercent)} %`
                            : `${formatRate(loan.rateMillipercent)} % fest`}{' '}
                          · {formatDate(loan.startDate)} – {loan.endDate ? formatDate(loan.endDate) : 'offen'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {loan.interest.length} Quartale, zusammen CHF {formatAmount(zinsen)}
                          {loan.interest[0]
                            ? ` (${quarterLabel(loan.interest[0].year, loan.interest[0].quarter)} – ${quarterLabel(
                                loan.interest.at(-1)?.year ?? loan.interest[0].year,
                                loan.interest.at(-1)?.quarter ?? loan.interest[0].quarter,
                              )})`
                            : ''}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Grunddaten
                </h3>
                <dl className="space-y-1 text-sm">
                  <Zeile label="Liegenschaftswert" value={formatAmount(daten.settings.propertyValueCents)} />
                  <Zeile label="Hypothek total" value={formatAmount(daten.settings.mortgageTotalCents)} />
                  <Zeile label="1. Hypothek" value={formatAmount(daten.settings.firstMortgageCents)} />
                  <Zeile label="Amortisation pro Jahr" value={formatAmount(daten.settings.amortizationPerYearCents)} />
                  <Zeile
                    label={`Bereits amortisiert${daten.settings.carriedOverDate ? ` per ${formatDate(daten.settings.carriedOverDate)}` : ''}`}
                    value={formatAmount(daten.settings.carriedOverCents)}
                  />
                  <Zeile label="SARON" value={`${formatRate(daten.settings.referenceRateMillipercent)} %`} />
                </dl>
              </section>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setErgebnis(null)}>
                  Andere Datei
                </Button>
                <Button
                  loading={uebernehmen.isPending}
                  disabled={ergebnis.bereitsVorhanden}
                  onClick={() => uebernehmen.mutate(daten, { onSuccess: onClose })}
                >
                  Übernehmen
                </Button>
              </div>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setErgebnis(null)}>
              Andere Datei
            </Button>
          )}
        </div>
      )}
    </Dialogfenster>
  )
}

function Leerzustand({ onImport, onManuell }: { onImport: () => void; onManuell: () => void }) {
  return (
    <div className="space-y-4 rounded-2xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Noch keine Hypothek erfasst. Am schnellsten geht es mit der eigenen Excel-Tabelle:
        Hypotheken, Zinssätze, Laufzeiten, bezahlte Zinsen je Quartal und der Stand der Amortisation
        werden daraus gelesen.
      </p>
      <div className="grid gap-2">
        <Button onClick={onImport}>Excel-Tabelle übernehmen</Button>
        <Button variant="secondary" onClick={onManuell}>
          Von Hand erfassen
        </Button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Danach trägst du je Quartal die bezahlten Zinsen nach und die Amortisation in so vielen
        Tranchen, wie du sie überweist.
      </p>
    </div>
  )
}

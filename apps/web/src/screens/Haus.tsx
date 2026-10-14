import {
  abrechnungsstand,
  analyse,
  billSubject,
  billYear,
  BILL_KIND_LABELS,
  COST_GROUPS,
  COST_GROUP_LABELS,
  COST_GROUP_SHORT,
  DIVISIONS,
  DIVISION_LABELS,
  DIVISION_UNITS,
  findPreviousYearEntry,
  formatAmount,
  formatMenge,
  formatPeriod,
  formatPricePerUnit,
  gleicherZeitraumVorjahr,
  kurzerMonat,
  kurzerZeitraum,
  monateDesJahres,
  monthListLabel,
  monthName,
  offenesAkonto,
  priceUnitLabel,
  priceValue,
  shortPeriodLabel,
  summarize,
  trendBetween,
  type BillInput,
  type Division,
  type DivisionEntry,
  type ImportResult,
  type Monat,
  type PeriodSummary,
  type Trend,
  type UtilityBill,
} from '@manager/shared'
import { useMemo, useRef, useState, type ReactNode } from 'react'

import { Button } from '../components/Button'
import {
  Abschnitt,
  Abzeichen,
  Fehlerbalken,
  Kachel,
  LEERER_TREND,
  LoeschKnopf,
  TrendZeichen,
  Zeile,
  ZeitraumWahl,
  type Zeitraum,
} from '../components/HausBausteine'
import { HausChart, ShareBar, type ChartData, type ChartPanel, type ChartSeries } from '../components/HausChart'
import { Modal, ModalCloseButton } from '../components/Modal'
import { RechnungDetail, RechnungFormular } from '../components/HausRechnung'
import { API_BASE, ApiRequestError } from '../lib/api'
import { einlesenEinzeln } from '../lib/einlesen'
import { useLocalSetting } from '../lib/einstellungen'
import {
  useAddHausBill,
  useDeleteHausBill,
  useHausBills,
  useImportHausBill,
  useUpdateHausBill,
} from '../lib/haus'
import { Hypothek } from './Hypothek'

/**
 * Der Bereich Haus: was das Haus verbraucht, was es kostet und wohin es sich
 * bewegt – Strom, Wasser, Abwasser und Kehricht, dazu die Hypothek.
 *
 * Die Sparte wählt die Zeile unter dem Titel, und sie nimmt den ganzen
 * Bildschirm mit. Die Hypothek steht dort als eigene Sparte neben den
 * Nebenkosten: Sie hat andere Zahlen (Zinsen je Quartal, Amortisation), aber
 * denselben Ort – wer wissen will, was das Haus kostet, sucht beides hier.
 */
export function Haus() {
  const [sparte, setSparte] = useLocalSetting<SparteWahl>(
    'haus.sparte',
    ['alle', ...DIVISIONS, 'hypothek'],
    'alle',
  )
  const query = useHausBills()
  const bills = query.data?.bills
  const divisions = useMemo(() => analyse(bills ?? []).divisions, [bills])

  const wahl = <SpartenWahl divisions={divisions} value={sparte} onChange={setSparte} />
  if (sparte === 'hypothek') return <Hypothek spartenWahl={wahl} />
  return <Nebenkosten sparte={sparte} spartenWahl={wahl} />
}

/**
 * Die Nebenkosten: Strom, Wasser, Abwasser und Kehricht.
 *
 * Aufgebaut wie die Frage, mit der man sie öffnet: zuoberst die eine Zahl, um
 * die es gerade geht, dann die Kennzahlen, die Entwicklung als Diagramm und
 * ganz unten die Rechnungen selbst. Wer nur wissen will, ob es teurer wird,
 * hört nach dem ersten Bildschirm auf zu scrollen.
 *
 * Ist ein Jahr gewählt, zeigt das Diagramm die zwölf Monate statt der
 * Abrechnungsperioden – eine einzelne Säule für ein Halbjahr sagt über den
 * Verlauf nichts. Akontorechnungen, die noch keine Abrechnung kennt, stehen
 * dann als provisorisch daneben.
 */
function Nebenkosten({ sparte, spartenWahl }: { sparte: NebenkostenWahl; spartenWahl: ReactNode }) {
  const query = useHausBills()
  const [zeitraum, setZeitraum] = useState<Zeitraum>('alle')
  const [sheet, setSheet] = useState<SheetState>(null)

  const bills = query.data?.bills
  const { entries, akonto, years } = useMemo(() => analyse(bills ?? []), [bills])
  // Was von den Akontorechnungen noch nicht abgerechnet ist – provisorisch.
  const akontoOffen = useMemo(() => offenesAkonto(akonto, entries), [akonto, entries])

  const jahr = typeof zeitraum === 'number' ? zeitraum : null
  const gewaehlt = useMemo(
    () => entries.filter((entry) => passt(entry, zeitraum, sparte)),
    [entries, zeitraum, sparte],
  )
  const provisorisch = useMemo(
    () => akontoOffen.filter((entry) => passt(entry, zeitraum, sparte)),
    [akontoOffen, zeitraum, sparte],
  )

  // Verglichen wird mit denselben Tagen des Vorjahres, wo es die gibt: Ein
  // halbes Jahr gegen ein ganzes wäre eine Aussage über die Zahl der
  // Rechnungen. Fehlen sie, bleibt es beim ganzen Vorjahr – mit Hinweis.
  const { vergleich, vergleichLabel, gleicheTage } = useMemo(() => {
    if (jahr === null) return { vergleich: null, vergleichLabel: null, gleicheTage: false }
    const derSparte = entries.filter((entry) => sparte === 'alle' || entry.division === sparte)
    const gleich = gleicherZeitraumVorjahr(gewaehlt, derSparte)
    if (gleich) {
      return {
        vergleich: summarize(gleich.entries),
        vergleichLabel: kurzerZeitraum(gleich.von, gleich.bis),
        gleicheTage: true,
      }
    }
    const vorjahr = entries.filter((entry) => passt(entry, jahr - 1, sparte))
    return {
      vergleich: vorjahr.length > 0 ? summarize(vorjahr) : null,
      vergleichLabel: String(jahr - 1),
      gleicheTage: false,
    }
  }, [entries, gewaehlt, jahr, sparte])

  const summe = summarize(gewaehlt)
  const monate = useMemo(() => {
    if (jahr === null) return null
    const derSparte = (liste: DivisionEntry[]) =>
      liste.filter((entry) => sparte === 'alle' || entry.division === sparte)
    return {
      jetzt: monateDesJahres(jahr, derSparte(entries), derSparte(akontoOffen)),
      vorjahr: monateDesJahres(jahr - 1, derSparte(entries), []),
    }
  }, [entries, akontoOffen, jahr, sparte])

  const chart = useMemo(
    () =>
      jahr !== null && monate
        ? buildMonatsChart(jahr, monate.jetzt, monate.vorjahr, sparte)
        : buildChart(gewaehlt, provisorisch, sparte),
    [jahr, monate, gewaehlt, provisorisch, sparte],
  )

  if (query.isLoading || !bills) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Haus</h1>
        {spartenWahl}
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
        <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-900" />
      </div>
    )
  }

  const offeneAkontoRechnungen = new Set(akontoOffen.map((entry) => entry.bill.id))
  const sparten = DIVISIONS.filter((division) =>
    [...gewaehlt, ...provisorisch].some((entry) => entry.division === division),
  )

  return (
    // Die Aktualisierung nach einer Änderung soll den Bildschirm nicht
    // zurücksetzen: Statt eines neuen Skeletts wird das Bisherige blasser.
    <div className={`space-y-5 pb-4 transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Haus</h1>
        {bills.length > 0 ? (
          <ZeitraumWahl years={years} value={zeitraum} onChange={setZeitraum} />
        ) : null}
      </div>

      {spartenWahl}

      {bills.length === 0 ? (
        <Leerzustand
          onImport={() => setSheet({ kind: 'import' })}
          onManuell={() => setSheet({ kind: 'neu' })}
        />
      ) : (
        <>
          <Leitzahl
            summe={summe}
            vergleich={vergleich}
            vergleichLabel={vergleichLabel}
            sparte={sparte}
            entries={gewaehlt}
            provisorisch={provisorisch}
          />

          <Kennzahlen
            summe={summe}
            vergleich={vergleich}
            vergleichLabel={vergleichLabel}
            gleicheTage={gleicheTage}
            kostenImKopf={summe.unit === null || summe.pricePerUnitHundredths === null}
          />

          {jahr !== null && monate && sparten.length > 0 ? (
            <Abrechnungsstand jahr={jahr} monate={monate.jetzt} divisions={sparten} />
          ) : null}

          {chart.labels.length > 0 && chart.panels.length > 0 ? (
            <Abschnitt
              titel={jahr !== null ? `Verlauf ${jahr}` : 'Entwicklung'}
              hinweis={
                jahr !== null
                  ? `Je Monat, die Rechnungen gleichmässig auf ihre Tage verteilt. Schraffiert: Akonto, noch nicht abgerechnet. Grauer Strich: ${jahr - 1}. Eine Spalte antippen zeigt ihre Werte.`
                  : 'Reihen lassen sich unten ein- und ausblenden. Schraffiert: Akonto, noch nicht abgerechnet. Eine Spalte antippen zeigt ihre Werte.'
              }
            >
              <HausChart data={chart} />
            </Abschnitt>
          ) : null}

          <Aufteilung summe={summe} sparte={sparte} />

          <Vorjahresvergleich alle={entries} gewaehlt={gewaehlt} />

          <Zahlungen
            abrechnungen={gewaehlt}
            akonto={akonto.filter((entry) => passt(entry, zeitraum, sparte))}
            sparte={sparte}
          />

          <Rechnungsliste
            bills={rechnungenIn([...gewaehlt, ...akonto.filter((e) => passt(e, zeitraum, sparte))])}
            provisorisch={offeneAkontoRechnungen}
            onOpen={(bill) => setSheet({ kind: 'detail', bill })}
          />

          <div className="grid gap-2">
            <Button onClick={() => setSheet({ kind: 'import' })}>Rechnung importieren</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setSheet({ kind: 'neu' })}>
                Von Hand
              </Button>
              <a
                href={`${API_BASE}/api/haus/export.csv`}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                CSV laden
              </a>
            </div>
          </div>
        </>
      )}

      {sheet?.kind === 'import' ? <ImportDialog onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === 'neu' ? <ErfassenDialog onClose={() => setSheet(null)} /> : null}
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

type SparteWahl = 'alle' | Division | 'hypothek'
type NebenkostenWahl = 'alle' | Division

type SheetState =
  | null
  | { kind: 'import' }
  | { kind: 'neu' }
  | { kind: 'detail'; bill: UtilityBill }
  | { kind: 'bearbeiten'; bill: UtilityBill }

function passt(entry: DivisionEntry, zeitraum: Zeitraum, sparte: NebenkostenWahl): boolean {
  if (sparte !== 'alle' && entry.division !== sparte) return false
  if (zeitraum !== 'alle' && billYear(entry.bill) !== zeitraum) return false
  return true
}

/** Die Rechnungen hinter einer Auswahl – jede höchstens einmal, jüngste zuerst. */
function rechnungenIn(entries: DivisionEntry[]): UtilityBill[] {
  const map = new Map<string, UtilityBill>()
  for (const entry of entries) map.set(entry.bill.id, entry.bill)
  return [...map.values()].sort((links, rechts) =>
    rechts.periodStart.localeCompare(links.periodStart),
  )
}

// ------------------------------------------------------------------ Diagramm

const DIVISION_COLORS: Record<Division, string> = {
  strom: 'var(--haus-strom)',
  wasser: 'var(--haus-wasser)',
  abwasser: 'var(--haus-abwasser)',
  kehricht: 'var(--haus-kehricht)',
}

/**
 * Baut die Felder des Diagramms aus der Auswahl.
 *
 * Je Einheit ein eigenes Feld: Kilowattstunden, Kubikmeter, Franken und
 * Rappen je Einheit haben nichts gemeinsam. Und die Kosten stapeln sich nach
 * dem, was gerade gefragt ist – über alle Sparten hinweg nach Sparte, beim
 * Strom allein nach seinen drei Blöcken.
 */
function buildChart(
  entries: DivisionEntry[],
  provisorisch: DivisionEntry[],
  sparte: NebenkostenWahl,
): ChartData {
  const perioden = [
    ...new Map(
      [...entries, ...provisorisch].map((entry) => [
        `${entry.bill.periodStart}|${entry.bill.periodEnd}`,
        { start: entry.bill.periodStart, end: entry.bill.periodEnd },
      ]),
    ).values(),
  ].sort((links, rechts) => links.start.localeCompare(rechts.start))

  const index = new Map(perioden.map((periode, i) => [`${periode.start}|${periode.end}`, i]))
  const spalte = (entry: DivisionEntry): number =>
    index.get(`${entry.bill.periodStart}|${entry.bill.periodEnd}`) ?? 0

  const leer = (): (number | null)[] => new Array<number | null>(perioden.length).fill(null)
  const addiere = (values: (number | null)[], at: number, value: number): void => {
    values[at] = (values[at] ?? 0) + value
  }

  const vorhanden = new Set(entries.map((entry) => entry.division))
  const panels: ChartPanel[] = []

  // 1. Kosten – immer da, und der Grund, warum man alles zusammen anschaut.
  const kosten: ChartSeries[] =
    sparte === 'strom'
      ? COST_GROUPS.map((group) => ({
          key: `kosten-${group}`,
          label: COST_GROUP_SHORT[group],
          color: `var(--haus-${group})`,
          values: leer(),
        }))
      : DIVISIONS.filter((division) => vorhanden.has(division)).map((division) => ({
          key: `kosten-${division}`,
          label: DIVISION_LABELS[division],
          color: DIVISION_COLORS[division],
          values: leer(),
        }))

  for (const entry of entries) {
    if (sparte === 'strom') {
      // Aus dem Block selbst, nicht aus seiner Reihenfolge: Eine Kette von
      // Wenn-Dann über drei feste Namen schrieb den vierten Block still dem
      // dritten zu und zeigte die Messung als Abgabe.
      for (const [position, group] of COST_GROUPS.entries()) {
        const betrag = entry.groupCents?.[group]
        if (betrag !== undefined) addiere(kosten[position]?.values ?? [], spalte(entry), betrag / 100)
      }
    } else {
      const serie = kosten.find((eintrag) => eintrag.key === `kosten-${entry.division}`)
      if (serie) addiere(serie.values, spalte(entry), entry.costCents / 100)
    }
  }

  // Akonto, das noch keine Abrechnung kennt – als eigene, schraffierte Spalte.
  if (provisorisch.length > 0) {
    const serie = akontoSerie(sparte, leer())
    for (const entry of provisorisch) addiere(serie.values, spalte(entry), entry.costCents / 100)
    kosten.push(serie)
  }
  panels.push({ id: 'kosten', title: 'Kosten', unit: 'CHF', kind: 'stapel', digits: 2, series: kosten })

  // 2. Strom in Kilowattstunden, nach Tarif getrennt.
  if (vorhanden.has('strom')) {
    const hoch = leer()
    const nieder = leer()
    for (const entry of entries) {
      if (entry.division !== 'strom') continue
      if (entry.highQuantity !== null) addiere(hoch, spalte(entry), entry.highQuantity)
      if (entry.lowQuantity !== null) addiere(nieder, spalte(entry), entry.lowQuantity)
    }
    panels.push({
      id: 'kwh',
      title: 'Stromverbrauch',
      unit: 'kWh',
      kind: 'stapel',
      digits: 0,
      series: [
        { key: 'hochtarif', label: 'Hochtarif', color: 'var(--haus-hochtarif)', values: hoch },
        { key: 'niedertarif', label: 'Niedertarif', color: 'var(--haus-niedertarif)', values: nieder },
      ],
    })
  }

  // 3. Wasser in Kubikmetern – eine Reihe, nicht zwei.
  //
  // Das Abwasser wird über denselben Zähler verrechnet wie das Trinkwasser.
  // Beide zu stapeln behauptete den doppelten Verbrauch.
  if (vorhanden.has('wasser') || vorhanden.has('abwasser')) {
    const menge = leer()
    for (const entry of entries) {
      if (entry.quantity === null || DIVISION_UNITS[entry.division] !== 'm³') continue
      const at = spalte(entry)
      menge[at] = Math.max(menge[at] ?? 0, entry.quantity)
    }
    panels.push({
      id: 'm3',
      title: 'Wasserverbrauch',
      unit: 'm³',
      kind: 'stapel',
      digits: 0,
      series: [{ key: 'wassermenge', label: 'Verbrauch', color: 'var(--haus-wasser)', values: menge }],
    })
  }

  // 4. Preise – je Einheit ein Feld, darin eine Linie je Sparte.
  for (const einheit of ['kWh', 'm³'] as const) {
    const sparten = DIVISIONS.filter(
      (division) => vorhanden.has(division) && DIVISION_UNITS[division] === einheit,
    )
    if (sparten.length === 0) continue

    const series: ChartSeries[] = sparten.map((division) => {
      const values = leer()
      for (const entry of entries) {
        if (entry.division !== division) continue
        const wert = priceValue(entry.pricePerUnitHundredths, entry.unit)
        if (wert !== null) values[spalte(entry)] = wert
      }
      return {
        key: `preis-${division}`,
        // Immer mit der Sparte im Namen: „Ø Preis" käme sonst zweimal in der
        // Legende vor – einmal für Rappen je Kilowattstunde, einmal für
        // Franken je Kubikmeter.
        label: `Ø ${DIVISION_LABELS[division]}`,
        color: sparten.length > 1 ? DIVISION_COLORS[division] : 'var(--haus-preis)',
        values,
      }
    })

    panels.push({
      id: `preis-${einheit}`,
      title: 'Ø Preis',
      unit: priceUnitLabel(einheit).label,
      kind: 'linie',
      digits: 2,
      series,
    })
  }

  return {
    labels: perioden.map((periode) => shortPeriodLabel(periode.start, periode.end)),
    periods: perioden.map((periode) => formatPeriod(periode.start, periode.end)),
    panels: panels.filter((panel) => panel.series.some((serie) => serie.values.some((v) => v !== null))),
  }
}

/**
 * Die Reihe für das Akonto: in der Farbe der Sparte, wenn nur eine gewählt ist –
 * über alle Sparten in der Farbe der Preise, damit sie sich von keiner Sparte
 * eine Farbe borgt, die dort etwas anderes heisst.
 */
function akontoSerie(sparte: NebenkostenWahl, values: (number | null)[]): ChartSeries {
  return {
    key: 'akonto',
    label: 'Akonto',
    color: sparte === 'alle' ? 'var(--haus-preis)' : DIVISION_COLORS[sparte],
    art: 'provisorisch',
    values,
  }
}

/**
 * Das Diagramm eines einzelnen Jahres: zwölf Monate statt der
 * Abrechnungsperioden.
 *
 * Jede Abrechnung ist gleichmässig auf ihre Tage verteilt (siehe
 * `haus-verlauf.ts`). Darüber das Akonto, soweit es noch nicht abgerechnet
 * ist, schraffiert – und als grauer Strich derselbe Monat des Vorjahres. Der
 * Strich stapelt sich nicht mit: Er ist Massstab, nicht Teil der Kosten.
 */
function buildMonatsChart(
  jahr: number,
  monate: Monat[],
  vormonate: Monat[],
  sparte: NebenkostenWahl,
): ChartData {
  const summe = (liste: DivisionEntry[], wert: (entry: DivisionEntry) => number | null): number | null => {
    const werte = liste.map(wert).filter((zahl): zahl is number => zahl !== null)
    return werte.length === 0 ? null : werte.reduce((sum, zahl) => sum + zahl, 0)
  }
  const derSparte = (liste: DivisionEntry[], division: Division) =>
    liste.filter((entry) => entry.division === division)

  const vorhanden = new Set(monate.flatMap((monat) => [...monat.entries, ...monat.akonto]).map((e) => e.division))
  const vorjahr = `${jahr - 1}`
  const panels: ChartPanel[] = []

  // 1. Kosten, gestapelt wie im Gesamtbild: beim Strom nach Block, sonst nach Sparte.
  const kosten: ChartSeries[] =
    sparte === 'strom'
      ? COST_GROUPS.map((group) => ({
          key: `kosten-${group}`,
          label: COST_GROUP_SHORT[group],
          color: `var(--haus-${group})`,
          values: monate.map((monat) => summe(monat.entries, (entry) => (entry.groupCents?.[group] ?? 0) / 100)),
        }))
      : DIVISIONS.filter((division) => vorhanden.has(division)).map((division) => ({
          key: `kosten-${division}`,
          label: DIVISION_LABELS[division],
          color: DIVISION_COLORS[division],
          values: monate.map((monat) => summe(derSparte(monat.entries, division), (entry) => entry.costCents / 100)),
        }))
  kosten.push(akontoSerie(sparte, monate.map((monat) => summe(monat.akonto, (entry) => entry.costCents / 100))))
  kosten.push({
    key: 'kosten-vorjahr',
    label: `Kosten ${vorjahr}`,
    color: 'var(--haus-vorjahr)',
    art: 'vergleich',
    values: vormonate.map((monat) => summe(monat.entries, (entry) => entry.costCents / 100)),
  })
  panels.push({ id: 'kosten', title: 'Kosten', unit: 'CHF', kind: 'stapel', digits: 2, series: kosten })

  // 2. Strom in Kilowattstunden, nach Tarif.
  if (vorhanden.has('strom')) {
    const stromVon = (monat: Monat) => derSparte(monat.entries, 'strom')
    panels.push({
      id: 'kwh',
      title: 'Stromverbrauch',
      unit: 'kWh',
      kind: 'stapel',
      digits: 0,
      series: [
        {
          key: 'hochtarif',
          label: 'Hochtarif',
          color: 'var(--haus-hochtarif)',
          values: monate.map((monat) => summe(stromVon(monat), (entry) => entry.highQuantity)),
        },
        {
          key: 'niedertarif',
          label: 'Niedertarif',
          color: 'var(--haus-niedertarif)',
          values: monate.map((monat) => summe(stromVon(monat), (entry) => entry.lowQuantity)),
        },
        {
          key: 'kwh-vorjahr',
          label: `kWh ${vorjahr}`,
          color: 'var(--haus-vorjahr)',
          art: 'vergleich',
          values: vormonate.map((monat) => summe(stromVon(monat), (entry) => entry.quantity)),
        },
      ],
    })
  }

  // 3. Wasser in Kubikmetern – das Abwasser läuft über denselben Zähler und
  // wird deshalb nicht dazugezählt (siehe buildChart).
  if (vorhanden.has('wasser') || vorhanden.has('abwasser')) {
    const kubik = (monat: Monat): number | null => {
      const mengen = monat.entries
        .filter((entry) => DIVISION_UNITS[entry.division] === 'm³' && entry.quantity !== null)
        .map((entry) => entry.quantity as number)
      return mengen.length === 0 ? null : Math.max(...mengen)
    }
    panels.push({
      id: 'm3',
      title: 'Wasserverbrauch',
      unit: 'm³',
      kind: 'stapel',
      digits: 1,
      series: [
        { key: 'wassermenge', label: 'Verbrauch', color: 'var(--haus-wasser)', values: monate.map(kubik) },
        { key: 'm3-vorjahr', label: `m³ ${vorjahr}`, color: 'var(--haus-vorjahr)', art: 'vergleich', values: vormonate.map(kubik) },
      ],
    })
  }

  // 4. Ø Preis je Einheit – innerhalb einer Abrechnung gleich, deshalb eine
  // Treppe: Sie zeigt, ab welchem Monat der neue Tarif gilt.
  for (const einheit of ['kWh', 'm³'] as const) {
    const sparten = DIVISIONS.filter((division) => vorhanden.has(division) && DIVISION_UNITS[division] === einheit)
    if (sparten.length === 0) continue
    const preis = (liste: DivisionEntry[]): number | null => {
      const kostenSumme = summe(liste, (entry) => entry.costCents)
      const menge = summe(liste, (entry) => entry.quantity)
      if (kostenSumme === null || menge === null || menge <= 0) return null
      return priceValue(Math.round((kostenSumme * 100) / menge), einheit)
    }
    const series: ChartSeries[] = sparten.map((division) => ({
      key: `preis-${division}`,
      label: `Ø ${DIVISION_LABELS[division]}`,
      color: sparten.length > 1 ? DIVISION_COLORS[division] : 'var(--haus-preis)',
      values: monate.map((monat) => preis(derSparte(monat.entries, division))),
    }))
    const [einzige] = sparten
    if (sparten.length === 1 && einzige) {
      series.push({
        key: `preis-vorjahr-${einheit}`,
        label: `Ø Preis ${vorjahr}`,
        color: 'var(--haus-vorjahr)',
        art: 'vergleich',
        values: vormonate.map((monat) => preis(derSparte(monat.entries, einzige))),
      })
    }
    panels.push({ id: `preis-${einheit}`, title: 'Ø Preis', unit: priceUnitLabel(einheit).label, kind: 'linie', digits: 2, series })
  }

  return {
    labels: monate.map((monat) => kurzerMonat(monat.month)),
    periods: monate.map((monat) => `${monthName(monat.month)} ${jahr}`),
    // Ein Feld, in dem dieses Jahr nichts steht, bleibt weg – auch wenn das
    // Vorjahr dort etwas hätte.
    panels: panels.filter((panel) =>
      panel.series.some((serie) => serie.art !== 'vergleich' && serie.values.some((v) => v !== null)),
    ),
  }
}

// ------------------------------------------------------------------- Filter

/**
 * Welche Sparte gezeigt wird – die Wahl überlebt das Schliessen der App.
 *
 * Die Hypothek steht hinter einem Trennstrich: Sie ist eine Sparte des Hauses,
 * aber keine der Nebenkosten, und „Alle Sparten" zählt sie nicht mit.
 */
function SpartenWahl({
  divisions,
  value,
  onChange,
}: {
  divisions: Division[]
  value: SparteWahl
  onChange: (value: SparteWahl) => void
}) {
  const nebenkosten: NebenkostenWahl[] = divisions.length > 1 ? ['alle', ...divisions] : ['alle']

  return (
    <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
      {nebenkosten.map((option) => (
        <SpartenKnopf
          key={option}
          aktiv={value === option}
          onClick={() => onChange(option)}
          farbe={option === 'alle' ? null : DIVISION_COLORS[option]}
        >
          {option === 'alle' ? (divisions.length > 1 ? 'Alle Sparten' : 'Nebenkosten') : DIVISION_LABELS[option]}
        </SpartenKnopf>
      ))}
      <span className="mx-0.5 h-6 w-px shrink-0 bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
      <SpartenKnopf aktiv={value === 'hypothek'} onClick={() => onChange('hypothek')} farbe="var(--hypothek-marke)">
        Hypothek
      </SpartenKnopf>
    </div>
  )
}

function SpartenKnopf({
  aktiv,
  onClick,
  farbe,
  children,
}: {
  aktiv: boolean
  onClick: () => void
  farbe: string | null
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={aktiv}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition ${
        aktiv
          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
          : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
      }`}
    >
      {farbe ? (
        <span className="size-2.5 rounded-full" style={{ backgroundColor: farbe }} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  )
}

// ------------------------------------------------------------------ Kennzahlen

/**
 * Die eine Zahl, wegen der man den Bildschirm öffnet.
 *
 * Bei einer einzelnen Sparte mit Verbrauch ist das der Preis je Einheit – die
 * einzige Zahl, die zwischen verschieden langen Perioden und schwankendem
 * Verbrauch vergleichbar bleibt. Über alle Sparten hinweg gibt es keinen
 * gemeinsamen Preis; dann sind es die Gesamtkosten.
 */
function Leitzahl({
  summe,
  vergleich,
  vergleichLabel,
  sparte,
  entries,
  provisorisch,
}: {
  summe: PeriodSummary
  vergleich: PeriodSummary | null
  vergleichLabel: string | null
  sparte: NebenkostenWahl
  entries: DivisionEntry[]
  /** Akonto, das noch keine Abrechnung kennt. */
  provisorisch: DivisionEntry[]
}) {
  const alsPreis = summe.unit !== null && summe.pricePerUnitHundredths !== null
  const trend = alsPreis
    ? trendBetween(summe.pricePerUnitHundredths, vergleich?.pricePerUnitHundredths ?? null)
    : trendBetween(summe.annualCostCents, vergleich?.annualCostCents ?? null)

  const spanne =
    entries.length > 0
      ? `${summe.billCount} ${summe.billCount === 1 ? 'Rechnung' : 'Rechnungen'} · ${formatPeriod(
          entries[0]?.bill.periodStart ?? '',
          entries[entries.length - 1]?.bill.periodEnd ?? '',
        )}`
      : 'Noch nichts abgerechnet'

  const akontoVon = provisorisch.reduce<string | null>(
    (min, entry) => (min === null || entry.bill.periodStart < min ? entry.bill.periodStart : min),
    null,
  )
  const akontoBis = provisorisch.reduce<string | null>(
    (max, entry) => (max === null || entry.bill.periodEnd > max ? entry.bill.periodEnd : max),
    null,
  )
  const akontoCents = provisorisch.reduce((sum, entry) => sum + entry.costCents, 0)

  return (
    <section className="rounded-2xl bg-brand-800 p-4 text-white">
      <p className="text-sm text-white/70">
        {alsPreis
          ? `Ø Preis ${sparte === 'alle' ? '' : DIVISION_LABELS[sparte]}`.trim()
          : `Kosten ${sparte === 'alle' ? 'gesamt' : DIVISION_LABELS[sparte]}`}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        {/* Der Blickfang der Seite – bewusst mit den normalen Ziffernbreiten:
            Gleich breite Ziffern wirken bei dieser Grösse auseinandergezogen. */}
        <span className="text-5xl font-bold">
          {alsPreis
            ? formatPricePerUnit(summe.pricePerUnitHundredths, summe.unit)
            : formatAmount(summe.totalCostCents)}
        </span>
        <span className="text-lg text-white/70">
          {alsPreis ? priceUnitLabel(summe.unit).label : 'CHF'}
        </span>
      </p>

      {trend.ratio !== null && vergleichLabel !== null ? (
        <p className="mt-2 text-sm">
          <TrendZeichen trend={trend} hell />
          <span className="text-white/80"> gegenüber {vergleichLabel}</span>
        </p>
      ) : null}

      <div className="mt-3 space-y-1 border-t border-white/15 pt-3 text-sm text-white/70">
        <p>{spanne}</p>
        {akontoVon !== null && akontoBis !== null ? (
          <p className="flex flex-wrap items-center gap-x-1.5">
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">
              provisorisch
            </span>
            Akonto {kurzerZeitraum(akontoVon, akontoBis)} · CHF {formatAmount(akontoCents)}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function Kennzahlen({
  summe,
  vergleich,
  vergleichLabel,
  gleicheTage,
  kostenImKopf,
}: {
  summe: PeriodSummary
  vergleich: PeriodSummary | null
  /** Womit verglichen wird: „Jan–Jun 2025" bei denselben Tagen, sonst das Vorjahr. */
  vergleichLabel: string | null
  /** Ob der Vergleich dieselben Tage des Vorjahres abdeckt. */
  gleicheTage: boolean
  /** Ob die Gesamtkosten schon in der Kachel darüber stehen. */
  kostenImKopf: boolean
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
   *
   * Meist kommt es gar nicht so weit: Für ein gewähltes Jahr wird mit
   * denselben Tagen des Vorjahres verglichen, wo es die gibt (siehe
   * `gleicherZeitraumVorjahr`) – dann decken beide gleich viele Tage ab.
   */
  const spanne = Math.max(summe.days, vergleich?.days ?? 0)
  const summenVergleichbar =
    vergleich !== null &&
    summe.days > 0 &&
    vergleich.days > 0 &&
    (gleicheTage || Math.abs(summe.days - vergleich.days) / spanne <= 0.1)

  const ungleich =
    vergleich !== null && vergleichLabel !== null && !summenVergleichbar
      ? `${vergleichLabel} deckt ${vergleich.days} statt ${summe.days} Tage ab`
      : undefined

  const einheit = summe.unit
  const mengeVergleichbar = einheit !== null && vergleich?.unit === einheit

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* Die Gesamtkosten stehen nur hier, wenn sie nicht schon der Blickfang
          darüber sind – dieselbe Zahl zweimal untereinander ist keine zweite
          Angabe. */}
      <Kachel
        label={kostenImKopf ? 'Kosten pro Jahr' : 'Kosten'}
        wert={
          kostenImKopf
            ? summe.annualCostCents === null
              ? '–'
              : formatAmount(summe.annualCostCents)
            : formatAmount(summe.totalCostCents)
        }
        einheit="CHF"
        trend={
          kostenImKopf
            ? trendBetween(summe.annualCostCents, vergleich?.annualCostCents ?? null)
            : summenVergleichbar
              ? trendBetween(summe.totalCostCents, vergleich?.totalCostCents ?? null)
              : LEERER_TREND
        }
        vergleich={vergleichLabel}
        hinweis={kostenImKopf ? 'Aus der Periodenlänge hochgerechnet' : ungleich}
      />
      <Kachel
        label="Kosten pro Monat"
        wert={proMonat === null ? '–' : formatAmount(Math.round(proMonat))}
        einheit="CHF"
        trend={trendBetween(proMonat, vergleichProMonat)}
        vergleich={vergleichLabel}
        hinweis="Aus der Periodenlänge hochgerechnet"
      />
      {einheit !== null ? (
        <>
          <Kachel
            label="Verbrauch"
            wert={formatMenge(summe.quantity)}
            einheit={einheit}
            trend={
              summenVergleichbar && mengeVergleichbar
                ? trendBetween(summe.quantity, vergleich?.quantity ?? null)
                : LEERER_TREND
            }
            vergleich={vergleichLabel}
            hinweis={ungleich}
          />
          <Kachel
            label="Verbrauch pro Tag"
            wert={summe.quantityPerDay === null ? '–' : formatMenge(summe.quantityPerDay, 1)}
            einheit={einheit}
            trend={
              mengeVergleichbar
                ? trendBetween(summe.quantityPerDay, vergleich?.quantityPerDay ?? null)
                : LEERER_TREND
            }
            vergleich={vergleichLabel}
            hinweis="Macht ungleich lange Perioden vergleichbar"
          />
        </>
      ) : (
        // Ohne gemeinsame Einheit gibt es keine gemeinsame Menge – dafür je
        // Sparte eine. „5'451 kWh" und „120 m³" nebeneinander sagen mehr als
        // eine dritte Variante derselben Kostenzahl.
        summe.perDivision
          .filter((eintrag) => eintrag.quantity !== null && eintrag.unit !== null)
          .slice(0, 2)
          .map((eintrag) => {
            const davor = vergleich?.perDivision.find((v) => v.division === eintrag.division)
            return (
              <Kachel
                key={eintrag.division}
                label={DIVISION_LABELS[eintrag.division]}
                wert={formatMenge(eintrag.quantity)}
                einheit={eintrag.unit ?? ''}
                trend={
                  summenVergleichbar
                    ? trendBetween(eintrag.quantity, davor?.quantity ?? null)
                    : LEERER_TREND
                }
                vergleich={vergleichLabel}
                hinweis={ungleich}
              />
            )
          })
      )}
    </div>
  )
}

// ------------------------------------------------------------ Abrechnungsstand

type Monatsstatus = 'abgerechnet' | 'akonto' | 'offen'

/**
 * Wo das gewählte Jahr steht: je Sparte zwölf Felder – abgerechnet, mit
 * Akonto erst vorausbezahlt, oder noch offen. Darunter die Beträge dazu.
 *
 * Die Antwort auf die Frage, mit der man ein angefangenes Jahr öffnet: Was
 * davon ist schon verrechnet, und was kann noch kommen?
 */
function Abrechnungsstand({
  jahr,
  monate,
  divisions,
}: {
  jahr: number
  monate: Monat[]
  divisions: Division[]
}) {
  const stand = abrechnungsstand(monate, divisions)
  const abgerechnet = monate.reduce((sum, monat) => sum + summarize(monat.entries).totalCostCents, 0)
  const akonto = monate.reduce(
    (sum, monat) => sum + monat.akonto.reduce((teil, entry) => teil + entry.costCents, 0),
    0,
  )

  const status = (monat: { tage: number; abgerechnet: number; akonto: number }): Monatsstatus =>
    monat.abgerechnet * 2 >= monat.tage ? 'abgerechnet' : monat.akonto * 2 >= monat.tage ? 'akonto' : 'offen'

  // Bei einer einzelnen Sparte sagt ein Satz, welche Monate wo stehen.
  const einzige = stand.length === 1 ? stand[0] : undefined
  const monateMit = (art: Monatsstatus) =>
    einzige ? einzige.monate.filter((monat) => status(monat) === art).map((monat) => monat.month) : []

  return (
    <Abschnitt
      titel={`Stand ${jahr}`}
      hinweis="Je Monat: abgerechnet, mit Akonto erst vorausbezahlt – oder noch offen."
    >
      <div className="space-y-1.5">
        {stand.map(({ division, monate: monatsStand }) => (
          <div key={division} className="flex items-center gap-2">
            {stand.length > 1 ? (
              <span className="w-[4.5rem] shrink-0 truncate text-xs text-slate-600 dark:text-slate-300">
                {DIVISION_LABELS[division]}
              </span>
            ) : null}
            <div className="grid flex-1 grid-cols-12 gap-0.5">
              {monatsStand.map((monat) => (
                <MonatsFeld key={monat.month} monat={monat} farbe={DIVISION_COLORS[division]} jahr={jahr} sparte={division} />
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-2" aria-hidden="true">
          {stand.length > 1 ? <span className="w-[4.5rem] shrink-0" /> : null}
          <div className="grid flex-1 grid-cols-12 gap-0.5 text-center text-[10px] text-slate-400 dark:text-slate-500">
            {monate.map((monat) => (
              <span key={monat.month}>{kurzerMonat(monat.month).charAt(0)}</span>
            ))}
          </div>
        </div>
      </div>

      {einzige ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {[
            monateMit('abgerechnet').length > 0 ? `Abgerechnet ${monthListLabel(monateMit('abgerechnet'))}` : null,
            monateMit('akonto').length > 0 ? `Akonto ${monthListLabel(monateMit('akonto'))}` : null,
            monateMit('offen').length > 0 ? `offen ${monthListLabel(monateMit('offen'))}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}

      <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
        <Zeile label="Abgerechnet" value={`CHF ${formatAmount(abgerechnet)}`} />
        {akonto > 0 ? (
          <Zeile
            label={
              <span className="inline-flex items-center gap-1.5">
                Akonto <Abzeichen ton="hinweis">provisorisch</Abzeichen>
              </span>
            }
            value={`CHF ${formatAmount(akonto)}`}
          />
        ) : null}
        {akonto > 0 ? (
          <div className="border-t border-slate-100 pt-1.5 dark:border-slate-800">
            <Zeile label={`Bisher ${jahr}`} value={`CHF ${formatAmount(abgerechnet + akonto)}`} stark />
          </div>
        ) : null}
      </dl>
    </Abschnitt>
  )
}

/**
 * Ein Monat im Abrechnungsstand: gefüllt, so weit er abgerechnet ist,
 * schraffiert, so weit ihn nur ein Akonto deckt. Die Anteile folgen den Tagen –
 * eine Abrechnung bis zum 20. füllt zwei Drittel.
 */
function MonatsFeld({
  monat,
  farbe,
  jahr,
  sparte,
}: {
  monat: { month: number; tage: number; abgerechnet: number; akonto: number }
  farbe: string
  jahr: number
  sparte: Division
}) {
  const abgerechnet = (monat.abgerechnet / monat.tage) * 100
  const akonto = (monat.akonto / monat.tage) * 100
  const beschreibung = `${DIVISION_LABELS[sparte]}, ${monthName(monat.month)} ${jahr}: ${
    abgerechnet >= 50 ? 'abgerechnet' : akonto >= 50 ? 'Akonto, provisorisch' : 'offen'
  }`

  return (
    <div
      role="img"
      aria-label={beschreibung}
      title={beschreibung}
      className="flex h-6 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800"
    >
      {abgerechnet > 0 ? <div style={{ width: `${abgerechnet}%`, backgroundColor: farbe }} /> : null}
      {akonto > 0 ? (
        <div
          style={{
            width: `${akonto}%`,
            background: `repeating-linear-gradient(45deg, ${farbe} 0 2px, transparent 2px 5px)`,
          }}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- Aufteilung

function Aufteilung({ summe, sparte }: { summe: PeriodSummary; sparte: NebenkostenWahl }) {
  if (summe.totalCostCents <= 0) return null

  // Über alle Sparten hinweg nach Sparte, beim Strom allein nach seinen
  // Blöcken – dieselbe Regel wie im Diagramm darüber.
  const slices =
    sparte === 'strom'
      ? COST_GROUPS.map((group) => ({
          label: COST_GROUP_LABELS[group],
          value: (summe.groupCents?.[group] ?? 0) / 100,
          color: `var(--haus-${group})`,
        })).filter((slice) => slice.value > 0)
      : summe.perDivision.map((eintrag) => ({
          label: DIVISION_LABELS[eintrag.division],
          value: eintrag.costCents / 100,
          color: DIVISION_COLORS[eintrag.division],
        }))

  if (slices.length < 2) return null

  return (
    <Abschnitt titel="Woher die Kosten kommen">
      <ShareBar total={summe.totalCostCents / 100} slices={slices} />

      {sparte === 'alle' && summe.highQuantity !== null && summe.lowQuantity !== null ? (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            Strom nach Tarif in kWh
          </p>
          <ShareBar
            total={summe.highQuantity + summe.lowQuantity}
            digits={0}
            slices={[
              { label: 'Hochtarif', value: summe.highQuantity, color: 'var(--haus-hochtarif)' },
              { label: 'Niedertarif', value: summe.lowQuantity, color: 'var(--haus-niedertarif)' },
            ]}
          />
        </div>
      ) : null}
    </Abschnitt>
  )
}

// -------------------------------------------------------------- Jahresvergleich

/**
 * Jede Sparte neben derselben Jahreszeit des Vorjahres.
 *
 * Der ehrlichste Vergleich, den die Daten hergeben: Ein Winterhalbjahr gegen
 * ein Sommerhalbjahr zu stellen, hiesse die Heizung mit dem Rasenmäher zu
 * vergleichen. Gesucht wird deshalb die Rechnung derselben Sparte, deren
 * Periode ein Jahr früher begann.
 */
function Vorjahresvergleich({
  alle,
  gewaehlt,
}: {
  alle: DivisionEntry[]
  gewaehlt: DivisionEntry[]
}) {
  const paare = gewaehlt
    .map((entry) => ({ jetzt: entry, davor: findPreviousYearEntry(alle, entry) }))
    .filter((paar): paar is { jetzt: DivisionEntry; davor: DivisionEntry } => paar.davor !== null)
    .reverse()

  if (paare.length === 0) return null

  return (
    <Abschnitt titel="Gegenüber dem Vorjahr">
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {paare.map(({ jetzt, davor }) => (
          <li key={jetzt.id} className="py-2.5 first:pt-0 last:pb-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: DIVISION_COLORS[jetzt.division] }}
                aria-hidden="true"
              />
              {DIVISION_LABELS[jetzt.division]}
              <span className="font-normal text-slate-500 dark:text-slate-400">
                {formatPeriod(jetzt.bill.periodStart, jetzt.bill.periodEnd)}
              </span>
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              verglichen mit {formatPeriod(davor.bill.periodStart, davor.bill.periodEnd)}
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              <VergleichsWert
                label="Verbrauch"
                trend={trendBetween(jetzt.quantity, davor.quantity)}
                wert={jetzt.quantity === null ? '–' : `${formatMenge(jetzt.quantity)} ${jetzt.unit ?? ''}`}
              />
              <VergleichsWert
                label="Kosten"
                trend={trendBetween(jetzt.costCents, davor.costCents)}
                wert={formatAmount(jetzt.costCents)}
              />
              <VergleichsWert
                label="Ø Preis"
                trend={trendBetween(jetzt.pricePerUnitHundredths, davor.pricePerUnitHundredths)}
                wert={
                  jetzt.pricePerUnitHundredths === null
                    ? '–'
                    : formatPricePerUnit(jetzt.pricePerUnitHundredths, jetzt.unit)
                }
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
      <dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{wert}</dd>
      <dd className="text-[11px]">
        <TrendZeichen trend={trend} />
      </dd>
    </div>
  )
}

// ------------------------------------------------------------------ Zahlungen

/**
 * Was tatsächlich überwiesen wurde – getrennt von dem, was verbraucht wurde.
 *
 * Akontorechnungen sind Vorauszahlungen auf denselben Verbrauch; in der
 * Auswertung hätten sie nichts verloren, weil sie jede Summe verdoppelten.
 * Hier gehören sie hin.
 */
function Zahlungen({
  abrechnungen,
  akonto,
  sparte,
}: {
  abrechnungen: DivisionEntry[]
  akonto: DivisionEntry[]
  sparte: NebenkostenWahl
}) {
  const schlussRechnungen = rechnungenIn(abrechnungen)
  const akontoRechnungen = rechnungenIn(akonto)
  if (schlussRechnungen.length === 0 && akontoRechnungen.length === 0) return null

  // Gerechnet wird je Rechnung und nicht je Sparte: Der Rechnungsbetrag gilt
  // für den ganzen Beleg, und dreimal derselbe Betrag wäre dreimal zu viel.
  const akontoTotal = akontoRechnungen.reduce((sum, bill) => sum + bill.totalCents, 0)
  const schluss = schlussRechnungen.reduce((sum, bill) => sum + bill.totalCents, 0)
  const angerechnet = schlussRechnungen.reduce((sum, bill) => sum + bill.prepaidCents, 0)

  const mitgedeckt =
    sparte === 'alle'
      ? []
      : DIVISIONS.filter(
          (division) =>
            division !== sparte &&
            [...schlussRechnungen, ...akontoRechnungen].some((bill) =>
              bill.sections.some((section) => section.division === division),
            ),
        )

  return (
    <Abschnitt titel="Zahlungen">
      <dl className="space-y-1.5 text-sm">
        <Zeile
          label={`Akontorechnungen (${akontoRechnungen.length})`}
          value={`CHF ${formatAmount(akontoTotal)}`}
        />
        <Zeile
          label={`Schlussabrechnungen (${schlussRechnungen.length})`}
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
      {/* Der Rechnungsbetrag gilt für den ganzen Beleg. Wer nach einer Sparte
          filtert, bekommt hier trotzdem die vollen Beträge – ein Anteil daran
          liesse sich nur mit einem erfundenen Verteilschlüssel ausweisen. */}
      {mitgedeckt.length > 0 ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Diese Beträge gelten für die ganzen Rechnungen – darin steckt auch{' '}
          {mitgedeckt.map((division) => DIVISION_LABELS[division]).join(' und ')}.
        </p>
      ) : null}
    </Abschnitt>
  )
}

// ---------------------------------------------------------------- Rechnungen

function Rechnungsliste({
  bills,
  provisorisch,
  onOpen,
}: {
  bills: UtilityBill[]
  /** Die Akontorechnungen, für die noch keine Abrechnung vorliegt. */
  provisorisch: Set<string>
  onOpen: (bill: UtilityBill) => void
}) {
  if (bills.length === 0) return null

  return (
    <Abschnitt titel="Rechnungen" hinweis="Alle Werte im Detail – antippen zum Öffnen.">
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {bills.map((bill) => (
          <li key={bill.id}>
            <button
              onClick={() => onOpen(bill)}
              className="flex w-full items-center justify-between gap-3 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {formatPeriod(bill.periodStart, bill.periodEnd)}
                  {/* Ein Akonto ist eine Vorauszahlung: provisorisch, bis die
                      Abrechnung kommt, danach in ihr verrechnet. */}
                  {bill.kind === 'akonto' ? (
                    provisorisch.has(bill.id) ? (
                      <Abzeichen ton="hinweis">provisorisch</Abzeichen>
                    ) : (
                      <Abzeichen>verrechnet</Abzeichen>
                    )
                  ) : null}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {BILL_KIND_LABELS[bill.kind]} Nr. {bill.invoiceNumber} · {billSubject(bill)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatAmount(bill.totalCents)}
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
  bill: UtilityBill
  onClose: () => void
  onEdit: () => void
}) {
  const loeschen = useDeleteHausBill()
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
      {sicher ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Das abgelegte PDF bleibt in den Dokumenten – gelöscht wird nur die Auswertung.
        </p>
      ) : null}
    </Modal>
  )
}

function BearbeitenDialog({ bill, onClose }: { bill: UtilityBill; onClose: () => void }) {
  const speichern = useUpdateHausBill()
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
  const anlegen = useAddHausBill()
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
        onSubmit={(bill) => anlegen.mutate({ bill }, { onSuccess: onClose })}
      />
    </Modal>
  )
}

// --------------------------------------------------------------------- Import

interface ImportEintrag {
  file: File
  result: ImportResult
}

/**
 * PDFs auslesen und der Reihe nach bestätigen.
 *
 * Bewusst zweistufig: Der Server liest, der Mensch entscheidet. Was der
 * Automat nicht sicher lesen konnte, steht als Hinweis über dem Formular –
 * und lässt sich dort gleich richtigstellen, statt dass eine falsche Zahl
 * still in der Statistik landet.
 *
 * Die Datei bleibt bis zum Übernehmen im Browser liegen und geht dann mit:
 * So landet dasselbe PDF in einem Zug in der Auswertung und in den Dokumenten.
 */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const auslesen = useImportHausBill()
  const anlegen = useAddHausBill()
  const dateiwahl = useRef<HTMLInputElement>(null)

  const [eintraege, setEintraege] = useState<ImportEintrag[]>([])
  const [index, setIndex] = useState(0)
  const [laeuft, setLaeuft] = useState(false)

  const aktuell = eintraege[index]
  const fehler = anlegen.error instanceof ApiRequestError ? anlegen.error : null

  async function dateienLesen(files: FileList) {
    setLaeuft(true)
    const gelesen: ImportEintrag[] = []

    // Zuerst alle in den Arbeitsspeicher: Die Datei geht zweimal zum Server,
    // zum Auslesen und nach dem Prüfen beim Übernehmen. Bis dahin hätte Chrome
    // eine Datei aus Google Drive längst verloren (siehe `lib/einlesen.ts`).
    const gewaehlt = Array.from(files)
    const eingelesen = await einlesenEinzeln(gewaehlt)

    // Eine Datei nach der anderen: Beim gleichzeitigen Hochladen von fünf
    // Rechnungen bringt der Server nichts schneller zustande, und ein Fehler
    // bei einer soll die anderen nicht mitreissen.
    for (const [nr, einlesung] of eingelesen.entries()) {
      if (!einlesung.ok) {
        // Ohne Formular: Übernehmen liesse sich eine unlesbare Datei ohnehin nicht.
        gelesen.push({
          file: gewaehlt[nr] as File,
          result: { bill: null, hinweise: [einlesung.meldung], bereitsVorhanden: false },
        })
        continue
      }
      const file = einlesung.datei
      try {
        gelesen.push({ file, result: await auslesen.mutateAsync(file) })
      } catch (error) {
        gelesen.push({
          file,
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
            Mehrere Dateien auf einmal sind möglich; sie werden nacheinander vorgelegt. Beim
            Übernehmen wird die Datei zugleich in den Dokumenten abgelegt.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{aktuell?.file.name}</p>

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
              onSubmit={(bill: BillInput) =>
                anlegen.mutate({ bill, file: aktuell.file }, { onSuccess: weiter })
              }
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

function Leerzustand({ onImport, onManuell }: { onImport: () => void; onManuell: () => void }) {
  return (
    <div className="space-y-4 rounded-2xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Noch keine Rechnung erfasst. Ein PDF des Versorgers genügt – Periode, Verbrauch, Tarife und
        Beträge werden daraus gelesen, für Strom wie für Wasser, Abwasser und Kehricht.
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

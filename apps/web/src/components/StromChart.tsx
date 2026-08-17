import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Die Entwicklung des Stromverbrauchs als Diagramm.
 *
 * Bewusst mehrere Felder untereinander statt eines Diagramms mit zwei
 * Achsen: Kilowattstunden, Franken und Rappen je Kilowattstunde haben nichts
 * gemeinsam, und zwei Skalen auf einer Fläche erfinden einen Zusammenhang, den
 * die Zahlen nicht hergeben – die Linie schneidet die Balken dort, wo jemand
 * die Achsen aneinander ausgerichtet hat. Die Felder teilen sich stattdessen
 * die Zeitachse: Was untereinander steht, gehört zur selben Periode, und jede
 * Skala bleibt ehrlich.
 *
 * Welche Reihen sichtbar sind, entscheidet die Legende darunter. Ein Feld, in
 * dem nichts mehr angezeigt wird, verschwindet – sonst bliebe ein leerer
 * Kasten stehen und nähme den anderen den Platz weg.
 */

export type SeriesKey = 'hoch' | 'nieder' | 'energie' | 'netz' | 'abgaben' | 'preis'

export interface ChartPoint {
  id: string
  /** Kurzform für die Achse: „H2 24". */
  label: string
  /** Ausgeschrieben für die Werteanzeige: „01.07.2024 – 31.12.2024". */
  periodLabel: string
  /** Verbrauch je Tarif in kWh. */
  hoch: number | null
  nieder: number | null
  /** Kosten der Periode in Franken. */
  energie: number | null
  netz: number | null
  abgaben: number | null
  /** Ø Preis in Rappen je Kilowattstunde. */
  preis: number | null
}

interface Series {
  key: SeriesKey
  label: string
  color: string
  /** Nachkommastellen in der Werteanzeige. */
  digits: number
}

interface Panel {
  id: string
  title: string
  unit: string
  kind: 'stapel' | 'linie'
  height: number
  series: Series[]
}

const PANELS: Panel[] = [
  {
    id: 'verbrauch',
    title: 'Verbrauch',
    unit: 'kWh',
    kind: 'stapel',
    height: 150,
    series: [
      { key: 'hoch', label: 'Hochtarif', color: 'var(--strom-hochtarif)', digits: 0 },
      { key: 'nieder', label: 'Niedertarif', color: 'var(--strom-niedertarif)', digits: 0 },
    ],
  },
  {
    id: 'kosten',
    title: 'Kosten',
    unit: 'CHF',
    kind: 'stapel',
    height: 150,
    series: [
      { key: 'energie', label: 'Energie', color: 'var(--strom-energie)', digits: 2 },
      { key: 'netz', label: 'Netznutzung', color: 'var(--strom-netznutzung)', digits: 2 },
      { key: 'abgaben', label: 'Abgaben', color: 'var(--strom-abgaben)', digits: 2 },
    ],
  },
  {
    id: 'preis',
    title: 'Ø Preis',
    unit: 'Rp./kWh',
    kind: 'linie',
    height: 116,
    series: [{ key: 'preis', label: 'Ø Preis', color: 'var(--strom-preis)', digits: 2 }],
  },
]

const ALL_SERIES = PANELS.flatMap((panel) => panel.series)

const AXIS_WIDTH = 44
const RIGHT_PAD = 10
const TOP_PAD = 12
/** Höhe des Streifens mit den Periodenbeschriftungen unter dem letzten Feld. */
const LABEL_BAND = 26
/** Der Zwischenraum, der gestapelte Flächen trennt – Fläche statt Umrandung. */
const GAP = 2
const MAX_BAR = 24
const DOT_RADIUS = 4

// ------------------------------------------------------------------ Werkzeug

/** Misst, wie breit der Kasten gerade ist – damit die Schrift nicht mitskaliert. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

/** Runde Achsenwerte: 0, 500, 1'000 … statt 0, 437, 874. */
function niceStep(rough: number): number {
  if (rough <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}

interface Scale {
  min: number
  max: number
  ticks: number[]
}

/** Skala für gestapelte Balken: immer von null, sonst lügt die Länge. */
function stackScale(max: number): Scale {
  const step = niceStep(Math.max(max, 1) / 4)
  const top = Math.ceil(Math.max(max, 1) / step) * step
  const ticks: number[] = []
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value)
  return { min: 0, max: top, ticks }
}

/**
 * Skala für die Preislinie.
 *
 * Hier darf die Achse über der Null beginnen: Gezeigt wird die Veränderung
 * eines Preises, der nie in die Nähe von null kommt, und bei einer Linie misst
 * das Auge die Steigung und nicht die Länge. Die beschrifteten Werte sagen
 * jederzeit, wo man sich befindet.
 */
function lineScale(values: number[]): Scale {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const spanne = Math.max(max - min, Math.max(max, 1) * 0.04)
  const step = niceStep(spanne / 2)

  const unten = Math.floor((min - spanne * 0.25) / step) * step
  const oben = Math.ceil((max + spanne * 0.25) / step) * step

  const ticks: number[] = []
  for (let value = unten; value <= oben + step / 2; value += step) ticks.push(value)
  return { min: unten, max: oben, ticks }
}

function formatTick(value: number, digits: number): string {
  return value.toLocaleString('de-CH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Balken mit abgerundetem Ende oben und geradem Fuss auf der Grundlinie. */
function barPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height))
  if (r === 0) return `M${x} ${y}h${width}v${height}h${-width}Z`
  return `M${x} ${y + height}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${width - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y + height}Z`
}

// ------------------------------------------------------------------ Diagramm

export function StromChart({ points }: { points: ChartPoint[] }) {
  const { ref, width } = useWidth()
  const [hidden, setHidden] = useState<Set<SeriesKey>>(() => new Set())
  const [selected, setSelected] = useState<number | null>(null)

  // Ohne eigene Wahl steht die jüngste Periode in der Werteanzeige: Das ist
  // die Zahl, wegen der man den Bildschirm geöffnet hat.
  const active = selected !== null && selected < points.length ? selected : points.length - 1

  const sichtbar = useMemo(
    () => new Set(ALL_SERIES.map((series) => series.key).filter((key) => !hidden.has(key))),
    [hidden],
  )

  const panels = PANELS.map((panel) => ({
    ...panel,
    series: panel.series.filter((series) => sichtbar.has(series.key)),
  })).filter((panel) => {
    if (panel.series.length === 0) return false
    // Ein Feld ohne Zahlen bleibt weg – bei reinen Akontoperioden gibt es
    // keinen Verbrauch, und eine leere Fläche erklärt niemandem, warum.
    return points.some((point) => panel.series.some((series) => point[series.key] !== null))
  })

  if (points.length === 0) return null

  const plotWidth = Math.max(width - AXIS_WIDTH - RIGHT_PAD, 60)
  const band = plotWidth / points.length
  const barWidth = Math.max(6, Math.min(MAX_BAR, band - 10))

  // Jede zweite Beschriftung, sobald es eng wird – abgeschnittene Wörter
  // helfen niemandem.
  const labelStep = Math.max(1, Math.ceil(52 / Math.max(band, 1)))

  const height = panels.reduce((sum, panel) => sum + panel.height, 0) + LABEL_BAND + TOP_PAD

  const bandX = (index: number): number => AXIS_WIDTH + band * index

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = active + (event.key === 'ArrowRight' ? 1 : -1)
    setSelected(Math.max(0, Math.min(points.length - 1, next)))
  }

  return (
    <div ref={ref} className="space-y-3">
      {width > 0 && panels.length > 0 ? (
        <div
          tabIndex={0}
          role="group"
          aria-label="Entwicklung von Verbrauch, Kosten und Strompreis. Mit den Pfeiltasten eine Periode wählen."
          onKeyDown={onKeyDown}
          className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={beschreibung(points, panels)}
          >
            {panels.map((panel, index) => {
              const top = TOP_PAD + panels.slice(0, index).reduce((sum, p) => sum + p.height, 0)
              return (
                <PanelBody
                  key={panel.id}
                  panel={panel}
                  points={points}
                  top={top}
                  width={width}
                  band={band}
                  barWidth={barWidth}
                  active={active}
                  bandX={bandX}
                />
              )
            })}

            {/* Die Periodenbeschriftung steht einmal ganz unten: Alle Felder
                zeigen dieselben Perioden, und dreimal dieselbe Zeile wäre
                dreimal derselbe Platzverbrauch. */}
            {points.map((point, index) =>
              index % labelStep === 0 || index === active ? (
                <text
                  key={point.id}
                  x={bandX(index) + band / 2}
                  y={height - LABEL_BAND / 2 + 4}
                  textAnchor="middle"
                  className={`text-[10px] ${
                    index === active
                      ? 'fill-slate-900 font-semibold dark:fill-slate-100'
                      : 'fill-slate-500 dark:fill-slate-400'
                  }`}
                >
                  {point.label}
                </text>
              ) : null,
            )}

            {/* Die Trefferflächen liegen zuoberst und sind so breit wie die
                ganze Spalte – auf einem Handy trifft niemand einen Balken. */}
            {points.map((point, index) => (
              <rect
                key={point.id}
                x={bandX(index)}
                y={TOP_PAD}
                width={band}
                height={height - TOP_PAD}
                fill="transparent"
                className="cursor-pointer"
                onPointerDown={() => setSelected(index)}
                onMouseEnter={() => setSelected(index)}
              >
                <title>{`${point.periodLabel}`}</title>
              </rect>
            ))}
          </svg>
        </div>
      ) : (
        <div className="h-72 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      )}

      <Readout point={points[active]} sichtbar={sichtbar} />

      <Legend
        hidden={hidden}
        onToggle={(key) =>
          setHidden((current) => {
            const next = new Set(current)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })
        }
      />
    </div>
  )
}

function beschreibung(points: ChartPoint[], panels: Panel[]): string {
  const von = points[0]?.periodLabel ?? ''
  const bis = points[points.length - 1]?.periodLabel ?? ''
  const felder = panels.map((panel) => `${panel.title} in ${panel.unit}`).join(', ')
  return `${felder} über ${points.length} Perioden, von ${von} bis ${bis}.`
}

// -------------------------------------------------------------------- Felder

interface PanelBodyProps {
  panel: Panel
  points: ChartPoint[]
  top: number
  width: number
  band: number
  barWidth: number
  active: number
  bandX: (index: number) => number
}

function PanelBody({ panel, points, top, width, band, barWidth, active, bandX }: PanelBodyProps) {
  const plotTop = top + 20
  const plotBottom = top + panel.height - 8
  const plotHeight = plotBottom - plotTop

  // Nur Perioden mit Zahlen zählen für die Skala – eine Akontoperiode ohne
  // Verbrauch soll die Achse nicht auf null herunterziehen.
  const werte = points
    .filter((point) => panel.series.some((series) => point[series.key] !== null))
    .map((point) => panel.series.reduce((sum, series) => sum + (point[series.key] ?? 0), 0))

  const linienwerte = points
    .map((point) => point[panel.series[0]?.key ?? 'preis'])
    .filter((value): value is number => value !== null)

  const scale =
    panel.kind === 'linie'
      ? lineScale(linienwerte.length > 0 ? linienwerte : [0, 1])
      : stackScale(Math.max(...werte, 0))

  const y = (value: number): number =>
    plotBottom - ((value - scale.min) / (scale.max - scale.min || 1)) * plotHeight

  const digits = panel.series[0]?.digits ?? 0
  const tickDigits = panel.kind === 'linie' ? digits : scale.max < 10 ? 2 : 0

  return (
    <g>
      <text x={0} y={top + 10} className="fill-slate-500 text-[11px] font-semibold dark:fill-slate-400">
        {panel.title}
        <tspan className="fill-slate-400 font-normal dark:fill-slate-500"> · {panel.unit}</tspan>
      </text>

      {/* Gitter: durchgezogene Haarlinien, eine Stufe von der Fläche entfernt. */}
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={AXIS_WIDTH}
            x2={width - RIGHT_PAD}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--strom-gitter)"
            strokeWidth={1}
          />
          <text
            x={AXIS_WIDTH - 6}
            y={y(tick) + 3}
            textAnchor="end"
            className="fill-slate-400 text-[9px] tabular-nums dark:fill-slate-500"
          >
            {formatTick(tick, tickDigits)}
          </text>
        </g>
      ))}

      {/* Die gewählte Spalte wird hinterlegt, nicht umrandet. */}
      <rect
        x={bandX(active)}
        y={plotTop - 6}
        width={band}
        height={plotHeight + 12}
        className="fill-slate-500/8 dark:fill-slate-400/10"
      />

      {panel.kind === 'stapel'
        ? points.map((point, index) => (
            <Stack
              key={point.id}
              point={point}
              series={panel.series}
              x={bandX(index) + (band - barWidth) / 2}
              width={barWidth}
              y={y}
              baseline={plotBottom}
            />
          ))
        : (
          <Line
            points={points}
            series={panel.series[0] as Series}
            band={band}
            bandX={bandX}
            y={y}
            active={active}
          />
        )}
    </g>
  )
}

function Stack({
  point,
  series,
  x,
  width,
  y,
  baseline,
}: {
  point: ChartPoint
  series: Series[]
  x: number
  width: number
  y: (value: number) => number
  baseline: number
}) {
  const teile = series
    .map((entry) => ({ entry, value: point[entry.key] }))
    .filter((teil): teil is { entry: Series; value: number } => teil.value !== null && teil.value > 0)

  let unten = 0

  return (
    <g>
      {teile.map((teil, index) => {
        const oben = unten + teil.value
        const yTop = y(oben)
        const yBottom = y(unten)
        unten = oben

        // Der Zwischenraum sitzt am Fuss jedes Abschnitts ausser dem untersten –
        // so bleibt die Spitze des Stapels der wahre Gesamtwert.
        const höhe = Math.max(1, yBottom - yTop - (index > 0 ? GAP : 0))
        const istOberster = index === teile.length - 1

        return (
          <path
            key={teil.entry.key}
            d={barPath(x, yTop, width, höhe, istOberster ? 4 : 0)}
            fill={teil.entry.color}
          />
        )
      })}
      {teile.length === 0 ? <line x1={x} x2={x + width} y1={baseline} y2={baseline} /> : null}
    </g>
  )
}

function Line({
  points,
  series,
  band,
  bandX,
  y,
  active,
}: {
  points: ChartPoint[]
  series: Series
  band: number
  bandX: (index: number) => number
  y: (value: number) => number
  active: number
}) {
  const gesetzt = points
    .map((point, index) => ({ value: point[series.key], index }))
    .filter((entry): entry is { value: number; index: number } => entry.value !== null)

  const d = gesetzt
    .map(
      (entry, position) =>
        `${position === 0 ? 'M' : 'L'}${bandX(entry.index) + band / 2} ${y(entry.value)}`,
    )
    .join(' ')

  const letzter = gesetzt[gesetzt.length - 1]

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={series.color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {gesetzt.map((entry) => (
        <circle
          key={entry.index}
          cx={bandX(entry.index) + band / 2}
          cy={y(entry.value)}
          r={entry.index === active ? DOT_RADIUS + 1 : DOT_RADIUS}
          fill={series.color}
          // Der Ring in der Flächenfarbe hält den Punkt lesbar, wo er die
          // Linie kreuzt – eine Umrandung wäre Tinte ohne Aussage.
          stroke="var(--strom-flaeche)"
          strokeWidth={2}
        />
      ))}
      {/* Beschriftet wird nur der letzte Punkt. Eine Zahl an jedem Punkt liest
          ohnehin niemand; alles Übrige steht in der Werteanzeige. */}
      {letzter ? (
        <text
          x={bandX(letzter.index) + band / 2}
          y={y(letzter.value) - 10}
          textAnchor="end"
          className="fill-slate-900 text-[10px] font-semibold tabular-nums dark:fill-slate-100"
        >
          {formatTick(letzter.value, series.digits)}
        </text>
      ) : null}
    </g>
  )
}

// ------------------------------------------------------------ Werte & Legende

function Readout({ point, sichtbar }: { point: ChartPoint | undefined; sichtbar: Set<SeriesKey> }) {
  if (!point) return null

  const zeilen = ALL_SERIES.filter(
    (series) => sichtbar.has(series.key) && point[series.key] !== null,
  )

  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        {point.periodLabel}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {zeilen.map((series) => (
          <div key={series.key} className="flex items-center justify-between gap-2">
            <dt className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: series.color }}
                aria-hidden="true"
              />
              <span className="truncate text-xs text-slate-600 dark:text-slate-300">
                {series.label}
              </span>
            </dt>
            <dd className="shrink-0 text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {formatTick(point[series.key] as number, series.digits)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Legend({
  hidden,
  onToggle,
}: {
  hidden: Set<SeriesKey>
  onToggle: (key: SeriesKey) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_SERIES.map((series) => {
        const aktiv = !hidden.has(series.key)
        return (
          <button
            key={series.key}
            type="button"
            onClick={() => onToggle(series.key)}
            aria-pressed={aktiv}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              aktiv
                ? 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                : 'border-slate-200 bg-transparent text-slate-400 dark:border-slate-700 dark:text-slate-500'
            }`}
          >
            <span
              className="size-2.5 rounded-full border-2"
              style={{
                backgroundColor: aktiv ? series.color : 'transparent',
                borderColor: series.color,
              }}
              aria-hidden="true"
            />
            {series.label}
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------- Anteilsbalken

export interface ShareSlice {
  label: string
  value: number
  color: string
}

/** Nachkommastellen der Werte: Franken haben zwei, Kilowattstunden keine. */
type ShareDigits = 0 | 2

/**
 * Ein liegender Balken, der ein Ganzes in seine Teile zerlegt.
 *
 * Statt eines Rings: Bei drei Anteilen, von denen zwei ähnlich gross sind,
 * liest man Längen zuverlässig und Winkel nicht. Die Prozentzahl steht nur im
 * Abschnitt, wenn sie hineinpasst – abgeschnittene Ziffern wären schlimmer als
 * keine, und in der Legende darunter steht ohnehin jeder Wert.
 */
export function ShareBar({
  slices,
  total,
  digits = 2,
}: {
  slices: ShareSlice[]
  total: number
  digits?: ShareDigits
}) {
  const summe = total > 0 ? total : slices.reduce((sum, slice) => sum + slice.value, 0)
  if (summe <= 0) return null

  const prozente = wholePercentages(slices.map((slice) => slice.value), summe)

  return (
    <div className="space-y-2">
      <div className="flex h-7 gap-0.5 overflow-hidden rounded-lg" role="presentation">
        {slices.map((slice, index) => (
          <div
            key={slice.label}
            className="grid place-items-center"
            // Die Breite folgt dem genauen Wert, die Beschriftung der gerundeten
            // Zahl – sonst verschöbe das Runden die Balkenlänge sichtbar.
            style={{ width: `${(slice.value / summe) * 100}%`, backgroundColor: slice.color }}
          >
            {(prozente[index] ?? 0) >= 14 ? (
              <span className="text-[10px] font-semibold tabular-nums text-white">
                {prozente[index]} %
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <dl className="grid gap-1">
        {slices.map((slice, index) => (
          <div key={slice.label} className="flex items-center justify-between gap-2 text-xs">
            <dt className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: slice.color }}
                aria-hidden="true"
              />
              {slice.label}
            </dt>
            <dd className="tabular-nums text-slate-900 dark:text-slate-100">
              {slice.value.toLocaleString('de-CH', {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits,
              })}
              <span className="ml-1.5 text-slate-400 dark:text-slate-500">
                {prozente[index]} %
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Ganze Prozentzahlen, die zusammen 100 ergeben.
 *
 * Einzeln gerundet ergäben 50.7, 34.6 und 14.6 zusammen 101 % – und niemand
 * glaubt einer Aufteilung, die sich nicht aufgeht. Verteilt wird deshalb nach
 * dem grössten Rest: erst abrunden, dann die fehlenden Punkte an die Anteile
 * geben, die am knappsten daran vorbeigingen.
 */
function wholePercentages(values: number[], total: number): number[] {
  const genau = values.map((value) => (value / total) * 100)
  const unten = genau.map(Math.floor)
  const fehlend = Math.round(100 - unten.reduce((sum, value) => sum + value, 0))

  const reihenfolge = genau
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((links, rechts) => rechts.rest - links.rest)

  const ergebnis = [...unten]
  for (let step = 0; step < fehlend && step < reihenfolge.length; step += 1) {
    const eintrag = reihenfolge[step]
    if (eintrag) ergebnis[eintrag.index] = (ergebnis[eintrag.index] ?? 0) + 1
  }
  return ergebnis
}

export const SERIES_COLORS: Record<SeriesKey, string> = Object.fromEntries(
  ALL_SERIES.map((series) => [series.key, series.color]),
) as Record<SeriesKey, string>

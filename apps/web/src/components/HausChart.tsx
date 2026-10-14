import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Die Entwicklung der Hauskosten als Diagramm.
 *
 * Bewusst mehrere Felder untereinander statt eines Diagramms mit zwei Achsen:
 * Kilowattstunden, Kubikmeter, Franken und Rappen je Einheit haben nichts
 * gemeinsam, und zwei Skalen auf einer Fläche erfinden einen Zusammenhang, den
 * die Zahlen nicht hergeben – die Linie schneidet die Balken dort, wo jemand
 * die Achsen aneinander ausgerichtet hat. Die Felder teilen sich stattdessen
 * die Zeitachse: Was untereinander steht, gehört zur selben Periode, und jede
 * Skala bleibt ehrlich.
 *
 * Welche Felder es überhaupt gibt, entscheidet der Bildschirm darüber: Bei
 * „Alle Sparten" braucht es je ein Feld für Kilowattstunden und Kubikmeter,
 * bei „nur Kehricht" gar keines. Welche Reihen sichtbar sind, entscheidet die
 * Legende darunter. Ein Feld, in dem nichts mehr angezeigt wird, verschwindet
 * – sonst bliebe ein leerer Kasten stehen und nähme den anderen den Platz weg.
 */

export interface ChartSeries {
  key: string
  label: string
  color: string
  /** Ein Wert je Periode, in der Reihenfolge von `labels`. null heisst „keine Angabe". */
  values: (number | null)[]
  /**
   * Wie die Reihe gezeichnet wird.
   *
   * `provisorisch` – eine Zahl, die noch nicht feststeht: eine Akontorechnung,
   * die erst die Abrechnung ersetzt, die Prognose eines Zinses, der noch nicht
   * bezahlt ist. Sie stapelt sich wie die anderen, aber schraffiert statt
   * gefüllt, damit niemand sie für abgerechnet hält.
   *
   * `vergleich` – dieselbe Grösse zu einer anderen Zeit, etwa das Vorjahr.
   * Sie stapelt sich nicht mit, sondern steht als Marke über der Säule
   * beziehungsweise als dünne graue Linie.
   */
  art?: 'normal' | 'provisorisch' | 'vergleich'
}

export interface ChartPanel {
  id: string
  title: string
  unit: string
  kind: 'stapel' | 'linie'
  /** Nachkommastellen in Achse und Werteanzeige. */
  digits: number
  series: ChartSeries[]
}

export interface ChartData {
  /** Kurzform je Periode für die Achse: „H2 24". */
  labels: string[]
  /** Ausgeschrieben für die Werteanzeige: „01.07.2024 – 31.12.2024". */
  periods: string[]
  panels: ChartPanel[]
}

const AXIS_WIDTH = 44
const RIGHT_PAD = 10
const TOP_PAD = 12
/** Höhe des Streifens mit den Periodenbeschriftungen unter dem letzten Feld. */
const LABEL_BAND = 26
/** Der Zwischenraum, der gestapelte Flächen trennt – Fläche statt Umrandung. */
const GAP = 2
const MAX_BAR = 24
const DOT_RADIUS = 4
const STACK_HEIGHT = 150
const LINE_HEIGHT = 116

const istVergleich = (serie: ChartSeries): boolean => serie.art === 'vergleich'

/**
 * Die Schraffur des Provisorischen: 45°, in der Farbe der Reihe auf einem
 * hellen Hauch derselben Farbe – so bleibt die Reihe erkennbar und ist doch
 * sichtbar etwas anderes als eine gefüllte Fläche.
 */
function schraffurCss(color: string): string {
  return `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 5px)`
}

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
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
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
 * Skala für eine Preislinie.
 *
 * Hier darf die Achse über der Null beginnen: Gezeigt wird die Veränderung
 * eines Preises, der nie in die Nähe von null kommt, und bei einer Linie misst
 * das Auge die Steigung und nicht die Länge. Die beschrifteten Werte sagen
 * jederzeit, wo man sich befindet.
 */
function lineScale(values: number[]): Scale {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const spanne = Math.max(max - min, Math.max(Math.abs(max), 1) * 0.04)
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

function panelHeight(panel: ChartPanel): number {
  return panel.kind === 'linie' ? LINE_HEIGHT : STACK_HEIGHT
}

// ------------------------------------------------------------------ Diagramm

export function HausChart({ data }: { data: ChartData }) {
  const { ref, width } = useWidth()
  // useId liefert Zeichen wie « » oder :, die in url(#…) nicht taugen.
  const musterId = `muster${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<number | null>(null)

  const anzahl = data.labels.length
  // Ohne eigene Wahl steht die jüngste Periode mit Zahlen in der
  // Werteanzeige: Das ist die Zahl, wegen der man den Bildschirm geöffnet hat.
  // Ein Dezember, der erst noch kommt, hat nur das Vorjahr zu bieten.
  const juengste = useMemo(() => {
    for (let index = data.labels.length - 1; index >= 0; index -= 1) {
      const belegt = data.panels.some((panel) =>
        panel.series.some((serie) => serie.art !== 'vergleich' && serie.values[index] != null),
      )
      if (belegt) return index
    }
    return data.labels.length - 1
  }, [data])
  const active = selected !== null && selected < anzahl ? selected : juengste

  const alleSerien = useMemo(
    () => data.panels.flatMap((panel) => panel.series),
    [data.panels],
  )

  const panels = data.panels
    .map((panel) => ({ ...panel, series: panel.series.filter((s) => !hidden.has(s.key)) }))
    .filter((panel) => panel.series.length > 0)
    // Ein Feld ohne Zahlen bleibt weg – bei reinen Akontoperioden gibt es
    // keinen Verbrauch, und eine leere Fläche erklärt niemandem, warum.
    .filter((panel) => panel.series.some((s) => s.values.some((v) => v !== null)))

  if (anzahl === 0 || alleSerien.length === 0) return null

  const plotWidth = Math.max(width - AXIS_WIDTH - RIGHT_PAD, 60)
  const band = plotWidth / anzahl
  const barWidth = Math.max(6, Math.min(MAX_BAR, band - 10))

  // Jede zweite Beschriftung, sobald es eng wird – abgeschnittene Wörter
  // helfen niemandem.
  const labelStep = Math.max(1, Math.ceil(52 / Math.max(band, 1)))
  const height = panels.reduce((sum, panel) => sum + panelHeight(panel), 0) + LABEL_BAND + TOP_PAD
  const bandX = (index: number): number => AXIS_WIDTH + band * index

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setSelected(Math.max(0, Math.min(anzahl - 1, active + (event.key === 'ArrowRight' ? 1 : -1))))
  }

  return (
    <div ref={ref} className="space-y-3">
      {width > 0 && panels.length > 0 ? (
        <div
          tabIndex={0}
          role="group"
          aria-label="Entwicklung der Hauskosten. Mit den Pfeiltasten eine Periode wählen."
          onKeyDown={onKeyDown}
          className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={beschreibung(data, panels)}
          >
            <defs>
              {alleSerien
                .filter((serie) => serie.art === 'provisorisch')
                .map((serie) => (
                  <pattern
                    key={serie.key}
                    id={`${musterId}-${serie.key}`}
                    width={5}
                    height={5}
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width={5} height={5} fill={serie.color} opacity={0.18} />
                    <rect width={2} height={5} fill={serie.color} />
                  </pattern>
                ))}
            </defs>

            {panels.map((panel, index) => (
              <PanelBody
                key={panel.id}
                musterId={musterId}
                panel={panel}
                top={TOP_PAD + panels.slice(0, index).reduce((sum, p) => sum + panelHeight(p), 0)}
                width={width}
                band={band}
                barWidth={barWidth}
                active={active}
                bandX={bandX}
              />
            ))}

            {/* Die Periodenbeschriftung steht einmal ganz unten: Alle Felder
                zeigen dieselben Perioden, und dreimal dieselbe Zeile wäre
                dreimal derselbe Platzverbrauch. */}
            {data.labels.map((label, index) =>
              index % labelStep === 0 || index === active ? (
                <text
                  key={`${label}-${index}`}
                  x={bandX(index) + band / 2}
                  y={height - LABEL_BAND / 2 + 4}
                  textAnchor="middle"
                  className={`text-[10px] ${
                    index === active
                      ? 'fill-slate-900 font-semibold dark:fill-slate-100'
                      : 'fill-slate-500 dark:fill-slate-400'
                  }`}
                >
                  {label}
                </text>
              ) : null,
            )}

            {/* Die Trefferflächen liegen zuoberst und sind so breit wie die
                ganze Spalte – auf einem Handy trifft niemand einen Balken. */}
            {data.labels.map((label, index) => (
              <rect
                key={`treffer-${label}-${index}`}
                x={bandX(index)}
                y={TOP_PAD}
                width={band}
                height={height - TOP_PAD}
                fill="transparent"
                className="cursor-pointer"
                onPointerDown={() => setSelected(index)}
                onMouseEnter={() => setSelected(index)}
              >
                <title>{data.periods[index]}</title>
              </rect>
            ))}
          </svg>
        </div>
      ) : (
        <div className="h-72 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      )}

      <Readout data={data} index={active} hidden={hidden} />

      <Legend
        panels={data.panels}
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

function beschreibung(data: ChartData, panels: ChartPanel[]): string {
  const felder = panels.map((panel) => `${panel.title} in ${panel.unit}`).join(', ')
  return `${felder} über ${data.labels.length} Perioden, von ${data.periods[0] ?? ''} bis ${
    data.periods[data.periods.length - 1] ?? ''
  }.`
}

// -------------------------------------------------------------------- Felder

interface PanelBodyProps {
  musterId: string
  panel: ChartPanel
  top: number
  width: number
  band: number
  barWidth: number
  active: number
  bandX: (index: number) => number
}

function PanelBody({ musterId, panel, top, width, band, barWidth, active, bandX }: PanelBodyProps) {
  const plotTop = top + 20
  const plotBottom = top + panelHeight(panel) - 8
  const plotHeight = plotBottom - plotTop
  const anzahl = panel.series[0]?.values.length ?? 0

  // Nur Perioden mit Zahlen zählen für die Skala – eine Akontoperiode ohne
  // Verbrauch soll die Achse nicht auf null herunterziehen.
  //
  // Gestapelt zählt die Summe der Reihen, als Linie jeder Wert für sich: Zwei
  // Preise übereinanderzulegen ergäbe eine Achse, auf der keiner von beiden
  // liegt.
  //
  // Eine Vergleichsreihe stapelt sich nicht mit, zählt aber für die Skala:
  // Eine Marke über dem Rand wäre eine, die niemand sieht.
  const werte: number[] = []
  for (let index = 0; index < anzahl; index += 1) {
    const wertVon = (serie: ChartSeries) => serie.values[index]
    const istZahl = (wert: number | null | undefined): wert is number => wert !== null && wert !== undefined
    const spalte = panel.series.filter((serie) => !istVergleich(serie)).map(wertVon).filter(istZahl)
    const vergleich = panel.series.filter(istVergleich).map(wertVon).filter(istZahl)
    if (panel.kind === 'stapel') {
      if (spalte.length > 0) werte.push(spalte.reduce((sum, wert) => sum + wert, 0))
      werte.push(...vergleich)
    } else {
      werte.push(...spalte, ...vergleich)
    }
  }

  const scale =
    panel.kind === 'linie'
      ? lineScale(werte.length > 0 ? werte : [0, 1])
      : stackScale(Math.max(...werte, 0))

  const y = (value: number): number =>
    plotBottom - ((value - scale.min) / (scale.max - scale.min || 1)) * plotHeight

  const tickDigits = panel.kind === 'linie' ? panel.digits : scale.max < 10 ? 2 : 0

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
            stroke="var(--haus-gitter)"
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

      {panel.kind === 'stapel' ? (
        Array.from({ length: anzahl }, (_, index) => (
          <g key={index}>
            <Stack
              musterId={musterId}
              series={panel.series.filter((serie) => !istVergleich(serie))}
              index={index}
              x={bandX(index) + (band - barWidth) / 2}
              width={barWidth}
              y={y}
            />
            {panel.series.filter(istVergleich).map((serie) => {
              const wert = serie.values[index]
              if (wert === null || wert === undefined) return null
              // Die Marke ragt links und rechts über die Säule hinaus: So
              // bleibt sie sichtbar, auch wo die Säule höher ist.
              return (
                <line
                  key={serie.key}
                  x1={bandX(index) + (band - barWidth) / 2 - 3}
                  x2={bandX(index) + (band + barWidth) / 2 + 3}
                  y1={y(wert)}
                  y2={y(wert)}
                  stroke={serie.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )
            })}
          </g>
        ))
      ) : (
        panel.series.map((serie) => (
          <Line
            key={serie.key}
            series={serie}
            digits={panel.digits}
            band={band}
            bandX={bandX}
            y={y}
            active={active}
          />
        ))
      )}
    </g>
  )
}

function Stack({
  musterId,
  series,
  index,
  x,
  width,
  y,
}: {
  musterId: string
  series: ChartSeries[]
  index: number
  x: number
  width: number
  y: (value: number) => number
}) {
  const teile = series
    .map((serie) => ({ serie, value: serie.values[index] ?? null }))
    .filter((teil): teil is { serie: ChartSeries; value: number } => teil.value !== null && teil.value > 0)

  let unten = 0

  return (
    <g>
      {teile.map((teil, position) => {
        const oben = unten + teil.value
        const yTop = y(oben)
        const yBottom = y(unten)
        unten = oben

        // Der Zwischenraum sitzt am Fuss jedes Abschnitts ausser dem untersten –
        // so bleibt die Spitze des Stapels der wahre Gesamtwert.
        const höhe = Math.max(1, yBottom - yTop - (position > 0 ? GAP : 0))

        return (
          <path
            key={teil.serie.key}
            d={barPath(x, yTop, width, höhe, position === teile.length - 1 ? 4 : 0)}
            fill={
              teil.serie.art === 'provisorisch'
                ? `url(#${musterId}-${teil.serie.key})`
                : teil.serie.color
            }
          />
        )
      })}
    </g>
  )
}

function Line({
  series,
  digits,
  band,
  bandX,
  y,
  active,
}: {
  series: ChartSeries
  digits: number
  band: number
  bandX: (index: number) => number
  y: (value: number) => number
  active: number
}) {
  const gesetzt = series.values
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => entry.value !== null)

  const d = gesetzt
    .map((entry, position) => `${position === 0 ? 'M' : 'L'}${bandX(entry.index) + band / 2} ${y(entry.value)}`)
    .join(' ')

  // Die Vergleichslinie tritt zurück: dünner, kleinere Punkte, keine
  // Beschriftung – sie ist der Massstab, nicht die Aussage.
  const vergleich = istVergleich(series)
  const letzter = vergleich ? undefined : gesetzt[gesetzt.length - 1]
  const radius = vergleich ? DOT_RADIUS - 1 : DOT_RADIUS

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={series.color}
        strokeWidth={vergleich ? 1.5 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {gesetzt.map((entry) => (
        <circle
          key={entry.index}
          cx={bandX(entry.index) + band / 2}
          cy={y(entry.value)}
          r={entry.index === active ? radius + 1 : radius}
          fill={series.color}
          // Der Ring in der Flächenfarbe hält den Punkt lesbar, wo er die
          // Linie kreuzt – eine Umrandung wäre Tinte ohne Aussage.
          stroke="var(--haus-flaeche)"
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
          {formatTick(letzter.value, digits)}
        </text>
      ) : null}
    </g>
  )
}

// ------------------------------------------------------------ Werte & Legende

function Readout({
  data,
  index,
  hidden,
}: {
  data: ChartData
  index: number
  hidden: Set<string>
}) {
  const zeilen = data.panels.flatMap((panel) => {
    const sichtbar = panel.series.filter(
      (serie) => !hidden.has(serie.key) && serie.values[index] !== null && serie.values[index] !== undefined,
    )
    const zeilenDesFelds = sichtbar.map((serie) => ({
      key: serie.key,
      label: serie.label,
      color: serie.color,
      art: serie.art ?? 'normal',
      wert: serie.values[index] as number,
      digits: panel.digits,
    }))
    // Bei einem Stapel aus mehreren Teilen gehört die Summe dazu – sie ist
    // die Höhe der Säule, und die lässt sich am Bildschirm nicht nachrechnen.
    const gestapelt = sichtbar.filter((serie) => !istVergleich(serie))
    if (panel.kind === 'stapel' && gestapelt.length > 1) {
      zeilenDesFelds.push({
        key: `${panel.id}-summe`,
        label: `Total ${panel.title}`,
        color: '',
        art: 'normal',
        wert: gestapelt.reduce((sum, serie) => sum + (serie.values[index] ?? 0), 0),
        digits: panel.digits,
      })
    }
    return zeilenDesFelds
  })

  if (zeilen.length === 0) return null

  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        {data.periods[index]}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {zeilen.map((zeile) => (
          <div key={zeile.key} className="flex items-center justify-between gap-2">
            <dt className="flex min-w-0 items-center gap-1.5">
              {zeile.color ? <Kennung color={zeile.color} art={zeile.art} aktiv /> : (
                <span className="size-2.5 shrink-0" aria-hidden="true" />
              )}
              <span
                className={`truncate text-xs ${
                  zeile.color
                    ? 'text-slate-600 dark:text-slate-300'
                    : 'font-semibold text-slate-900 dark:text-slate-100'
                }`}
              >
                {zeile.label}
              </span>
            </dt>
            <dd className="shrink-0 text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {formatTick(zeile.wert, zeile.digits)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Legend({
  panels,
  hidden,
  onToggle,
}: {
  panels: ChartPanel[]
  hidden: Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {panels.flatMap((panel) => panel.series).map((serie) => {
        const aktiv = !hidden.has(serie.key)
        return (
          <button
            key={serie.key}
            type="button"
            onClick={() => onToggle(serie.key)}
            aria-pressed={aktiv}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              aktiv
                ? 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                : 'border-slate-200 bg-transparent text-slate-400 dark:border-slate-700 dark:text-slate-500'
            }`}
          >
            <Kennung color={serie.color} art={serie.art ?? 'normal'} aktiv={aktiv} />
            {serie.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Das Zeichen einer Reihe in Legende und Werteanzeige: ein Punkt für eine
 * gewöhnliche Reihe, ein schraffierter für eine provisorische, ein Strich für
 * den Vergleich – dieselbe Form wie im Diagramm, damit die Zuordnung ohne Farbe
 * gelingt.
 */
function Kennung({
  color,
  art,
  aktiv,
}: {
  color: string
  art: NonNullable<ChartSeries['art']>
  aktiv: boolean
}) {
  if (art === 'vergleich') {
    return (
      <span
        className="h-0.5 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: aktiv ? color : 'transparent', outline: aktiv ? undefined : `1px solid ${color}` }}
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className="size-2.5 shrink-0 rounded-full border-2"
      style={{
        background: aktiv ? (art === 'provisorisch' ? schraffurCss(color) : color) : 'transparent',
        borderColor: color,
      }}
      aria-hidden="true"
    />
  )
}

// ------------------------------------------------------------- Anteilsbalken

export interface ShareSlice {
  label: string
  value: number
  color: string
}

/** Nachkommastellen der Werte: Franken haben zwei, Mengen keine. */
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

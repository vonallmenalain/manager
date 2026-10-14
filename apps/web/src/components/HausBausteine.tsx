import { formatPercentChange, type Trend } from '@manager/shared'
import type { ReactNode } from 'react'

/**
 * Die Bausteine, aus denen der Bereich Haus besteht – für die Nebenkosten wie
 * für die Hypothek. Zwei Sparten, die gleich aussehen, liest man mit einem
 * Blick; zwei, die sich ähnlich, aber nicht gleich verhalten, verwechselt man.
 */

export type Zeitraum = 'alle' | number

/**
 * Die eine Filterzeile über allem, was sie betrifft.
 *
 * Sie schaltet den ganzen Bildschirm um, nicht nur ein Diagramm: Zwei Kacheln,
 * die sich auf verschiedene Zeiträume beziehen, sind schlimmer als eine
 * Angabe zu wenig.
 */
export function ZeitraumWahl({
  years,
  value,
  onChange,
}: {
  years: number[]
  value: Zeitraum
  onChange: (value: Zeitraum) => void
}) {
  return (
    <div className="-mx-1 flex max-w-[60%] gap-1 overflow-x-auto px-1">
      {(['alle', ...years] as Zeitraum[]).map((option) => (
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

export const LEERER_TREND: Trend = { ratio: null, direction: 'gleich', delta: null }

/**
 * Eine Kennzahl mit ihrer Veränderung.
 *
 * `vergleich` nennt, womit verglichen wurde – „2025" oder „Jan–Jun 2025".
 * Ohne Vergleich steht der Hinweis darunter, warum es keinen gibt oder woher
 * die Zahl kommt.
 */
export function Kachel({
  label,
  wert,
  einheit,
  trend = LEERER_TREND,
  vergleich = null,
  hinweis,
}: {
  label: string
  wert: string
  einheit: string
  trend?: Trend
  vergleich?: string | null
  hinweis?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="text-xl font-bold text-slate-900 dark:text-slate-100">{wert}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">{einheit}</span>
      </p>
      {trend.ratio !== null && vergleich !== null ? (
        <p className="mt-1 text-xs">
          <TrendZeichen trend={trend} />
          <span className="text-slate-400 dark:text-slate-500"> vs. {vergleich}</span>
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
 * farbfehlsichtigen Auge nichts. Weniger ist hier immer das Bessere – bei
 * Verbrauch wie bei Kosten.
 */
export function TrendZeichen({ trend, hell }: { trend: Trend; hell?: boolean }) {
  if (trend.ratio === null) return null

  const pfeil = trend.direction === 'steigend' ? '▲' : trend.direction === 'sinkend' ? '▼' : '▬'
  const farbe = hell
    ? 'text-white'
    : trend.direction === 'gleich'
      ? 'text-slate-500 dark:text-slate-400'
      : trend.direction === 'sinkend'
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-amber-700 dark:text-amber-400'

  return (
    <span className={`font-semibold tabular-nums ${farbe}`}>
      <span aria-hidden="true">{pfeil} </span>
      {formatPercentChange(trend.ratio)}
    </span>
  )
}

export function Zeile({ label, value, stark }: { label: ReactNode; value: string; stark?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`text-slate-600 dark:text-slate-300 ${stark ? 'font-semibold' : ''}`}>{label}</dt>
      <dd
        className={`shrink-0 whitespace-nowrap tabular-nums text-slate-900 dark:text-slate-100 ${
          stark ? 'font-bold' : 'font-semibold'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Löschen trägt die Warnfarbe in der Schrift und nicht als Fläche – so hält es
 * die App überall, wo etwas verschwindet. Ein roter Block neben dem blauen
 * Knopf sähe aus wie die zweite Hauptsache.
 */
export function LoeschKnopf({
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

export function Abschnitt({
  titel,
  hinweis,
  aktion,
  children,
}: {
  titel: string
  hinweis?: string
  /** Ein kleiner Knopf rechts neben dem Titel – „Erfassen", „Bearbeiten". */
  aktion?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{titel}</h2>
        {aktion}
      </div>
      {hinweis ? (
        <p className="mb-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hinweis}</p>
      ) : (
        <div className="mb-3" />
      )}
      {children}
    </section>
  )
}

/** Der kleine Knopf im Kopf eines Abschnitts. */
export function AbschnittKnopf({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-my-1.5 -mr-2 min-h-9 shrink-0 rounded-lg px-2 text-sm font-semibold text-brand-700 active:bg-brand-50 dark:text-brand-300 dark:active:bg-slate-800"
    >
      {children}
    </button>
  )
}

export function Fehlerbalken({ text }: { text: string }) {
  return (
    <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
      {text}
    </p>
  )
}

/** Ein schmales Abzeichen neben einem Namen – „provisorisch", „SARON", „läuft". */
export function Abzeichen({
  children,
  ton = 'neutral',
}: {
  children: ReactNode
  ton?: 'neutral' | 'hinweis' | 'gut'
}) {
  const farben = {
    neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    hinweis: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
    gut: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200',
  }[ton]
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${farben}`}>
      {children}
    </span>
  )
}

/**
 * Ein Fortschritt als liegender Balken: gefüllt, was erledigt ist, die Spur in
 * einer hellen Stufe derselben Farbe. Die Zahl dazu steht immer daneben –
 * der Balken zeigt das Verhältnis, nicht den Wert.
 */
export function Fortschritt({
  anteil,
  label,
  farbe = 'var(--hypothek-fortschritt)',
}: {
  /** 0 bis 1. */
  anteil: number
  label: string
  farbe?: string
}) {
  const prozent = Math.max(0, Math.min(1, anteil)) * 100
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(prozent)}
      className="h-2.5 overflow-hidden rounded-full bg-[var(--hypothek-spur)]"
    >
      <div className="h-full rounded-full" style={{ width: `${prozent}%`, backgroundColor: farbe }} />
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * „Rückgängig" nach einem Griff, der sich nicht selbst zurücknehmen lässt –
 * eine gelöschte Notiz, ein versehentlich abgehakter Eintrag im Laden.
 *
 * Statt einer Rückfrage vorher: Die hält bei jedem Griff auf, auch bei den
 * neunundneunzig, die so gemeint waren, und wer sie zu oft gesehen hat,
 * bestätigt sie ungelesen. Der Hinweis danach stört nicht, und wer sich
 * vertippt hat, nimmt es mit einem Tipp zurück.
 *
 * Es gilt immer nur der letzte Griff: Ein neuer ersetzt den Hinweis, und nach
 * einigen Sekunden verschwindet er von selbst. Solange der Finger oder die
 * Maus auf ihm liegt, bleibt er stehen.
 */
export interface Angebot {
  text: string
  rueckgaengig: () => void
}

const DAUER_MS = 8000

export function useRueckgaengig() {
  const [angebot, setAngebot] = useState<(Angebot & { nr: number }) | null>(null)
  const nr = useRef(0)

  const anbieten = useCallback((text: string, rueckgaengig: () => void) => {
    nr.current += 1
    setAngebot({ text, rueckgaengig, nr: nr.current })
  }, [])
  const schliessen = useCallback(() => setAngebot(null), [])

  return { angebot, anbieten, schliessen }
}

export function RueckgaengigHinweis({
  angebot,
  onSchliessen,
  style,
  className = '',
}: {
  angebot: (Angebot & { nr: number }) | null
  onSchliessen: () => void
  /** Wo der Hinweis steht – über der Navigation, dem Eingabefeld, neben dem runden Knopf. */
  style?: CSSProperties
  className?: string
}) {
  const [gehalten, setGehalten] = useState(false)
  // Ein neuer Hinweis beginnt frisch – auch wenn der vorige unter dem Finger
  // verschwand und das Loslassen nie gemeldet wurde.
  const aktuelle = angebot?.nr
  useEffect(() => setGehalten(false), [aktuelle])

  useEffect(() => {
    if (!angebot || gehalten) return
    const timer = window.setTimeout(onSchliessen, DAUER_MS)
    return () => window.clearTimeout(timer)
  }, [angebot, gehalten, onSchliessen])

  if (!angebot) return null

  return (
    <div
      // Kein `data-navigationsleiste`: Er soll auch über einem Fenster nicht
      // verschwinden, das sich gleich danach öffnet – er liegt ohnehin darunter.
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-30 px-3 ${className}`}
      style={style}
    >
      <div
        key={angebot.nr}
        onPointerEnter={() => setGehalten(true)}
        onPointerLeave={() => setGehalten(false)}
        onFocus={() => setGehalten(true)}
        onBlur={() => setGehalten(false)}
        className="pointer-events-auto mx-auto flex w-full max-w-md items-center gap-2 rounded-2xl bg-slate-900 py-1.5 pl-4 pr-1.5 text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
      >
        <p className="min-w-0 flex-1 truncate text-sm">{angebot.text}</p>
        <button
          onClick={() => {
            angebot.rueckgaengig()
            onSchliessen()
          }}
          className="min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold text-sky-300 transition active:bg-white/10 dark:text-sky-700 dark:active:bg-black/10"
        >
          Rückgängig
        </button>
        <button
          onClick={onSchliessen}
          aria-label="Hinweis schliessen"
          className="grid size-10 shrink-0 place-items-center rounded-xl text-white/60 transition active:bg-white/10 dark:text-slate-500 dark:active:bg-black/10"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}

/** Über der Navigationsleiste des Haushalts – sie ist 3.5rem hoch, samt sicherem Bereich. */
export const UEBER_DER_NAVIGATION: CSSProperties = {
  bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))',
}

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Rückgängig und Wiederholen für ein Fenster, in dem geschrieben wird.
 *
 * Der Browser hat einen eigenen Verlauf, aber nur für das Feld, in dem der
 * Cursor gerade steht – und ausgerechnet im formatierten Text taugt er nicht:
 * Jeder eigene Handgriff (eine Farbe, ein Einfügen) baut das Feld neu auf, und
 * danach weiss der Browser nicht mehr, was er rückgängig machen soll. Ein
 * entfernter Eintrag einer Checkliste steht in gar keinem Feld mehr. Deshalb
 * merkt sich das Fenster selbst, wie es vorher aussah – als Ganzes: Titel,
 * Text und Einträge.
 *
 * Tippen wird zu Schritten gebündelt, sonst nähme jedes Rückgängig nur einen
 * Buchstaben zurück. Ein Schritt endet nach einer kurzen Pause, nach ein paar
 * Sekunden ununterbrochenen Tippens oder wenn man woanders weiterschreibt
 * (eine andere `gruppe`). Alles ohne Gruppe – Abhaken, Verschieben, eine
 * Farbe – ist ein Schritt für sich.
 */
export interface Verlauf<T> {
  value: T
  /** Eine Änderung. Gleiche `gruppe` kurz hintereinander wird ein Schritt. */
  set: (update: (vorher: T) => T, gruppe?: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

/** Wie lange eine Pause sein darf, bevor ein neuer Schritt beginnt. */
const PAUSE_MS = 1000
/** Wie lang ein Schritt höchstens dauert – ein langer Absatz wird mehrere. */
const SCHRITT_MS = 5000
/** Mehr Schritte zurück braucht niemand; der Speicher bleibt überschaubar. */
const MAX_SCHRITTE = 200

interface Stand<T> {
  vorher: T[]
  jetzt: T
  nachher: T[]
  /** Woran gerade getippt wird – `null` heisst: Der nächste Schritt beginnt neu. */
  gruppe: string | null
  seit: number
  zuletzt: number
}

export function useVerlauf<T>(
  anfang: () => T,
  /** Ob sich wirklich etwas geändert hat – sonst entstünden leere Schritte. */
  gleich: (a: T, b: T) => boolean,
): Verlauf<T> {
  const [stand, setStand] = useState<Stand<T>>(() => ({
    vorher: [],
    jetzt: anfang(),
    nachher: [],
    gruppe: null,
    seit: 0,
    zuletzt: 0,
  }))
  const gleichRef = useRef(gleich)
  gleichRef.current = gleich

  const set = useCallback((update: (vorher: T) => T, gruppe?: string) => {
    const zeit = Date.now()
    setStand((alt) => {
      const neu = update(alt.jetzt)
      if (gleichRef.current(neu, alt.jetzt)) return alt
      const weiter =
        gruppe !== undefined &&
        gruppe === alt.gruppe &&
        zeit - alt.zuletzt < PAUSE_MS &&
        zeit - alt.seit < SCHRITT_MS
      if (weiter) return { ...alt, jetzt: neu, nachher: [], zuletzt: zeit }
      return {
        vorher: [...alt.vorher, alt.jetzt].slice(-MAX_SCHRITTE),
        jetzt: neu,
        nachher: [],
        gruppe: gruppe ?? null,
        seit: zeit,
        zuletzt: zeit,
      }
    })
  }, [])

  const undo = useCallback(() => {
    setStand((alt) => {
      const zurueck = alt.vorher[alt.vorher.length - 1]
      if (alt.vorher.length === 0 || zurueck === undefined) return alt
      return {
        vorher: alt.vorher.slice(0, -1),
        jetzt: zurueck,
        nachher: [alt.jetzt, ...alt.nachher],
        gruppe: null,
        seit: 0,
        zuletzt: 0,
      }
    })
  }, [])

  const redo = useCallback(() => {
    setStand((alt) => {
      const vor = alt.nachher[0]
      if (alt.nachher.length === 0 || vor === undefined) return alt
      return {
        vorher: [...alt.vorher, alt.jetzt],
        jetzt: vor,
        nachher: alt.nachher.slice(1),
        gruppe: null,
        seit: 0,
        zuletzt: 0,
      }
    })
  }, [])

  return {
    value: stand.jetzt,
    set,
    undo,
    redo,
    canUndo: stand.vorher.length > 0,
    canRedo: stand.nachher.length > 0,
  }
}

/**
 * Die Tastenkürzel dazu, solange das Fenster offen ist: Ctrl+Z (⌘Z) nimmt
 * zurück, Ctrl+Shift+Z und Ctrl+Y stellen wieder her.
 *
 * Abgefangen wird vor dem Browser, auch in Titel und Einträgen: Zwei Verläufe
 * nebeneinander – einer je Feld und einer fürs Fenster – nähmen sonst bei
 * jedem Druck etwas anderes zurück. Dazu `historyUndo` aus dem Bearbeiten-Menü
 * des Systems oder dem Schütteln eines iPhones.
 */
export function useVerlaufTasten(undo: () => void, redo: () => void): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const zurueck = key === 'z' && !event.shiftKey
      const wieder = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)
      if (!zurueck && !wieder) return
      event.preventDefault()
      if (zurueck) undo()
      else redo()
    }
    function onBeforeInput(event: InputEvent) {
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return
      event.preventDefault()
      if (event.inputType === 'historyUndo') undo()
      else redo()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('beforeinput', onBeforeInput, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('beforeinput', onBeforeInput, true)
    }
  }, [undo, redo])
}

/**
 * Wo der Cursor nach einem Rückgängig hingehört: ans Ende dessen, was sich
 * geändert hat.
 *
 * Gesucht wird der gemeinsame Anfang und das gemeinsame Ende von vorher und
 * nachher; dazwischen liegt die Änderung. Wer ein Wort zu viel gelöscht hat
 * und es zurückholt, steht danach hinter dem Wort – nicht am Anfang der Notiz.
 */
export function stelleDerAenderung(vorher: string, nachher: string): number {
  const kuerzer = Math.min(vorher.length, nachher.length)
  let anfang = 0
  while (anfang < kuerzer && vorher[anfang] === nachher[anfang]) anfang++
  let ende = 0
  while (
    ende < kuerzer - anfang &&
    vorher[vorher.length - 1 - ende] === nachher[nachher.length - 1 - ende]
  ) {
    ende++
  }
  return nachher.length - ende
}

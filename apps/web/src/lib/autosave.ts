import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveState = 'ruht' | 'speichert' | 'gespeichert' | 'fehler'

export interface Autosave {
  state: SaveState
  /** Sofort speichern, ohne die Pause abzuwarten. */
  flush: () => void
  /** Nichts mehr speichern – etwa, weil der Datensatz gerade gelöscht wurde. */
  stop: () => void
}

/**
 * Speichert von selbst: kurz nach der letzten Änderung und noch einmal beim
 * Schliessen.
 *
 * Ein Speichern-Knopf ist die einzige Stelle, an der sich Geschriebenes
 * verlieren lässt – und auf dem Handy die wahrscheinlichste, weil ein Anruf
 * oder ein Wisch die Ansicht wegnimmt, bevor man ihn trifft.
 *
 * Zwei Dinge, die dabei zählen:
 *
 *  - Läuft schon ein Speichern, wird nicht parallel ein zweites gestartet,
 *    sondern gleich danach nachgezogen. Sonst könnte der ältere Stand als
 *    letzter ankommen – oder beim ersten Mal ein zweiter Datensatz entstehen.
 *  - Gespeichert wird nur, was vom Stand beim Öffnen abweicht. Ohne diese
 *    Bremse schriebe schon das Öffnen jeden Datensatz unverändert zurück –
 *    und das Bearbeitungsdatum wäre eine Angabe darüber, was man angeschaut
 *    hat, nicht darüber, was man geändert hat.
 */
export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<void>,
  options: {
    /** Ob sich der aktuelle Stand überhaupt speichern lässt. */
    savable?: (value: T) => boolean
    delayMs?: number
  } = {},
): Autosave {
  const { delayMs = 900 } = options

  // Alles über Refs: Nichts davon darf ein Neuzeichnen auslösen, und alles
  // muss auch nach dem Ausblenden noch stimmen – beim Speichern zum Schluss
  // rendert die Komponente nicht mehr.
  const latest = useRef(value)
  latest.current = value
  const saveRef = useRef(save)
  saveRef.current = save
  const savableRef = useRef(options.savable)
  savableRef.current = options.savable

  const dirty = useRef(false)
  const running = useRef(false)
  const stopped = useRef(false)
  const [state, setState] = useState<SaveState>('ruht')

  const run = useCallback(async () => {
    if (stopped.current || !dirty.current || running.current) return
    if (savableRef.current && !savableRef.current(latest.current)) return

    running.current = true
    dirty.current = false
    setState('speichert')

    try {
      await saveRef.current(latest.current)
      setState('gespeichert')
    } catch {
      dirty.current = true
      setState('fehler')
    } finally {
      running.current = false
      if (dirty.current) void run()
    }
  }, [])

  // Der Vergleich läuft über den Inhalt, nicht über die Identität: Ein Objekt
  // ist bei jedem Rendern ein neues, der Text darin aber meist derselbe.
  const signature = JSON.stringify(value)
  const geoeffnet = useRef(signature)

  useEffect(() => {
    // Verglichen wird gegen den Stand beim Öffnen, nicht gegen „schon einmal
    // hier gewesen": Wer eine Änderung wieder rückgängig macht, hat nichts
    // geändert und soll auch nichts speichern – sonst stünde an der Notiz ein
    // Bearbeitungsdatum für etwas, das gar nicht geschehen ist.
    if (signature === geoeffnet.current) return

    dirty.current = true
    const timer = setTimeout(() => void run(), delayMs)
    return () => clearTimeout(timer)
  }, [signature, delayMs, run])

  // Beim Schliessen – auch über die Zurück-Geste – das Angefangene sichern.
  useEffect(() => () => void run(), [run])

  return {
    state,
    flush: () => void run(),
    stop: () => {
      stopped.current = true
      dirty.current = false
    },
  }
}

/** Der Satz, der im Fenster steht, solange gespeichert wird. */
export function saveStateLabel(state: SaveState, hint?: string): string {
  if (hint) return hint
  if (state === 'speichert') return 'Speichert …'
  if (state === 'fehler') return 'Nicht gespeichert'
  if (state === 'gespeichert') return 'Gespeichert'
  return ''
}

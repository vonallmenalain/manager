import { useCallback, useState } from 'react'

/**
 * Eine Einstellung, die am Gerät hängt und nicht am Konto.
 *
 * Wie eine Liste angezeigt wird, ist keine Angabe über den Haushalt, sondern
 * über den Bildschirm, auf den man gerade schaut: Am Handy will man anderes
 * sehen als am grossen Monitor. Deshalb `localStorage` und keine Tabelle –
 * eine Einstellung, die mitreist, wäre auf dem zweiten Gerät die falsche.
 *
 * Unbekannte Werte fallen auf den Standard zurück. So überlebt die Anzeige
 * eine Umbenennung, statt auf einem Wert stehen zu bleiben, den es nicht
 * mehr gibt.
 */
/**
 * Eine geordnete Liste mit Häkchen – gedacht für „was wird angezeigt und in
 * welcher Reihenfolge".
 *
 * Gespeichert wird die ganze Reihenfolge, auch das Abgewählte: Wer eine Kachel
 * wieder einschaltet, findet sie dort, wo er sie zuletzt hatte, und nicht am
 * Ende. Kommt später eine neue Kachel dazu, hängt sie sich mit ihrem Standard
 * hinten an, statt die gespeicherte Wahl ungültig zu machen.
 */
export function useLocalOrder<T extends string>(
  key: string,
  standard: readonly { id: T; sichtbar: boolean }[],
): [{ id: T; sichtbar: boolean }[], (value: { id: T; sichtbar: boolean }[]) => void] {
  const [value, setValue] = useState(() => mergeOrder(readOrder(key), standard))

  const store = useCallback(
    (next: { id: T; sichtbar: boolean }[]) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Dann gilt die Wahl eben nur für diese Sitzung.
      }
    },
    [key],
  )

  return [value, store]
}

function readOrder(key: string): { id: string; sichtbar: boolean }[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is { id: string; sichtbar: boolean } =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === 'string' &&
        typeof (entry as { sichtbar?: unknown }).sichtbar === 'boolean',
    )
  } catch {
    // Unlesbares wird behandelt wie nichts Gespeichertes.
    return []
  }
}

/** Gespeichertes zuerst, Unbekanntes weg, Fehlendes hinten dran. */
function mergeOrder<T extends string>(
  stored: { id: string; sichtbar: boolean }[],
  standard: readonly { id: T; sichtbar: boolean }[],
): { id: T; sichtbar: boolean }[] {
  const erlaubt = new Set(standard.map((entry) => entry.id))
  const uebernommen = stored.filter((entry): entry is { id: T; sichtbar: boolean } =>
    erlaubt.has(entry.id as T),
  )
  const bekannt = new Set(uebernommen.map((entry) => entry.id))

  return [...uebernommen, ...standard.filter((entry) => !bekannt.has(entry.id))]
}

export function useLocalSetting<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    // Im privaten Modus mancher Browser wirft schon das Lesen. Eine
    // Anzeigeeinstellung ist es nicht wert, daran zu scheitern.
    try {
      const stored = window.localStorage.getItem(key)
      return allowed.includes(stored as T) ? (stored as T) : fallback
    } catch {
      return fallback
    }
  })

  const store = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, next)
      } catch {
        // Dann gilt die Wahl eben nur für diese Sitzung.
      }
    },
    [key],
  )

  return [value, store]
}

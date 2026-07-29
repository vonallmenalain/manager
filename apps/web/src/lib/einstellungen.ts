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

import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * Meldet den Service Worker an und sagt Bescheid, wenn eine neue Fassung
 * bereitliegt.
 *
 * Das Problem, das dahintersteckt: Eine installierte PWA lädt ihr Programm aus
 * dem Zwischenspeicher des Service Workers. Kommt ein Deploy, merkt die offene
 * App davon nichts – sie läuft mit dem Programm weiter, das beim Start geladen
 * wurde. Selbst ein Neuladen im Browser half nicht zuverlässig, weil auch die
 * Seite selbst aus dem Zwischenspeicher kam. Auf dem Handy blieb nur: App
 * vollständig schliessen und neu öffnen.
 *
 * Deshalb hier zwei Dinge:
 *
 *  1. **Aktiv nachfragen.** Von sich aus prüft der Browser nur bei einer
 *     Navigation, ob es einen neuen Worker gibt. Eine App, die tagelang offen
 *     bleibt, erführe es nie. Also wird regelmässig gefragt – und immer dann,
 *     wenn die App wieder in den Vordergrund kommt.
 *  2. **Fragen statt tauschen.** Der neue Worker wartet, bis der Mensch davor
 *     zustimmt. Ein Austausch mitten im Ausfüllen eines Formulars wäre die
 *     schlechtere Überraschung.
 *
 * Der Zustand liegt bewusst neben React und nicht darin: Angemeldet wird genau
 * einmal je Sitzung, egal wie viele Komponenten zuschauen – und React führt
 * Effekte in der Entwicklung absichtlich doppelt aus.
 */

/** Wie oft nachgefragt wird, solange die App offen bleibt. */
const NACHFRAGE_INTERVALL_MS = 30 * 60 * 1000

let bereit = false
let laeuft = false
let aktualisieren: ((neuLaden?: boolean) => Promise<void>) | null = null
let gestartet = false

const zuhoerer = new Set<() => void>()

/**
 * Meldet den Worker an. Mehrfache Aufrufe sind harmlos – der zweite tut nichts.
 */
export function startAppUpdate(): void {
  if (gestartet || typeof window === 'undefined') return
  gestartet = true

  aktualisieren = registerSW({
    immediate: true,

    onNeedRefresh() {
      bereit = true
      melden()
    },

    onRegisteredSW(_url, registration) {
      if (!registration) return

      // Beim Anmelden liegt manchmal schon ein wartender Worker vor – etwa,
      // wenn die App im Hintergrund lag, während der Browser ihn geholt hat.
      if (registration.waiting) {
        bereit = true
        melden()
      }

      const nachfragen = (): void => {
        // Ohne Verbindung wirft update(); das ist keine Meldung wert.
        void registration.update().catch(() => undefined)
      }

      window.setInterval(nachfragen, NACHFRAGE_INTERVALL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') nachfragen()
      })
    },
  })
}

/** Zustand des Hinweises am unteren Rand. */
export interface UpdateZustand {
  /** Ob eine neue Fassung bereitliegt. */
  bereit: boolean
  /** Ob gerade gewechselt wird – der Knopf zeigt dann, dass etwas passiert. */
  laeuft: boolean
}

let zustand: UpdateZustand = { bereit: false, laeuft: false }

function melden(): void {
  // Ein neues Objekt je Änderung: useSyncExternalStore vergleicht mit === und
  // zeichnete sonst nie neu.
  zustand = { bereit, laeuft }
  for (const zuhoerer_ of zuhoerer) zuhoerer_()
}

export function useUpdateZustand(): UpdateZustand {
  return useSyncExternalStore(
    (onStoreChange) => {
      zuhoerer.add(onStoreChange)
      return () => zuhoerer.delete(onStoreChange)
    },
    () => zustand,
    () => LEER,
  )
}

const LEER: UpdateZustand = { bereit: false, laeuft: false }

/**
 * Übernimmt die neue Fassung.
 *
 * Das Neuladen macht diese Stelle selbst, statt es `registerSW` zu überlassen:
 * Dessen eingebaute Fassung hängt an einem Merkmal von workbox, das nur gesetzt
 * ist, wenn die Seite beim Anmelden schon von einem Worker bedient wurde. Beim
 * allerersten Besuch trifft das nicht zu – der Knopf hätte dort nichts getan.
 * `controllerchange` dagegen sagt genau das, worauf es ankommt: Der neue Worker
 * hat übernommen.
 */
export async function appAktualisieren(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  laeuft = true
  melden()

  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => window.location.reload(),
    { once: true },
  )

  const registration = await navigator.serviceWorker.getRegistration()
  if (registration?.waiting) {
    await aktualisieren?.(true)
    return
  }

  // Wartet keiner mehr, hat der Tausch schon stattgefunden – dann genügt es,
  // die Seite neu zu laden.
  window.location.reload()
}

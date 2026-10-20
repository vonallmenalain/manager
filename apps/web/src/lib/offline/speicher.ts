/**
 * Ein kleiner Schlüssel-Wert-Speicher auf dem Gerät – in IndexedDB.
 *
 * Für das, was die App ohne Verbindung braucht: den letzten Stand der Daten
 * und die Änderungen, die noch zum Server müssen. `localStorage` wäre
 * einfacher, fasst aber nur ein paar Megabyte, blockiert beim Schreiben die
 * Oberfläche und verliert alles, was nicht in eine Zeichenkette passt.
 *
 * Jede App hat ihre eigene Datenbank: Manager und DocBase liegen auf derselben
 * Adresse, und die eine soll der anderen nichts wegräumen.
 *
 * Geht etwas schief – ein privates Fenster ohne IndexedDB, ein voller
 * Speicher –, arbeitet die App einfach ohne: Lesen ergibt nichts, Schreiben
 * tut nichts. Dass sie dann offline weniger kann, ist besser, als dass sie
 * online gar nicht mehr startet.
 */

const STORE = 'werte'

let datenbank: Promise<IDBDatabase | null> | null = null
let name = 'manager-offline'

/** Wie die Datenbank dieser App heisst. */
export function speicherName(): string {
  return name
}

/** Welche App hier speichert – vor dem ersten Zugriff aufzurufen. */
export function speicherFuer(app: 'manager' | 'docbase'): void {
  name = `${app}-offline`
  datenbank = null
}

function oeffnen(): Promise<IDBDatabase | null> {
  if (datenbank) return datenbank
  datenbank = new Promise((resolve) => {
    try {
      const anfrage = indexedDB.open(name, 1)
      anfrage.onupgradeneeded = () => anfrage.result.createObjectStore(STORE)
      anfrage.onsuccess = () => {
        const db = anfrage.result
        // Will die andere App diese Datenbank löschen (beim Abmelden), gibt
        // diese sie frei, statt das Löschen zu blockieren.
        db.onversionchange = () => {
          db.close()
          datenbank = null
        }
        resolve(db)
      }
      anfrage.onerror = () => resolve(null)
      anfrage.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return datenbank
}

function vorgang<T>(
  modus: IDBTransactionMode,
  ausfuehren: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return oeffnen().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined)
        try {
          const anfrage = ausfuehren(db.transaction(STORE, modus).objectStore(STORE))
          anfrage.onsuccess = () => resolve(anfrage.result)
          anfrage.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

export function lesen<T>(schluessel: string): Promise<T | undefined> {
  return vorgang<T>('readonly', (store) => store.get(schluessel) as IDBRequest<T>)
}

export async function schreiben(schluessel: string, wert: unknown): Promise<void> {
  await vorgang('readwrite', (store) => store.put(wert, schluessel))
}

/** Alles weg – beim Abmelden: Danach soll auf dem Gerät nichts mehr stehen. */
export async function allesLoeschen(): Promise<void> {
  await vorgang('readwrite', (store) => store.clear())
}

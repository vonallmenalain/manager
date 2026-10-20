import type { PublicUser } from '@manager/shared'
import type { QueryClient } from '@tanstack/react-query'

import { auftragSenden } from './senden'
import { speicherFuer } from './speicher'
import { verbindungEinrichten } from './verbindung'
import { abarbeiten, warteschlangeLaden } from './warteschlange'
import { abfragenAufbewahren, abfragenWiederherstellen } from './zwischenspeicher'
import { api } from '../api'
import { wartendeAnwenden } from '../household'

/** Länger wartet der Start nicht auf den Speicher des Geräts. */
const HOECHSTENS_WARTEN_MS = 1500

/**
 * Bereitet die App darauf vor, auch ohne Verbindung zu arbeiten – vor dem
 * ersten Zeichnen.
 *
 * Holt den letzten Stand und die wartenden Änderungen vom Gerät, damit schon
 * das erste Bild die Einkaufsliste zeigt und nicht einen leeren Rahmen. Hängt
 * der Speicher des Geräts, startet die App nach kurzer Zeit trotzdem: Ohne
 * aufbewahrten Stand ist sie offline weniger nützlich, aber nie ganz weg.
 */
export async function offlineStarten(
  app: 'manager' | 'docbase',
  queryClient: QueryClient,
): Promise<void> {
  speicherFuer(app)

  const laden = (async () => {
    await abfragenWiederherstellen(queryClient)
    await warteschlangeLaden({
      senden: auftragSenden,
      benutzer: () => queryClient.getQueryData<PublicUser | null>(['session'])?.id ?? '',
      nachDemLeeren: () => {
        void queryClient.invalidateQueries({ queryKey: ['shopping'] })
        void queryClient.invalidateQueries({ queryKey: ['notes'] })
      },
    })
    wartendeAnwenden(queryClient)
  })()
  await Promise.race([
    laden.catch(() => undefined),
    new Promise((resolve) => window.setTimeout(resolve, HOECHSTENS_WARTEN_MS)),
  ])

  abfragenAufbewahren(queryClient)
  verbindungEinrichten({
    pruefen: api.health,
    // Der Server ist zurück: alles Angezeigte frisch holen und abschicken,
    // was liegen blieb.
    beiRueckkehr: () => {
      void queryClient.invalidateQueries()
      void abarbeiten()
    },
  })
}

/// <reference lib="webworker" />
import { ExpirationPlugin } from 'workbox-expiration'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

/**
 * Bilder und Dateien, die man schon einmal gesehen hat, auch ohne Verbindung.
 *
 * Die Listen selbst bewahrt die App auf (siehe `zwischenspeicher.ts`); was in
 * ihnen als Bild steht – das Vorschaubild einer Rechnung, das Foto in einer
 * Notiz, die gerasterten Seiten eines PDFs –, holt sie als eigene Anfrage.
 * Die fängt dieser Teil des Service Workers ab: Mit Verbindung geht sie
 * zum Server, und die Antwort wird aufbewahrt; ohne kommt sie von hier.
 *
 * Zwei Fächer mit eigener Grenze: Vorschauen sind klein und zahlreich, die
 * Dateien selbst können ein paar Megabyte gross sein. Was zu lange nicht mehr
 * angeschaut wurde, fällt als Erstes heraus, und wird der Speicher knapp,
 * räumt der Browser die Fächer, bevor er etwas anderes verweigert.
 */

const VORSCHAU =
  /\/api\/(documents\/[^/]+\/(vorschaubild|preview\/\d+)|notes\/files\/[^/]+\/(vorschaubild|vorschau\/\d+))$/
const DATEI = /\/api\/(documents\/[^/]+\/file|notes\/files\/[^/]+\/datei)$/

export function dateienZwischenspeichern(app: 'manager' | 'docbase'): void {
  registerRoute(
    ({ url, request }) => request.method === 'GET' && VORSCHAU.test(url.pathname),
    new NetworkFirst({
      cacheName: `${app}-vorschauen`,
      // Im Funkloch nicht ewig warten: Nach ein paar Sekunden lieber das
      // aufbewahrte Bild als ein leeres Feld.
      networkTimeoutSeconds: 4,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 800,
          maxAgeSeconds: 90 * 24 * 60 * 60,
          purgeOnQuotaError: true,
        }),
      ],
    }),
  )

  registerRoute(
    // Nicht das Herunterladen (`?download=1`): Das will man als Datei, und
    // sie liegt danach ohnehin auf dem Gerät.
    ({ url, request }) =>
      request.method === 'GET' && DATEI.test(url.pathname) && !url.searchParams.has('download'),
    new NetworkFirst({
      cacheName: `${app}-dateien`,
      networkTimeoutSeconds: 8,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 80,
          maxAgeSeconds: 90 * 24 * 60 * 60,
          purgeOnQuotaError: true,
        }),
      ],
    }),
  )
}

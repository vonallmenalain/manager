/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import {
  SHARE_CACHE,
  SHARE_FILE_PREFIX,
  SHARE_FILENAME_HEADER,
  SHARE_LANDING_PATH,
  SHARE_TARGET_PATH,
  SHARE_TEXT_KEY,
} from './lib/shareConstants'

declare const self: ServiceWorkerGlobalScope

/**
 * Eigener Service Worker statt der automatisch erzeugten Fassung.
 *
 * Grund ist das Teilen-Menü von Android: Beim Teilen schickt das System einen
 * POST an die App. Ein solcher Request landet nicht auf dem Server, sondern
 * muss hier abgefangen werden – nur der Service Worker sieht ihn. Das ist mit
 * einem erzeugten Worker nicht möglich.
 */

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

/**
 * Jede Seitennavigation wird aus der zwischengespeicherten App-Hülle
 * bedient. Ohne diese Regel zeigt ein Aufruf ohne Verbindung die
 * Dinosaurier-Seite des Browsers, obwohl die App längst installiert ist.
 *
 * Ausgenommen sind API-Aufrufe – die müssen immer echt zum Server – und der
 * Teilen-Endpunkt, der weiter unten eigens behandelt wird.
 *
 * Die DocBase braucht hier keine Ausnahme mehr: Dieser Worker hat den
 * Geltungsbereich `/app/` und bekommt Navigationen nach `/docbase/` gar nicht
 * erst zu sehen.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, new RegExp(`^${SHARE_TARGET_PATH}`)],
  }),
)

self.addEventListener('install', () => {
  // Sofort übernehmen: Nach einem Update soll nicht bis zum nächsten
  // vollständigen Schliessen der App die alte Fassung weiterlaufen.
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)

  if (event.request.method === 'POST' && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShare(event.request))
  }
})

/**
 * Nimmt alles entgegen, was Android beim Teilen mitschickt.
 *
 * Nicht nur Dateien: Wer einen Verweis teilt, schickt gar keine – dann stehen
 * Titel, Text und Adresse in den Formularfeldern, die im Manifest unter
 * `share_target.params` angemeldet sind. Beides wandert in denselben
 * Zwischenspeicher, unterschieden nur am Schlüssel.
 *
 * Wohin es dann geht, entscheidet die Auswahlseite – hier wird nichts
 * einsortiert. Der Worker weiss nichts von Notizen und Dokumenten und soll es
 * auch nicht wissen müssen.
 */
async function handleShare(request: Request): Promise<Response> {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File)
    const text = {
      title: feld(formData, 'title'),
      text: feld(formData, 'text'),
      url: feld(formData, 'url'),
    }

    // Ein neues Teilen ersetzt das vorige vollständig. Ohne das Leeren bliebe
    // liegen, was jemand auf der Auswahlseite hat stehen lassen, und käme beim
    // nächsten Teilen als Zugabe wieder mit.
    await caches.delete(SHARE_CACHE)
    const cache = await caches.open(SHARE_CACHE)

    // Die Dateien liegen nur im Arbeitsspeicher dieses Requests. Wir legen sie
    // in der Cache Storage ab, weil die Seite gleich neu geladen wird und
    // sonst nichts mehr von ihnen übrig wäre.
    //
    // Nacheinander statt mit Promise.all: Die Reihenfolge im Zwischenspeicher
    // ist die Reihenfolge der Ablage, und mehrere Seiten sollen so ankommen,
    // wie sie geteilt wurden.
    for (const [index, file] of files.entries()) {
      await cache.put(
        new Request(`${SHARE_FILE_PREFIX}${index}`),
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/octet-stream',
            // Der Dateiname überlebt die Cache-Ablage nicht von selbst.
            [SHARE_FILENAME_HEADER]: encodeURIComponent(file.name || 'Geteiltes Dokument'),
          },
        }),
      )
    }

    if (text.title || text.text || text.url) {
      await cache.put(
        new Request(SHARE_TEXT_KEY),
        new Response(JSON.stringify(text), { headers: { 'content-type': 'application/json' } }),
      )
    }

    // 303 statt 302: Der Browser soll die Zieladresse mit GET laden, nicht
    // den POST wiederholen.
    return Response.redirect(SHARE_LANDING_PATH, 303)
  } catch {
    return Response.redirect(`${SHARE_LANDING_PATH}?fehler=1`, 303)
  }
}

/** Ein Textfeld aus dem Formular – Dateien und Fehlendes ergeben nichts. */
function feld(formData: FormData, name: string): string {
  const wert = formData.get(name)
  return typeof wert === 'string' ? wert.trim() : ''
}

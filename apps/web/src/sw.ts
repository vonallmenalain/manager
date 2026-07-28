/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import { SHARE_CACHE, SHARE_FILENAME_HEADER, SHARE_TARGET_PATH } from './lib/shareConstants'

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
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/share-target/],
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

async function handleShare(request: Request): Promise<Response> {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File)

    const cache = await caches.open(SHARE_CACHE)

    // Die Dateien liegen nur im Arbeitsspeicher dieses Requests. Wir legen sie
    // in der Cache Storage ab, weil die Seite gleich neu geladen wird und
    // sonst nichts mehr von ihnen übrig wäre.
    await Promise.all(
      files.map((file, index) => {
        const key = `/__geteilt/${Date.now()}-${index}`
        return cache.put(
          new Request(key),
          new Response(file, {
            headers: {
              'content-type': file.type || 'application/octet-stream',
              // Der Dateiname überlebt die Cache-Ablage nicht von selbst.
              [SHARE_FILENAME_HEADER]: encodeURIComponent(file.name || 'Geteiltes Dokument'),
            },
          }),
        )
      }),
    )

    // 303 statt 302: Der Browser soll die Zieladresse mit GET laden, nicht
    // den POST wiederholen.
    return Response.redirect(`/dokumente?geteilt=${files.length}`, 303)
  } catch {
    return Response.redirect('/dokumente?geteilt=fehler', 303)
  }
}

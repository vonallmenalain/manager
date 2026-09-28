/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import { SHARE_CACHE, SHARE_LANDING_PATH, SHARE_TARGET_PATH } from './lib/shareConstants'
import { receiveShare } from './lib/shareReceiver'

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

/**
 * Übernommen wird erst auf Zuruf.
 *
 * Vorher stand hier ein `skipWaiting()` beim Einbau. Das tauschte den Worker
 * im Hintergrund aus, während die offene Seite unbeirrt mit dem alten Programm
 * weiterlief – und niemand erfuhr davon. Jetzt wartet der neue Worker, die App
 * zeigt einen Hinweis, und erst ein Tipp auf „Aktualisieren" schickt diese
 * Nachricht und lädt die Seite neu.
 */
self.addEventListener('message', (event) => {
  const nachricht = event.data as { type?: string } | null
  if (nachricht?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)

  // Was Android beim Teilen schickt, legt `receiveShare` im Zwischenspeicher
  // des Managers ab und leitet auf die Auswahlseite weiter.
  if (event.request.method === 'POST' && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(receiveShare(event.request, SHARE_CACHE, SHARE_LANDING_PATH))
  }
})

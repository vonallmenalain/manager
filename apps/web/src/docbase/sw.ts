/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import {
  DOCBASE_SHARE_CACHE,
  DOCBASE_SHARE_LANDING_PATH,
  DOCBASE_SHARE_TARGET_PATH,
} from '../lib/shareConstants'
import { receiveShare } from '../lib/shareReceiver'

declare const self: ServiceWorkerGlobalScope

/**
 * Der Service Worker der DocBase.
 *
 * Eigener Worker mit eigenem Geltungsbereich (`/docbase/`), damit sich die
 * beiden Apps unabhängig voneinander installieren lassen und jede ihre eigene
 * Hülle im Zwischenspeicher hält. Der Browser wählt für eine Adresse immer den
 * Worker mit dem längsten passenden Bereich – unter `/docbase/` also diesen,
 * überall sonst den des Managers.
 *
 * Seit die Sammlung auch Geteiltes aufnimmt, hat er ein eigenes Teilen-Ziel:
 * Wer im Teilen-Menü von Android „DocBase" wählt, landet in der DocBase und
 * entscheidet dort zwischen Sammlung und Notiz – nicht im Haushalt. Abgelegt
 * wird in einem eigenen Zwischenspeicher, damit sich die beiden Apps nicht
 * gegenseitig ihr Geteiltes wegräumen.
 */

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

/**
 * Jede Seitennavigation innerhalb der DocBase wird aus der zwischen-
 * gespeicherten Hülle bedient – sonst zeigt ein Aufruf ohne Verbindung die
 * Dinosaurier-Seite, obwohl die App installiert ist.
 *
 * API-Aufrufe sind ausgenommen: Die müssen immer echt zum Server. Ebenso das
 * Teilen-Ziel, das weiter unten eigens behandelt wird.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, new RegExp(`^${DOCBASE_SHARE_TARGET_PATH}`)],
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

  if (event.request.method === 'POST' && url.pathname === DOCBASE_SHARE_TARGET_PATH) {
    event.respondWith(
      receiveShare(event.request, DOCBASE_SHARE_CACHE, DOCBASE_SHARE_LANDING_PATH),
    )
  }
})

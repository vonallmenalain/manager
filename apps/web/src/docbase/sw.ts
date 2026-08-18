/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

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
 * Deutlich schlichter als sein Gegenstück: Kein Teilen-Ziel. Das gehört zum
 * Haushalt, wo täglich Post ankommt; in eine Sammlung legt man bewusst ab.
 */

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

/**
 * Jede Seitennavigation innerhalb der DocBase wird aus der zwischen-
 * gespeicherten Hülle bedient – sonst zeigt ein Aufruf ohne Verbindung die
 * Dinosaurier-Seite, obwohl die App installiert ist.
 *
 * API-Aufrufe sind ausgenommen: Die müssen immer echt zum Server.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
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

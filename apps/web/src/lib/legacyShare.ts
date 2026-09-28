/**
 * Meldet den Worker an der Wurzel an – damit das Teilen aus einer alten
 * Installation ankommt.
 *
 * Ein Manager, der noch vor dem Umzug nach `/app/` installiert wurde, schickt
 * beim Teilen an `/share-target`; so steht es in seinem Paket, und daran lässt
 * sich vom Server aus nichts ändern. Angenommen wird der Aufruf nur von einem
 * Service Worker mit dem Geltungsbereich `/` (legacy-root/sw.js). Den gab es
 * auf vielen Geräten nicht mehr: Er hatte sich nach dem Umzug selbst
 * abgemeldet.
 *
 * Deshalb meldet ihn der Manager bei jedem Start an. Kennt der Browser ihn
 * schon, ist das eine blosse Nachfrage nach einer neuen Fassung. Der Worker
 * beantwortet keine Navigation und liegt neben den Bereichen der beiden Apps,
 * nicht über ihnen: Unter `/app/` und `/docbase/` hat jeweils deren eigener
 * Worker den längeren, passenderen Bereich.
 *
 * Nur in der gebauten App – im Entwicklungsserver liegt unter `/sw.js`
 * nichts.
 */
export function wurzelWorkerAnmelden(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  // Ohne Verbindung oder im privaten Fenster schlägt das fehl – dann eben
  // beim nächsten Start. Die App selbst braucht diesen Worker nicht.
  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
}

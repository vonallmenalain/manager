/**
 * Abmelde-Worker für die alte Adresse `/`.
 *
 * Bis zum Umzug lag der Manager auf `/` und hatte dort einen Service Worker
 * mit dem Geltungsbereich `/`. Der ist auf jedem Gerät noch vorhanden, auf dem
 * die App einmal geöffnet wurde, und er beantwortet weiterhin jede Navigation
 * unterhalb von `/` aus seinem Zwischenspeicher – auch die zur neuen Adresse
 * `/app/`. Ohne Gegenmassnahme sähe man dort auf Dauer die alte Fassung.
 *
 * Ein Service Worker lässt sich nicht vom Server aus löschen. Er verschwindet
 * nur, wenn der Browser unter derselben Adresse eine andere Datei vorfindet –
 * also genau diese hier. Eine Weiterleitung auf den neuen Worker ginge nicht:
 * Auf eine Umleitung antwortet der Browser mit einem Fehler und behält den
 * alten Worker.
 *
 * Diese Datei wird nicht gebündelt, sondern unverändert nach `dist/sw.js`
 * kopiert (siehe `vite.config.ts`). Sie darf irgendwann verschwinden – wenn
 * absehbar kein Gerät mehr die alte Fassung kennt.
 */

self.addEventListener('install', () => {
  // Nicht auf das Schliessen aller Seiten warten: Solange der alte Worker
  // aktiv bleibt, liefert er weiter die alte App aus.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(aufraeumen())
})

async function aufraeumen() {
  /**
   * Nur die Zwischenspeicher des alten Wurzel-Workers.
   *
   * Workbox hängt den Geltungsbereich an den Namen. Der alte endet deshalb
   * genau auf der Wurzeladresse, die der DocBase auf `/docbase/` und die des
   * neuen Managers auf `/app/`. Ohne diese Einschränkung räumte der Worker
   * beim Aufräumen die Ablagen der anderen App gleich mit weg.
   */
  const wurzel = `${self.location.origin}/`
  const namen = await caches.keys()
  await Promise.all(
    namen.filter((name) => name.endsWith(wurzel)).map((name) => caches.delete(name)),
  )

  await self.registration.unregister()

  // Die offenen Seiten hängen noch an diesem Worker. Ohne erneutes Laden
  // bliebe die alte Hülle bis zum nächsten vollständigen Start stehen.
  const seiten = await self.clients.matchAll({ type: 'window' })
  for (const seite of seiten) {
    seite.navigate(seite.url).catch(() => {
      // Eine Seite, die gerade selbst navigiert, lässt sich nicht umlenken –
      // sie lädt ohnehin gleich neu.
    })
  }
}

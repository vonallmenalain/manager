/**
 * Der Worker an der alten Adresse `/`.
 *
 * Zwei Aufgaben, beide aus der Zeit vor dem Umzug nach `/app/`:
 *
 * 1. Den alten Wurzel-Worker ablösen. Bis zum Umzug lag der Manager auf `/`
 *    und hatte dort einen Service Worker mit dem Geltungsbereich `/`. Der ist
 *    auf jedem Gerät noch vorhanden, auf dem die App einmal geöffnet wurde, und
 *    er beantwortete weiterhin jede Navigation unterhalb von `/` aus seinem
 *    Zwischenspeicher – auch die zur neuen Adresse `/app/`. Ein Service Worker
 *    lässt sich nicht vom Server aus löschen. Er verschwindet nur, wenn der
 *    Browser unter derselben Adresse eine andere Datei vorfindet – also genau
 *    diese hier. Eine Weiterleitung auf den neuen Worker ginge nicht: Auf eine
 *    Umleitung antwortet der Browser mit einem Fehler und behält den alten.
 *
 *    Diese Datei räumt die alten Zwischenspeicher weg und beantwortet selbst
 *    keine einzige Navigation: Alles geht ans Netz und von dort per
 *    Weiterleitung nach `/app/`.
 *
 * 2. Das Teilen alter Installationen retten. Android schreibt das Teilen-Ziel
 *    einer App bei der Installation fest in ihr Paket. Ein Manager, der noch
 *    auf `/` installiert wurde, schickt deshalb weiterhin an `/share-target`.
 *    Ohne Worker an dieser Stelle landete der POST bei Netlify, wurde nach
 *    `/app/share-target` umgeleitet und kam dort als gewöhnlicher Aufruf ohne
 *    Dateien an – die App zeigte ihre Startseite, das Geteilte war weg. Jetzt
 *    wird es hier abgelegt, genau wie im Worker des Managers
 *    (`src/lib/shareReceiver.ts`), und die Auswahlseite des Managers übernimmt.
 *
 * Früher meldete sich diese Datei nach dem Aufräumen selbst ab. Damit war aber
 * auch niemand mehr da, der den POST alter Installationen annahm. Der Manager
 * meldet sie deshalb bei jedem Start selbst an (siehe `src/lib/legacyShare.ts`)
 * – auch auf Geräten, auf denen sie sich schon abgemeldet hatte.
 *
 * Die Datei wird nicht gebündelt, sondern unverändert nach `dist/sw.js`
 * kopiert (siehe `vite.config.ts`). Die Namen unten müssen deshalb von Hand zu
 * `src/lib/shareConstants.ts` passen; `shareConstants.test.ts` prüft das.
 */

const SHARE_TARGET = '/share-target'
const SHARE_CACHE = 'geteilte-dateien'
const SHARE_FILE_PREFIX = '/__geteilt/datei-'
const SHARE_TEXT_KEY = '/__geteilt/text'
const SHARE_FILENAME_HEADER = 'x-dateiname'
const SHARE_LANDING = '/app/teilen'

self.addEventListener('install', () => {
  // Nicht auf das Schliessen aller Seiten warten: Solange der alte Worker
  // aktiv bleibt, liefert er weiter die alte App aus.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(aufraeumen())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.pathname === SHARE_TARGET) {
    event.respondWith(teilenAnnehmen(event.request))
  }
  // Alles andere bleibt unberührt und geht ans Netz.
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

  // Seiten, die noch am alten Worker hängen, zeigen dessen alte Hülle. Neu
  // geladen gehen sie ans Netz und kommen bei der neuen App an. Ein frisch
  // angemeldeter Worker hat keine solchen Seiten – dann geschieht hier nichts.
  const seiten = await self.clients.matchAll({ type: 'window' })
  for (const seite of seiten) {
    seite.navigate(seite.url).catch(() => {
      // Eine Seite, die gerade selbst navigiert, lässt sich nicht umlenken –
      // sie lädt ohnehin gleich neu.
    })
  }
}

/** Dieselbe Ablage wie im Worker des Managers – siehe dort. */
async function teilenAnnehmen(request) {
  try {
    const formData = await request.formData()
    const files = formData
      .getAll('files')
      .filter((entry) => entry instanceof File && entry.size > 0)
    const text = {
      title: feld(formData, 'title'),
      text: feld(formData, 'text'),
      url: feld(formData, 'url'),
    }

    await caches.delete(SHARE_CACHE)
    const cache = await caches.open(SHARE_CACHE)

    for (const [index, file] of files.entries()) {
      await cache.put(
        new Request(`${SHARE_FILE_PREFIX}${index}`),
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/octet-stream',
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

    return Response.redirect(SHARE_LANDING, 303)
  } catch {
    return Response.redirect(`${SHARE_LANDING}?fehler=1`, 303)
  }
}

function feld(formData, name) {
  const wert = formData.get(name)
  return typeof wert === 'string' ? wert.trim() : ''
}

import {
  SHARE_FILENAME_HEADER,
  SHARE_FILE_PREFIX,
  SHARE_LOG_KEY,
  SHARE_TEXT_KEY,
  type ShareProtokoll,
} from './shareConstants'

/**
 * Nimmt alles entgegen, was Android beim Teilen mitschickt – für die Service
 * Worker beider Apps, jeder mit seinem eigenen Zwischenspeicher und seiner
 * eigenen Auswahlseite.
 *
 * Nicht nur Dateien: Wer einen Verweis teilt, schickt gar keine – dann stehen
 * Titel, Text und Adresse in den Formularfeldern, die im Manifest unter
 * `share_target.params` angemeldet sind. Beides wandert in denselben
 * Zwischenspeicher, unterschieden nur am Schlüssel.
 *
 * Wohin es dann geht, entscheidet die Auswahlseite – hier wird nichts
 * einsortiert. Der Worker weiss nichts von Notizen und Dokumenten und soll es
 * auch nicht wissen müssen.
 *
 * Dieselbe Ablage steht ein drittes Mal, ohne Bündler, im Worker an der
 * Wurzel (`legacy-root/sw.js`) – für Installationen von vor dem Umzug.
 */
export async function receiveShare(
  request: Request,
  cacheName: string,
  landingPath: string,
): Promise<Response> {
  try {
    const formData = await request.formData()
    // Leere Dateien fallen weg: Manche Apps schicken beim Teilen eines
    // Verweises ein leeres Dateifeld mit, und das stünde sonst als namenlose
    // Datei auf der Auswahlseite – die sich nirgends ablegen liesse.
    const files = formData
      .getAll('files')
      .filter((entry): entry is File => entry instanceof File && entry.size > 0)
    const text = {
      title: feld(formData, 'title'),
      text: feld(formData, 'text'),
      url: feld(formData, 'url'),
    }

    // Ein neues Teilen ersetzt das vorige vollständig. Ohne das Leeren bliebe
    // liegen, was jemand auf der Auswahlseite hat stehen lassen, und käme beim
    // nächsten Teilen als Zugabe wieder mit.
    await caches.delete(cacheName)
    const cache = await caches.open(cacheName)

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
            // Den Typ so, wie er ankam – auch einen leeren. Was daraus wird,
            // entscheidet die Seite beim Abholen anhand des Dateinamens (siehe
            // `sharedContent.ts`); hier stünde sonst nur ein Ratespiel mehr.
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

    // Was überhaupt ankam – auch das, was oben verworfen wurde (eine leere
    // Datei). Nur Namen und Grössen, keine Inhalte.
    const protokoll: ShareProtokoll = { felder: [] }
    formData.forEach((wert, name) => {
      protokoll.felder.push(
        typeof wert === 'string'
          ? { name, art: 'text', laenge: wert.length }
          : { name, art: 'datei', laenge: wert.size, datei: wert.name, typ: wert.type },
      )
    })
    await cache.put(
      new Request(SHARE_LOG_KEY),
      new Response(JSON.stringify(protokoll), { headers: { 'content-type': 'application/json' } }),
    )

    // 303 statt 302: Der Browser soll die Zieladresse mit GET laden, nicht
    // den POST wiederholen.
    return Response.redirect(landingPath, 303)
  } catch {
    return Response.redirect(`${landingPath}?fehler=1`, 303)
  }
}

/** Ein Textfeld aus dem Formular – Dateien und Fehlendes ergeben nichts. */
function feld(formData: FormData, name: string): string {
  const wert = formData.get(name)
  return typeof wert === 'string' ? wert.trim() : ''
}

/**
 * Leert `dist/` vollständig, bevor gebaut wird.
 *
 * Vite räumt nur sein eigenes Ausgabeverzeichnis auf – hier `dist/app` und
 * `dist/docbase`. Was daneben in `dist/` liegt, bleibt liegen. Auf dem eigenen
 * Rechner fällt das nie auf, weil dort ohnehin frisch gebaut wird. Auf dem
 * Build-Server von Netlify schon: Der behält die Arbeitskopie zwischen zwei
 * Builds, und `dist/` ist nicht versioniert – es räumt also niemand je auf.
 *
 * Genau das ist passiert. Aus der Zeit, als der Manager noch auf `/` lag,
 * lagen dort weiterhin ein `index.html`, ein `assets/`-Ordner, Symbole und ein
 * `registerSW.js`. Jeder Deploy nahm sie mit. Und weil Netlify eine vorhandene
 * Datei immer der passenden Weiterleitung vorzieht, beantwortete dieses alte
 * `index.html` jeden Aufruf von `manager.alae.app` – die Weiterleitung auf
 * `/app/` kam nie zum Zug. Wer die Adresse im Browser eintippte, bekam seit
 * dem Umzug die alte App. Die installierte PWA startet direkt auf `/app/` und
 * war deshalb aktuell: Derselbe Deploy, zwei verschiedene Fassungen.
 */
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const paket = resolve(dirname(fileURLToPath(import.meta.url)), '..')

await rm(resolve(paket, 'dist'), { recursive: true, force: true })

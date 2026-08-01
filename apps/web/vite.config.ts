import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { MANAGER_SCOPE } from './src/lib/appScopes'
import { SHARE_TARGET_PATH } from './src/lib/shareConstants'

/**
 * Legt den Abmelde-Worker in die Wurzel des Ausgabeordners.
 *
 * Der Manager lag früher unter `/` und hatte dort einen Service Worker mit dem
 * Geltungsbereich `/`. Der lebt auf jedem Gerät weiter, auf dem die alte
 * Fassung einmal geöffnet wurde – und er bedient weiterhin jede Navigation
 * unterhalb von `/` aus seinem Zwischenspeicher, also auch die neue Adresse
 * `/app/`. Man sähe nach dem Umzug die alte App und käme von selbst nie wieder
 * heraus.
 *
 * Ein Service Worker verschwindet nur, wenn der Browser unter derselben
 * Adresse eine *andere* Datei findet. Deshalb liegt dort weiterhin ein
 * `/sw.js` – eines, das sich beim Start selbst abmeldet und aufräumt.
 * Weiterleiten liesse sich die Adresse nicht: Auf eine Umleitung antwortet der
 * Browser mit einem Fehler und behält den alten Worker.
 */
function abmeldeWorkerAusliefern(): Plugin {
  return {
    name: 'alten-worker-abmelden',
    enforce: 'post',
    async writeBundle(options) {
      const dir = options.dir ?? resolve('dist/app')
      const ziel = resolve(dirname(dir), 'sw.js')
      await mkdir(dirname(ziel), { recursive: true })
      await copyFile(resolve('legacy-root/sw.js'), ziel)
    },
  }
}

export default defineConfig({
  /**
   * Der Manager liegt unter `/app/`, nicht mehr unter `/`.
   *
   * Grund ist die Installation auf Android: Lag der Manager auf `/`, umfasste
   * sein Geltungsbereich auch `/docbase/`. Der Browser hielt die DocBase dann
   * für dieselbe, bereits installierte App und bot sie gar nicht erst zur
   * Installation an. Zwei Apps auf einer Adresse gehen nur nebeneinander
   * (`/app/` und `/docbase/`), nicht ineinander.
   */
  base: MANAGER_SCOPE,

  plugins: [
    react(),
    abmeldeWorkerAusliefern(),
    tailwindcss(),
    VitePWA({
      // Eigener Service Worker statt eines erzeugten: Nur so lässt sich der
      // POST des Android-Teilen-Menüs abfangen (siehe src/sw.ts).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],

      manifest: {
        name: 'Manager',
        short_name: 'Manager',
        description: 'Dokumente, Einkauf, Notizen und Finanzen für unseren Haushalt',
        lang: 'de-CH',
        theme_color: '#1e3a5f',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        /**
         * Beides mit Schrägstrich am Ende und beides unterhalb von `/app`:
         * Damit liegt der Manager neben der DocBase (`/docbase/`) statt um sie
         * herum. Erst dadurch erkennt Android zwei getrennte Apps und lässt
         * beide auf dem Startbildschirm zu. Die Wurzel `/` gehört zu keiner
         * der beiden Apps mehr und leitet nur noch hierher weiter.
         */
        start_url: MANAGER_SCOPE,
        scope: MANAGER_SCOPE,
        icons: [
          { src: `${MANAGER_SCOPE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${MANAGER_SCOPE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${MANAGER_SCOPE}icons/icon-maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],

        /**
         * Damit erscheint Manager im Teilen-Menü von Android. Wer ein PDF in
         * Gmail öffnet und auf Teilen tippt, findet die App direkt neben den
         * nativen Anwendungen.
         *
         * Der POST geht nicht an den Server, sondern wird vom Service Worker
         * abgefangen – die Adresse muss trotzdem im Geltungsbereich liegen.
         * Sie kommt deshalb aus derselben Quelle wie die Stelle, die ihn
         * abfängt: Stünden hier zwei Werte, hörte das Teilen ohne jede Meldung
         * auf zu funktionieren.
         */
        share_target: {
          action: SHARE_TARGET_PATH,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: ['application/pdf', 'image/*'],
              },
            ],
          },
        },

        // Langer Druck auf das App-Symbol führt direkt zur Aufnahme.
        shortcuts: [
          {
            name: 'Dokument aufnehmen',
            short_name: 'Aufnehmen',
            description: 'Kamera öffnen und ein Dokument ablegen',
            url: `${MANAGER_SCOPE}dokumente?aufnehmen=1`,
            icons: [{ src: `${MANAGER_SCOPE}icons/icon-192.png`, sizes: '192x192' }],
          },
        ],
      },

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },

      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Eigener Unterordner, damit die Adresse `/app/` ohne Umschreiben im
    // Server entsteht: Was hier liegt, liegt später unter `/app`. Daneben
    // schreibt der zweite Build seinen Ordner `docbase` – die beiden Apps
    // teilen sich nur noch das Ausgabeverzeichnis, keine einzige Datei.
    outDir: 'dist/app',
  },
})

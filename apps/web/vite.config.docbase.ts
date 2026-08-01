import { rename } from 'node:fs/promises'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { DOCBASE_SCOPE } from './src/lib/appScopes'

/**
 * Macht aus `docbase.html` die `index.html` des Ordners.
 *
 * Der Einstiegspunkt muss im Projektverzeichnis liegen und dort eindeutig
 * heissen – zwei `index.html` nebeneinander gibt es nicht. Ausgeliefert werden
 * muss er aber als `/docbase/`, denn das ist der Geltungsbereich der App und
 * die Adresse, die auf dem Startbildschirm landet.
 */
function alsIndexAusliefern(): Plugin {
  return {
    name: 'docbase-index',
    enforce: 'post',
    async writeBundle(options) {
      const dir = options.dir ?? resolve('dist/docbase')
      await rename(resolve(dir, 'docbase.html'), resolve(dir, 'index.html'))
    },
  }
}

/**
 * Der zweite Build: DocBase unter /docbase.
 *
 * Bewusst eine eigene Konfiguration und kein zweiter Einstiegspunkt im selben
 * Build. Der Grund ist die PWA: Manifest und Service Worker gibt es je Build
 * genau einmal, und genau die beiden müssen sich unterscheiden, damit sich
 * zwei Apps nebeneinander auf dem Startbildschirm installieren lassen. Ein
 * gemeinsamer Build könnte zwei Seiten ausliefern – aber nur eine App.
 *
 * Schreibt in einen eigenen Ordner neben dem des Managers (`dist/docbase`
 * neben `dist/app`). Die Trennung ist nicht nur Ordnung: Jeder der beiden
 * Service Worker nimmt in seinen Zwischenspeicher auf, was er in seinem Ordner
 * findet – und sieht die Dateien der anderen App dadurch gar nicht erst.
 */
export default defineConfig({
  base: DOCBASE_SCOPE,
  publicDir: 'public-docbase',

  plugins: [
    react(),
    tailwindcss(),
    alsIndexAusliefern(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/docbase',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],

      manifest: {
        name: 'DocBase',
        short_name: 'DocBase',
        description: 'Medizinische Sammlung: Studien, Kursmaterial und Notizen',
        lang: 'de-CH',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        /**
         * Beides mit Schrägstrich am Ende und beides unterhalb von /docbase:
         * Daran erkennt der Browser zwei getrennte Apps auf derselben Adresse.
         * Entscheidend ist, dass sich die Bereiche nicht überschneiden – der
         * Manager liegt deshalb unter `/app/` und nicht mehr auf `/`. Läge er
         * auf der Wurzel, umfasste sein Bereich diesen hier gleich mit, und
         * Android liesse die DocBase nicht als eigene App installieren.
         */
        start_url: DOCBASE_SCOPE,
        scope: DOCBASE_SCOPE,
        icons: [
          { src: `${DOCBASE_SCOPE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${DOCBASE_SCOPE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${DOCBASE_SCOPE}icons/icon-maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Der Bündler kennt die Hülle noch unter ihrem Dateinamen im Projekt;
        // im Zwischenspeicher muss sie unter der Adresse liegen, unter der sie
        // ausgeliefert wird – sonst findet der Worker ohne Verbindung nichts.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((entry) =>
              entry.url === 'docbase.html' ? { ...entry, url: 'index.html' } : entry,
            ),
            warnings: [],
          }),
        ],
      },

      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],

  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist/docbase',
    rollupOptions: {
      input: 'docbase.html',
    },
  },

  server: {
    port: 5174,
  },
})

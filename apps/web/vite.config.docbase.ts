import { rename } from 'node:fs/promises'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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
 * Läuft nach dem Hauptbuild und schreibt in denselben Ordner (`emptyOutDir:
 * false`), sonst räumte er dessen Ergebnis weg. Die Reihenfolge hat noch einen
 * zweiten Nutzen: Der Service Worker des Managers sieht die Dateien der
 * DocBase gar nicht erst und nimmt sie deshalb auch nicht in seinen
 * Zwischenspeicher auf.
 */
export default defineConfig({
  base: '/docbase/',
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
         * Für eine Seite gilt immer der längste passende Geltungsbereich – der
         * Manager (Bereich `/`) bleibt also überall sonst zuständig.
         */
        start_url: '/docbase/',
        scope: '/docbase/',
        icons: [
          { src: '/docbase/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/docbase/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/docbase/icons/icon-maskable-512.png',
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
    emptyOutDir: false,
    rollupOptions: {
      input: 'docbase.html',
    },
  },

  server: {
    port: 5174,
  },
})

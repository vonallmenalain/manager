import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
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
         */
        share_target: {
          action: '/share-target',
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
            url: '/dokumente?aufnehmen=1',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
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
  },
})

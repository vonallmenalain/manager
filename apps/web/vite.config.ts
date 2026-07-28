import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Neue Version wird im Hintergrund geladen und beim nächsten Start aktiv.
      // Für eine Haushalts-App ist das angenehmer als ein Update-Banner.
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
        // Etappe 2 ergänzt hier 'share_target' und 'shortcuts'. Beides jetzt schon
        // einzutragen hiesse, im Android-Teilen-Menü einen Eintrag anzubieten,
        // der noch ins Leere läuft.
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // API-Antworten gehören nicht in den Precache: Der Service Worker soll
        // die App-Hülle ausliefern, die Daten kommen immer frisch vom Server.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
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

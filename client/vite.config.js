import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'FretFit — Guitar Reach',
        short_name: 'FretFit',
        description:
          'Assess the physical difficulty of chord shapes for your hand. ' +
          'Measures fret/string reach and scores every combination 1–10.',
        theme_color: '#0f0f0f',
        background_color: '#0f0f0f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['music', 'education', 'utilities'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the built app shell. Cap file size so the bundled intro.mp4
        // (~3 MB) and other large media aren't force-precached.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Keep the heavy Three.js chunk OUT of precache — it's lazy-loaded only
        // when a 3D surface opens, and matches the StaleWhileRevalidate rule
        // below, so it caches on first fetch without bloating the install size
        // for users who never open one.
        globIgnores: ['**/three-vendor-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Never let the SW intercept API/auth calls — always hit the network.
        navigateFallbackDenylist: [/^\/api/],
        // A new build's service worker takes over IMMEDIATELY instead of waiting
        // behind the old one until every tab closes. Combined with the
        // NetworkFirst navigation rule below, this stops the app from serving a
        // stale page on browser restart: the newest deployed version wins on the
        // very next load, not one-load-behind.
        skipWaiting: true,
        clientsClaim: true,
        // Drop caches created by previous SW versions so an old precache can't
        // resurface after an update.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Navigations (the HTML app shell): fetch from the NETWORK FIRST so a
            // fresh page always wins when online; fall back to cache only when
            // offline. This is what fixes "I keep landing on the old page".
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' && !url.pathname.startsWith('/api'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 3, // offline? fall back to cache fast
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Fingerprinted static assets (JS/CSS/images, not /api): safe to
            // serve fast and refresh in the background — their hashed filenames
            // change on every build, so a stale one is never the wrong version.
            urlPattern: ({ request, url, sameOrigin }) =>
              sameOrigin && request.mode !== 'navigate' && !url.pathname.startsWith('/api'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'app-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        // Keep the SW off in `npm run dev` so it never caches dev modules.
        enabled: false,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Route all Three.js / react-three code into ONE shared chunk. Combined
        // with the dynamic import() of each 3D surface (via <Lazy3D>), this keeps
        // three out of the main bundle and lets every 3D surface share the same
        // lazily-fetched chunk. manualChunks alone wouldn't defer it — the
        // dynamic import is what removes it from initial load.
        manualChunks(id) {
          if (
            id.includes('node_modules/three') ||
            id.includes('node_modules/@react-three') ||
            id.includes('node_modules/postprocessing') ||
            id.includes('node_modules/maath')
          ) {
            return 'three-vendor';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})

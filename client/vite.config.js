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
        runtimeCaching: [
          {
            // Same-origin assets (not /api): serve fast, refresh in background.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && !url.pathname.startsWith('/api'),
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

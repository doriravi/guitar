import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PWAPrompt from './components/PWAPrompt.jsx'

// Dev self-heal: the PWA service worker is disabled in `npm run dev`
// (devOptions.enabled:false), but a worker registered by an earlier
// `npm run build`/`preview` or a deployed visit stays registered on
// localhost and keeps SERVING ITS OLD PRECACHED BUNDLE over the dev server —
// so you land on a stale page that "clear cache" never fixes (clearing cache
// doesn't remove a service worker). In dev, proactively unregister any worker
// and drop its caches so the dev server is always what you actually see.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => {
      if (!regs.length) return;
      Promise.all(regs.map((r) => r.unregister()))
        .then(() => caches?.keys?.() ?? [])
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => {
          // A controlled page keeps the old worker alive until reload.
          if (navigator.serviceWorker.controller) window.location.reload();
        })
        .catch(() => { /* best effort */ });
    })
    .catch(() => { /* best effort */ });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <PWAPrompt />
  </StrictMode>,
)

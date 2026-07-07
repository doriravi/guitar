import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { usePwaInstall } from '../lib/usePwaInstall'

/**
 * PWA glue, rendered once near the app root. Two independent pieces:
 *
 *  1. Update toast — when a new service worker has cached a fresh build, offer
 *     a one-tap "Update" that activates it and reloads.
 *  2. Install prompt — on browsers that fire `beforeinstallprompt` (Chrome/Edge
 *     on Android & desktop, Windows), surface a native "Install app" button.
 *     iOS/iPadOS Safari installs via Share → "Add to Home Screen", so we show a
 *     one-time hint there instead. The shared install state also powers the
 *     "Install app" entry in the app's side menu (see usePwaInstall).
 *
 * Purely additive: if the browser supports none of this, the component renders
 * nothing and the app behaves exactly as before.
 */
export default function PWAPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const { canInstall, ios, promptInstall } = usePwaInstall()
  const [installDismissed, setInstallDismissed] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem('fretfit_ios_install_hint') === '1'
    if (ios && !dismissed) setIosHint(true)
  }, [ios])

  const dismissIos = () => {
    localStorage.setItem('fretfit_ios_install_hint', '1')
    setIosHint(false)
  }

  const wrap = {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: 'calc(16px + env(safe-area-inset-bottom))',
    zIndex: 9999,
    maxWidth: 'min(440px, calc(100vw - 24px))',
    width: 'max-content',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    borderRadius: 14,
    background: 'rgba(20,20,20,0.96)',
    border: '1px solid rgba(201,169,110,0.3)',
    boxShadow: '0 12px 40px -12px rgba(0,0,0,0.7)',
    color: 'var(--color-ink)',
    fontSize: 14,
    backdropFilter: 'blur(8px)',
  }
  const btn = {
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 999,
    border: 'none',
    cursor: 'pointer',
    background: 'var(--color-brand)',
    color: '#161616',
    whiteSpace: 'nowrap',
  }
  const ghost = {
    ...btn,
    background: 'transparent',
    color: 'var(--color-ink-muted)',
    border: '1px solid rgba(255,255,255,0.15)',
  }

  if (needRefresh) {
    return (
      <div style={wrap} role="status">
        <span>A new version is ready.</span>
        <button style={btn} onClick={() => updateServiceWorker(true)}>Update</button>
        <button style={ghost} onClick={() => setNeedRefresh(false)}>Later</button>
      </div>
    )
  }

  if (canInstall && !installDismissed) {
    return (
      <div style={wrap} role="dialog" aria-label="Install app">
        <span>📲 Install FretFit as an app</span>
        <button style={btn} onClick={promptInstall}>Install</button>
        <button style={ghost} onClick={() => setInstallDismissed(true)}>Not now</button>
      </div>
    )
  }

  if (iosHint) {
    return (
      <div style={wrap} role="dialog" aria-label="Add to Home Screen">
        <span style={{ lineHeight: 1.35 }}>
          📲 Install: tap <b>Share</b> then <b>“Add to Home Screen”</b>
        </span>
        <button style={ghost} onClick={dismissIos}>Got it</button>
      </div>
    )
  }

  return null
}

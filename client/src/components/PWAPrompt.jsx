import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * PWA glue, rendered once near the app root. Two independent pieces:
 *
 *  1. Update toast — when a new service worker has cached a fresh build, offer
 *     a one-tap "Update" that activates it and reloads.
 *  2. Install button — on browsers that fire `beforeinstallprompt` (Chrome/Edge
 *     on Android & desktop, Windows), surface a native "Install app" button.
 *     iOS/iPadOS Safari doesn't fire this event; those users install via the
 *     Share → "Add to Home Screen" flow, so we show a one-time hint instead.
 *
 * Purely additive: if the browser supports none of this, the component renders
 * nothing and the app behaves exactly as before.
 */
export default function PWAPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const [installEvent, setInstallEvent] = useState(null)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault()
      setInstallEvent(e)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', () => setInstallEvent(null))

    // iOS standalone-install hint: only iPhone/iPad Safari, not already
    // installed, and not dismissed before.
    const ua = window.navigator.userAgent
    const isIOS = /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    const dismissed = localStorage.getItem('fretfit_ios_install_hint') === '1'
    if (isIOS && !isStandalone && !dismissed) setIosHint(true)

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const install = async () => {
    if (!installEvent) return
    installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

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

  if (installEvent) {
    return (
      <div style={wrap} role="dialog" aria-label="Install app">
        <span>📲 Install FretFit as an app</span>
        <button style={btn} onClick={install}>Install</button>
        <button style={ghost} onClick={() => setInstallEvent(null)}>Not now</button>
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

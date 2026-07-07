import { useEffect, useState } from 'react'

// Module-level singletons so every component sees the same install state.
// `beforeinstallprompt` fires once, early — we stash the event here so a menu
// button rendered later can still trigger the native install.
let deferredPrompt = null
const listeners = new Set()

function notify() {
  listeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

/**
 * Shared PWA-install state. Returns:
 *  - canInstall: browser fired beforeinstallprompt (Android/Chrome/Edge/Windows)
 *  - installed:  already running as an installed app
 *  - ios:        iOS/iPadOS Safari (needs the manual Share → Add to Home Screen)
 *  - promptInstall(): trigger the native install dialog (returns the outcome)
 */
export function usePwaInstall() {
  const [, force] = useState(0)

  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])

  const promptInstall = async () => {
    if (!deferredPrompt) return null
    deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    deferredPrompt = null
    notify()
    return choice?.outcome ?? null
  }

  return {
    canInstall: !!deferredPrompt,
    installed: isStandalone(),
    ios: isIOS() && !isStandalone(),
    promptInstall,
  }
}

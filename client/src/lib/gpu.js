// GPU / 3D capability gate. Pure helpers (no React) that decide whether the app
// should render its heavy Three.js surfaces at all. Every 3D mount goes through
// `should3D()` (usually via <Lazy3D>), so a device that opts out of motion, lacks
// WebGL, or the user has disabled 3D on, silently gets the 2D/SVG fallback and
// never downloads the three-vendor chunk.

const DISABLE_KEY = 'guitar_disable_3d';

// User preference: an explicit "turn 3D off" switch persisted in localStorage.
// Defaults to off (3D allowed). Wrapped in try/catch for private-mode/SSR safety.
export function is3DDisabledByUser() {
  try {
    return localStorage.getItem(DISABLE_KEY) === '1';
  } catch {
    return false;
  }
}

export function set3DDisabledByUser(disabled) {
  try {
    if (disabled) localStorage.setItem(DISABLE_KEY, '1');
    else localStorage.removeItem(DISABLE_KEY);
  } catch {
    /* ignore */
  }
}

// Same reduced-motion convention already used by index.css and the landing
// ParticleField — respect the OS "reduce motion" setting.
export function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

// True when the WebGPU API surface exists (navigator.gpu). Note this does NOT
// guarantee a working adapter — some environments (e.g. software-WebGL fallback)
// expose navigator.gpu but requestAdapter() returns null. Use hasRealWebGPU()
// for the stronger, async check.
export function hasWebGPU() {
  try {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  } catch {
    return false;
  }
}

// Stronger async check: a real, usable WebGPU adapter exists. Cached. Surfaces
// that look bad on the WebGL fallback (the ambient/hero shaders) gate on this so
// they simply don't render when only software rendering is available, rather
// than showing a degraded wash.
let _realWebGPU;
export async function hasRealWebGPU() {
  if (_realWebGPU !== undefined) return _realWebGPU;
  try {
    if (!('gpu' in navigator)) return (_realWebGPU = false);
    const adapter = await navigator.gpu.requestAdapter();
    _realWebGPU = !!adapter;
  } catch {
    _realWebGPU = false;
  }
  return _realWebGPU;
}

// True when *some* GPU path exists (WebGPU or WebGL). Cached because creating a
// probe context is not free and the answer never changes within a session.
let _webglOk;
export function hasWebGL() {
  if (_webglOk !== undefined) return _webglOk;
  try {
    const c = document.createElement('canvas');
    _webglOk = !!(
      c.getContext('webgl2') ||
      c.getContext('webgl') ||
      c.getContext('experimental-webgl')
    );
  } catch {
    _webglOk = false;
  }
  return _webglOk;
}

// The single gate every 3D surface consults. 3D renders only when the user
// hasn't disabled it, motion is allowed, and the device can actually draw it.
export function should3D() {
  if (is3DDisabledByUser()) return false;
  if (prefersReducedMotion()) return false;
  return hasWebGPU() || hasWebGL();
}

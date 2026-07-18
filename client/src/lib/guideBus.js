// guideBus — a tiny global event bus so the guide avatar can REACT to things
// happening anywhere in the app without prop-drilling or a React context.
//
// Two signals today:
//   • 'music' — the app is producing sound (a chord/progression/backing/MIDI-style
//     playback is heard). Carries { ms } so listeners know how long to react.
//   • 'rec'   — a recorder started/stopped. Carries { on: true|false }.
//
// The guide subscribes and DANCES while either is active. Kept framework-free
// (a plain EventTarget) so lib modules like audio.js can fire it too.

const target =
  typeof window !== 'undefined' && window.EventTarget
    ? new EventTarget()
    : { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };

/** Signal that music is being heard for roughly `ms` milliseconds. */
export function musicHeard(ms = 1200) {
  try {
    target.dispatchEvent(new CustomEvent('music', { detail: { ms: Math.max(200, ms | 0) } }));
  } catch { /* no CustomEvent in this env — ignore */ }
}

/** Signal a recorder starting (on=true) or stopping (on=false). */
export function recording(on) {
  try {
    target.dispatchEvent(new CustomEvent('rec', { detail: { on: !!on } }));
  } catch { /* ignore */ }
}

/** Subscribe to a bus event; returns an unsubscribe fn. */
export function onGuide(type, handler) {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}

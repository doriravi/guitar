// Shared count-in AUDIO cue: every countdown in the app must sound like a clock
// ticking down — one tick per remaining second — and SAY "go" the instant it
// finishes. This lives in one place so all count-ins (scale practice, chord
// recording, Music Memory, play-along, …) behave identically; a driver just
// reports its current remaining-seconds value here on each change.
//
// Usage — make one cue per recording and feed it the countdown number:
//   const cue = makeCountdownCue();
//   // ...each time the on-screen countdown changes (5,4,3,2,1,0):
//   cue.set(remainingSeconds);
//   // ...and if the take is cancelled mid-count:
//   cue.cancel();
//
// It is edge-triggered and idempotent: calling set() repeatedly with the same
// value does nothing, so it's safe to call from a per-frame loop. A tick fires
// only when the value drops to a NEW positive second; "go" fires once when the
// value first reaches 0 (the count-in → content boundary).

import { playTick } from './audio';
import { sayGo } from './vocals';

/**
 * @param {object} [opts]
 *   muted   — () => boolean : suppress ALL cue audio when true (honours a screen's
 *             own mute toggle). Checked live on every tick/go.
 *   onGo    — optional callback fired alongside the spoken "go" (e.g. a visual flash)
 * @returns {{ set(remainingSeconds:number): void, cancel(): void }}
 */
export function makeCountdownCue({ muted, onGo } = {}) {
  let last = null;           // last remaining-seconds value we acted on
  let firedGo = false;       // "go" fires at most once per count-in

  const isMuted = () => { try { return !!muted?.(); } catch { return false; } };

  return {
    set(remaining) {
      const n = Math.max(0, Math.floor(Number(remaining) || 0));
      if (n === last) return;          // edge-trigger: only act on a change
      const prev = last;
      last = n;

      if (n > 0) {
        // A new second of the count-in — clock tick. The final tick (n === 1,
        // the last one before "go") is accented so the start feels imminent.
        if (!isMuted()) {
          // playTick resolves the shared ctx itself when none is passed.
          try { playTick(null, undefined, { accent: n === 1 }); } catch { /* ignore */ }
        }
        firedGo = false;               // re-arm if a count-in restarts
      } else if (n === 0 && prev != null && prev > 0 && !firedGo) {
        // Count-in just finished — say "go".
        firedGo = true;
        if (!isMuted()) {
          try { sayGo(); } catch { /* ignore */ }
        }
        try { onGo?.(); } catch { /* ignore */ }
      }
    },
    cancel() {
      last = null;
      firedGo = false;
    },
  };
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the audio + vocals deps so we can assert the cue's edge-triggering logic
// (ticks per second, one "go" at zero) without a real AudioContext / speech engine.
const ticks = [];
const gos = [];
vi.mock('./audio', () => ({
  playTick: (_ctx, _t, opts) => ticks.push(opts || {}),
}));
vi.mock('./vocals', () => ({
  sayGo: () => { gos.push(1); return () => {}; },
}));

import { makeCountdownCue } from './countdownCue';

describe('countdown cue — clock ticks then "go"', () => {
  beforeEach(() => { ticks.length = 0; gos.length = 0; });

  it('ticks once per new second and says "go" exactly once at zero', () => {
    const cue = makeCountdownCue();
    cue.set(5); cue.set(4); cue.set(3); cue.set(2); cue.set(1); cue.set(0);
    expect(ticks.length).toBe(5);        // 5,4,3,2,1 → five ticks
    expect(gos.length).toBe(1);          // one "go" at zero
  });

  it('is edge-triggered — repeated same-value calls do nothing', () => {
    const cue = makeCountdownCue();
    cue.set(3); cue.set(3); cue.set(3);
    expect(ticks.length).toBe(1);
    cue.set(0); cue.set(0);
    expect(gos.length).toBe(1);
  });

  it('accents the final tick (n === 1) before "go"', () => {
    const cue = makeCountdownCue();
    cue.set(2); cue.set(1);
    expect(ticks[0].accent).toBe(false);
    expect(ticks[1].accent).toBe(true);
  });

  it('respects the muted() gate — no tick, no go', () => {
    const cue = makeCountdownCue({ muted: () => true });
    cue.set(3); cue.set(2); cue.set(1); cue.set(0);
    expect(ticks.length).toBe(0);
    expect(gos.length).toBe(0);
  });

  it('fires onGo even when audio is muted (visual cue still wanted)', () => {
    let flashed = 0;
    const cue = makeCountdownCue({ muted: () => true, onGo: () => { flashed += 1; } });
    cue.set(1); cue.set(0);
    expect(flashed).toBe(1);
  });

  it('does not say "go" if the count never started above zero', () => {
    const cue = makeCountdownCue();
    cue.set(0);
    expect(gos.length).toBe(0);
  });

  it('re-arms after cancel so a new count-in ticks and goes again', () => {
    const cue = makeCountdownCue();
    cue.set(1); cue.set(0);
    cue.cancel();
    cue.set(1); cue.set(0);
    expect(ticks.length).toBe(2);
    expect(gos.length).toBe(2);
  });
});

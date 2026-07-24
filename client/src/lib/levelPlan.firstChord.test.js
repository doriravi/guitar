import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hasSeenFirstChord, markFirstChordSeen } from './levelPlan';

// The first-chord welcome is a one-time hand-off shown right after the hand scan.
// Its "seen" flag must default false, flip true once marked, survive a reload
// (persisted), and never throw when localStorage is corrupt or unavailable.
describe('first-chord welcome seen flag', () => {
  let mem;
  beforeEach(() => {
    mem = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    });
  });

  it('reads false before it is ever marked', () => {
    expect(hasSeenFirstChord()).toBe(false);
  });

  it('reads true after marking, and the flag persists in storage', () => {
    markFirstChordSeen();
    expect(hasSeenFirstChord()).toBe(true);
    // A fresh read (mirrors a reload) still sees it — it's really persisted.
    expect(mem['guitar_first_chord_seen_v1']).toBe('1');
    expect(hasSeenFirstChord()).toBe(true);
  });

  it('marking is idempotent', () => {
    markFirstChordSeen();
    markFirstChordSeen();
    expect(hasSeenFirstChord()).toBe(true);
  });

  it('treats any non-"1" stored value as not seen', () => {
    mem['guitar_first_chord_seen_v1'] = 'true';
    expect(hasSeenFirstChord()).toBe(false);
    mem['guitar_first_chord_seen_v1'] = '0';
    expect(hasSeenFirstChord()).toBe(false);
  });

  it('never throws when localStorage.getItem blows up', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(() => hasSeenFirstChord()).not.toThrow();
    expect(hasSeenFirstChord()).toBe(false);
    expect(() => markFirstChordSeen()).not.toThrow(); // swallows the write error
  });
});

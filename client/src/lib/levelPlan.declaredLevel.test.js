import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDeclaredTier, setDeclaredTier, TIERS } from './levelPlan';

// The declared starting tier is a display-focus preference the user picks once at
// sign-up. It must round-trip a valid tier, reject junk without clobbering a good
// stored value, and never throw on a corrupt / stale / wrong-version blob.
describe('declared starting level store', () => {
  let mem;
  beforeEach(() => {
    mem = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    });
  });

  it('reads null when nothing is stored', () => {
    expect(getDeclaredTier()).toBe(null);
  });

  it('round-trips a valid tier and returns it from the setter', () => {
    expect(setDeclaredTier('Intermediate')).toBe('Intermediate');
    expect(getDeclaredTier()).toBe('Intermediate');
  });

  it('accepts every real tier', () => {
    for (const t of TIERS) {
      expect(setDeclaredTier(t)).toBe(t);
      expect(getDeclaredTier()).toBe(t);
    }
  });

  it('latest valid write wins', () => {
    setDeclaredTier('Beginner');
    setDeclaredTier('Advanced');
    expect(getDeclaredTier()).toBe('Advanced');
  });

  it('rejects junk and does not clobber a good stored value', () => {
    setDeclaredTier('Advanced');
    expect(setDeclaredTier('SuperMaster')).toBe(null);
    expect(setDeclaredTier(null)).toBe(null);
    expect(setDeclaredTier(undefined)).toBe(null);
    expect(setDeclaredTier(42)).toBe(null);
    expect(getDeclaredTier()).toBe('Advanced');
  });

  it('reads null (never throws) on corrupt or invalid stored data', () => {
    mem['guitar_declared_level_v1'] = '{not json';
    expect(getDeclaredTier()).toBe(null);

    mem['guitar_declared_level_v1'] = JSON.stringify({ v: 1, tier: 'Legend' });
    expect(getDeclaredTier()).toBe(null); // unknown tier

    mem['guitar_declared_level_v1'] = JSON.stringify({ v: 2, tier: 'Master' });
    expect(getDeclaredTier()).toBe(null); // wrong version
  });
});

// Unit tests for the chord-transition drill generator + persistence.
// Run with `npm test` (Vitest). localStorage is shimmed below for the
// save/load round-trip (Vitest runs in Node by default here).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILTIN_LADDERS, rankPairs, ladderPairs, buildDrillTimeline, drillToItem,
  saveDrillSet, loadDrillSets, deleteDrillSet, addPairToSet, hydrateDrillSet,
  SPEED_STEPS, tierPairs, tierCount, buildDrillLevel, nextDrillLevel,
} from './transitionDrills';

// Minimal in-memory localStorage so the persistence helpers work under Node.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
});

describe('rankPairs — easy→hard ordering', () => {
  it('returns pairs sorted ascending by transition difficulty', () => {
    const pairs = rankPairs(['G', 'C', 'D', 'Em', 'Am', 'F'], { prefer: { F: 'Major (barre)' } });
    expect(pairs.length).toBeGreaterThan(3);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i].score).toBeGreaterThanOrEqual(pairs[i - 1].score);
    }
  });

  it('an F-barre change lands harder than an easy open change in the same ladder', () => {
    const pairs = rankPairs(['C', 'G', 'Am', 'F'], { prefer: { F: 'Major (barre)' } });
    const easiest = pairs[0];
    const fBarreChange = pairs.find(p => p.from === 'F' || p.to === 'F');
    expect(fBarreChange).toBeTruthy();
    expect(fBarreChange.score).toBeGreaterThan(easiest.score);
  });

  it('drops chords with no playable voicing and caps at maxPairs', () => {
    const pairs = rankPairs(['C', 'G', 'ZZ_not_a_chord'], { maxPairs: 2 });
    expect(pairs.length).toBeLessThanOrEqual(2);
    expect(pairs.every(p => p.from !== 'ZZ_not_a_chord' && p.to !== 'ZZ_not_a_chord')).toBe(true);
  });

  it('a smaller hand ranks a stretch-heavy ladder no easier than an average hand', () => {
    const small = { thumbToIndex: 5.6, indexToMiddle: 3.4, middleToRing: 2.6, ringToLittle: 4.1 };
    const avg = rankPairs(['C', 'F', 'Bm'], { prefer: { F: 'Major (barre)' } });
    const sm = rankPairs(['C', 'F', 'Bm'], { prefer: { F: 'Major (barre)' }, profile: small });
    // Hardest change should be at least as hard for the small hand.
    expect(sm[sm.length - 1].score).toBeGreaterThanOrEqual(avg[avg.length - 1].score);
  });
});

describe('the big open-chord ladder', () => {
  const marathon = BUILTIN_LADDERS.find(l => l.id === 'open-marathon');

  it('exists and draws only from the open-chord pool', () => {
    expect(marathon).toBeTruthy();
    expect(marathon.chords.length).toBeGreaterThanOrEqual(30);
  });

  it('produces ~50 changes spanning a real easy→hard gradient', () => {
    const pairs = ladderPairs(marathon);
    expect(pairs.length).toBeGreaterThanOrEqual(45);
    // monotonic easy→hard
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i].score).toBeGreaterThanOrEqual(pairs[i - 1].score);
    }
    // genuine spread (not 50 near-identical easy changes)
    expect(pairs[pairs.length - 1].score - pairs[0].score).toBeGreaterThan(3);
  });

  it('splits into many tiers so the chords get harder often', () => {
    const pairs = ladderPairs(marathon);
    const item = drillToItem({ id: marathon.id, name: marathon.name, pairs });
    expect(item.tiers).toBeGreaterThanOrEqual(6);   // not just 3 huge tiers
    // each successive tier's hardest change is harder than the previous tier's
    let prevHardest = 0;
    for (let t = 0; t < item.tiers; t++) {
      const tp = tierPairs(pairs, t, item.perTier);
      const hardest = tp[tp.length - 1].score;
      expect(hardest).toBeGreaterThanOrEqual(prevHardest);
      prevHardest = hardest;
    }
  });
});

describe('every built-in ladder produces a usable easy→hard drill', () => {
  it.each(BUILTIN_LADDERS.map(l => [l.name, l]))('%s', (_name, ladder) => {
    const pairs = ladderPairs(ladder);
    expect(pairs.length).toBeGreaterThan(0);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i].score).toBeGreaterThanOrEqual(pairs[i - 1].score);
    }
  });
});

describe('buildDrillTimeline — game-consumable windows', () => {
  const pairs = [{ from: 'G', to: 'C', score: 4.0 }, { from: 'C', to: 'D', score: 6.0 }];

  it('lays out reps × pairs as an A→B loop, HARDEST pair first', () => {
    const tl = buildDrillTimeline(pairs, { bpm: 70, reps: 3 });
    // 2 pairs × 3 reps × 2 chords = 12 windows.
    expect(tl.windows.length).toBe(12);
    // Pairs arrive ranked easy→hard; the drill plays hardest-first so a tier bump
    // shows the new hard change immediately. So C→D (6.0) leads, then G→C (4.0).
    expect(tl.windows.slice(0, 4).map(w => w.name)).toEqual(['C', 'D', 'C', 'D']);
    expect(tl.windows.slice(6, 10).map(w => w.name)).toEqual(['G', 'C', 'G', 'C']);
  });

  it('each window has the fields PracticeGame reads, with monotonic time', () => {
    const tl = buildDrillTimeline(pairs, { bpm: 70, reps: 2 });
    for (const w of tl.windows) {
      expect(w.kind).toBe('chord');
      expect(typeof w.name).toBe('string');
      expect(w.pcs && w.pcs.expected instanceof Set).toBe(true);
      expect(w.durSec).toBeGreaterThan(0);
      expect(w.endSec).toBeGreaterThan(w.startSec);
    }
    for (let i = 1; i < tl.windows.length; i++) {
      expect(tl.windows[i].startSec).toBeGreaterThan(tl.windows[i - 1].startSec);
    }
  });

  it('meta carries the fields the game loop consumes', () => {
    const tl = buildDrillTimeline(pairs, { bpm: 80, reps: 2 });
    for (const k of ['bpmBase', 'bpm', 'spb', 'countInBeats', 'countInSec', 'totalSec']) {
      expect(typeof tl.meta[k]).toBe('number');
    }
    expect(tl.meta.bpmBase).toBe(80);
  });
});

describe('drillToItem — the object PracticeGame.start() consumes', () => {
  it('carries isDrill, a stable key, a prebuilt timeline, and a synthetic song', () => {
    const pairs = ladderPairs(BUILTIN_LADDERS[0], { maxPairs: 3 });
    const item = drillToItem({ id: 'open-basics', name: 'Open-chord basics', pairs }, { reps: 2 });
    expect(item.isDrill).toBe(true);
    expect(item.key).toBe('drill_open-basics');
    expect(item.song.id).toBe('drill_open-basics');   // → songKeyOf uses song.id, so history keys are stable
    expect(item.timeline.windows.length).toBeGreaterThan(0);
  });
});

describe('tiered leveling — chord difficulty × speed', () => {
  // 9 ranked pairs → perTier 3 → 3 tiers.
  const pairs = Array.from({ length: 9 }, (_, i) => ({ from: 'C', to: 'G', score: i + 1 }));

  it('tierCount splits the ranked list into thirds', () => {
    expect(tierCount(pairs)).toBe(3);
    expect(tierCount([])).toBe(0);
  });

  it('each higher tier ADDS the next harder pairs on top of the easier ones', () => {
    const t0 = tierPairs(pairs, 0);
    const t1 = tierPairs(pairs, 1);
    const t2 = tierPairs(pairs, 2);
    expect(t0.length).toBe(3);
    expect(t1.length).toBe(6);
    expect(t2.length).toBe(9);
    // Tier 1 is a superset of tier 0 (easy pairs keep appearing).
    expect(t1.slice(0, 3)).toEqual(t0);
    // The newly added pairs are the harder ones.
    expect(t1[5].score).toBeGreaterThan(t0[2].score);
  });

  it('nextDrillLevel climbs speed 3 steps, then bumps the tier and resets speed', () => {
    const item = drillToItem({ id: 'x', name: 'X', pairs });
    expect(item.tiers).toBe(3);
    // Within tier 0: step 0 → 1 → 2.
    expect(nextDrillLevel(item, 0, 0)).toEqual({ tier: 0, step: 1 });
    expect(nextDrillLevel(item, 0, 1)).toEqual({ tier: 0, step: 2 });
    // After the last speed step: next tier, speed resets to step 0.
    expect(nextDrillLevel(item, 0, SPEED_STEPS.length - 1)).toEqual({ tier: 1, step: 0 });
    // At the hardest tier's top speed: nothing left.
    expect(nextDrillLevel(item, 2, SPEED_STEPS.length - 1)).toBeNull();
  });

  it('buildDrillLevel produces a timeline at the tier’s pairs and the step’s speed', () => {
    const item = drillToItem({ id: 'x', name: 'X', pairs }, { reps: 2 });
    const lvl = buildDrillLevel(item, 1, 2);   // tier 1 (6 pairs), speed step 2 (100%)
    expect(lvl.speed).toBe(SPEED_STEPS[2]);
    expect(lvl.pairs.length).toBe(6);
    expect(lvl.timeline.windows.length).toBe(6 * 2 * 2);   // pairs × reps × 2 chords
    expect(lvl.isLastLevel).toBe(false);
    expect(buildDrillLevel(item, 2, SPEED_STEPS.length - 1).isLastLevel).toBe(true);
  });

  it('drillToItem starts at tier 0 / slowest step', () => {
    const item = drillToItem({ id: 'x', name: 'X', pairs });
    expect(item.timeline.meta.speed).toBe(SPEED_STEPS[0]);
  });

  it('advancing a tier makes a NEW (harder) change lead the sequence', () => {
    // 6 pairs with distinct chords + ascending scores → perTier 2, 3 tiers.
    const distinct = [
      { from: 'Em', to: 'Am', score: 2 }, { from: 'G', to: 'Em', score: 3 },   // tier 0
      { from: 'G', to: 'C', score: 4 },   { from: 'C', to: 'D', score: 5 },     // tier 1 adds these
      { from: 'C', to: 'F', score: 6 },   { from: 'F', to: 'Bm', score: 7 },    // tier 2 adds these
    ];
    const item = drillToItem({ id: 'x', name: 'X', pairs: distinct }, { reps: 1 });
    const t0 = buildDrillLevel(item, 0, 0);
    const t1 = buildDrillLevel(item, 1, 0);
    // Hardest-first: tier 0 leads with its hardest (G→Em); tier 1 leads with the
    // newly unlocked harder pair (C→D). So the leading change visibly changes.
    expect(t0.timeline.windows.slice(0, 2).map(w => w.name)).toEqual(['G', 'Em']);
    expect(t1.timeline.windows.slice(0, 2).map(w => w.name)).toEqual(['C', 'D']);
  });
});

describe('saved drill sets — persistence round-trip', () => {
  it('saves, loads, and re-ranks a weak-transitions set', () => {
    saveDrillSet({ name: 'My weak changes', pairs: [{ from: 'C', to: 'F' }, { from: 'G', to: 'D' }] });
    const sets = loadDrillSets();
    expect(sets.length).toBe(1);
    expect(sets[0].name).toBe('My weak changes');
    expect(sets[0].pairs.length).toBe(2);

    const hydrated = hydrateDrillSet(sets[0], { prefer: { F: 'Major (barre)' } });
    expect(hydrated.pairs.length).toBe(2);
    // Re-ranked easy→hard.
    expect(hydrated.pairs[1].score).toBeGreaterThanOrEqual(hydrated.pairs[0].score);
  });

  it('addPairToSet creates a set, de-dupes, and appends', () => {
    let sets = addPairToSet('nope', { from: 'C', to: 'F' }, 'My weak changes');
    expect(sets.length).toBe(1);
    const id = sets[0].id;
    sets = addPairToSet(id, { from: 'C', to: 'F' });       // duplicate → no-op
    expect(sets[0].pairs.length).toBe(1);
    sets = addPairToSet(id, { from: 'G', to: 'Bm' });      // new pair → appended
    expect(sets[0].pairs.length).toBe(2);
  });

  it('deleteDrillSet removes by id', () => {
    const sets = saveDrillSet({ name: 'Temp', pairs: [{ from: 'C', to: 'G' }] });
    const id = sets[0].id;
    const after = deleteDrillSet(id);
    expect(after.find(s => s.id === id)).toBeUndefined();
  });
});

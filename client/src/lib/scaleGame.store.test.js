// Tests for the Scale Quest store extension (saveScaleRun / bestForScale /
// scaleMastery in scalePractice.js). The point of these is the ADDITIVE contract:
// the game's richer fields must attach without breaking the existing recorder's
// rows, and legacy rows must never inflate a game query.

import { describe, it, expect, beforeEach } from 'vitest';
import { saveScaleRun, bestForScale, scaleMastery } from './scalePractice';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
});

describe('saveScaleRun — additive game fields', () => {
  it('a plain (legacy-shaped) run still saves and reads exactly as before', () => {
    const rec = saveScaleRun({ scale: 'C Major', score: 82, stars: 4, level: 8, grade: 'B', coverage: 90, cleanliness: 80 });
    expect(rec.scale).toBe('C Major');
    expect(rec.score).toBe(82);
    // None of the game fields appear when not supplied.
    expect(rec.box).toBeUndefined();
    expect(rec.mode).toBeUndefined();
    expect(rec.accuracy).toBeUndefined();
  });

  it('attaches the game fields as STRUCTURED data, not label-string-stuffing', () => {
    const rec = saveScaleRun({
      scale: 'A Minor pentatonic', score: 88, stars: 5, level: 9, grade: 'A',
      box: { minFret: 5, maxFret: 8 }, bpm: 92, mode: 'run',
      accuracy: 94, speed: 72, memory: 81, labelsOff: true,
    });
    expect(rec.box).toEqual({ minFret: 5, maxFret: 8 });
    expect(rec.bpm).toBe(92);
    expect(rec.mode).toBe('run');
    expect(rec.accuracy).toBe(94);
    expect(rec.speed).toBe(72);
    expect(rec.memory).toBe(81);
    expect(rec.labelsOff).toBe(true);
    // The scale label is untouched — the box/mode live in their own fields.
    expect(rec.scale).toBe('A Minor pentatonic');
  });
});

describe('bestForScale — filtering ignores legacy rows', () => {
  it('unfiltered, still returns the overall best (legacy behavior intact)', () => {
    saveScaleRun({ scale: 'C Major', score: 60 });
    saveScaleRun({ scale: 'C Major', score: 90 });
    expect(bestForScale('C Major').score).toBe(90);
  });

  it('a box+mode filter returns only matching GAME rows, never legacy ones', () => {
    // A high-scoring legacy row (no box/mode) must NOT satisfy a filtered query.
    saveScaleRun({ scale: 'A Minor pentatonic', score: 99 });                          // legacy, no box
    saveScaleRun({ scale: 'A Minor pentatonic', score: 70, mode: 'run', box: { minFret: 5, maxFret: 8 } });
    saveScaleRun({ scale: 'A Minor pentatonic', score: 85, mode: 'run', box: { minFret: 8, maxFret: 11 } });

    const box58 = bestForScale('A Minor pentatonic', { mode: 'run', box: { minFret: 5, maxFret: 8 } });
    expect(box58.score).toBe(70); // NOT the 99 legacy row, NOT the other box
    const box811 = bestForScale('A Minor pentatonic', { mode: 'run', box: { minFret: 8, maxFret: 11 } });
    expect(box811.score).toBe(85);
  });

  it('backfills stars for a legacy row that predates the star grade', () => {
    saveScaleRun({ scale: 'E Blues', score: 72 }); // no stars field
    expect(bestForScale('E Blues').stars).toBe(4); // scoreToStars(72) = 4
  });
});

describe('scaleMastery — the honest crown', () => {
  it('is 0 until BOTH run and hunt have been played (never overstates)', () => {
    saveScaleRun({ scale: 'A Minor pentatonic', score: 95, stars: 5, mode: 'run', box: { minFret: 5, maxFret: 8 } });
    // Great run score, but no hunt run yet → crown stays 0.
    expect(scaleMastery('A Minor pentatonic').crown).toBe(0);
    expect(scaleMastery('A Minor pentatonic').runStars).toBe(5);
    expect(scaleMastery('A Minor pentatonic').huntStars).toBe(0);
  });

  it('crown is the MIN of run and hunt stars once both exist', () => {
    saveScaleRun({ scale: 'A Minor pentatonic', score: 95, stars: 5, mode: 'run', box: { minFret: 5, maxFret: 8 } });
    saveScaleRun({ scale: 'A Minor pentatonic', score: 60, stars: 3, mode: 'hunt', box: { minFret: 5, maxFret: 8 } });
    const m = scaleMastery('A Minor pentatonic');
    expect(m.runStars).toBe(5);
    expect(m.huntStars).toBe(3);
    expect(m.crown).toBe(3); // you've mastered it only as well as your weaker mode
  });

  it('legacy rows (no mode) can’t inflate the crown', () => {
    saveScaleRun({ scale: 'A Minor pentatonic', score: 100, stars: 5 }); // legacy, no mode
    expect(scaleMastery('A Minor pentatonic').crown).toBe(0);
  });

  it('clearedBpm is the highest tempo tier passed at >=4 stars in run mode', () => {
    saveScaleRun({ scale: 'A Minor pentatonic', score: 90, stars: 5, mode: 'run', bpm: 80 });
    saveScaleRun({ scale: 'A Minor pentatonic', score: 88, stars: 4, mode: 'run', bpm: 100 });
    saveScaleRun({ scale: 'A Minor pentatonic', score: 50, stars: 2, mode: 'run', bpm: 120 }); // failed tier
    expect(scaleMastery('A Minor pentatonic').clearedBpm).toBe(100); // 120 not cleared
  });
});

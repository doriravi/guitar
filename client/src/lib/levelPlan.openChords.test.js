import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  advanceForRecording,
  healOpenChordsFalseCompletion,
  loadManual,
  setManualDone,
  RECORDING_PASS_STARS,
} from './levelPlan';

// Regression: an earlier build completed "Learn your first open chords (C A G E D)"
// on the FIRST single passing chord recording of ANY name. The step lists five
// chords, so one good take must NOT complete it — only all five mastered should.
// And a stored false-completion from the old build must self-heal once.

const REQUIRED = ['C', 'A', 'G', 'E', 'D'];
const PASS = RECORDING_PASS_STARS + 1; // a passing take (stars strictly above the bar)

describe('open-chords milestone auto-advance (chord recordings)', () => {
  let mem;
  beforeEach(() => {
    mem = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    });
  });

  it('does NOT complete on a single passing chord', () => {
    const mastered = new Set(['C']); // only one of five recorded/mastered
    const advanced = advanceForRecording({
      kind: 'chord', name: 'C', stars: PASS,
      isChordMastered: (c) => mastered.has(c),
    });
    expect(advanced).toBe(null);
    expect(loadManual()['beg-open-chords']).toBeFalsy();
  });

  it('does NOT complete when four of five are mastered', () => {
    const mastered = new Set(['C', 'A', 'G', 'E']); // missing D
    const advanced = advanceForRecording({
      kind: 'chord', name: 'E', stars: PASS,
      isChordMastered: (c) => mastered.has(c),
    });
    expect(advanced).toBe(null);
    expect(loadManual()['beg-open-chords']).toBeFalsy();
  });

  it('completes only once ALL five are mastered', () => {
    const mastered = new Set(REQUIRED); // the just-saved take completes the set
    const advanced = advanceForRecording({
      kind: 'chord', name: 'D', stars: PASS,
      isChordMastered: (c) => mastered.has(c),
    });
    expect(advanced).toBe('beg-open-chords');
    expect(loadManual()['beg-open-chords']).toBe(true);
  });

  it('ignores an off-list chord even if the rest are mastered', () => {
    // Bb isn't one of C/A/G/E/D; a good Bb take must never touch this step.
    const mastered = new Set([...REQUIRED, 'Bb']);
    const advanced = advanceForRecording({
      kind: 'chord', name: 'Bb', stars: PASS,
      isChordMastered: (c) => mastered.has(c),
    });
    expect(advanced).toBe(null);
  });

  it('a weak take never advances, even with all five mastered', () => {
    const mastered = new Set(REQUIRED);
    const advanced = advanceForRecording({
      kind: 'chord', name: 'D', stars: RECORDING_PASS_STARS, // NOT above the bar
      isChordMastered: (c) => mastered.has(c),
    });
    expect(advanced).toBe(null);
  });

  it('without an isChordMastered predicate, a chord recording advances nothing', () => {
    const advanced = advanceForRecording({ kind: 'chord', name: 'D', stars: PASS });
    expect(advanced).toBe(null);
  });

  it('a passing scale recording still completes its (single) milestone', () => {
    expect(advanceForRecording({ kind: 'scale', name: 'A Pentatonic Minor', stars: PASS }))
      .toBe('int-pentatonic');
    expect(advanceForRecording({ kind: 'scale', name: 'C Major', stars: PASS }))
      .toBe('int-major-scale');
  });
});

describe('heal of the stored false completion', () => {
  let mem;
  beforeEach(() => {
    mem = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    });
  });

  it('clears an unearned tick (no chords mastered, drill not passed)', () => {
    setManualDone('beg-open-chords', true);
    expect(loadManual()['beg-open-chords']).toBe(true);
    const healed = healOpenChordsFalseCompletion({}, () => false);
    expect(healed).toBe(true);
    expect(loadManual()['beg-open-chords']).toBeFalsy();
  });

  it('keeps a genuinely-earned tick (all five mastered)', () => {
    setManualDone('beg-open-chords', true);
    const healed = healOpenChordsFalseCompletion({}, () => true); // every chord mastered
    expect(healed).toBe(false);
    expect(loadManual()['beg-open-chords']).toBe(true);
  });

  it('runs only once — a re-tick after heal is not cleared again', () => {
    setManualDone('beg-open-chords', true);
    expect(healOpenChordsFalseCompletion({}, () => false)).toBe(true);
    // User (or a real completion) sets it again later; the one-shot heal must not fire.
    setManualDone('beg-open-chords', true);
    expect(healOpenChordsFalseCompletion({}, () => false)).toBe(false);
    expect(loadManual()['beg-open-chords']).toBe(true);
  });

  it('is a no-op when nothing was ticked', () => {
    expect(healOpenChordsFalseCompletion({}, () => false)).toBe(false);
  });
});

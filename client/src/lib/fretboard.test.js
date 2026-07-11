// Unit tests for the chord-TRANSITION scorer (scoreTransition) and the
// existing transitionDifficulty it builds on. Run with `npm test` (Vitest).
//
// The headline acceptance criterion from the feature request:
//   G→C must score EASIER than C→F(barre).
//
// Shapes come straight from the real chord library so the tests exercise the
// exact voicings the app renders, not hand-tuned fixtures.

import { describe, it, expect } from 'vitest';
import { scoreTransition, transitionDifficulty } from './fretboard';
import { CHORDS } from './chords';
import { DEFAULT_PROFILE } from './handProfile';

// Fetch a library voicing by name + type. Several chords have multiple shapes
// (open F vs. barre F), so we pin the type to get the one we want.
function voicing(name, type) {
  const v = CHORDS.find(c => c.name === name && (type ? c.type === type : true));
  if (!v) throw new Error(`test setup: no voicing for ${name} ${type || ''}`);
  return v;
}

const G      = voicing('G', 'Major');
const C      = voicing('C', 'Major');
const D      = voicing('D', 'Major');
const F_easy = voicing('F', 'Major (easy)');
const F_barre = voicing('F', 'Major (barre)');

// A deliberately small hand (~75% of average spans) for personalization tests.
const SMALL_HAND = {
  thumbToIndex:  5.6,
  indexToMiddle: 3.4,
  middleToRing:  2.6,
  ringToLittle:  4.1,
};

describe('scoreTransition — headline acceptance', () => {
  it('G→C is easier to switch than C→F barre', () => {
    const gToC = scoreTransition(G, C, DEFAULT_PROFILE);
    const cToFbarre = scoreTransition(C, F_barre, DEFAULT_PROFILE);
    expect(gToC).toBeLessThan(cToFbarre);
  });

  it('holds on the average hand too (no profile passed)', () => {
    expect(scoreTransition(G, C)).toBeLessThan(scoreTransition(C, F_barre));
  });
});

describe('scoreTransition — output shape', () => {
  it('always returns a 1..10 value rounded to one decimal', () => {
    for (const [a, b] of [[G, C], [C, D], [C, F_barre], [D, F_easy], [G, F_barre]]) {
      const s = scoreTransition(a, b, DEFAULT_PROFILE);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(10);
      expect(Math.round(s * 10) / 10).toBe(s); // one-decimal
    }
  });

  it('accepts a raw notes array as well as a voicing object', () => {
    const fromObjects = scoreTransition(G, C, DEFAULT_PROFILE);
    const fromArrays  = scoreTransition(G.notes, C.notes, DEFAULT_PROFILE);
    expect(fromArrays).toBe(fromObjects);
  });
});

describe('scoreTransition — trivial changes', () => {
  it('a chord to itself is trivial (~1)', () => {
    expect(scoreTransition(C, C, DEFAULT_PROFILE)).toBeLessThanOrEqual(1.5);
  });

  it('an all-open / unfretted side makes the change trivial', () => {
    const openOnly = [{ string: 0, fret: 0 }, { string: 1, fret: 0 }];
    expect(scoreTransition(openOnly, C, DEFAULT_PROFILE)).toBe(1);
    expect(scoreTransition(C, [], DEFAULT_PROFILE)).toBe(1);
  });
});

describe('scoreTransition — hand-profile personalization', () => {
  it('a stretch-heavy change is at least as hard for a small hand as an average one', () => {
    const avg   = scoreTransition(C, F_barre, DEFAULT_PROFILE);
    const small = scoreTransition(C, F_barre, SMALL_HAND);
    expect(small).toBeGreaterThanOrEqual(avg);
  });

  it('a small hand feels a genuinely wide destination shape as strictly harder', () => {
    // D barre (x57775) demands a real 2-fret+ splay — a small hand should pay
    // more to land it than the average hand does, not just tie.
    const Dbarre = voicing('D', 'Major (barre)');
    const avg   = scoreTransition(G, Dbarre, DEFAULT_PROFILE);
    const small = scoreTransition(G, Dbarre, SMALL_HAND);
    expect(small).toBeGreaterThan(avg);
  });

  it('never drops below the population-average base cost for the same change', () => {
    // Personalization only ADDS strain for tighter hands; it must not make a
    // change look easier than the average-hand model says it is.
    const base  = transitionDifficulty(C.notes, F_barre.notes);
    const small = scoreTransition(C, F_barre, SMALL_HAND);
    expect(small).toBeGreaterThanOrEqual(base);
  });
});

describe('transitionDifficulty — anchors still relieve cost (regression)', () => {
  it('a shared common tone lowers a change vs. one where the same shape is moved', () => {
    // Hold the DESTINATION shape's grip constant (both targets are the identical
    // 2-fret span, so calcDifficulty is equal) and vary only whether a note is
    // held on the same string+fret as the source. The anchored change must score
    // no higher — that's the anchor relief, isolated from grip difficulty.
    const src      = [{ string: 3, fret: 2 }, { string: 4, fret: 4 }];
    const shared   = [{ string: 3, fret: 2 }, { string: 4, fret: 4 }]; // identical → anchored
    const moved    = [{ string: 3, fret: 5 }, { string: 4, fret: 7 }]; // same shape, slid up
    expect(transitionDifficulty(src, shared))
      .toBeLessThanOrEqual(transitionDifficulty(src, moved));
  });
});

describe('transitionDifficulty — recalibration regressions', () => {
  // These pin the fixes for the two ways the OLD travel-based model mis-rated
  // real changes. The chord-cell badges in the Progressions view read this
  // function directly, so these guard the badges too.

  it('a switch INTO an F barre is genuinely hard, not trivial', () => {
    // The old model floored C→F(barre) to 1.0 on a shared common tone. Forming a
    // six-string barre is one of the hardest changes a beginner makes.
    expect(transitionDifficulty(C.notes, F_barre.notes)).toBeGreaterThan(5);
  });

  it('a switch into a barre outranks the common open-chord changes', () => {
    // G→C and C→D are the bread-and-butter beginner changes; the old model
    // inflated them above the barre change on phantom nearest-note travel.
    const barre = transitionDifficulty(C.notes, F_barre.notes);
    expect(barre).toBeGreaterThan(transitionDifficulty(G.notes, C.notes));
    expect(barre).toBeGreaterThan(transitionDifficulty(C.notes, D.notes));
  });

  it('a chord to itself is trivial through the base model too', () => {
    expect(transitionDifficulty(C.notes, C.notes)).toBeLessThanOrEqual(1.5);
  });

  it('scoreTransition on the average hand matches the base model', () => {
    // scoreTransition should reduce to transitionDifficulty for an average hand
    // (personalization only kicks in for hands that differ from the default).
    for (const [a, b] of [[G, C], [C, F_barre], [D, F_easy]]) {
      expect(scoreTransition(a, b, DEFAULT_PROFILE))
        .toBe(transitionDifficulty(a.notes, b.notes));
    }
  });
});

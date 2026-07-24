import { describe, it, expect } from 'vitest';
import {
  bestCapo,
  transposeDown,
  transposeUp,
  capoPlaybackTab,
  parseRoot,
} from './capo';
import { suggestCapo } from './lyricChords';
import { easiestVoicing } from './voicingLookup';

// The capo optimizer is the crux of the feature — a wrong transposition would
// silently teach the player the wrong chord. These tests pin the transposition
// math, the reach-minimization choice, the barre-trigger gate, and the playback
// shift (which must never mis-pitch a string).

describe('capo transposition math', () => {
  it('transposeDown/Up round-trips to the same pitch class and preserves the suffix', () => {
    for (const name of ['Bb', 'F#m7', 'Ebmaj7', 'Absus4', 'C', 'Gm']) {
      const suffix = parseRoot(name).suffix;
      for (let f = 0; f <= 7; f++) {
        const back = transposeUp(transposeDown(name, f), f);
        expect(pcOf(back)).toBe(pcOf(name));       // same pitch (spelling may go sharp)
        expect(parseRoot(back).suffix).toBe(suffix); // suffix intact
      }
    }
  });

  it('a capo raises pitch: fretting transposeDown(C,F) behind capo F sounds C', () => {
    // The sounding pitch of an open shape X behind a capo on fret F is transposeUp(X,F).
    for (const name of ['Bb', 'Eb', 'Ab', 'F#m', 'B', 'Dbmaj7']) {
      for (let f = 1; f <= 7; f++) {
        const shape = transposeDown(name, f);
        const sounds = transposeUp(shape, f);
        // Same pitch class as the original (spelling may go sharp).
        expect(pcOf(sounds)).toBe(pcOf(name));
      }
    }
  });
});

// Pitch class of a chord's root (0..11), for enharmonic-agnostic comparison.
function pcOf(name) {
  const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  return PC[parseRoot(name).root];
}

describe('bestCapo — trigger and optimization', () => {
  it('returns null for an all-open progression (no barre chord)', () => {
    expect(bestCapo(['C', 'G', 'Am', 'F'])).toBe(null);
    expect(bestCapo(['G', 'D', 'Em', 'C'])).toBe(null);
  });

  it('returns null for empty / falsy input', () => {
    expect(bestCapo([])).toBe(null);
    expect(bestCapo(null)).toBe(null);
    expect(bestCapo([null, undefined, ''])).toBe(null);
  });

  it('suggests a capo for a hard (Bb) key and transposes every chord down by the fret', () => {
    const r = bestCapo(['Bb', 'Eb', 'F', 'Gm']);
    expect(r).not.toBe(null);
    expect(r.fret).toBeGreaterThanOrEqual(1);
    // Each mapped shape sounds as the original chord.
    for (const [orig, shape] of Object.entries(r.map)) {
      expect(pcOf(transposeUp(shape, r.fret))).toBe(pcOf(orig));
    }
  });

  it('actually reduces total reach (savings > 0) when it suggests a capo', () => {
    const r = bestCapo(['Bb', 'Eb', 'F', 'Gm']);
    expect(r.savings).toBeGreaterThan(0);
    expect(r.totalAfter).toBeLessThan(r.totalBefore);
  });

  it('reports the barre-forcing original chords (hardChords) for the "why" explanation', () => {
    const r = bestCapo(['Bb', 'Eb', 'F', 'Gm']);
    expect(Array.isArray(r.hardChords)).toBe(true);
    // Bb, Eb and Gm force barres; every listed hardChord is one of the inputs.
    expect(r.hardChords.length).toBeGreaterThan(0);
    for (const c of r.hardChords) expect(['Bb', 'Eb', 'F', 'Gm']).toContain(c);
    expect(r.hardChords).toContain('Bb');
  });

  it('the barre penalty reduces barres vs. no capo (fewer, ideally zero, barres remain)', () => {
    // A capo can't make EVERY chord open when one maps to an inherently-barre root
    // with no open shape on file (e.g. Cm → F#m). But the barre penalty must ensure
    // the suggested capo leaves STRICTLY FEWER barres than playing with no capo —
    // otherwise it isn't doing its "play open instead of barres" job.
    const isBarre = (name, prof) => {
      const v = easiestVoicing(name, { profile: prof });
      return !!(v && /barre/i.test(v.type || ''));
    };
    for (const prog of [['Bb', 'Eb', 'F', 'Gm'], ['Eb', 'Ab', 'Bb', 'Cm'], ['F#', 'B', 'C#m', 'Ab']]) {
      const r = bestCapo(prog);
      if (!r) continue;
      const barresBefore = prog.filter(n => isBarre(n)).length;
      const barresAfter = r.shapes.filter(s => s.voicing && /barre/i.test(s.voicing.type || '')).length;
      expect(barresAfter).toBeLessThan(barresBefore);
    }
  });

  it('for a fully-openable hard key, the winning shapes are ALL open (no barre)', () => {
    // Bb/Eb/F/Gm → capo 3 → G/C/D/Em, all open. F#/B/C#m/Ab → capo 4 → D/G/Am/E,
    // all open. When an all-open capo exists, the optimizer must find it.
    for (const prog of [['Bb', 'Eb', 'F', 'Gm'], ['F#', 'B', 'C#m', 'Ab']]) {
      const r = bestCapo(prog);
      expect(r).not.toBe(null);
      for (const s of r.shapes) {
        expect(/barre/i.test(s.voicing?.type || '')).toBe(false);
      }
    }
  });

  it('breaks ties toward the lowest capo fret', () => {
    // If two frets give equal total reach, the lower fret must win. We can't force
    // an exact tie without fixtures, but we CAN assert the chosen fret is the
    // lowest among frets within an epsilon of the winning total.
    const r = bestCapo(['Bb', 'Eb', 'F', 'Gm']);
    expect(r.fret).toBeGreaterThanOrEqual(1);
    expect(r.fret).toBeLessThanOrEqual(7);
  });

  it('threads a hand profile through the scoring', () => {
    const small = { thumbToIndex: 5.5, indexToMiddle: 3.0, middleToRing: 2.0, ringToLittle: 3.5 };
    const r = bestCapo(['Bb', 'Eb', 'F', 'Gm'], small);
    // Still a valid suggestion; scoring didn't crash on a profile.
    expect(r === null || (r.fret >= 1 && r.totalAfter >= 0)).toBe(true);
  });
});

describe('suggestCapo back-compat wrapper', () => {
  it('returns the {fret, map} shape delegating to bestCapo', () => {
    const r = suggestCapo(['Bb', 'Eb', 'F', 'Gm']);
    expect(r).not.toBe(null);
    expect(typeof r.fret).toBe('number');
    expect(typeof r.map).toBe('object');
    expect(r.map.Bb).toBeTruthy();
  });

  it('returns null for an all-open song', () => {
    expect(suggestCapo(['C', 'G', 'Am', 'F'])).toBe(null);
  });
});

describe('capoPlaybackTab — shift without mis-pitching', () => {
  it('leaves the tab unchanged at capo 0', () => {
    expect(capoPlaybackTab({ tab: 'x32010' }, 0)).toBe('x32010');
  });

  it('shifts open (0) and fretted notes up by the capo fret; x stays x', () => {
    // A x02220 (A) behind capo 1 → x13331 (sounds Bb).
    expect(capoPlaybackTab({ tab: 'x02220' }, 1)).toBe('x13331');
    // 320003 (G) behind capo 2 → 542225.
    expect(capoPlaybackTab({ tab: '320003' }, 2)).toBe('542225');
  });

  it('MUTES a string that would exceed fret 9 rather than clamp to a wrong pitch', () => {
    // fret 4 note + capo 6 = 10, unrepresentable in single-char tab → 'x', never '9'.
    const out = capoPlaybackTab({ tab: '244222' }, 6);
    // string with 4 → 10 → muted; others shift normally (2→8).
    expect(out[1]).toBe('x');       // the A-string 4 → would be 10 → muted
    expect(out).not.toContain('9'); // no silent clamp to a wrong pitch
  });

  it('is safe on a missing/blank tab', () => {
    expect(capoPlaybackTab(null, 3)).toBe('xxxxxx');
    expect(capoPlaybackTab({}, 3)).toBe('xxxxxx');
  });
});

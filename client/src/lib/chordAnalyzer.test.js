// Vitest spec for chordAnalyzer — parity with the Python unittests in
// vision/test_chord_analyzer.py (same fixtures, adapted to { string, fret }).
//
// String convention (matches the app): 0=low E, 1=A, 2=D, 3=G, 4=B, 5=high e.
// A fret of -1 means "muted / not played" and is ignored.

import { describe, it, expect } from 'vitest';
import {
  detectChord,
  pitchClasses,
  positionToMidi,
  positionToPitchClass,
} from './chordAnalyzer';

// Small helper so fixtures read like the Python (string, fret) tuples.
const p = (string, fret) => ({ string, fret });

describe('position math', () => {
  it('open strings map to the tuning pitches', () => {
    expect(positionToMidi(p(0, 0))).toBe(40); // low E2
    expect(positionToMidi(p(1, 0))).toBe(45); // A2
    expect(positionToMidi(p(5, 0))).toBe(64); // high e4
  });

  it('frets raise the pitch', () => {
    expect(positionToMidi(p(0, 5))).toBe(45);  // 5th fret low E = A2
    expect(positionToMidi(p(0, 12))).toBe(52); // 12th fret = octave up
  });

  it('computes pitch classes', () => {
    expect(positionToPitchClass(p(0, 0))).toBe(4); // E
    expect(positionToPitchClass(p(1, 0))).toBe(9); // A
    expect(positionToPitchClass(p(2, 0))).toBe(2); // D
  });

  it('rejects an out-of-range string', () => {
    expect(() => positionToMidi(p(6, 0))).toThrow();
    expect(() => positionToMidi(p(-1, 0))).toThrow();
  });

  it('ignores muted positions in pitch classes', () => {
    // low-E open -> E(4); A-string muted -> dropped; D-string 2nd fret -> E(4).
    // Both sounding notes are E, so the distinct set is just {4}.
    const pcs = pitchClasses([p(0, 0), p(1, -1), p(2, 2)]);
    expect(pcs).toEqual(new Set([4]));
  });
});

describe('major chords', () => {
  it('E major open (022100)', () => {
    expect(detectChord([p(0, 0), p(1, 2), p(2, 2), p(3, 1), p(4, 0), p(5, 0)])).toBe('E');
  });
  it('A major open (x02220)', () => {
    expect(detectChord([p(1, 0), p(2, 2), p(3, 2), p(4, 2), p(5, 0)])).toBe('A');
  });
  it('C major open (x32010)', () => {
    expect(detectChord([p(1, 3), p(2, 2), p(3, 0), p(4, 1), p(5, 0)])).toBe('C');
  });
  it('G major open (320003)', () => {
    expect(detectChord([p(0, 3), p(1, 2), p(2, 0), p(3, 0), p(4, 0), p(5, 3)])).toBe('G');
  });
  it('D major open (xx0232)', () => {
    expect(detectChord([p(2, 0), p(3, 2), p(4, 3), p(5, 2)])).toBe('D');
  });
  it('bare C major triad by pitch classes', () => {
    expect(detectChord([p(1, 3), p(0, 0), p(2, 5)])).toBe('C');
  });
});

describe('minor chords', () => {
  it('A minor open (x02210)', () => {
    expect(detectChord([p(1, 0), p(2, 2), p(3, 2), p(4, 1), p(5, 0)])).toBe('Am');
  });
  it('E minor open (022000)', () => {
    expect(detectChord([p(0, 0), p(1, 2), p(2, 2), p(3, 0), p(4, 0), p(5, 0)])).toBe('Em');
  });
  it('D minor open (xx0231)', () => {
    expect(detectChord([p(2, 0), p(3, 2), p(4, 3), p(5, 1)])).toBe('Dm');
  });
  it('a minor triad is not reported as major', () => {
    expect(detectChord([p(1, 0), p(2, 2), p(3, 2), p(4, 1), p(5, 0)])).not.toBe('A');
  });
});

describe('dominant 7th chords', () => {
  it('G7 open (320001)', () => {
    expect(detectChord([p(0, 3), p(1, 2), p(2, 0), p(3, 0), p(4, 0), p(5, 1)])).toBe('G7');
  });
  it('C7 pitch classes (C E G Bb)', () => {
    expect(detectChord([p(1, 3), p(0, 0), p(2, 5), p(3, 3)])).toBe('C7');
  });
  it('dom7 is preferred over major (G7 not G)', () => {
    expect(detectChord([p(0, 3), p(1, 2), p(2, 0), p(3, 0), p(4, 0), p(5, 1)])).not.toBe('G');
  });
});

describe('enharmonic + edge cases', () => {
  it('uses sharp root spelling (F#, not Gb)', () => {
    // F# major: F#, A#, C#. F#(0,2), A#(0,6), C#(1,4).
    expect(detectChord([p(0, 2), p(0, 6), p(1, 4)])).toBe('F#');
  });
  it('empty positions -> null', () => {
    expect(detectChord([])).toBeNull();
  });
  it('all muted -> null', () => {
    expect(detectChord([p(0, -1), p(1, -1), p(2, -1)])).toBeNull();
  });
  it('a single note is not a chord', () => {
    expect(detectChord([p(0, 0)])).toBeNull();
  });
  it('an unrecognized cluster -> null', () => {
    // C, C#, D matches no major/minor/dom7 template.
    expect(detectChord([p(1, 3), p(1, 4), p(1, 5)])).toBeNull();
  });
  it('duplicate notes do not break the match (E major)', () => {
    expect(detectChord([p(0, 0), p(3, 1), p(1, 2), p(5, 0)])).toBe('E');
  });
});

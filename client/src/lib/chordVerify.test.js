// Vitest spec for chordVerify — the camera×mic fusion logic.
//
// Target used throughout: A minor, tab "x02210" (E=x A=0 D=2 G=2 B=1 e=0).
// Its fretted `notes` (opens/mutes excluded) are:
//   string 2 (D) fret 2, string 3 (G) fret 2, string 4 (B) fret 1.

import { describe, it, expect } from 'vitest';
import {
  expectedPositions,
  compareShape,
  fuseVerdict,
  verdictToMarks,
} from './chordVerify';

const AM = {
  name: 'Am',
  tab: 'x02210',
  notes: [
    { string: 2, fret: 2 },
    { string: 3, fret: 2 },
    { string: 4, fret: 1 },
  ],
};

// A perfect mic reading for Am: the 3 fretted strings + the 2 open strings all
// 'correct', muted low-E 'muted'. Matches evaluateStrings' shape.
const micAllCorrect = [
  { string: 0, expected: 'muted', status: 'muted' },
  { string: 1, expected: 'play', status: 'correct', fret: 0 },
  { string: 2, expected: 'play', status: 'correct', fret: 2 },
  { string: 3, expected: 'play', status: 'correct', fret: 2 },
  { string: 4, expected: 'play', status: 'correct', fret: 1 },
  { string: 5, expected: 'play', status: 'correct', fret: 0 },
];

describe('expectedPositions', () => {
  it('returns the fretted notes only', () => {
    expect(expectedPositions(AM)).toEqual([
      { string: 2, fret: 2 },
      { string: 3, fret: 2 },
      { string: 4, fret: 1 },
    ]);
  });
  it('handles a target with no notes', () => {
    expect(expectedPositions({ name: 'X' })).toEqual([]);
  });
});

describe('compareShape', () => {
  const camAm = [
    { string: 2, fret: 2 },
    { string: 3, fret: 2 },
    { string: 4, fret: 1 },
  ];

  it('matches a correct Am shape', () => {
    const r = compareShape(camAm, AM);
    expect(r.isShapeMatch).toBe(true);
    expect(r.matchedStrings).toEqual([2, 3, 4]);
    expect(r.wrongStrings).toEqual([]);
    expect(r.missingStrings).toEqual([]);
  });

  it('flags a wrong fret on one string', () => {
    const cam = [
      { string: 2, fret: 2 },
      { string: 3, fret: 3 }, // wrong
      { string: 4, fret: 1 },
    ];
    const r = compareShape(cam, AM);
    expect(r.isShapeMatch).toBe(false);
    expect(r.wrongStrings).toEqual([3]);
  });

  it('flags a missing string', () => {
    const cam = [
      { string: 2, fret: 2 },
      { string: 4, fret: 1 },
    ];
    const r = compareShape(cam, AM);
    expect(r.isShapeMatch).toBe(false);
    expect(r.missingStrings).toEqual([3]);
  });

  it('flags an extra fretted string', () => {
    const cam = [
      { string: 2, fret: 2 },
      { string: 3, fret: 2 },
      { string: 4, fret: 1 },
      { string: 5, fret: 3 }, // extra
    ];
    const r = compareShape(cam, AM);
    expect(r.extraStrings).toEqual([5]);
    expect(r.isShapeMatch).toBe(true); // all expected strings still matched
  });
});

describe('fuseVerdict', () => {
  const goodShape = compareShape(AM.notes, AM);

  it('status "both" when camera and mic agree on the target', () => {
    const v = fuseVerdict({
      cameraChord: 'Am',
      cameraShape: goodShape,
      micChord: 'Am',
      micStringResults: micAllCorrect,
      targetName: 'Am',
    });
    expect(v.status).toBe('both');
    expect(v.agree).toBe(true);
  });

  it('status "shape-only" — correct fingering but a muted string (headline case)', () => {
    // Camera shape is perfect, but the mic reports string 4 (B) didn't sound.
    const micMutedB = micAllCorrect.map((r) =>
      r.string === 4 ? { ...r, status: 'missing' } : r,
    );
    const v = fuseVerdict({
      cameraChord: 'Am',
      cameraShape: goodShape,
      micChord: null, // the chord didn't ring cleanly as Am
      micStringResults: micMutedB,
      targetName: 'Am',
    });
    expect(v.status).toBe('shape-only');
    expect(v.agree).toBe(false);
    // The reason should call out string 'B' (string index 4) as not sounding.
    expect(v.reason).toContain('B');
    // And the marks should paint string 4 as 'weak' (shaped ok, didn't sound).
    expect(verdictToMarks(v.perString)[4]).toBe('weak');
  });

  it('status "sound-only" when the camera can\'t read the hand', () => {
    const emptyShape = compareShape([], AM);
    const v = fuseVerdict({
      cameraChord: null,
      cameraShape: emptyShape,
      micChord: 'Am',
      micStringResults: micAllCorrect,
      targetName: 'Am',
    });
    expect(v.status).toBe('sound-only');
    expect(v.reason.toLowerCase()).toContain('reposition');
  });

  it('status "none" when neither sensor matches', () => {
    const wrongShape = compareShape([{ string: 2, fret: 5 }], AM);
    const v = fuseVerdict({
      cameraChord: 'C',
      cameraShape: wrongShape,
      micChord: 'C',
      micStringResults: micAllCorrect.map((r) => ({ ...r, status: 'wrong' })),
      targetName: 'Am',
    });
    expect(v.status).toBe('none');
    expect(v.agree).toBe(false);
  });

  it('shape channel accepts a name match even without a full shape match', () => {
    // Camera reports the right NAME (an alternate voicing) but shape diff is
    // partial — name equality still counts the fingering as right.
    const partial = compareShape([{ string: 2, fret: 2 }], AM);
    const v = fuseVerdict({
      cameraChord: 'Am',
      cameraShape: partial,
      micChord: 'Am',
      micStringResults: micAllCorrect,
      targetName: 'Am',
    });
    expect(v.status).toBe('both');
  });
});

describe('verdictToMarks', () => {
  it('marks wrong/missing camera strings red (missing) and dead-sounding ok strings amber (weak)', () => {
    const perString = [
      { string: 2, label: 'D', cam: 'ok', mic: 'correct' },
      { string: 3, label: 'G', cam: 'wrong', mic: 'wrong' },
      { string: 4, label: 'B', cam: 'ok', mic: 'muted' },
    ];
    const marks = verdictToMarks(perString);
    expect(marks[3]).toBe('missing');
    expect(marks[4]).toBe('weak');
    expect(marks[2]).toBeUndefined();
  });
});

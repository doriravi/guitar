// Vitest spec for scaleGame — the Scale Quest scoring + box math.
//
// The load-bearing tests here check against real guitar facts (unison-string
// collisions, canonical box pitches, scale-run order), not the implementation's
// own arithmetic. The boxIsUnambiguous test is SHIP-BLOCKING: it encodes the
// exact error the design critique caught (a "clean" starter box that wasn't).

import { describe, it, expect } from 'vitest';
import {
  fretMidiExact,
  boxIsUnambiguous,
  scaleSetOf,
  scaleBoxes,
  buildTargetSequence,
  alignOrdered,
  gradeScaleRunOrdered,
  scoreSpeed,
  scoreFretboardMemory,
  scoreScaleTrack,
  makeNoteCapture,
  midiMatches,
  SCALE_UNLOCK_ORDER,
} from './scaleGame';
import { OPEN_STRING_MIDI, NOTE_NAMES } from './chordAnalyzer';
import { SCALE_LABELS } from './improvEngine';

const A = 9, C = 0, E = 4;

describe('fretMidiExact — agrees with the app tuning table', () => {
  it('open strings are the open-string MIDI', () => {
    for (let s = 0; s < 6; s++) expect(fretMidiExact(s, 0)).toBe(OPEN_STRING_MIDI[s]);
  });
  it('the 5th-fret tuning trick: string N fret 5 == string N+1 open (except G→B)', () => {
    expect(fretMidiExact(0, 5)).toBe(fretMidiExact(1, 0)); // low E fret 5 = A
    expect(fretMidiExact(1, 5)).toBe(fretMidiExact(2, 0)); // A fret 5 = D
    expect(fretMidiExact(2, 5)).toBe(fretMidiExact(3, 0)); // D fret 5 = G
    // G→B is the 4-semitone exception: G fret 4 = B open.
    expect(fretMidiExact(3, 4)).toBe(fretMidiExact(4, 0));
  });
});

describe('boxIsUnambiguous — THE SHIP-BLOCKING honesty check', () => {
  const minPentA = scaleSetOf(A, 'minorPentatonic'); // A C D E G

  it('PASSES the verified clean starter box (A minor pentatonic, frets 5–8)', () => {
    const r = boxIsUnambiguous({ minFret: 5, maxFret: 8 }, minPentA);
    expect(r.ok).toBe(true);
    expect(r.collisions).toEqual([]);
  });

  it('FAILS the 5–9 box the design almost shipped — it hides a unison', () => {
    // G-string 9th fret and B-string 5th fret are BOTH E4 (MIDI 64), the classic
    // guitar unison. Two experts recommended this box; the critique caught it.
    // Hearing E4 can't tell which cell you played, so position scoring here lies.
    const r = boxIsUnambiguous({ minFret: 5, maxFret: 9 }, minPentA);
    expect(r.ok).toBe(false);
    const e4 = r.collisions.find((c) => c.midi === 64);
    expect(e4).toBeTruthy();
    const cells = e4.cells.map((c) => `${c.string}:${c.fret}`).sort();
    expect(cells).toEqual(['3:9', '4:5']); // G-string f9, B-string f5
  });

  it('the collision it reports is a REAL same-pitch pair, re-derived from tuning', () => {
    const r = boxIsUnambiguous({ minFret: 5, maxFret: 9 }, minPentA);
    for (const col of r.collisions) {
      for (const cell of col.cells) {
        expect(fretMidiExact(cell.string, cell.fret)).toBe(col.midi);
      }
      expect(col.cells.length).toBeGreaterThan(1);
    }
  });

  it('full diatonic scales collide often (why v1 is pentatonic-first)', () => {
    // The scope-truth the design commits to: mid-neck diatonic boxes usually have
    // a unison. This asserts the general fact, not a single box.
    const cMajor = scaleSetOf(C, 'major');
    let collided = 0, total = 0;
    for (let minFret = 2; minFret <= 10; minFret++) {
      total++;
      if (!boxIsUnambiguous({ minFret, maxFret: minFret + 4 }, cMajor).ok) collided++;
    }
    expect(collided).toBeGreaterThan(total / 2); // majority collide
  });
});

describe('scaleBoxes', () => {
  it('offers boxes with a clean flag, and at least one clean pentatonic box exists', () => {
    const boxes = scaleBoxes(A, 'minorPentatonic');
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.some((b) => b.clean)).toBe(true);
    // Every box's clean flag matches a fresh boxIsUnambiguous call (no drift).
    const set = scaleSetOf(A, 'minorPentatonic');
    for (const b of boxes) {
      expect(b.clean).toBe(boxIsUnambiguous({ minFret: b.minFret, maxFret: b.maxFret }, set).ok);
    }
  });
  it('returns null for an unknown scale', () => {
    expect(scaleBoxes(0, 'notAScale')).toBeNull();
  });
});

describe('buildTargetSequence', () => {
  const box = { minFret: 5, maxFret: 8 };

  it('a run ascends by pitch then descends (one up-and-down lap)', () => {
    const seq = buildTargetSequence(A, 'minorPentatonic', { box, mode: 'run' });
    const midi = seq.map((t) => t.midi);
    // Find the turnaround: strictly rising then strictly falling.
    const peak = midi.indexOf(Math.max(...midi));
    for (let i = 1; i <= peak; i++) expect(midi[i]).toBeGreaterThan(midi[i - 1]);
    for (let i = peak + 1; i < midi.length; i++) expect(midi[i]).toBeLessThan(midi[i - 1]);
    // The top note isn't played twice in a row at the turnaround.
    expect(midi[peak]).not.toBe(midi[peak + 1]);
  });

  it('every target note is in the scale and in the box', () => {
    const set = scaleSetOf(A, 'minorPentatonic');
    const seq = buildTargetSequence(A, 'minorPentatonic', { box, mode: 'run' });
    for (const t of seq) {
      expect(set.has(((t.midi % 12) + 12) % 12)).toBe(true);
      expect(t.fret).toBeGreaterThanOrEqual(box.minFret);
      expect(t.fret).toBeLessThanOrEqual(box.maxFret);
      expect(t.midi).toBe(fretMidiExact(t.string, t.fret));
    }
  });

  it('marks twins in a colliding box and none in a clean box', () => {
    const cleanSeq = buildTargetSequence(A, 'minorPentatonic', { box: { minFret: 5, maxFret: 8 } });
    expect(cleanSeq.every((t) => t.octaveUnique && t.twins.length === 0)).toBe(true);
    const dirtySeq = buildTargetSequence(A, 'minorPentatonic', { box: { minFret: 5, maxFret: 9 } });
    expect(dirtySeq.some((t) => !t.octaveUnique && t.twins.length > 0)).toBe(true);
  });

  it('hunt order is deterministic (same seed → same order, no Math.random)', () => {
    const a = buildTargetSequence(A, 'minorPentatonic', { box, mode: 'hunt', seed: 7 });
    const b = buildTargetSequence(A, 'minorPentatonic', { box, mode: 'hunt', seed: 7 });
    expect(a.map((t) => `${t.string}:${t.fret}`)).toEqual(b.map((t) => `${t.string}:${t.fret}`));
    // A hunt visits every box cell exactly once.
    expect(new Set(a.map((t) => `${t.string}:${t.fret}`)).size).toBe(a.length);
  });

  it('labels degrees relative to the root (R on the tonic)', () => {
    const seq = buildTargetSequence(A, 'minorPentatonic', { box, mode: 'run' });
    for (const t of seq) {
      if (((t.midi % 12) + 12) % 12 === A) expect(t.degree).toBe('R');
    }
    // A minor pentatonic degrees are R b3 4 5 b7.
    const degs = new Set(seq.map((t) => t.degree));
    expect([...degs].sort()).toEqual(['4', '5', 'R', 'b3', 'b7']);
  });
});

describe('alignOrdered — order matters', () => {
  it('perfect in-order play scores 1', () => {
    const t = [40, 43, 45, 47];
    expect(alignOrdered(t, t).orderMatch).toBe(1);
  });
  it('right notes, WRONG order scores below 1 (a scale run must be in order)', () => {
    const target = [40, 43, 45, 47];
    const scrambled = [47, 45, 43, 40]; // all right notes, fully reversed
    const r = alignOrdered(scrambled, target);
    expect(r.orderMatch).toBeLessThan(1);
    // Longest in-order common subsequence of a reversal is 1.
    expect(r.matched).toBe(1);
  });
  it('missing notes lower the match', () => {
    expect(alignOrdered([40, 45], [40, 43, 45, 47]).orderMatch).toBe(0.5);
  });
  it('extra wrong notes between correct ones don’t break the in-order run', () => {
    const r = alignOrdered([40, 99, 43, 98, 45], [40, 43, 45]);
    expect(r.matched).toBe(3);
    expect(r.orderMatch).toBe(1);
  });
  it('empty target is a safe 0', () => {
    expect(alignOrdered([40], []).orderMatch).toBe(0);
  });
});

describe('gradeScaleRunOrdered — accuracy blend', () => {
  const scaleSet = scaleSetOf(A, 'minorPentatonic');
  const targets = buildTargetSequence(A, 'minorPentatonic', { box: { minFret: 5, maxFret: 8 }, mode: 'run' });

  it('a clean in-order run of the exact targets scores near-perfect', () => {
    const played = targets.map((t) => ({ midi: t.midi }));
    const r = gradeScaleRunOrdered(played, targets, { rootPc: A, scaleSet });
    expect(r.orderMatch).toBe(1);
    expect(r.coverage).toBe(1);
    expect(r.purity).toBe(1);
    expect(r.accuracy).toBeCloseTo(1, 5);
  });

  it('out-of-scale notes drop purity', () => {
    const played = [...targets.map((t) => ({ midi: t.midi })), { midi: A + 1 + 48 }]; // a chromatic stray
    const r = gradeScaleRunOrdered(played, targets, { rootPc: A, scaleSet });
    expect(r.purity).toBeLessThan(1);
  });

  it('detects tonic landing (first and last note = root)', () => {
    const rootMidi = fretMidiExact(0, 5); // A on low E, fret 5
    const landed = [{ midi: rootMidi }, { midi: rootMidi + 3 }, { midi: rootMidi }];
    expect(gradeScaleRunOrdered(landed, targets, { rootPc: A, scaleSet }).tonicLanded).toBe(true);
    const notLanded = [{ midi: rootMidi + 3 }, { midi: rootMidi }];
    expect(gradeScaleRunOrdered(notLanded, targets, { rootPc: A, scaleSet }).tonicLanded).toBe(false);
  });

  it('handles an empty run without throwing', () => {
    const r = gradeScaleRunOrdered([], targets, { rootPc: A, scaleSet });
    expect(r.accuracy).toBe(0);
  });
});

describe('scoreSpeed', () => {
  it('on-tempo, even playing scores high', () => {
    // 8 notes, one every 250ms = 4 nps, target 4 nps, perfectly even.
    const onsets = Array.from({ length: 8 }, (_, i) => i * 250);
    const r = scoreSpeed(onsets, { targetNps: 4, runDurationMs: 2000 });
    expect(r.tempoRatio).toBeCloseTo(1, 2);
    expect(r.tempoStability).toBeGreaterThan(0.9);
    expect(r.speed).toBeGreaterThan(0.9);
  });
  it('too slow lowers tempoRatio but doesn’t crash', () => {
    const onsets = [0, 500, 1000]; // 3 notes in 2s = 1.5 nps vs target 4
    const r = scoreSpeed(onsets, { targetNps: 4, runDurationMs: 2000 });
    expect(r.tempoRatio).toBeLessThan(0.5);
  });
  it('uneven timing (rushing/dragging) lowers stability', () => {
    const even = scoreSpeed([0, 250, 500, 750, 1000], { targetNps: 4, runDurationMs: 1000 });
    const jerky = scoreSpeed([0, 60, 500, 560, 1000], { targetNps: 4, runDurationMs: 1000 });
    expect(jerky.tempoStability).toBeLessThan(even.tempoStability);
  });
  it('faster-but-past-target never exceeds ratio 1 (sloppy speed ≠ better)', () => {
    const onsets = Array.from({ length: 20 }, (_, i) => i * 50); // 20 nps, way over
    expect(scoreSpeed(onsets, { targetNps: 4, runDurationMs: 1000 }).tempoRatio).toBe(1);
  });
});

describe('scoreFretboardMemory — nested so all factors must be present', () => {
  it('all three high → high memory', () => {
    const r = scoreFretboardMemory({ octaveMatch: 1, orderMatch: 1, tempoStability: 1 });
    expect(r.memory).toBeCloseTo(1, 5);
    expect(r.region).toBe('in-box');
  });
  it('wrong octave (=lost the position) tanks memory even with perfect order/time', () => {
    const r = scoreFretboardMemory({ octaveMatch: 0.2, orderMatch: 1, tempoStability: 1 });
    expect(r.memory).toBeLessThan(0.25);
    expect(r.region).toBe('drifting');
  });
  it('a right-but-slow run doesn’t zero (floors)', () => {
    const r = scoreFretboardMemory({ octaveMatch: 1, orderMatch: 1, tempoStability: 0 });
    expect(r.memory).toBeGreaterThan(0.4); // 1 * 1 * 0.5
  });
});

describe('scoreScaleTrack — reuses star thresholds + applies pass caps', () => {
  it('maps to the app’s existing star bands, no new thresholds', () => {
    expect(scoreScaleTrack(0.9).stars).toBe(5);  // >=85
    expect(scoreScaleTrack(0.5).stars).toBe(2);  // 40..54
  });
  it('caps a great score when the player sprayed out-of-scale notes', () => {
    // Cap sits just below the 3-star (C) band floor of 55, so a spray run can't
    // reach a passing star grade no matter how clean the order was.
    const r = scoreScaleTrack(0.95, { purity: 0.5 });
    expect(r.score).toBeLessThanOrEqual(54);
    expect(r.stars).toBeLessThan(3);
    expect(r.capped).toMatch(/scale/);
  });
  it('caps to B when the order was wrong (a scale run must be in order)', () => {
    const r = scoreScaleTrack(0.95, { orderMatch: 0.5 });
    expect(r.score).toBeLessThanOrEqual(69);
    expect(r.stars).toBeLessThan(5);
    expect(r.capped).toMatch(/order/);
  });
  it('caps when the tonic wasn’t landed in a landing drill', () => {
    const r = scoreScaleTrack(0.95, { tonicRequired: true, tonicLanded: false });
    expect(r.score).toBeLessThanOrEqual(69);
  });
  it('no caps → the score passes through', () => {
    expect(scoreScaleTrack(0.9, { purity: 1, orderMatch: 1 }).capped).toBeNull();
  });
});

describe('makeNoteCapture — the ring-over defense', () => {
  // Helper: feed a list of frames, collect the committed notes.
  const run = (cap, frames) => frames.map((f) => cap.push(f)).filter(Boolean);
  // A frame: pitch held, moderate level. onset marks a fresh attack.
  const F = (midi, { onset = false, rms = 0.2, tMs = 0 } = {}) => ({ midi, rms, onset, tMs });

  it('commits one note per plucked attack, not once per ringing frame', () => {
    const cap = makeNoteCapture();
    // One pluck of MIDI 45 that rings for many frames.
    const frames = [
      F(45, { onset: true, tMs: 0 }),
      ...Array.from({ length: 20 }, (_, i) => F(45, { tMs: 20 + i * 10 })),
    ];
    const out = run(cap, frames);
    expect(out).toHaveLength(1);
    expect(out[0].midi).toBe(45);
  });

  it('commits a new note on the NEXT attack even while the old one rings under it', () => {
    // The core ring-over case: play 45, then attack 47 while 45 still rings.
    // A naive "stable pitch" loop would keep committing 45. The onset commits 47.
    const cap = makeNoteCapture();
    const frames = [
      F(45, { onset: true, tMs: 0 }),
      F(45, { tMs: 10 }), F(45, { tMs: 20 }), F(45, { tMs: 30 }),
      F(47, { onset: true, tMs: 40 }),          // new attack, blended pitch settling
      F(47, { tMs: 50 }), F(47, { tMs: 60 }),
    ];
    const out = run(cap, frames);
    expect(out.map((n) => n.midi)).toEqual([45, 47]);
  });

  it('commits a legato note (no onset) once it holds stable — hammer-on path', () => {
    // A hammer-on has no clean re-attack, so the onset never fires; a stable NEW
    // pitch held for stableFrames must still commit.
    const cap = makeNoteCapture({ stableFrames: 3 });
    const frames = [
      F(45, { onset: true, tMs: 0 }), F(45, { tMs: 10 }),
      F(47, { tMs: 20 }), F(47, { tMs: 30 }), F(47, { tMs: 40 }), // 3 stable frames, no onset
      F(47, { tMs: 50 }),
    ];
    expect(run(cap, frames).map((n) => n.midi)).toEqual([45, 47]);
  });

  it('does NOT commit a brief unstable blend (the two-note smear) as a note', () => {
    // Between two real notes YIN can return one garbage frame from the blend.
    // Without an onset and without holding stable, it must be ignored.
    const cap = makeNoteCapture({ stableFrames: 3 });
    const frames = [
      F(45, { onset: true, tMs: 0 }), F(45, { tMs: 10 }),
      F(52, { tMs: 20 }),                        // one-frame smear, no onset, not held
      F(47, { onset: true, tMs: 30 }), F(47, { tMs: 40 }),
    ];
    expect(run(cap, frames).map((n) => n.midi)).toEqual([45, 47]); // 52 dropped
  });

  it('a re-plucked SAME note (after a gap) commits again', () => {
    const cap = makeNoteCapture();
    const frames = [
      F(45, { onset: true, tMs: 0 }), F(45, { tMs: 10 }),
      F(null, { rms: 0, tMs: 20 }),              // release / silence
      F(45, { onset: true, tMs: 30 }), F(45, { tMs: 40 }), // played again
    ];
    expect(run(cap, frames).map((n) => n.midi)).toEqual([45, 45]);
  });

  it('a re-plucked same note WITHOUT a gap still commits on the fresh onset', () => {
    // Rapid repeated picking of one string: each attack is a note, even with no
    // silence between (the string never fully releases).
    const cap = makeNoteCapture();
    const frames = [
      F(45, { onset: true, tMs: 0 }), F(45, { tMs: 10 }),
      F(45, { onset: true, tMs: 20 }), F(45, { tMs: 30 }),
      F(45, { onset: true, tMs: 40 }),
    ];
    expect(run(cap, frames).map((n) => n.midi)).toEqual([45, 45, 45]);
  });

  it('carries the onset timestamp through (for speed scoring)', () => {
    const cap = makeNoteCapture();
    const out = run(cap, [F(45, { onset: true, tMs: 137 }), F(45, { tMs: 150 })]);
    expect(out[0].tMs).toBe(137);
  });

  it('reset clears the ring state', () => {
    const cap = makeNoteCapture();
    run(cap, [F(45, { onset: true }), F(45)]);
    cap.reset();
    // After reset, the same note commits fresh on its next onset.
    expect(run(cap, [F(45, { onset: true }), F(45)]).map((n) => n.midi)).toEqual([45]);
  });

  it('simulates a full ascending pentatonic run cleanly', () => {
    // A minor pent box: 45(A) 48(C) 50(D) 52(E) 55(G) 57(A), each a fresh pluck
    // that rings under the next. The capture must recover exactly this sequence.
    const cap = makeNoteCapture();
    const seq = [45, 48, 50, 52, 55, 57];
    const frames = [];
    let t = 0;
    for (const m of seq) {
      frames.push(F(m, { onset: true, tMs: t }));          // attack
      // it rings for a few frames, blending with the previous (which we model as
      // occasional stale reads — the onset already committed, so they're ignored)
      frames.push(F(m, { tMs: t + 10 }), F(m, { tMs: t + 20 }));
      t += 200;
    }
    expect(run(cap, frames).map((n) => n.midi)).toEqual(seq);
  });
});

describe('midiMatches — exact octave, adjacent fret rejected', () => {
  it('accepts the exact MIDI', () => {
    expect(midiMatches(64, 64)).toBe(true);
  });
  it('rejects an adjacent fret (a semitone = 100 cents, outside ±40)', () => {
    expect(midiMatches(65, 64)).toBe(false);
    expect(midiMatches(63, 64)).toBe(false);
  });
  it('rejects the same pitch class an octave off (wrong position)', () => {
    expect(midiMatches(76, 64)).toBe(false); // E5 vs E4
  });
});

describe('catalog wiring', () => {
  it('every unlock-order scale is a real SCALE_LABELS entry', () => {
    for (const id of SCALE_UNLOCK_ORDER) expect(SCALE_LABELS[id]).toBeTruthy();
  });
});

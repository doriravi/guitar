// Vitest spec for improvEngine — chord name -> where to solo.
//
// The interesting assertions here are the ones checked against guitar facts that
// are true independently of this code (open strings, the 12-fret octave, the
// canonical Am pentatonic box, the b7 that makes a dominant 7th). A test that
// only re-derives the implementation's own arithmetic would pass just as happily
// with the formulas wrong.

import { describe, it, expect } from 'vitest';
import {
  parseChordName,
  chordTones,
  findPitchClasses,
  scalePositions,
  improvMap,
  SCALE_FORMULAS,
  NUM_STRINGS,
} from './improvEngine';
import { OPEN_STRING_MIDI, NOTE_NAMES, CHORD_QUALITIES } from './chordAnalyzer';

const pcOf = (name) => NOTE_NAMES.indexOf(name);

describe('parseChordName', () => {
  it('parses the qualities the app supports', () => {
    expect(parseChordName('C')).toMatchObject({ rootName: 'C', suffix: '' });
    expect(parseChordName('Am')).toMatchObject({ rootName: 'A', suffix: 'm' });
    expect(parseChordName('G7')).toMatchObject({ rootName: 'G', suffix: '7' });
  });

  it('resolves flats to the same pitch class as their sharp spelling', () => {
    // The app treats Bb and A# as one note; the detector emits sharps but the
    // chord library and song catalog carry flats.
    expect(parseChordName('Bb').root).toBe(parseChordName('A#').root);
    expect(parseChordName('Ebm').root).toBe(parseChordName('D#m').root);
  });

  it('handles the wrap at both ends of the pitch-class circle', () => {
    expect(parseChordName('Cb').root).toBe(pcOf('B'));  // wraps down past C
    expect(parseChordName('B#').root).toBe(pcOf('C'));  // wraps up past B
  });

  it('returns null rather than guessing at an unsupported quality', () => {
    // These are real chords the catalog contains, but CHORD_QUALITIES doesn't
    // define them — silently downgrading Am7b5 to "Am" would light up a wrong
    // fretboard with full confidence.
    expect(parseChordName('Am7b5')).toBeNull();
    expect(parseChordName('Csus4')).toBeNull();
    expect(parseChordName('F6')).toBeNull();
    expect(parseChordName('H')).toBeNull();
    expect(parseChordName('')).toBeNull();
    expect(parseChordName(null)).toBeNull();
  });
});

describe('chordTones — spelling comes from chordAnalyzer, not a local copy', () => {
  it('spells a major triad root/3/5', () => {
    // C major = C E G. Verified against the note names, not against intervals.
    const names = chordTones('C').map((t) => NOTE_NAMES[t.pc]);
    expect(names.sort()).toEqual(['C', 'E', 'G']);
    expect(chordTones('C').map((t) => t.degree)).toEqual(['R', '3', '5']);
  });

  it('spells a minor triad with a b3', () => {
    // A minor = A C E.
    const names = chordTones('Am').map((t) => NOTE_NAMES[t.pc]);
    expect(names.sort()).toEqual(['A', 'C', 'E']);
    expect(chordTones('Am').map((t) => t.degree)).toEqual(['R', 'b3', '5']);
  });

  it('spells a dominant 7th with a major 3rd AND a b7', () => {
    // G7 = G B D F. The F (b7) is what makes it dominant; the B (major 3rd) is
    // what stops it being a minor 7th.
    const names = chordTones('G7').map((t) => NOTE_NAMES[t.pc]);
    expect(names.sort()).toEqual(['B', 'D', 'F', 'G']);
    expect(chordTones('G7').map((t) => t.degree)).toEqual(['R', '3', '5', 'b7']);
  });

  it('stays in lockstep with CHORD_QUALITIES (the shared source)', () => {
    // If someone edits the interval table in chordAnalyzer, this module must
    // follow automatically — that's the whole reason it imports rather than
    // redeclares. This test fails loudly if the link is ever broken.
    for (const q of CHORD_QUALITIES) {
      const tones = chordTones('C' + q.suffix);
      expect(tones.map((t) => t.interval).sort((a, b) => a - b))
        .toEqual([...q.intervals].sort((a, b) => a - b));
    }
  });
});

describe('findPitchClasses — the fret math, checked against real guitar facts', () => {
  it('finds each open string at fret 0 for its own pitch class', () => {
    // Standard tuning, verified note-by-note: E A D G B e.
    const OPEN = ['E', 'A', 'D', 'G', 'B', 'E'];
    OPEN.forEach((noteName, string) => {
      const hits = findPitchClasses([pcOf(noteName)], { maxFret: 0 });
      expect(hits.some((h) => h.string === string && h.fret === 0)).toBe(true);
    });
  });

  it('repeats every note exactly 12 frets up (the octave)', () => {
    const hits = findPitchClasses([pcOf('A')], { maxFret: 12 });
    // Low E string: A is at fret 5, so it must also be at fret 17 — and within
    // a 0..12 window, at 5 only.
    const lowE = hits.filter((h) => h.string === 0).map((h) => h.fret);
    expect(lowE).toContain(5);
    expect(lowE).toContain(17 - 12); // the same A, one octave down
    const wide = findPitchClasses([pcOf('A')], { maxFret: 17 })
      .filter((h) => h.string === 0).map((h) => h.fret);
    expect(wide).toContain(5);
    expect(wide).toContain(17);
  });

  it('knows the 5th-fret tuning trick (A string fret 5 = D string open)', () => {
    // The way every guitarist tunes by ear: fret 5 of a string = the next string
    // open (except G->B). If the mapping is right, this must hold.
    const d = pcOf('D');
    const hits = findPitchClasses([d], { maxFret: 5 });
    expect(hits.some((h) => h.string === 1 && h.fret === 5)).toBe(true); // A string, 5th
    expect(hits.some((h) => h.string === 2 && h.fret === 0)).toBe(true); // D string, open
  });

  it('respects the fret window', () => {
    const hits = findPitchClasses([pcOf('A')], { minFret: 3, maxFret: 7 });
    expect(hits.every((h) => h.fret >= 3 && h.fret <= 7)).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('agrees with OPEN_STRING_MIDI for every position it returns', () => {
    // Independent re-derivation from the tuning table: every hit must really be
    // the pitch class it claims.
    const hits = findPitchClasses([0, 5, 9], { maxFret: 12 });
    for (const h of hits) {
      expect((OPEN_STRING_MIDI[h.string] + h.fret) % 12).toBe(h.pc);
    }
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('scalePositions — against the shapes guitarists actually know', () => {
  it('produces the canonical A minor pentatonic box at fret 5', () => {
    // Every guitarist's first box: A minor pentatonic, 5th position, is
    // 5-8 / 5-7 / 5-7 / 5-7 / 5-8 / 5-8 across the six strings. This is a fact
    // about the guitar, so it checks the fret math end to end.
    const EXPECTED = [[5, 8], [5, 7], [5, 7], [5, 7], [5, 8], [5, 8]];
    const pos = scalePositions(pcOf('A'), 'minorPentatonic', { minFret: 5, maxFret: 8 });
    for (let s = 0; s < NUM_STRINGS; s++) {
      const frets = pos.filter((p) => p.string === s).map((p) => p.fret).sort((a, b) => a - b);
      expect(frets).toEqual(EXPECTED[s]);
    }
  });

  it('puts the E minor pentatonic on the open position guitarists know', () => {
    // E minor pentatonic = E G A B D. The open box, note by note:
    //   low E: 0=E  3=G      A: 0=A  2=B      D: 0=D  2=E
    //   G:     0=G  2=A      B: 0=B  3=D   high e: 0=E  3=G
    // (fret 3 on the D string would be F — not in the scale.)
    const EXPECTED = [[0, 3], [0, 2], [0, 2], [0, 2], [0, 3], [0, 3]];
    const pos = scalePositions(pcOf('E'), 'minorPentatonic', { minFret: 0, maxFret: 3 });
    for (let s = 0; s < NUM_STRINGS; s++) {
      const frets = pos.filter((p) => p.string === s).map((p) => p.fret).sort((a, b) => a - b);
      expect(frets).toEqual(EXPECTED[s]);
    }
  });

  it('spells C major as the white notes (no accidentals)', () => {
    // The definitive check on the major formula: C major = C D E F G A B.
    const pcs = new Set(scalePositions(pcOf('C'), 'major', { maxFret: 12 }).map((p) => p.pc));
    const names = [...pcs].map((pc) => NOTE_NAMES[pc]).sort();
    expect(names).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('spells A natural minor as the white notes too (relative minor of C)', () => {
    // A Aeolian is C Ionian starting on A — same seven notes. If the natural
    // minor formula is wrong, this breaks even though C major passed.
    const pcs = new Set(scalePositions(pcOf('A'), 'naturalMinor', { maxFret: 12 }).map((p) => p.pc));
    const names = [...pcs].map((pc) => NOTE_NAMES[pc]).sort();
    expect(names).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('distinguishes Mixolydian from major by exactly one note: the b7', () => {
    const major = new Set(scalePositions(pcOf('G'), 'major', { maxFret: 12 }).map((p) => p.pc));
    const mixo  = new Set(scalePositions(pcOf('G'), 'mixolydian', { maxFret: 12 }).map((p) => p.pc));
    const onlyMajor = [...major].filter((pc) => !mixo.has(pc)).map((pc) => NOTE_NAMES[pc]);
    const onlyMixo  = [...mixo].filter((pc) => !major.has(pc)).map((pc) => NOTE_NAMES[pc]);
    expect(onlyMajor).toEqual(['F#']); // G major has the leading tone
    expect(onlyMixo).toEqual(['F']);   // G Mixolydian flattens it — the dom7 note
  });

  it('blues = minor pentatonic + exactly the b5', () => {
    const pent  = new Set(scalePositions(pcOf('A'), 'minorPentatonic', { maxFret: 12 }).map((p) => p.pc));
    const blues = new Set(scalePositions(pcOf('A'), 'blues', { maxFret: 12 }).map((p) => p.pc));
    const added = [...blues].filter((pc) => !pent.has(pc));
    expect(added.map((pc) => NOTE_NAMES[pc])).toEqual(['D#']); // Eb = b5 of A
    expect([...pent].every((pc) => blues.has(pc))).toBe(true);
  });

  it('labels degrees consistently with the formula', () => {
    const pos = scalePositions(pcOf('A'), 'minorPentatonic', { maxFret: 12 });
    const intervals = new Set(pos.map((p) => p.interval));
    expect([...intervals].sort((a, b) => a - b)).toEqual(SCALE_FORMULAS.minorPentatonic);
    // The root must be labelled R and land on A.
    const roots = pos.filter((p) => p.degree === 'R');
    expect(roots.every((p) => NOTE_NAMES[p.pc] === 'A')).toBe(true);
  });

  it('returns null for an unknown scale', () => {
    expect(scalePositions(0, 'lydianDominantWhatever')).toBeNull();
  });
});

describe('improvMap — the onChordDetected entry point', () => {
  it('returns null for a chord it cannot honestly analyse', () => {
    // Better no overlay than a half-right one the player can't sanity-check.
    expect(improvMap('Am7b5')).toBeNull();
    expect(improvMap('nonsense')).toBeNull();
    expect(improvMap(null)).toBeNull();
  });

  it('maps Am to its tones plus minor-flavoured scales', () => {
    const map = improvMap('Am', { maxFret: 12 });
    expect(map.chord).toMatchObject({ name: 'Am', rootName: 'A', suffix: 'm' });
    // Chord tones are A C E, wherever they appear.
    const toneNames = new Set(map.tones.map((t) => NOTE_NAMES[t.pc]));
    expect([...toneNames].sort()).toEqual(['A', 'C', 'E']);
    // The scales offered are the minor ones, and minor pentatonic is the "safe" pick.
    const ids = map.scales.map((s) => s.id);
    expect(ids).toContain('minorPentatonic');
    expect(ids).toContain('naturalMinor');
    expect(ids).not.toContain('major');
    expect(map.scales.find((s) => s.role === 'safe').id).toBe('minorPentatonic');
  });

  it('maps C to major-flavoured scales', () => {
    const ids = improvMap('C', { maxFret: 12 }).scales.map((s) => s.id);
    expect(ids).toContain('majorPentatonic');
    expect(ids).toContain('major');
    expect(ids).not.toContain('naturalMinor');
  });

  it('offers Mixolydian on a dominant 7th (the mode that spells it)', () => {
    const map = improvMap('G7', { maxFret: 12 });
    const mixo = map.scales.find((s) => s.id === 'mixolydian');
    expect(mixo).toBeTruthy();
    expect(mixo.role).toBe('full');
    // The chord's own b7 must be present in the scale that claims to fit it.
    const b7 = map.tones.find((t) => t.degree === 'b7');
    expect(b7).toBeTruthy();
    expect(mixo.positions.some((p) => p.pc === b7.pc)).toBe(true);
  });

  it('marks which scale notes are chord tones (landing vs passing notes)', () => {
    const map = improvMap('Am', { maxFret: 12 });
    const pent = map.scales.find((s) => s.id === 'minorPentatonic');
    const tonePcs = new Set(map.tones.map((t) => t.pc));
    for (const p of pent.positions) {
      expect(p.isChordTone).toBe(tonePcs.has(p.pc));
    }
    // A minor pentatonic contains the full Am triad, so some notes are landing
    // notes and some aren't — if everything were flagged the same the HUD's main
    // distinction would be meaningless.
    expect(pent.positions.some((p) => p.isChordTone)).toBe(true);
    expect(pent.positions.some((p) => !p.isChordTone)).toBe(true);
  });

  it('every scale it recommends actually contains the chord’s root', () => {
    // A scale that doesn't contain the root of the chord you're playing over is
    // simply the wrong recommendation. Checked for every supported quality.
    for (const name of ['C', 'Am', 'G7', 'F', 'Dm', 'A7']) {
      const map = improvMap(name, { maxFret: 12 });
      for (const scale of map.scales) {
        expect(scale.positions.some((p) => p.pc === map.chord.root)).toBe(true);
      }
    }
  });

  it('positions use the app’s standard convention, ready for FretboardDiagram', () => {
    const map = improvMap('Am', { maxFret: 12 });
    for (const t of map.tones) {
      expect(t.string).toBeGreaterThanOrEqual(0);
      expect(t.string).toBeLessThan(NUM_STRINGS);
      expect(t.fret).toBeGreaterThanOrEqual(0);
      // Independently re-derive the pitch class from the tuning table.
      expect((OPEN_STRING_MIDI[t.string] + t.fret) % 12).toBe(t.pc);
    }
  });

  it('honours the fret window so the HUD can show one box', () => {
    const map = improvMap('Am', { minFret: 5, maxFret: 8 });
    const all = [...map.tones, ...map.scales.flatMap((s) => s.positions)];
    expect(all.every((p) => p.fret >= 5 && p.fret <= 8)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
  });
});

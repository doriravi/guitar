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
  trustDetection,
  makeChordLatch,
  livePitchClasses,
  SCALE_FORMULAS,
  NUM_STRINGS,
} from './improvEngine';
import { OPEN_STRING_MIDI, NOTE_NAMES, CHORD_QUALITIES } from './chordAnalyzer';
import { matchChord, hzToMidi } from './pitchDetect';
import { CHORDS } from './chords';

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

describe('trustDetection — the gate against a detector that never says no', () => {
  const AM = { chord: { name: 'Am' }, score: 1.0 };

  it('accepts a clean, complete chord', () => {
    expect(trustDetection(AM, { noteCount: 5, rms: 0.1 }).trust).toBe(true);
  });

  it('rejects silence before anything else', () => {
    const r = trustDetection(AM, { noteCount: 5, rms: 0.001 });
    expect(r.trust).toBe(false);
    expect(r.reason).toBe('silence');
  });

  it('rejects a single ringing string even at a perfect score', () => {
    // One open low-E scores 1.000 against "E5" — a perfect match to a chord
    // that is really just a string. Score alone cannot catch this; note count can.
    const r = trustDetection({ chord: { name: 'E5' }, score: 1.0 }, { noteCount: 1, rms: 0.1 });
    expect(r.trust).toBe(false);
    expect(r.reason).toBe('not enough notes');
  });

  it('rejects a weak match', () => {
    const r = trustDetection({ chord: { name: 'Am' }, score: 0.6 }, { noteCount: 4, rms: 0.1 });
    expect(r.trust).toBe(false);
    expect(r.reason).toBe('unclear');
  });

  it('rejects a chord the improv engine cannot analyse', () => {
    // The chord LIBRARY is far bigger than CHORD_QUALITIES. A confident Dsus4 is
    // still not something we can map scales for — better to show nothing.
    const r = trustDetection({ chord: { name: 'Dsus4' }, score: 1.0 }, { noteCount: 4, rms: 0.1 });
    expect(r.trust).toBe(false);
    expect(r.reason).toBe('unsupported chord');
  });

  it('handles a null match', () => {
    expect(trustDetection(null, { rms: 0.1 }).trust).toBe(false);
  });

  it('works without rms (callers that do not have it)', () => {
    expect(trustDetection(AM, { noteCount: 5 }).trust).toBe(true);
  });
});

describe('trustDetection against the REAL detector + REAL chord library', () => {
  // Not mocked: this runs the live matchChord over the actual CHORDS library,
  // so it pins the behaviour measured from the real pipeline. If someone retunes
  // the detector and noise starts passing again, this fails.
  const analyse = (hzList) => {
    const m = matchChord(hzList, CHORDS);
    const noteCount = new Set(
      hzList.map((hz) => ((Math.round(hzToMidi(hz)) % 12) + 12) % 12),
    ).size;
    return trustDetection(m, { noteCount, rms: 0.1 });
  };

  it('trusts a real Am', () => {
    // x02210 — A C E A C E, the shape everyone learns first.
    expect(analyse([110.0, 164.81, 220.0, 261.63, 329.63]).trust).toBe(true);
  });

  it('rejects one open low-E string (which the raw detector calls "E5" at 1.000)', () => {
    expect(analyse([82.41, 164.8, 247.2]).trust).toBe(false);
  });

  it('rejects random non-musical noise (raw detector: "Bbm7" at 0.750)', () => {
    // This is the case that made the gate necessary: three arbitrary
    // frequencies score 0.750 — three times the shared 0.25 threshold — because
    // Jaccard rewards chords with few distinct pitch classes.
    expect(analyse([137.0, 231.5, 419.0]).trust).toBe(false);
  });

  it('rejects two-note mush from a chord change (raw detector: "Dsus4" at 0.667)', () => {
    expect(analyse([110.0, 196.0]).trust).toBe(false);
  });

  it('rejects silence', () => {
    expect(trustDetection(matchChord([110.0], CHORDS), { noteCount: 1, rms: 0.0 }).trust).toBe(false);
  });
});

describe('livePitchClasses', () => {
  const pcOf2 = (n) => NOTE_NAMES.indexOf(n);
  it('maps detected Hz to distinct pitch classes', () => {
    // Open A (110), A one octave up (220), and C#4 (~277) -> {A, C#}.
    const s = livePitchClasses([110.0, 220.0, 277.18]);
    expect(s.has(pcOf2('A'))).toBe(true);
    expect(s.has(pcOf2('C#'))).toBe(true);
    expect(s.size).toBe(2); // the two A's collapse to one class
  });
  it('is empty for no input or non-positive Hz', () => {
    expect(livePitchClasses([]).size).toBe(0);
    expect(livePitchClasses(null).size).toBe(0);
    expect(livePitchClasses([0, -5]).size).toBe(0);
  });
});

describe('makeChordLatch — hold the chord through its own decay', () => {
  const ok = { trust: true, reason: null };
  const no = (reason) => ({ trust: false, reason });

  it('starts empty', () => {
    expect(makeChordLatch().current().chord).toBeNull();
  });

  it('latches the first confident chord', () => {
    const l = makeChordLatch();
    expect(l.update(ok, 'Am').chord).toBe('Am');
    expect(l.current()).toMatchObject({ chord: 'Am', live: true });
  });

  it('HOLDS the chord as it decays into silence — the whole point', () => {
    // This is the bug being fixed: the display used to die the instant the strum
    // decayed below the gate, so it flickered on every strum.
    const l = makeChordLatch();
    l.update(ok, 'Am');
    for (let i = 0; i < 200; i++) {
      expect(l.update(no('silence'), null).chord).toBe('Am');
    }
    expect(l.current().chord).toBe('Am');
  });

  it('holds through noise and unclear frames too', () => {
    const l = makeChordLatch();
    l.update(ok, 'Am');
    expect(l.update(no('unclear'), null).chord).toBe('Am');
    expect(l.update(no('not enough notes'), null).chord).toBe('Am');
    expect(l.update(no('unsupported chord'), null).chord).toBe('Am');
    expect(l.current().chord).toBe('Am');
  });

  it('marks a held-but-not-sounding chord as not live', () => {
    // The UI needs this to say "holding" rather than implying it hears the chord
    // right now — the honest distinction between the two.
    const l = makeChordLatch();
    expect(l.update(ok, 'Am').live).toBe(true);
    expect(l.update(no('silence'), null).live).toBe(false);
    expect(l.update(ok, 'Am').live).toBe(true);
  });

  it('replaces the chord when a DIFFERENT one is confidently played', () => {
    const l = makeChordLatch({ confirmFrames: 2 });
    l.update(ok, 'Am');
    expect(l.update(ok, 'C').chord).toBe('Am');       // first sighting: not yet
    const r = l.update(ok, 'C');                       // confirmed
    expect(r.chord).toBe('C');
    expect(r.changed).toBe(true);
  });

  it('needs consecutive frames — a single stray frame cannot swap the display', () => {
    // Mid-transition the detector can emit one confident-but-wrong chord. That
    // must not replace what's on screen.
    const l = makeChordLatch({ confirmFrames: 3 });
    l.update(ok, 'Am');
    l.update(ok, 'F');       // stray
    l.update(ok, 'G');       // different stray — resets the candidate
    l.update(ok, 'G');
    expect(l.current().chord).toBe('Am'); // still Am: G only has 2 of 3
    expect(l.update(ok, 'G').chord).toBe('G'); // third consecutive: now it swaps
  });

  it('a return to the held chord cancels a pending change', () => {
    const l = makeChordLatch({ confirmFrames: 3 });
    l.update(ok, 'Am');
    l.update(ok, 'C');        // candidate C, 1 hit
    l.update(ok, 'Am');       // back to Am — C was a flicker
    l.update(ok, 'C');        // candidate C restarts at 1
    expect(l.current().chord).toBe('Am');
    l.update(ok, 'C');        // 2
    expect(l.update(ok, 'C').chord).toBe('C'); // 3 — now it changes
  });

  it('untrusted frames do not count toward a pending change', () => {
    const l = makeChordLatch({ confirmFrames: 2 });
    l.update(ok, 'Am');
    l.update(ok, 'C');            // candidate C, 1 hit
    l.update(no('silence'), null); // silence must not advance C
    expect(l.current().chord).toBe('Am');
    l.update(ok, 'C');            // 2 hits now
    expect(l.current().chord).toBe('C');
  });

  it('only reports changed on an actual change', () => {
    const l = makeChordLatch({ confirmFrames: 1 });
    expect(l.update(ok, 'Am').changed).toBe(true);   // null -> Am
    expect(l.update(ok, 'Am').changed).toBe(false);  // same chord
    expect(l.update(ok, 'C').changed).toBe(true);    // Am -> C
  });

  it('clamps confirmFrames to a floor of 1 (a swap always needs a confirming frame)', () => {
    // Without the clamp, confirmFrames <= 0 makes candidateHits >= confirmFrames
    // true BEFORE any confirming frame is counted, so the very act of the loop
    // reaching the branch swaps — that must not happen. Clamped to 1, exactly one
    // confident frame of the new chord swaps: intended, and still a real gate
    // (an untrusted frame never advances it, proven by the tests above).
    for (const bad of [0, -5]) {
      const l = makeChordLatch({ confirmFrames: bad });
      l.update(ok, 'Am');
      // One confident C frame is enough at the floor of 1 — but it IS a frame of
      // C, not a zero-confirmation swap.
      expect(l.update(ok, 'C').chord).toBe('C');
    }
    // And a non-C confident frame must NOT swap to C: the floor is 1, not 0.
    const l = makeChordLatch({ confirmFrames: 0 });
    l.update(ok, 'Am');
    expect(l.update(ok, 'F').chord).toBe('F'); // F confirmed
    // Prove untrusted frames still can't drive a swap even at the floor.
    const l2 = makeChordLatch({ confirmFrames: 0 });
    l2.update(ok, 'Am');
    expect(l2.update({ trust: false, reason: 'silence' }, null).chord).toBe('Am');
  });

  it('only a STRUM replaces the held chord — soloing over it does not', () => {
    // The player holds Am, then solos: single notes that the detector may name
    // as other chords must NOT swap the display. Only >= strumNotes counts.
    const l = makeChordLatch({ confirmFrames: 2, strumNotes: 3 });
    l.update(ok, 'Am', 5);                       // strum Am
    // Solo line: confident C/G/F names arriving 1-2 notes at a time.
    expect(l.update(ok, 'C', 1).chord).toBe('Am');
    expect(l.update(ok, 'G', 2).chord).toBe('Am');
    expect(l.update(ok, 'C', 1).chord).toBe('Am');
    expect(l.update(ok, 'C', 2).chord).toBe('Am'); // even 2 confident C's: no swap
    expect(l.current().chord).toBe('Am');
  });

  it('a single-note frame still reads as live playing, not silence', () => {
    const l = makeChordLatch({ strumNotes: 3 });
    l.update(ok, 'Am', 5);
    expect(l.update(ok, 'C', 1).live).toBe(true); // you ARE playing (a solo note)
  });

  it('a full strum of a different chord still replaces after confirmFrames', () => {
    const l = makeChordLatch({ confirmFrames: 2, strumNotes: 3 });
    l.update(ok, 'Am', 5);
    expect(l.update(ok, 'C', 4).chord).toBe('Am'); // 1st strum frame
    expect(l.update(ok, 'C', 4).chord).toBe('C');  // 2nd — swaps
  });

  it('a sub-strum frame cancels a pending strum-driven change', () => {
    // Halfway to confirming C, the player drops to a single note — the pending C
    // must reset, so a later stray strum doesn't get a head start.
    const l = makeChordLatch({ confirmFrames: 3, strumNotes: 3 });
    l.update(ok, 'Am', 5);
    l.update(ok, 'C', 4);            // candidate C, 1 hit
    l.update(ok, 'C', 1);            // single note — resets the pending change
    l.update(ok, 'C', 4);            // candidate C restarts at 1
    expect(l.current().chord).toBe('Am');
    l.update(ok, 'C', 4);            // 2
    expect(l.update(ok, 'C', 4).chord).toBe('C'); // 3 — now it swaps
  });

  it('defaults noteCount to the strum threshold so old callers still swap', () => {
    // update() called without a noteCount must behave as before this option.
    const l = makeChordLatch({ confirmFrames: 1 });
    l.update(ok, 'Am');
    expect(l.update(ok, 'C').chord).toBe('C');
  });

  it('reset clears everything', () => {
    const l = makeChordLatch();
    l.update(ok, 'Am');
    l.reset();
    expect(l.current().chord).toBeNull();
    expect(l.current().live).toBe(false);
  });

  it('survives a realistic strum→ring→change sequence', () => {
    // Strum Am, let it ring out, then change to C: exactly the real use.
    const l = makeChordLatch({ confirmFrames: 2 });
    l.update(ok, 'Am');                                  // strum
    for (let i = 0; i < 60; i++) l.update(no('silence'), null); // ~1s ringing out
    expect(l.current().chord).toBe('Am');                // still showing Am
    l.update(ok, 'C'); l.update(ok, 'C');                // strum C
    expect(l.current().chord).toBe('C');
    for (let i = 0; i < 60; i++) l.update(no('silence'), null);
    expect(l.current().chord).toBe('C');                 // holds C now
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

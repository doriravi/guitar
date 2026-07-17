// improvEngine.js
// ===============
// "You're playing an Am — here's where to solo over it."
//
// Given a chord NAME (from the mic, via matchChord/detectChord), work out which
// notes to light up on a fretboard HUD: the chord's own tones, and the scale
// paths that fit over it.
//
// Where the theory comes from
// ---------------------------
// Chord spelling is NOT redefined here. `CHORD_QUALITIES` in chordAnalyzer.js is
// the app's single definition of what major/minor/dominant-7th MEAN, and this
// module reads it. Same for OPEN_STRING_MIDI (the tuning) and NOTE_NAMES (the
// spelling). A second copy of those tables would drift from the detector, and
// the HUD would confidently light up an A minor pentatonic over a chord the
// detector had actually heard as something else.
//
// Scale choice is a genuine judgement, not a lookup
// ------------------------------------------------
// There is no single "correct" scale for a chord — it depends on harmonic
// context this module cannot see (we get one chord name, not a key). So the
// choices below are the conventional, defensible ones a teacher would give a
// player improvising over a static vamp, and each carries a `why` string so the
// UI can say WHY rather than presenting an arbitrary pick as authoritative:
//   - major      -> major pentatonic (safe), Ionian/major (full)
//   - minor      -> minor pentatonic (safe), natural minor/Aeolian (full)
//   - dominant 7 -> minor pentatonic (the blues move), Mixolydian (the "correct"
//                   mode: major triad + the b7 the chord actually contains)
// A player in a real key may well want something else; this is a starting point,
// and it says so.

import {
  OPEN_STRING_MIDI,
  NOTE_NAMES,
  CHORD_QUALITIES,
} from './chordAnalyzer';
import { NUM_FRETS } from './fretboard';

export const NUM_STRINGS = 6;

// ── Scale formulas ───────────────────────────────────────────────────────────
// Semitone offsets from the ROOT. These are scale definitions (which the app did
// not previously have anywhere — scales.js holds diatonic CHORD harmony, a
// different thing), so unlike chord spelling there is nothing here to reuse.
export const SCALE_FORMULAS = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  major:           [0, 2, 4, 5, 7, 9, 11], // Ionian
  naturalMinor:    [0, 2, 3, 5, 7, 8, 10], // Aeolian
  mixolydian:      [0, 2, 4, 5, 7, 9, 10], // major with a b7
  blues:           [0, 3, 5, 6, 7, 10],    // minor pentatonic + the b5
};

// Which scales fit which chord quality. Keyed by the SAME `suffix` values
// CHORD_QUALITIES uses, so the two can't fall out of step.
const SCALES_FOR_QUALITY = {
  '': [
    { id: 'majorPentatonic', label: 'Major pentatonic', role: 'safe',
      why: 'Every note fits a major chord — the safest place to start.' },
    { id: 'major', label: 'Major (Ionian)', role: 'full',
      why: 'The full major scale; adds the 4th and 7th for more colour.' },
  ],
  m: [
    { id: 'minorPentatonic', label: 'Minor pentatonic', role: 'safe',
      why: 'The standard minor-key soloing shape — nothing in it clashes.' },
    { id: 'naturalMinor', label: 'Natural minor (Aeolian)', role: 'full',
      why: 'The full minor scale; adds the 2nd and b6.' },
    { id: 'blues', label: 'Blues', role: 'colour',
      why: 'Minor pentatonic plus the b5 "blue note" — lean on it, don’t sit on it.' },
  ],
  7: [
    { id: 'mixolydian', label: 'Mixolydian', role: 'full',
      why: 'The mode that actually spells a dominant 7th: major 3rd with a b7.' },
    { id: 'minorPentatonic', label: 'Minor pentatonic', role: 'colour',
      why: 'The blues move — the b3 against the chord’s major 3rd is the grit.' },
    { id: 'blues', label: 'Blues', role: 'colour',
      why: 'Minor pentatonic plus the b5. Classic over a dominant vamp.' },
  ],
};

// Degree names for the chord tones, so the HUD can label a dot "b3" not just "3".
const INTERVAL_NAMES = {
  0: 'R', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4',
  6: 'b5', 7: '5', 8: 'b6', 9: '6', 10: 'b7', 11: '7',
};

/**
 * Split a chord name into its root pitch class and quality suffix.
 *
 * Accepts the spellings the app actually produces: NOTE_NAMES uses sharps, but
 * chords.js and the catalog carry flats (Bb, Eb), so both resolve here. Anything
 * we can't parse returns null rather than guessing — a wrong root would light up
 * an entire wrong fretboard.
 *
 * @param {string} name e.g. "Am", "C", "G7", "Bbm", "F#7"
 * @returns {{root:number, suffix:string, rootName:string}|null}
 */
export function parseChordName(name) {
  if (typeof name !== 'string') return null;
  const m = name.trim().match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return null;
  const [, letter, accidental, rest] = m;

  const base = NOTE_NAMES.indexOf(letter);
  if (base < 0) return null;
  let root = base;
  if (accidental === '#') root = (root + 1) % 12;
  if (accidental === 'b') root = (root + 11) % 12;

  // The suffix must be one CHORD_QUALITIES knows — that table is the authority
  // on what qualities exist, so an unsupported one (m7b5, sus4, add9…) is an
  // honest null rather than a silent downgrade to a triad we didn't hear.
  const suffix = rest.trim();
  const known = CHORD_QUALITIES.some((q) => q.suffix === suffix);
  if (!known) return null;

  return { root, suffix, rootName: NOTE_NAMES[root] };
}

/**
 * The pitch classes a chord contains, straight from CHORD_QUALITIES.
 *
 * @param {string} name chord name
 * @returns {{pc:number, interval:number, degree:string}[]|null}
 */
export function chordTones(name) {
  const parsed = parseChordName(name);
  if (!parsed) return null;
  const quality = CHORD_QUALITIES.find((q) => q.suffix === parsed.suffix);
  if (!quality) return null;
  return [...quality.intervals]
    .sort((a, b) => a - b)
    .map((interval) => ({
      pc: (parsed.root + interval) % 12,
      interval,
      degree: INTERVAL_NAMES[interval],
    }));
}

/**
 * Every place a set of pitch classes appears on the fretboard.
 *
 * Returns positions in the app's standard convention ({ string, fret }, string
 * 0 = low E), so the results drop straight into FretboardDiagram, calcDifficulty
 * and the rest of the app without translation.
 *
 * @param {number[]|Set<number>} pcs   pitch classes to find
 * @param {object} [opts]
 * @param {number} [opts.minFret=0]    lowest fret to search (0 = include open)
 * @param {number} [opts.maxFret=NUM_FRETS]
 * @returns {{string:number, fret:number, pc:number}[]}
 */
export function findPitchClasses(pcs, opts = {}) {
  const want = pcs instanceof Set ? pcs : new Set(pcs);
  const minFret = opts.minFret ?? 0;
  const maxFret = opts.maxFret ?? NUM_FRETS;
  const out = [];
  for (let string = 0; string < NUM_STRINGS; string++) {
    for (let fret = minFret; fret <= maxFret; fret++) {
      const pc = (OPEN_STRING_MIDI[string] + fret) % 12;
      if (want.has(pc)) out.push({ string, fret, pc });
    }
  }
  return out;
}

/**
 * Build a scale's fretboard positions for a given root.
 *
 * @param {number} root      root pitch class 0..11
 * @param {string} scaleId   a key of SCALE_FORMULAS
 * @param {object} [opts]    passed to findPitchClasses (minFret/maxFret)
 * @returns {{string:number, fret:number, pc:number, interval:number, degree:string}[]|null}
 */
export function scalePositions(root, scaleId, opts = {}) {
  const formula = SCALE_FORMULAS[scaleId];
  if (!formula) return null;
  const byPc = new Map();
  for (const interval of formula) byPc.set((root + interval) % 12, interval);
  return findPitchClasses([...byPc.keys()], opts).map((p) => ({
    ...p,
    interval: byPc.get(p.pc),
    degree: INTERVAL_NAMES[byPc.get(p.pc)],
  }));
}

// ── Trusting the detector ────────────────────────────────────────────────────
// matchChord() always returns a best match — it never returns null, just
// something weak. Measured against the live pipeline, at the shared minScore of
// 0.25 the gate admits essentially everything:
//
//   real Am (5 notes)         -> "Am"    score 1.000   correct
//   one open low-E string     -> "E5"    score 1.000   a string, not a chord
//   two-note mush mid-change  -> "Dsus4" score 0.667   passes
//   three random noise freqs  -> "Bbm7"  score 0.750   passes
//
// Jaccard rewards small expected-sets: a sparse chord like Bbm7 needs only a
// couple of coincidental pitch classes to score high. That is survivable for the
// existing recorder (a wrong name in a list you review later) but not for an
// improv HUD, which would light a full scale over a chord you never played,
// continuously, while you mute strings between changes.
//
// So this module applies its OWN gate rather than raising the shared minScore —
// ChordListener and PracticeGame are calibrated around 0.25 and the user has a
// saved config keyed to it; moving it would silently change their behaviour.

/**
 * Should the HUD act on this detector result?
 *
 * @param {{chord:{name:string}, score:number}|null} match from matchChordConfigured
 * @param {object} [opts]
 * @param {number} [opts.minScore=0.85] how close the spelling must be
 * @param {number} [opts.minNotes=3]    distinct pitch classes heard
 * @param {number} [opts.rms=null]      mic level, when the caller has it
 * @param {number} [opts.minRms=0.02]   below this we treat it as silence
 * @returns {{trust:boolean, reason:string|null}}
 */
export function trustDetection(match, opts = {}) {
  const minScore = opts.minScore ?? 0.85;
  const minNotes = opts.minNotes ?? 3;
  const minRms = opts.minRms ?? 0.02;

  if (opts.rms != null && opts.rms < minRms) {
    return { trust: false, reason: 'silence' };
  }
  if (!match || !match.chord) return { trust: false, reason: 'nothing detected' };

  // A triad needs three distinct pitch classes. Fewer means we're hearing a
  // string or two, and naming a chord from that is a guess — this is what
  // rejects the single ringing string that scores a perfect 1.000.
  if (opts.noteCount != null && opts.noteCount < minNotes) {
    return { trust: false, reason: 'not enough notes' };
  }
  // A near-exact spelling match. 0.85 admits a real chord missing one note to a
  // dead string; it rejects the 0.67-0.75 coincidences noise produces.
  if ((match.score ?? 0) < minScore) {
    return { trust: false, reason: 'unclear' };
  }
  // The improv engine can only analyse qualities CHORD_QUALITIES defines. The
  // chord LIBRARY is much larger (E5, Dsus4, Bbm7…), so a name can arrive that
  // parses to nothing here — reject it rather than showing an empty HUD.
  if (!parseChordName(match.chord.name)) {
    return { trust: false, reason: 'unsupported chord' };
  }
  return { trust: true, reason: null };
}

// ── Holding a chord on screen ────────────────────────────────────────────────
// A guitar chord is loud for a moment and then decays. Detection follows that
// envelope: it's confident during the strum and drops out as the strings ring
// down, so a HUD that mirrors detection frame-by-frame flickers on every strum
// and is unusable to actually improvise against — you'd be reading a strobe.
//
// So the display LATCHES: once we trust a chord, it stays lit until a DIFFERENT
// chord is confidently detected. Absence of signal never clears it, because
// absence means "you stopped strumming", not "you changed chord".
//
// The honesty line, and why this doesn't cross it:
//   - Holding a chord through its own decay = still correct. The chord is what
//     you played; nothing is being invented.
//   - Holding it after you've MOVED to another chord = a lie that looks exactly
//     like a correct reading. That's the case the latch must not allow, so a new
//     chord replaces the old one the moment we're confident about it.
// The gap between those two is real: it's the window between you changing chord
// and us becoming confident about the new one, when the display still shows the
// previous chord. That window is bounded by detection latency (a strum or so),
// and the UI marks a held chord as such rather than presenting it as live.

/**
 * Create a latch that holds the last confidently-detected chord.
 *
 * Pure and self-contained (no React) so the hold/replace rules are unit-testable
 * without a microphone or a rendering loop.
 *
 * @param {object} [opts]
 * @param {number} [opts.confirmFrames=2] consecutive trusted frames of a NEW
 *        chord before it replaces the current one. Guards against a single bad
 *        frame mid-transition swapping the display to a chord you never played.
 * @returns {{update:Function, current:Function, reset:Function}}
 */
export function makeChordLatch(opts = {}) {
  // At least 1: confirmFrames < 1 would make every stray single frame replace
  // the held chord instantly, defeating the guard this option exists to provide.
  const confirmFrames = Math.max(1, opts.confirmFrames ?? 2);
  let held = null;        // the chord currently on screen
  let candidate = null;   // a different chord we're becoming confident about
  let candidateHits = 0;
  let live = false;       // is the held chord sounding right now?

  return {
    /**
     * Feed one frame's verdict.
     * @param {{trust:boolean, reason:string|null}} verdict from trustDetection
     * @param {string|null} chordName the detected name (when trusted)
     * @returns {{chord:string|null, live:boolean, changed:boolean}}
     */
    update(verdict, chordName) {
      const prev = held;
      if (!verdict?.trust || !chordName) {
        // No confident reading. Keep showing what we have — the player is between
        // strums, or letting it ring. Do NOT clear, and do NOT let an untrusted
        // frame count toward a pending change.
        live = false;
        return { chord: held, live, changed: false };
      }
      if (chordName === held) {
        // Same chord, still sounding — refresh liveness and drop any pending
        // change (a flicker toward another chord that didn't hold up).
        candidate = null;
        candidateHits = 0;
        live = true;
        return { chord: held, live, changed: false };
      }
      // Nothing on screen yet: latch immediately. confirmFrames exists to stop a
      // stray frame REPLACING a chord you're looking at; with an empty display
      // there's nothing to protect, and making the first chord wait would just
      // feel broken.
      if (held === null) {
        held = chordName;
        candidate = null;
        candidateHits = 0;
        live = true;
        return { chord: held, live, changed: true };
      }

      // A different chord, confidently heard.
      if (chordName === candidate) candidateHits += 1;
      else { candidate = chordName; candidateHits = 1; }

      if (candidateHits >= confirmFrames) {
        held = candidate;
        candidate = null;
        candidateHits = 0;
        live = true;
        return { chord: held, live, changed: held !== prev };
      }
      // Not yet convinced — keep the old chord up rather than blanking.
      return { chord: held, live: false, changed: false };
    },
    current() { return { chord: held, live }; },
    reset() { held = null; candidate = null; candidateHits = 0; live = false; },
  };
}

/**
 * THE MAIN ENTRY POINT — what onChordDetected(chordName) feeds the HUD.
 *
 * Returns the chord's own tones plus the scales that fit over it, every note
 * already resolved to { string, fret } so the HUD just draws dots.
 *
 * Returns null for a chord it cannot honestly analyse (unparseable name, or a
 * quality CHORD_QUALITIES doesn't define). The caller must render nothing in
 * that case: a half-right overlay of "notes that fit" is worse than no overlay,
 * because the player has no way to tell which half is wrong.
 *
 * @param {string} chordName e.g. "Am" (as produced by the mic detector)
 * @param {object} [opts]
 * @param {number} [opts.minFret=0]
 * @param {number} [opts.maxFret=NUM_FRETS]
 * @returns {{chord, tones, scales}|null}
 */
export function improvMap(chordName, opts = {}) {
  const parsed = parseChordName(chordName);
  if (!parsed) return null;
  const tones = chordTones(chordName);
  if (!tones) return null;

  const tonePcs = new Set(tones.map((t) => t.pc));
  const toneByPc = new Map(tones.map((t) => [t.pc, t]));

  // Chord tones, everywhere they appear — the high-contrast dots.
  const tonePositions = findPitchClasses(tonePcs, opts).map((p) => ({
    ...p,
    interval: toneByPc.get(p.pc).interval,
    degree: toneByPc.get(p.pc).degree,
  }));

  const scales = (SCALES_FOR_QUALITY[parsed.suffix] || []).map((s) => {
    const positions = scalePositions(parsed.root, s.id, opts) || [];
    return {
      ...s,
      // `isChordTone` lets the HUD draw the same note differently depending on
      // whether it's a landing note or a passing one — the distinction that
      // makes a scale overlay useful rather than just a wall of dots.
      positions: positions.map((p) => ({ ...p, isChordTone: tonePcs.has(p.pc) })),
    };
  });

  return {
    chord: { name: chordName, root: parsed.root, rootName: parsed.rootName, suffix: parsed.suffix },
    tones: tonePositions,
    scales,
  };
}

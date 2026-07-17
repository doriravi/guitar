// chordAnalyzer.js
// ================
// Map a set of fretted note positions to a chord name — the *inverse* of the
// chord library (lib/chords.js maps a chord NAME -> a tab). Here we take the
// physical (string, fret) positions a player is holding and figure out which
// chord they form.
//
// This is a direct JS port of the Python prototype vision/chord_analyzer.py,
// kept deliberately in lockstep with it (same templates, same matching rule,
// same string convention) so the two stay verifiable against each other.
//
// Model
// -----
// - Standard tuning only. A position is { string, fret }:
//     * string is 0..5, matching the app's convention everywhere else:
//         0 = low E, 1 = A, 2 = D, 3 = G, 4 = B, 5 = high e
//     * fret is 0 (open) .. up the neck. A negative fret means "muted / not
//       played" and is ignored (so a full 6-slot hand can be passed as-is).
// - Each position -> a MIDI pitch -> a pitch class (0-11, C = 0).
// - The distinct pitch classes are matched against chord templates, trying
//   every sounding pitch class as a candidate root.
//
// Supported qualities (parity with the prototype): major, minor, dominant 7th.

// Open-string MIDI pitches in standard tuning, indexed by string 0..5
// (low E2 = 40, A2 = 45, D3 = 50, G3 = 55, B3 = 59, high e4 = 64).
export const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64];

// Pitch-class names. Sharps are the canonical spelling; enharmonic flats
// (Bb === A#) resolve to the same class, matching how the app treats them.
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F',
                           'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Chord quality -> { suffix, intervals }. Intervals are semitone offsets from
// the root that must ALL be present (and, for an exact match, be the ONLY ones).
// Ordered most-specific first so a dominant 7th (which contains a major triad)
// matches as "7" rather than collapsing to a plain major.
//
// Exported because this is the app's ONE definition of what a chord quality IS.
// improvEngine.js reads it to decide which scales fit a detected chord; if it
// declared its own copy, the two would drift and the improv HUD would eventually
// light up scale paths for a chord spelled differently than the detector heard.
export const CHORD_QUALITIES = [
  { suffix: '7', intervals: new Set([0, 4, 7, 10]) }, // dominant 7th: root, M3, P5, m7
  { suffix: 'm', intervals: new Set([0, 3, 7]) },      // minor triad:  root, m3, P5
  { suffix: '',  intervals: new Set([0, 4, 7]) },      // major triad:  root, M3, P5
];

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function validatePosition(pos) {
  if (!pos || typeof pos.string !== 'number' || typeof pos.fret !== 'number') {
    throw new Error(`position must be { string, fret }, got ${JSON.stringify(pos)}`);
  }
  if (pos.string < 0 || pos.string > 5) {
    throw new Error(`string must be 0..5 (0=low E, 5=high e), got ${pos.string}`);
  }
}

// Convert a { string, fret } position to its MIDI pitch.
export function positionToMidi(pos) {
  validatePosition(pos);
  return OPEN_STRING_MIDI[pos.string] + pos.fret;
}

// Convert a { string, fret } position to a pitch class 0..11 (C = 0).
export function positionToPitchClass(pos) {
  return ((positionToMidi(pos) % 12) + 12) % 12;
}

// The set of distinct sounding pitch classes. Positions with a negative fret
// (muted) are skipped.
export function pitchClasses(positions) {
  const classes = new Set();
  for (const pos of positions) {
    validatePosition(pos);
    if (pos.fret < 0) continue; // muted / not played
    classes.add(positionToPitchClass(pos));
  }
  return classes;
}

/**
 * Identify the chord formed by a list of { string, fret } positions.
 *
 * Returns a chord name (e.g. "C", "Am", "G7") or null if the notes don't form
 * a supported major / minor / dominant-7th chord.
 *
 * Matching rule: the set of sounding pitch classes must EXACTLY equal the root
 * plus the quality's intervals — no extra notes and none missing. This keeps
 * detection unambiguous (a bare major triad won't be reported as a 7th, and
 * vice-versa). We try every sounding note as a candidate root and, for a given
 * root, prefer the most-specific quality (7th before triad).
 *
 * @param {Array<{string:number, fret:number}>} positions
 * @returns {string|null}
 */
export function detectChord(positions) {
  const classes = pitchClasses(positions);
  if (classes.size === 0) return null;

  const roots = [...classes].sort((a, b) => a - b);
  for (const root of roots) {
    // Intervals present relative to this candidate root.
    const intervals = new Set([...classes].map((pc) => (((pc - root) % 12) + 12) % 12));
    for (const { suffix, intervals: required } of CHORD_QUALITIES) {
      if (setsEqual(intervals, required)) {
        // First exact match wins. Because we iterate roots ascending and
        // qualities most-specific-first, an exact match is unique for the
        // supported qualities, so we can return immediately.
        return NOTE_NAMES[root] + suffix;
      }
    }
  }
  return null;
}

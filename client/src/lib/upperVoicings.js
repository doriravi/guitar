// "Higher up the neck" voicing engine.
//
// For a given chord, produce a movable barre/CAGED voicing positioned further up
// the fretboard than the open/easiest shape. This is the standard way to play a
// progression in a single hand-position higher on the neck (e.g. all E-shape and
// A-shape barres around the 5th–8th frets) — useful for a brighter tone, for
// staying in one region, or when open chords don't sit under the melody.
//
// We GENERATE these shapes from movable templates rather than relying on the
// static chord library, so any root/quality combination is covered even if it
// isn't in chords.js. The output uses the same note model as the rest of the app:
//   note = { string: 0..5, fret }, string 0 = low E … 5 = high e.

import { calcDifficulty } from './fretboard';

const NOTE_TO_SEMITONE = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

// Open-string pitch classes per string (0=low E … 5=high e).
const OPEN_PC = [4, 9, 2, 7, 11, 4]; // E A D G B e

// Movable shape templates. `rootString` is the string whose fret equals the
// barre/root fret R; each entry is the fret OFFSET from R on that string, or null
// for a muted string. These are the canonical CAGED E-shape and A-shape voicings.
//
// Offsets are the classic shapes. For a root pitch class `pc`, the barre fret R is
// chosen so the root sits at the right pitch on `rootString`.
const SHAPES = {
  // ── E-shape (root on low-E, string 0) ──
  'E:maj':  { rootString: 0, offsets: [0, 2, 2, 1, 0, 0] },         // 022100 form
  'E:min':  { rootString: 0, offsets: [0, 2, 2, 0, 0, 0] },         // 022000 form
  'E:dom7': { rootString: 0, offsets: [0, 2, 0, 1, 0, 0] },         // 020100 form
  'E:maj7': { rootString: 0, offsets: [0, 2, 1, 1, 0, 0] },         // 021100 form
  'E:min7': { rootString: 0, offsets: [0, 2, 0, 0, 0, 0] },         // 020000 form
  // ── A-shape (root on A, string 1) ──
  'A:maj':  { rootString: 1, offsets: [null, 0, 2, 2, 2, 0] },      // x02220 form
  'A:min':  { rootString: 1, offsets: [null, 0, 2, 2, 1, 0] },      // x02210 form
  'A:dom7': { rootString: 1, offsets: [null, 0, 2, 0, 2, 0] },      // x02020 form
  'A:maj7': { rootString: 1, offsets: [null, 0, 2, 1, 2, 0] },      // x02120 form
  'A:min7': { rootString: 1, offsets: [null, 0, 2, 0, 1, 0] },      // x02010 form
};

// Map a chord-name quality suffix to a template quality.
// Returns null for qualities we don't have a clean movable barre for (we just
// skip those chords rather than invent a dubious shape).
function templateQuality(suffix) {
  const q = suffix;
  if (q === '' || q === '6' || q.startsWith('sus') || q.startsWith('add')) return 'maj';
  if (q === 'maj7' || q === 'maj9') return 'maj7';
  if (/^m(?!aj)/.test(q) || q === 'min') {
    if (q.startsWith('m7') && !q.startsWith('m7b5')) return 'min7';
    return 'min';
  }
  if (q.startsWith('7') || q === '9' || q === '13' || q === '11') return 'dom7';
  if (q.startsWith('maj')) return 'maj7';
  // dim / m7b5 / aug → no clean barre template
  return null;
}

function parseChord(name) {
  const m = name.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  return { root: m[1], suffix: m[2] };
}

// Build the actual {string,fret} notes for a shape at barre fret R.
function buildNotes(shape, R) {
  const notes = [];
  for (let s = 0; s < 6; s++) {
    const off = shape.offsets[s];
    if (off === null || off === undefined) continue; // muted
    notes.push({ string: s, fret: R + off });
  }
  return notes;
}

// Lowest fret used by a shape (barre fret itself, since offsets are >= 0).
function barreFretForRoot(shape, rootPc) {
  const openPc = OPEN_PC[shape.rootString];
  // We want (openPc + R) % 12 === rootPc, with R >= 1 (a real barre, up the neck).
  let R = ((rootPc - openPc) % 12 + 12) % 12;
  if (R === 0) R = 12; // root would be open string → move up an octave to stay "up the neck"
  return R;
}

const MIN_UPPER_FRET = 1; // a real fretted barre (>=1) — anything open isn't "up the neck"
// Cap at fret 9 so every fretted position stays single-digit: keeps the 6-char
// EADGBe tab convention intact (the chord diagram parses one char per string) and
// keeps the shape in a comfortable, reachable region of the neck.
const MAX_FRET = 9;

/**
 * Best "up the neck" voicing for a chord, or null if none is suitable.
 *
 * Strategy: try both the E-shape and A-shape templates for the chord's quality,
 * each placed at the lowest barre fret that puts it at/above MIN_UPPER_FRET, then
 * (within reach limits) pick the easier of the two to fret.
 *
 * Returns:
 *   { name, shape: 'E-shape'|'A-shape', barreFret, voicing: { notes, score, tab } }
 */
export function upperVoicing(chordName, { minFret = MIN_UPPER_FRET } = {}) {
  const parsed = parseChord(chordName);
  if (!parsed) return null;
  const { root, suffix } = parsed;
  const rootPc = NOTE_TO_SEMITONE[root];
  if (rootPc === undefined) return null;

  const tq = templateQuality(suffix);
  if (!tq) return null;

  const candidates = [];
  for (const [shapeName, label] of [['E', 'E-shape'], ['A', 'A-shape']]) {
    const shape = SHAPES[`${shapeName}:${tq}`];
    if (!shape) continue;
    let R = barreFretForRoot(shape, rootPc);
    // Ensure a real fretted barre (no open root); bump an octave only if needed.
    while (R < minFret) R += 12;
    const topFret = R + Math.max(...shape.offsets.filter(o => o !== null));
    if (topFret > MAX_FRET) continue;
    const notes = buildNotes(shape, R);
    candidates.push({ label, barreFret: R, notes, score: calcDifficulty(notes) });
  }
  if (!candidates.length) return null;

  // Pick the most comfortable upper-neck position. We favour lower barre frets
  // (easier to reach, less of a stretch) and use the difficulty score as a tie-
  // breaker, so e.g. G prefers the E-shape barre at fret 3 over an A-shape at 10.
  candidates.sort((a, b) => a.barreFret - b.barreFret || a.score - b.score);
  const best = candidates[0];

  return {
    name: chordName,
    shape: best.label,
    barreFret: best.barreFret,
    voicing: {
      name: chordName,
      type: `${best.label} barre @ fret ${best.barreFret}`,
      notes: best.notes,
      score: best.score,
      tab: notesToTab(best.notes),
    },
  };
}

// Render a 6-char EADGBe tab string from notes (for the fretboard diagram tooltip).
function notesToTab(notes) {
  const arr = ['x', 'x', 'x', 'x', 'x', 'x'];
  for (const n of notes) arr[n.string] = String(n.fret);
  return arr.join('');
}

/**
 * Compute up-the-neck voicings for a whole progression.
 * `chords` is the progression chord list ({ chordName }).
 * Returns { perChord: (result|null)[], count }.
 */
export function suggestUpperProgression(chords, opts) {
  const perChord = chords.map(c => upperVoicing(c.chordName, opts));
  const count = perChord.filter(Boolean).length;
  return { perChord, count };
}

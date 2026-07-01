// Shared chord-voicing lookup.
//
// Lifted out of ProgressionExplorer.jsx so both the progression view and the
// Song Editor read voicings from ONE source of truth (no duplicated CHORD_MAP).
// A voicing is the static-library chord shape with its raw difficulty attached:
//   { name, type, notes:[{string,fret}], tab:"EADGBe", score }
// where `score` is the population-average calcDifficulty (NOT personalized — the
// caller re-scores with the active hand profile).

import { CHORDS } from './chords';
import { calcDifficulty } from './fretboard';

// Enharmonic spellings so "Bb" and "A#" resolve to the same library entry.
const ENHARMONIC = {
  'C#': 'Db', Db: 'C#', 'D#': 'Eb', Eb: 'D#',
  'F#': 'Gb', Gb: 'F#', 'G#': 'Ab', Ab: 'G#',
  'A#': 'Bb', Bb: 'A#',
};

// name → all library voicings for that chord, each with a raw difficulty score.
const CHORD_MAP = (() => {
  const map = new Map();
  for (const chord of CHORDS) {
    const score = calcDifficulty(chord.notes);
    if (!map.has(chord.name)) map.set(chord.name, []);
    map.get(chord.name).push({ ...chord, score });
  }
  return map;
})();

/**
 * All known voicings for a chord name (unsorted). Falls back to the enharmonic
 * spelling (Bb ↔ A#) when the exact name isn't catalogued. Returns [] when the
 * chord isn't in the library.
 */
export function lookupVoicings(chordName) {
  const exact = CHORD_MAP.get(chordName);
  if (exact?.length) return exact;
  const m = (chordName || '').match(/^([A-G][#b]?)(.*)$/);
  if (m) {
    const alt = ENHARMONIC[m[1]];
    if (alt) return CHORD_MAP.get(alt + m[2]) || [];
  }
  return [];
}

/**
 * The easiest (lowest population-average difficulty) voicing for a chord, or
 * null when the chord isn't in the library.
 */
export function easiestVoicing(chordName) {
  const list = lookupVoicings(chordName);
  if (!list.length) return null;
  return list.slice().sort((a, b) => a.score - b.score)[0];
}

/**
 * Every catalogued chord name (deduped, in library order) — for the editor's
 * manual chord picker.
 */
export function allChordNames() {
  return [...CHORD_MAP.keys()];
}

export { CHORD_MAP };

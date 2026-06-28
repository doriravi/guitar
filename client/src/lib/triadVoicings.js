// "Up the neck — no barre" triad voicing engine.
//
// Unlike upperVoicings.js (which uses full movable BARRE shapes), this builds
// small THREE-NOTE triad voicings ("triplets") high on the neck using the same
// pitch classes the original chord contains — root, third, fifth. No barre: each
// note sits on its own string across three ADJACENT strings within a small fret
// window, so it's a compact grip you can play with individual fingers.
//
// Use case: play the progression higher on the neck without barre chords, keeping
// the harmony (the chord's main notes) intact.
//
// Note model matches the rest of the app:
//   note = { string: 0..5, fret }, string 0 = low E … 5 = high e.

import { calcDifficulty } from './fretboard';

const NOTE_TO_SEMITONE = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

// Open-string pitch class per string (0=low E … 5=high e).
const OPEN_PC = [4, 9, 2, 7, 11, 4];

// Triad interval sets (semitones from root) keyed by chord quality.
// We reduce extended/altered chords to their underlying triad so the voicing
// stays a clean 3-note grip while keeping the chord's main (root/3rd/5th) notes.
function triadIntervals(suffix) {
  const q = suffix;
  // Minor family (m, m7, m9, m6, m(maj7)…) but NOT 'maj'
  if (/^m(?!aj)/.test(q) || q === 'min') {
    if (q.startsWith('m7b5') || q.startsWith('mb5')) return [0, 3, 6];   // dim triad
    return [0, 3, 7];                                                     // minor
  }
  if (q.startsWith('dim')) return [0, 3, 6];                              // diminished
  if (q.startsWith('aug') || q === '+') return [0, 4, 8];                 // augmented
  if (q.startsWith('sus2')) return [0, 2, 7];                            // sus2
  if (q.startsWith('sus4') || q.startsWith('7sus4') || q.startsWith('sus')) return [0, 5, 7]; // sus4
  // Everything else (major, 6, 7, 9, 11, 13, maj7, maj9, add9, slash…) → major triad
  return [0, 4, 7];
}

function parseChord(name) {
  // Strip any slash bass (e.g. "C/G") — we voice the chord triad itself.
  const base = name.split('/')[0];
  const m = base.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  return { root: m[1], suffix: m[2] };
}

// Pitch class of a given string+fret.
function pcAt(string, fret) {
  return (OPEN_PC[string] + fret) % 12;
}

const MIN_FRET = 3;   // "up the neck" — above the open-position chords, but reachable
// Cap at fret 9 so every fret stays single-digit: keeps the 6-char EADGBe tab
// convention intact (the chord diagram parses one char per string).
const MAX_FRET = 9;
const MAX_SPAN = 3;   // max fret span across the three strings (no big stretch)

/**
 * Build the best no-barre triad voicing for `chordName`, higher up the neck.
 *
 * Searches every set of 3 ADJACENT strings and every fret window in [MIN_FRET,
 * MAX_FRET], collecting grips where the three notes (one per string) together
 * cover all three triad pitch classes within MAX_SPAN frets. Returns the easiest /
 * most compact such grip, or null if none exists in range.
 *
 * Returns:
 *   {
 *     name, intervals, pcs,            // chord + the pitch classes used
 *     voicing: { name, type, notes, score, tab },
 *     baseFret,                        // lowest fret used (for the position label)
 *   }
 */
export function triadUpVoicing(chordName, { minFret = MIN_FRET, maxFret = MAX_FRET } = {}) {
  const parsed = parseChord(chordName);
  if (!parsed) return null;
  const { root, suffix } = parsed;
  const rootPc = NOTE_TO_SEMITONE[root];
  if (rootPc === undefined) return null;

  const intervals = triadIntervals(suffix);
  const targetPcs = new Set(intervals.map(i => (rootPc + i) % 12));

  let best = null; // { notes, score, baseFret }

  // Iterate over all 3-adjacent-string groups: (0,1,2) … (3,4,5).
  for (let s0 = 0; s0 <= 3; s0++) {
    const strings = [s0, s0 + 1, s0 + 2];

    // For each string, the candidate frets in range whose pitch class is in the triad.
    const perString = strings.map(s => {
      const opts = [];
      for (let f = minFret; f <= maxFret; f++) {
        if (targetPcs.has(pcAt(s, f))) opts.push(f);
      }
      return opts;
    });
    if (perString.some(o => o.length === 0)) continue;

    // Try every combination (each list is small — at most ~3 entries in an octave).
    for (const fa of perString[0]) {
      for (const fb of perString[1]) {
        for (const fc of perString[2]) {
          const frets = [fa, fb, fc];
          const span = Math.max(...frets) - Math.min(...frets);
          if (span > MAX_SPAN) continue;

          // Must cover all three triad notes (root, third, fifth) — no doubled-only grips.
          const covered = new Set(strings.map((s, i) => pcAt(s, frets[i])));
          if (covered.size < targetPcs.size) continue;

          const notes = strings.map((s, i) => ({ string: s, fret: frets[i] }));
          const score = calcDifficulty(notes);
          const baseFret = Math.min(...frets);

          if (!best
              || score < best.score
              || (score === best.score && baseFret < best.baseFret)) {
            best = { notes, score, baseFret };
          }
        }
      }
    }
  }

  if (!best) return null;

  return {
    name: chordName,
    intervals,
    pcs: [...targetPcs],
    baseFret: best.baseFret,
    voicing: {
      name: chordName,
      type: `triad @ fret ${best.baseFret}`,
      notes: best.notes,
      score: best.score,
      tab: notesToTab(best.notes),
    },
  };
}

function notesToTab(notes) {
  const arr = ['x', 'x', 'x', 'x', 'x', 'x'];
  for (const n of notes) arr[n.string] = String(n.fret);
  return arr.join('');
}

/**
 * Triad up-the-neck voicings for a whole progression.
 * `chords` is the progression chord list ({ chordName }).
 * Returns { perChord: (result|null)[], count }.
 */
export function suggestTriadProgression(chords, opts) {
  const perChord = chords.map(c => triadUpVoicing(c.chordName, opts));
  const count = perChord.filter(Boolean).length;
  return { perChord, count };
}

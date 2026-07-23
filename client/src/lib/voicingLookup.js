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
import { isWithinReach } from './handProfile';

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

// Exact-or-enharmonic library hit (the original strict lookup).
function directHit(chordName) {
  const exact = CHORD_MAP.get(chordName);
  if (exact?.length) return exact;
  const m = (chordName || '').match(/^([A-G][#b]?)(.*)$/);
  if (m) {
    const alt = ENHARMONIC[m[1]];
    if (alt) {
      const hit = CHORD_MAP.get(alt + m[2]);
      if (hit?.length) return hit;
    }
  }
  return null;
}

// Real chord sheets (Cifra Club et al.) spell chords the library doesn't:
// Brazilian notation (F7M = Fmaj7, D4 = Dsus4, A2 = Asus2, Bm75- = Bm7b5,
// E5+ = Eaug), rich extensions (D911/F#, G611), and slash basses (Am/G).
// Build a priority list of progressively simpler candidate names so EVERY
// chord resolves to some playable shape — diagrams, hover, difficulty and
// audio then support chords the user has never seen. First hit wins.
// True when a token is chord-shaped: a root note followed ONLY by chord
// vocabulary (m/maj/min/dim/aug/sus/add, accidentals, digits, symbols).
// Rejects section words that start with a note letter ("Final", "Chorus",
// "Bridge") so they never masquerade as F/C/B.
export function looksLikeChordName(name) {
  const m = (name || '').match(/^([A-G][#b]?)(.*)$/);
  if (!m) return false;
  // Slash parts are either a bass note (G/B, Am/F#, sheet-style G/b) or an
  // extension continuation (B74/9, Bm7/5-, F7M2/4+); anything else is a word.
  const parts = m[2].split('/');
  let rest = parts[0];
  for (const p of parts.slice(1)) {
    if (/^[A-Ga-g][#b]?$/.test(p)) continue;          // bass note
    if (/^[0-9+\-#b°]+$/.test(p)) { rest += p; continue; }   // extension tail
    return false;
  }
  const leftover = rest.toLowerCase()
    .replace(/(maj|min|dim|aug|sus|add)/g, '')
    .replace(/[mb#°().,+\-0-9]/g, '');
  return leftover === '';
}

function candidateNames(chordName) {
  if (!looksLikeChordName(chordName)) return [];
  const m = (chordName || '').match(/^([A-G][#b]?)(.*)$/);
  if (!m) return [];
  const root = m[1];

  const out = [];
  // Slash handling mirrors looksLikeChordName: a bass-note part is dropped
  // (Am/G matches on Am); extension parts fold into the suffix (Bm7/5- is
  // analyzed as Bm75-). The full name is tried first (G/B-style entries exist).
  const parts = m[2].split('/');
  let rest = parts[0];
  for (const p of parts.slice(1)) {
    if (/^[0-9+\-#b°]+$/.test(p)) rest += p;
  }
  out.push(root + rest);

  const minor = /^m(?!aj)/i.test(rest);            // "m…" but not "maj…"
  const q = rest.toLowerCase();

  if (/(7m|maj7)/.test(q)) out.push(root + 'maj7');            // F7M, DM7, F7M9…
  if (/(m7(b5|5-|-5|\/5-)|m75-)/.test(q)) out.push(root + 'dim', root + 'm7');
  if (/(dim|°)/.test(q)) out.push(root + 'dim');
  if (/(aug|\+|5\+)/.test(q) && !minor) out.push(root + 'aug');
  if (/(sus4|^4|4)/.test(q) && !minor) out.push(root + 'sus4'); // D4, A74, F#47…
  if (/(sus2|^2|add2|2)/.test(q) && !minor) out.push(root + 'sus2');
  if (minor) {
    if (/7/.test(q)) out.push(root + 'm7');
    out.push(root + 'm6', root + 'm');
  } else {
    if (/9/.test(q)) out.push(root + '9', root + 'add9');
    if (/7/.test(q)) out.push(root + '7');
    if (/6/.test(q)) out.push(root + '6');
    if (/^5/.test(q)) out.push(root + '5');
  }
  // Last resort: the bare triad.
  out.push(minor ? root + 'm' : root);
  return out;
}

/**
 * All known voicings for a chord name (unsorted). Resolves enharmonic
 * spellings (Bb ↔ A#), real-sheet notation (F7M, D4, A2, Bm75-…) and slash
 * basses to the closest catalogued shape, per the CLAUDE.md chord-library
 * rule: every chord that appears anywhere must render and play. Returns []
 * only when even the bare triad has no shape on file.
 */
export function lookupVoicings(chordName) {
  const direct = directHit(chordName);
  if (direct) return direct;
  for (const candidate of candidateNames(chordName)) {
    const hit = directHit(candidate);
    if (hit) return hit;
  }
  return [];
}

// A barre voicing (tagged "(barre)" in its type) scores LOW on the reach-diagonal
// metric because the fingers cluster tightly — e.g. barre C (x35553) scores 4.9
// vs open C (x32010) at 5.4. But holding a full barre is HARDER for a real hand
// (especially the short-fingered target user), not easier. So when picking the
// shape to SHOW, add a penalty to barres: an open/partial shape wins unless a
// barre is meaningfully easier on the raw score, or is the only shape on file.
const BARRE_DISPLAY_PENALTY = 1.5;
function isBarreVoicing(v) {
  return /barre/i.test(v?.type || '');
}
function displayScore(v) {
  return v.score + (isBarreVoicing(v) ? BARRE_DISPLAY_PENALTY : 0);
}

/**
 * The easiest voicing to SHOW for a chord, or null when the chord isn't in the
 * library. "Easiest" here is playability for a real hand, not just the raw
 * reach-diagonal score: barre shapes are penalized (see displayScore) so an open
 * shape is preferred whenever one exists and isn't drastically harder — the open
 * C, not the barre C, is what a beginner should be shown.
 *
 * When a hand `profile` is passed AND the user has asked to be limited to their
 * reach, this prefers the easiest such voicing that is WITHIN their comfortable
 * reach. If no catalogued shape qualifies (e.g. an inherently hard chord) it
 * still returns the overall easiest — the CLAUDE.md rule that every chord stays
 * playable everywhere wins over the preference.
 *
 * @param {string} chordName
 * @param {object} [opts]  { profile, limitToReach }
 */
export function easiestVoicing(chordName, opts = {}) {
  const list = lookupVoicings(chordName);
  if (!list.length) return null;
  // Sort by the display score (raw difficulty + barre penalty) so open shapes
  // beat barres of similar raw difficulty, but reach-gating still uses the true
  // (unpenalized) score.
  const sorted = list.slice().sort((a, b) => displayScore(a) - displayScore(b));
  const { profile, limitToReach } = opts;
  if (limitToReach && profile) {
    const inReach = sorted.find(v => isWithinReach(v.score, profile));
    if (inReach) return inReach;
  }
  return sorted[0];
}

/**
 * Every catalogued chord name (deduped, in library order) — for the editor's
 * manual chord picker.
 */
export function allChordNames() {
  return [...CHORD_MAP.keys()];
}

export { CHORD_MAP };

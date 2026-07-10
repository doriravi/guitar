// "My style" — a lightweight musical-style profile for the composer.
//
// Two sources, merged (per the user's choice):
//   1. LEARNED — derived automatically from the songs the user has saved
//      (loadCustomSongs): which keys, chord qualities, tempo and progressions
//      they gravitate toward.
//   2. MANUAL  — explicit settings the user picks in the Recorder's style panel
//      (genre, scale flavor, chord colors, tempo), persisted to localStorage.
//
// The composer (melody→song, solo generation) reads getActiveStyle() and biases
// its choices toward it: e.g. a bluesy profile prefers dominant 7ths and the
// blues scale; a saved-song set full of minor keys biases the detected key
// minor when ambiguous.

import { loadCustomSongs } from './customSongs';

const KEY = 'guitar_style_profile';

// Scale flavors the composer can lean on when generating a melody/solo.
export const SCALE_FLAVORS = ['auto', 'major', 'minor', 'pentatonic', 'blues', 'dorian'];
// Chord "colors" — extensions the composer may add to plain triads.
export const CHORD_COLORS = ['clean', '7ths', 'sus', 'add9', 'jazzy'];
export const GENRES = ['auto', 'pop', 'rock', 'folk', 'blues', 'metal', 'jazz'];

export const DEFAULT_STYLE = {
  genre: 'auto',
  scaleFlavor: 'auto',   // one of SCALE_FLAVORS
  chordColor: 'clean',   // one of CHORD_COLORS
  tempo: 0,              // 0 = auto (use learned/So default); else BPM
};

// ── Manual settings (persisted) ──────────────────────────────────────────────

export function loadStyle() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_STYLE, ...JSON.parse(raw) } : { ...DEFAULT_STYLE };
  } catch { return { ...DEFAULT_STYLE }; }
}

export function saveStyle(style) {
  try { localStorage.setItem(KEY, JSON.stringify(style)); } catch {}
}

// ── Learned profile (derived from saved songs) ───────────────────────────────

const MINOR_HINT = /m(?!aj)/; // a lowercase m not followed by "aj" → minor-ish

// Inspect the user's saved songs and summarize their tendencies.
export function learnStyle(songs = loadCustomSongs()) {
  const keyCount = {};       // "C major" → n
  const qualityCount = {};   // 'minor' | 'seventh' | 'sus' | 'add' | 'major'
  let bpmSum = 0, bpmN = 0;
  let chordN = 0;

  for (const s of songs) {
    if (s.key) {
      const k = `${s.key} ${s.scaleType === 'minor' ? 'minor' : 'major'}`;
      keyCount[k] = (keyCount[k] || 0) + 1;
    }
    if (s.bpm) { bpmSum += s.bpm; bpmN++; }

    // Walk every chord name used across lyric lines to tally chord colors.
    for (const ln of (s.lyricLines || [])) {
      for (const name of (ln.chordNames || [])) {
        chordN++;
        const body = name.replace(/^[A-G][#b]?/, ''); // strip the root
        if (/7/.test(body)) bump(qualityCount, 'seventh');
        else if (/sus/.test(body)) bump(qualityCount, 'sus');
        else if (/add|9|6/.test(body)) bump(qualityCount, 'add');
        else if (MINOR_HINT.test(body)) bump(qualityCount, 'minor');
        else bump(qualityCount, 'major');
      }
    }
  }

  const topKey = top(keyCount);
  const avgBpm = bpmN ? Math.round(bpmSum / bpmN) : 0;
  return {
    songCount: songs.length,
    topKey,                                   // e.g. "A minor" | null
    minorLeaning: (qualityCount.minor || 0) > (qualityCount.major || 0),
    likesSevenths: chordN > 0 && (qualityCount.seventh || 0) / chordN > 0.15,
    avgBpm,
    chordN,
  };
}

function bump(obj, k) { obj[k] = (obj[k] || 0) + 1; }
function top(obj) {
  let best = null, n = -1;
  for (const [k, v] of Object.entries(obj)) if (v > n) { n = v; best = k; }
  return best;
}

// ── Active style = manual over learned ───────────────────────────────────────

// The effective style the composer should use, folding manual settings over the
// learned profile. `auto`/0 fields fall back to what was learned from songs.
export function getActiveStyle() {
  const manual = loadStyle();
  const learned = learnStyle();

  // Resolve scale flavor: manual wins; else lean minor/major from learned.
  let scaleFlavor = manual.scaleFlavor;
  if (scaleFlavor === 'auto') scaleFlavor = learned.minorLeaning ? 'minor' : 'major';

  // Resolve chord color: manual wins; else prefer 7ths if the user uses them.
  let chordColor = manual.chordColor;
  if (chordColor === 'clean' && manual.chordColor === 'clean' && learned.likesSevenths) {
    // Only auto-upgrade when the user hasn't explicitly set a color and clearly
    // favors sevenths in their saved songs.
    chordColor = '7ths';
  }

  // Resolve tempo: manual wins; else learned average; else 90.
  const tempo = manual.tempo || learned.avgBpm || 90;

  return {
    genre: manual.genre,
    scaleFlavor,
    chordColor,
    tempo,
    learned,
  };
}

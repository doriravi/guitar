// Reach-driven capo optimizer.
//
// A capo lets a short-fingered player restate a barre-heavy song as easy open
// shapes: clamp the capo on fret F and every open-position shape you fret sounds
// F semitones HIGHER. So to sound a song chord C you fret the shape for
// transposeDown(C, F) and the capo raises it back to C.
//
// The OLD heuristic (lyricChords.suggestCapo) just COUNTED how many roots landed
// on the five "easy open" letters {C,A,G,E,D}. That's a rough proxy — it can't
// tell an easy open shape from a hard one, and it ignores the actual hand doing
// the fretting. This module replaces that with the real signal the whole app is
// built on: the reach engine. For each candidate capo fret we look up the easiest
// catalogued voicing of every transposed-down shape and SUM its calcDifficulty
// (the exact Euclidean mm reach, optionally personalized to the user's hand). The
// capo that minimises total reach wins; ties break to the lowest fret.
//
// The KEY physics point (mirrored by ProgressionExplorer's playback shift): reach
// is scored on the SHAPE UNDER THE FINGERS — the transposed-down open shape's
// notes — never on the sounding pitch. capoPlaybackTab then shifts that shape up
// by the capo fret so it sounds at the original pitch on playback.
//
// Pure JS: no React, no network. This is the single source of the pitch-class
// helpers; lyricChords.js imports them from here so there's exactly one NOTE_TO_PC.

import { calcDifficulty } from './fretboard';
import { easiestVoicing } from './voicingLookup';

// ─── Pitch-class helpers (the single copy — lyricChords re-imports these) ──────

// Pitch classes for roots, sharp-spelled.
export const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
export const PC_TO_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Roots whose common open chords are EASY (no barre needed) in standard tuning.
export const EASY_OPEN_ROOTS = new Set(['C', 'A', 'G', 'E', 'D']);

// Roots that force a barre in any common voicing — these are what make a song
// "hard" and worth a capo suggestion. F is intentionally NOT here: it has a
// widely-used easy partial shape, so an F in an otherwise-open song shouldn't
// by itself trigger a whole-song capo.
export const HARD_ROOTS = new Set(['Bb', 'A#', 'Eb', 'D#', 'Ab', 'G#', 'Db', 'C#', 'Gb', 'F#', 'B']);

/** Split a chord name into { root, suffix } (e.g. "F#m7" → { root:'F#', suffix:'m7' }). */
export function parseRoot(chordName) {
  const m = (chordName || '').match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  return { root: m[1], suffix: m[2] };
}

/**
 * Transpose a chord name DOWN by `semitones`, keeping its suffix. This is the
 * shape you actually fret behind a capo: fret transposeDown(C, F), the capo on
 * fret F raises it back to sounding C.
 */
export function transposeDown(chordName, semitones) {
  const p = parseRoot(chordName);
  if (!p) return chordName;
  const pc = NOTE_TO_PC[p.root];
  if (pc == null) return chordName;
  const shaped = ((pc - semitones) % 12 + 12) % 12;
  return PC_TO_SHARP[shaped] + p.suffix;
}

/**
 * Transpose a chord name UP by `semitones`, keeping its suffix — the inverse of
 * transposeDown. The SOUNDING pitch of an open shape X played behind a capo on
 * fret F is transposeUp(X, F).
 */
export function transposeUp(chordName, semitones) {
  const p = parseRoot(chordName);
  if (!p) return chordName;
  const pc = NOTE_TO_PC[p.root];
  if (pc == null) return chordName;
  const shaped = ((pc + semitones) % 12 + 12) % 12;
  return PC_TO_SHARP[shaped] + p.suffix;
}

// ─── Barre trigger (decision #1) ───────────────────────────────────────────────

// A barre voicing is tagged "(barre)" in its type — same detection as
// voicingLookup.isBarreVoicing (kept local so this module stays self-contained).
function isBarreVoicing(v) {
  return /barre/i.test(v?.type || '');
}

// True when a chord FORCES a barre for a short-fingered player: either its
// easiest catalogued voicing is a barre, or its root is one of the HARD_ROOTS
// (a black-key / B root whose common open shapes all need a barre). These are the
// chords a capo exists to remove.
export function forcesBarre(name, profile) {
  const p = parseRoot(name);
  if (p && HARD_ROOTS.has(p.root)) return true;
  const v = easiestVoicing(name, { profile });
  return !!(v && isBarreVoicing(v));
}

// ─── Scoring ───────────────────────────────────────────────────────────────────

// Reach of a single chord = calcDifficulty of its easiest voicing's fretted
// notes. `profile` is optional: with it, small hands score wide shapes harder;
// without it, calcDifficulty falls back to the population-average score. A chord
// with NO catalogued shape can't be fretted here, so it's penalized heavily
// (NO_SHAPE_PENALTY) — a capo fret that leaves a chord unplayable should never win.
const NO_SHAPE_PENALTY = 12;

// A barre shape scores LOW on the raw reach-diagonal metric (the fingers cluster
// tightly), yet holding a full barre is HARDER for a real — especially short-
// fingered — hand than an open shape of the same span. voicingLookup applies the
// same correction when choosing which shape to SHOW (BARRE_DISPLAY_PENALTY). The
// capo optimizer MUST apply it too: without it, bestCapo can "win" by recommending
// a high capo whose transposed shape is itself a barre (e.g. Eb → capo 6, F#m
// barre), which defeats the whole point ("play OPEN shapes instead of barres") and
// pushes fretted notes past fret 9 (see capoPlaybackTab). Penalizing barres here
// steers the optimizer toward genuinely open shapes at a lower capo.
const BARRE_REACH_PENALTY = 1.5;

function scoreChord(name, profile) {
  const v = easiestVoicing(name, { profile });
  if (!v || !v.notes?.length) return { voicing: null, score: NO_SHAPE_PENALTY };
  // Reach is on the SHAPE UNDER THE FINGERS. calcDifficulty personalizes only
  // when a profile is passed — call it with one arg for the population average.
  const raw = profile ? calcDifficulty(v.notes, profile) : calcDifficulty(v.notes);
  const score = raw + (isBarreVoicing(v) ? BARRE_REACH_PENALTY : 0);
  return { voicing: v, score };
}

// Sum the reach of a whole chord set once every name has been transposed down by
// `fret` (fret 0 = no capo = the chords as written). Also counts how many of the
// chosen shapes are still barres — the tie-breaker that lets an all-open capo win
// over a slightly-lower-total one that leaves a barre (see bestCapo).
function totalReachAt(names, fret, profile) {
  let total = 0;
  let barres = 0;
  const shapes = [];
  for (const orig of names) {
    const capoName = transposeDown(orig, fret);
    const { voicing, score } = scoreChord(capoName, profile);
    total += score;
    if (voicing && isBarreVoicing(voicing)) barres += 1;
    shapes.push({ orig, capoName, voicing, score: round2(score) });
  }
  return { total, barres, shapes };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ─── The optimizer ─────────────────────────────────────────────────────────────

// How high a capo we'll ever suggest. 7 covers every practical restatement
// (beyond that the neck runs out and the tone thins).
const MAX_CAPO_FRET = 7;

/**
 * Reach-driven best capo for a set of chord names.
 *
 * @param {string[]} chordNames  chord names used in the song/section (dupes ok)
 * @param {object}   [profile]   the active hand profile; omit for population avg
 * @returns {null | {
 *   fret:number,                 // 0..7 recommended capo fret
 *   map: Record<string,string>,  // origName → transposed-down OPEN shape you fret
 *   shapes: Array<{ orig, capoName, voicing:(object|null), score:number }>,
 *   totalBefore:number,          // summed reach of the easiest voicings at capo 0
 *   totalAfter:number,           // summed reach behind the chosen capo
 *   savings:number               // totalBefore - totalAfter (>0 ⇒ capo helps)
 * }}
 *   null when nothing forces a barre (decision #1), or when no capo beats capo 0.
 */
export function bestCapo(chordNames, profile) {
  const names = [...new Set((chordNames || []).filter(Boolean))];
  if (!names.length) return null;

  // Decision #1 — only suggest a capo when the progression actually contains a
  // barre-forcing chord. An all-open song (C/G/Am/F) gets no pointless capo.
  if (!names.some(n => forcesBarre(n, profile))) return null;

  // Score every candidate fret (0 = no capo = the chords as written).
  const candidates = [];
  for (let fret = 0; fret <= MAX_CAPO_FRET; fret++) {
    candidates.push({ fret, ...totalReachAt(names, fret, profile) });
  }
  const base = candidates[0];
  const totalBefore = round2(base.total);

  // Decision #2 — minimise TOTAL reach. But the feature is "play OPEN shapes
  // instead of barres", so when an ALL-OPEN capo exists within a small reach
  // margin of the lowest-total one, prefer it: fewer leftover barres beats a
  // slightly-lower total (user's call). Selection order among candidates:
  //   1. among frets within OPEN_MARGIN reach of the min total → fewest barres,
  //   2. then lowest total, 3. then lowest fret.
  // The margin (≈ one moderate chord) keeps this from ever choosing a much harder
  // capo just to shed a barre; a genuinely inherent barre (no open shape on file,
  // e.g. Cm→F#m) can still remain when no nearby capo removes it.
  const OPEN_MARGIN = 4.0;
  const minTotal = Math.min(...candidates.map(c => c.total));
  const contenders = candidates.filter(c => c.total <= minTotal + OPEN_MARGIN);
  contenders.sort((a, b) =>
    (a.barres - b.barres) ||          // fewest barres first
    (a.total - b.total) ||            // then lowest total reach
    (a.fret - b.fret));               // then lowest capo fret
  const best = contenders[0];

  // Capo didn't help: the winner is "no capo", or it doesn't beat no-capo on total
  // reach (a small epsilon guards floating-point ties).
  const EPS = 0.01;
  if (best.fret === 0 || best.total >= base.total - EPS) return null;

  const map = {};
  for (const s of best.shapes) map[s.orig] = s.capoName;

  // The original chords that force a barre — what the banner names to explain WHY
  // a capo helps ("this song needs barre chords like Bb, Eb…").
  const hardChords = names.filter(n => forcesBarre(n, profile));

  return {
    fret: best.fret,
    map,
    shapes: best.shapes,
    hardChords,
    totalBefore,
    totalAfter: round2(best.total),
    savings: round2(base.total - best.total),
  };
}

// ─── Playback shift ──────────────────────────────────────────────────────────────

/**
 * Shift a voicing's tab UP by `fret` so the open-position shape SOUNDS at the
 * capo'd pitch — exactly what a real capo does: it presses every string at that
 * fret, so open (0) strings move to the capo fret and fretted notes move up by
 * the same amount. Muted (x) strings stay muted.
 *
 * Centralized here so every surface (Progressions, Play-Along, Song Editor…)
 * plays a capo'd shape identically. The tab format holds ONE digit per string
 * (the audio synth reads it char-by-char), so a shifted fret must stay 0–9. The
 * barre penalty in scoreChord keeps the optimizer on low open shapes, so a
 * post-shift fret >9 is rare; if one ever occurs we MUTE that string rather than
 * clamp it to 9 — a dropped string is honest, a clamped one plays a WRONG pitch
 * (a semitone flat) and would teach the ear the wrong chord.
 *
 * @param {{tab:string}} voicing  the OPEN shape being fretted behind the capo
 * @param {number} fret           capo fret (0 leaves the tab unchanged)
 * @returns {string} the 6-char shifted tab
 */
export function capoPlaybackTab(voicing, fret) {
  const tab = voicing?.tab || 'xxxxxx';
  if (!fret) return tab;
  return tab.split('').map(ch => {
    if (ch === 'x') return 'x';                       // muted stays muted
    const f = parseInt(ch, 10);
    if (Number.isNaN(f)) return ch;
    const shifted = f + fret;                         // open (0) → capo fret too
    return shifted > 9 ? 'x' : String(shifted);       // unrepresentable → mute, never mis-pitch
  }).join('');
}

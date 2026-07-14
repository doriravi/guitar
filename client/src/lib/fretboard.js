// Standard tuning: strings 0-5 = E2, A2, D3, G3, B3, E4
export const STANDARD_TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
export const NUM_STRINGS = 6;
export const NUM_FRETS = 22;

// Physical fretboard geometry is now shared with the Fretboard Measures
// visualizer (lib/geometry.js): exact equal-temperament ("Rule of 18") fret
// spacing and the real tapered string span, in mm. calcDifficulty and every
// distance below measure through it, so the number the app scores and the
// picture the tool draws are the same physics.
import { CLASSICAL, maxReachMm } from './geometry';

// Physical distance in mm along the neck between two fret positions on one
// string (kept for the transition model's neck-shift term). Measured through
// the shared geometry so it uses the real Rule-of-18 spacing.
function fretDistanceMm(fret1, fret2) {
  return Math.abs(CLASSICAL.noteX(fret2) - CLASSICAL.noteX(fret1));
}

// Calibration of the difficulty curve, tuned so the exact geometry reproduces
// the app's established 1–10 scale (open chords ~2.4–4.8, barres ~5.1–5.8) —
// the scale every downstream ceiling (LEVEL_CEILINGS, diffMax, "limit to my
// reach") is calibrated against. Fitting the exact max-pair reach (mm) of the
// real library shapes to their prior scores gives DIV≈126, EXP≈1.32:
//   ~9mm  (Em)              → ~1.3
//   ~18mm (A)               → ~1.7
//   ~35mm (D)               → ~2.6
//   ~49mm (G)               → ~3.6
//   ~62mm (D barre)         → ~4.5
//   ~74mm (C / full F barre)→ ~5.4
//   ≥165mm                  → 10
const REACH_DIVISOR = 126;
const REACH_EXPONENT = 1.32;

// Map a physical max-pair reach (mm) onto the 1–10 difficulty scale.
function reachToScore(reachMm) {
  const score = 1 + 9 * Math.pow(reachMm / REACH_DIVISOR, REACH_EXPONENT);
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}

/**
 * Calculate reach difficulty score (1-10) for a set of fret positions.
 *
 * The raw geometry is the exact Euclidean stretch (mm) between the two
 * furthest-apart notes of the shape, measured on the real classical neck
 * (lib/geometry.js) — the SAME distance the Fretboard Measures tool shows.
 *
 * When a hand `profile` is supplied, the score is additionally scaled by how
 * far the shape over-taxes THAT hand's actual finger spans (handStrainFactor,
 * the per-finger reach model): a small hand feels a wide shape as strictly
 * harder, an average hand sees the population-average geometry unchanged. Called
 * with one argument (the module-load voicing caches, the "limit to reach"
 * filters) it returns the population-average score, unchanged in meaning.
 *
 * @param {Array<{string: number, fret: number}>} notes  - array of {string (0-5), fret (0-22)}
 * @param {object} [profile]  - optional hand profile (span measurements in cm)
 * @returns {number} score 1-10
 */
export function calcDifficulty(notes, profile) {
  if (!notes || notes.length < 2) return 1;

  // Exact diagonal stretch (mm) between the two furthest notes — one geometry,
  // shared with the visualizer.
  const reachMm = maxReachMm(notes, CLASSICAL);
  let score = reachToScore(reachMm);

  // Personalize: fold in how much this shape over-taxes the given hand.
  if (profile) {
    score = Math.min(10, score * handStrainFactor(notes, profile));
    score = Math.round(score * 10) / 10;
  }
  return score;
}

// Reference comfortable gap maxima (cm), 95th percentile
export const GAP_REF_MAX = { thumbToIndex: 9.5, indexToMiddle: 6.5, middleToRing: 5.0, ringToLittle: 7.5 };

// Fret spacing in cm (same model as mm version above, converted)
function fretSpacingCm(fret) {
  return Math.max(1.8, 3.5 - fret * 0.077);
}

function fretDistanceCm(f1, f2) {
  const lo = Math.min(f1, f2);
  const hi = Math.max(f1, f2);
  let d = 0;
  for (let f = lo; f < hi; f++) d += fretSpacingCm(f);
  return d;
}

/**
 * For a chord's notes, compute how many cm each adjacent finger pair must span,
 * and express that as a fraction of the reference maximum for that pair.
 * Returns { thumbToIndex, indexToMiddle, middleToRing, ringToLittle } — each 0..1+
 * Returns null when the chord has fewer than 1 fretted note.
 *
 * Finger assignment comes from optimalFingering, so a BARRE is respected: the
 * index barres one fret (it does not "reach" up to the next finger's fret), and
 * gaps are measured between the frets where CONSECUTIVE fingers actually land.
 * Earlier this naïvely mapped distinct frets → index,middle,ring,pinky, which
 * mis-read a barre like C(x35553): it reported a 6.5 cm index→middle stretch
 * (fret 3→5) when the index is flat-barred on 3 and the middle isn't the finger
 * on 5 at all — flagging an easy barre as "135% of capacity".
 */
export function fingerGapUsage(notes) {
  if (!notes || notes.length === 0) return null;
  const fing = optimalFingering(notes);
  if (!fing) return null;

  // The fret each finger (1=index…4=pinky) presses. For a barre, the index is
  // pinned to the barre fret. Take the lowest fret a finger touches as its spot.
  const fretByFinger = new Map();
  for (const a of fing.assignment) {
    const cur = fretByFinger.get(a.finger);
    if (cur == null || a.fret < cur) fretByFinger.set(a.finger, a.fret);
  }
  const idx = fretByFinger.get(1);
  const mid = fretByFinger.get(2);
  const ring = fretByFinger.get(3);
  const pinky = fretByFinger.get(4);

  // A BARRE changes what the gaps mean. The index lies FLAT across the barre
  // fret — it is not part of a finger-to-finger splay, and the notes above the
  // barre are pressed by the free fingers (middle/ring/pinky) with the whole
  // hand supporting them, not by an index→middle scissor stretch. So for a barre
  // we drop the thumb→index and index→middle splay terms (they don't describe a
  // real stretch here) and only score the splay AMONG the free fingers above the
  // barre. This stops normal barre shapes like C(x35553) from being flagged as a
  // 2-fret "index→middle" over-stretch the player never actually performs.
  const barred = fing.barreFret != null;

  const anchorFret = idx ?? mid ?? ring ?? pinky ?? 0;
  const ti = barred ? 0 : fretDistanceCm(Math.max(0, anchorFret - 2), anchorFret);
  const im = !barred && idx != null && mid != null ? fretDistanceCm(idx, mid) : 0;
  const mr = mid != null && ring != null ? fretDistanceCm(mid, ring) : 0;
  const rp = ring != null && pinky != null ? fretDistanceCm(ring, pinky) : 0;

  return {
    thumbToIndex:  ti / GAP_REF_MAX.thumbToIndex,
    indexToMiddle: im / GAP_REF_MAX.indexToMiddle,
    middleToRing:  mr / GAP_REF_MAX.middleToRing,
    ringToLittle:  rp / GAP_REF_MAX.ringToLittle,
  };
}

/**
 * Suggest an optimal left-hand fingering for a chord shape.
 *
 * Given the fretted notes of a voicing, assign a finger (1=index, 2=middle,
 * 3=ring, 4=pinky) to each, optionally collapsing same-fret notes onto a single
 * barring finger. We follow real fretting constraints:
 *
 *   - Frets map to fingers monotonically: a note on a lower fret never gets a
 *     higher-numbered finger than a note on a higher fret.
 *   - When two or more notes sit on the lowest fret across non-adjacent or
 *     multiple strings, the index finger barres them (one finger, many strings).
 *   - Open (fret 0) and muted strings need no finger.
 *
 * @param {Array<{string:number, fret:number}>} notes - the chord's notes
 * @returns {{
 *   assignment: Array<{string:number, fret:number, finger:number, barre:boolean}>,
 *   barreFret: number|null,
 *   fingersUsed: number,
 *   difficulty: number
 * } | null}  null when there are no fretted notes (all open/muted)
 */
export function optimalFingering(notes) {
  const fretted = (notes || []).filter(n => n.fret > 0);
  if (fretted.length === 0) return null;

  const minFret = Math.min(...fretted.map(n => n.fret));

  // Detect a barre. The index finger barres the lowest fret only when it must
  // cover multiple strings AND there are higher-fret notes that need the other
  // fingers free — e.g. an F or Bm7 barre. Two adjacent notes on the lowest
  // fret with nothing above them (like Em) are played with separate fingers,
  // not a barre, so we don't force one there.
  const onMinFret = fretted.filter(n => n.fret === minFret);
  const minFretStrings = onMinFret.map(n => n.string);
  const barreSpan = onMinFret.length >= 2
    ? Math.max(...minFretStrings) - Math.min(...minFretStrings)
    : 0;
  // Barre when the index must cover a wide span on the lowest fret (3+ strings),
  // which is the unambiguous case. Narrower same-fret pairs (like Em or open-D
  // shapes) are played with separate fingers, so we leave them un-barred.
  const useBarre = onMinFret.length >= 3 || (onMinFret.length >= 2 && barreSpan >= 3);

  const assignment = [];
  let barreFret = null;

  if (useBarre) {
    barreFret = minFret;
    for (const n of onMinFret) {
      assignment.push({ string: n.string, fret: n.fret, finger: 1, barre: true });
    }
  }

  // Remaining notes (above the barre, or all notes if no barre) get fingers
  // assigned in fret order. With a barre, the index is used, so we start at
  // the middle finger (2); without, we start at the index (1).
  const remaining = fretted
    .filter(n => !(useBarre && n.fret === minFret))
    .sort((a, b) => a.fret - b.fret || a.string - b.string);

  let nextFinger = useBarre ? 2 : 1;
  for (const n of remaining) {
    const finger = Math.min(4, nextFinger);
    assignment.push({ string: n.string, fret: n.fret, finger, barre: false });
    nextFinger++;
  }

  // Distinct fingers actually used (a barre counts once).
  const fingersUsed = new Set(assignment.map(a => a.finger)).size;

  return {
    assignment: assignment.sort((a, b) => a.string - b.string),
    barreFret,
    fingersUsed,
    difficulty: calcDifficulty(fretted),
  };
}

/**
 * How much of the fretting hand has to REORGANIZE to get from shape A to shape B,
 * as a 0..1 fraction (0 = nothing moves, 1 = full rebuild). Built from the
 * reach-cost primitives the rest of the engine uses:
 *
 *   - Anchor share: fretted notes held on the identical string+fret in both
 *     shapes don't move. The more of the (larger) shape is anchored, the less
 *     reorganizes. A shared barre fret anchors every barred note.
 *   - Neck shift: how far the index-finger anchor (lowest fret) slides, relative
 *     to a ~5-fret "big move", added on top.
 *   - Into-a-barre floor: forming a barre recommits the whole hand — a near-full
 *     reorganization regardless of how many notes happen to line up. Waived when
 *     BOTH shapes barre the same fret (the index never lifts — a real anchor).
 *
 * Both inputs are already fretted-only note arrays. Returns 0..1.
 */
function reorganizationFraction(a, b) {
  const keyOf = n => `${n.string}:${n.fret}`;
  const setB = new Set(b.map(keyOf));
  const anchored = a.filter(n => setB.has(keyOf(n))).length;
  const anchorShare = anchored / Math.max(a.length, b.length);      // 0..1 held still

  const anchorA = Math.min(...a.map(n => n.fret));
  const anchorB = Math.min(...b.map(n => n.fret));
  const shiftFrac = Math.min(1, fretDistanceMm(anchorA, anchorB) / 160); // ~5 frets ≈ 1

  let reorg = Math.min(1, (1 - anchorShare) * 0.85 + shiftFrac * 0.4);

  const fa = optimalFingering(a);
  const fb = optimalFingering(b);
  const sameBarre = fa?.barreFret != null && fa.barreFret === fb?.barreFret;
  const intoBarre = !sameBarre && (fa?.barreFret != null || fb?.barreFret != null);
  if (intoBarre) reorg = Math.max(reorg, 0.9);

  return reorg;
}

/**
 * Score the difficulty of CHANGING from one chord shape to another (1-10), for
 * the population-average hand. (scoreTransition adds hand-profile personalization
 * on top of this.)
 *
 * Switching chords smoothly is the #1 struggle for most players. For a real
 * fretting hand the cost is dominated by the harder GRIP you have to form,
 * modulated by how much the hand physically reorganizes to get there:
 *
 *   - Grip cost: how hard the harder of the two shapes is to hold (calcDifficulty).
 *     Switching into an F barre is hard mostly because the barre is hard, even
 *     when the hand barely slides.
 *   - Reorganization: total finger travel, neck reposition, and common-tone /
 *     shared-barre anchors, folded into a 0..1 share of a full rebuild
 *     (reorganizationFraction). It SCALES the grip cost rather than competing
 *     with it: a self-transition (nothing moves) collapses toward trivial; a
 *     full reshuffle pays the grip in full.
 *
 * This deliberately does NOT use average nearest-note travel as the backbone —
 * that mis-rates common open changes (it inflates G→C on phantom travel between
 * mismatched string layouts) and lets the anchor discount floor genuinely hard
 * barre changes (C→F barre) to trivial. Grip-anchoring fixes both.
 *
 * Open-string and muted notes carry no fretting-hand cost. Two chords that are
 * identical, or differ only by open strings, score ~1 (trivial).
 *
 * @param {Array<{string:number, fret:number}>} notesA - first chord's fretted notes
 * @param {Array<{string:number, fret:number}>} notesB - second chord's fretted notes
 * @returns {number} score 1-10
 */
export function transitionDifficulty(notesA, notesB) {
  const a = (notesA || []).filter(n => n.fret > 0);
  const b = (notesB || []).filter(n => n.fret > 0);

  // No fretting on one side (e.g. all-open chord) → just place/lift the hand.
  if (a.length === 0 || b.length === 0) return 1;

  // Backbone: how hard the harder of the two grips is to form.
  const grip = Math.max(calcDifficulty(a), calcDifficulty(b));

  // Reorganization drives how much of that grip cost you actually pay.
  const reorg = reorganizationFraction(a, b);
  const movementMult = 0.15 + 1.05 * reorg;                        // 0.15 .. 1.20

  const score = grip * movementMult;
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}

// Population-average hand spans (cm), the reference used to personalize a
// transition. Mirrors handProfile.DEFAULT_PROFILE — duplicated here (as a small
// literal) so fretboard.js stays free of a handProfile import and the two
// modules don't form an import cycle. Keep in sync if the defaults change.
const DEFAULT_HAND = { thumbToIndex: 7.5, indexToMiddle: 4.5, middleToRing: 3.5, ringToLittle: 5.5 };

// Pull the fretted notes out of whatever the caller passed for a chord: a raw
// notes array [{string,fret}], or a voicing object { notes: [...] }. Returns []
// for null/empty/open-only inputs. (Name-string → voicing resolution lives in
// the UI layer, which owns the chord catalog; the physics core stays pure.)
function chordNotes(chord) {
  if (!chord) return [];
  const notes = Array.isArray(chord) ? chord : Array.isArray(chord.notes) ? chord.notes : [];
  return notes.filter(n => n && n.fret > 0);
}

/**
 * How much the DESTINATION shape over-taxes this hand, as a factor ≥ 1.
 *
 * Reuses fingerGapUsage (the same per-finger reach-cost model that powers the
 * hand-profile bars): each adjacent finger-pair's required span in cm, divided
 * by the user's actual span for that pair. The single worst-stretched pair
 * drives the factor — a chord is as hard to grab as its tightest joint. An
 * average hand on an average shape lands ~1.0 (no penalty); a small hand
 * reaching a wide shape lands >1. The effect is damped (^0.5) so small hands
 * play harder, but not linearly — they adapt with technique, matching how
 * handProfile.personalDifficulty treats static shapes.
 */
function handStrainFactor(notes, profile) {
  const usage = fingerGapUsage(notes);          // fractions of the REFERENCE max per pair
  if (!usage) return 1;
  const p = { ...DEFAULT_HAND, ...(profile || {}) };
  let worst = 0;
  for (const key of Object.keys(GAP_REF_MAX)) {
    const requiredCm = usage[key] * GAP_REF_MAX[key];   // undo the ref-max normalization
    const userCm = p[key];
    if (requiredCm <= 0 || userCm <= 0) continue;
    worst = Math.max(worst, requiredCm / userCm);       // 1.0 = right at this hand's limit
  }
  if (worst <= 0) return 1;
  return Math.max(1, Math.pow(worst, 0.5));
}

/**
 * Personalized chord-CHANGE difficulty (1-10) for a specific hand.
 *
 * `scoreTransition(chordA, chordB, handProfile)` is the hand-aware entry point
 * for "how hard is it to switch between these two chords?". It is the
 * population-average change cost — transitionDifficulty(), which already models
 * the harder grip you form and how much the hand reorganizes — scaled by how far
 * that shape over-taxes THIS hand (handStrainFactor, built on fingerGapUsage). A
 * small hand pays more; an average hand sees the base cost unchanged.
 *
 * chordA / chordB may each be a notes array [{string,fret}] or a voicing object
 * { notes }. handProfile is optional (defaults to the average hand). Returns
 * 1-10, one decimal — the same scale as every other difficulty in the app.
 */
export function scoreTransition(chordA, chordB, handProfile) {
  const a = chordNotes(chordA);
  const b = chordNotes(chordB);

  // Population-average change cost (grip backbone + reorganization).
  const base = transitionDifficulty(a, b);

  // A change with no fretting on one side (all-open chord) is trivial no matter
  // the hand — placing/lifting, no stretch or grip to personalize.
  if (a.length === 0 || b.length === 0) return base;

  // Personalize by the shape that over-taxes THIS hand the most.
  const strain = Math.max(handStrainFactor(a, handProfile), handStrainFactor(b, handProfile));
  const score = base * strain;

  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}

/**
 * Build a full difficulty table for all pairs of frets (0-maxFret) across strings.
 * Returns array of { fret1, fret2, fretSpan, stringSpan, score }
 */
export function buildDifficultyTable(maxFret = 12) {
  const rows = [];
  for (let f1 = 0; f1 <= maxFret; f1++) {
    for (let f2 = f1; f2 <= maxFret; f2++) {
      for (let ss = 1; ss <= 5; ss++) {
        const score = calcDifficulty([
          { string: 0, fret: f1 },
          { string: ss, fret: f2 },
        ]);
        rows.push({ fret1: f1, fret2: f2, fretSpan: f2 - f1, stringSpan: ss, score });
      }
    }
  }
  return rows;
}

/**
 * Build a difficulty table for all 3-note (triplet) combinations.
 * Enumerates adjacent-string groups (0-1-2, 1-2-3, 2-3-4, 3-4-5) and
 * all fret combinations within [0, maxFret].
 * Returns array of { strings, frets, fretSpan, stringSpan, score }
 */
export function buildTripletTable(maxFret = 5) {
  const STRING_GROUPS = [
    [0, 1, 2], [1, 2, 3], [2, 3, 4], [3, 4, 5],
  ];
  const rows = [];
  for (const [s0, s1, s2] of STRING_GROUPS) {
    for (let f0 = 0; f0 <= maxFret; f0++) {
      for (let f1 = 0; f1 <= maxFret; f1++) {
        for (let f2 = 0; f2 <= maxFret; f2++) {
          const notes = [
            { string: s0, fret: f0 },
            { string: s1, fret: f1 },
            { string: s2, fret: f2 },
          ];
          const frets = [f0, f1, f2];
          const fretSpan = Math.max(...frets) - Math.min(...frets);
          const score = calcDifficulty(notes);
          rows.push({
            strings: [s0, s1, s2],
            frets,
            fretSpan,
            stringSpan: s2 - s0,
            score,
          });
        }
      }
    }
  }
  return rows;
}

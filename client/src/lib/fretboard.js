// Standard tuning: strings 0-5 = E2, A2, D3, G3, B3, E4
export const STANDARD_TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
export const NUM_STRINGS = 6;
export const NUM_FRETS = 22;

// Average fret spacing in mm (decreases as frets go higher, approximated linearly)
// Open position frets are ~35mm wide, 12th fret ~18mm
function fretSpacingMm(fret) {
  return Math.max(18, 35 - fret * 0.77);
}

// Physical distance in mm between two fret positions on the same string
function fretDistanceMm(fret1, fret2) {
  const lo = Math.min(fret1, fret2);
  const hi = Math.max(fret1, fret2);
  let dist = 0;
  for (let f = lo; f < hi; f++) {
    dist += fretSpacingMm(f);
  }
  return dist;
}

// String spacing ~11mm apart (standard)
const STRING_SPACING_MM = 11;

/**
 * Calculate reach difficulty score (1-10) for a set of fret positions.
 * @param {Array<{string: number, fret: number}>} notes  - array of {string (0-5), fret (0-22)}
 * @returns {number} score 1-10
 */
export function calcDifficulty(notes) {
  if (!notes || notes.length < 2) return 1;

  const frets = notes.map(n => n.fret);
  const strings = notes.map(n => n.string);

  const fretSpan = Math.max(...frets) - Math.min(...frets);
  const stringSpan = Math.max(...strings) - Math.min(...strings);

  // Physical fret reach in mm
  const fretReachMm = fretDistanceMm(Math.min(...frets), Math.max(...frets));
  // Physical string reach in mm
  const stringReachMm = stringSpan * STRING_SPACING_MM;

  // Diagonal reach (Euclidean)
  const totalReachMm = Math.sqrt(fretReachMm ** 2 + stringReachMm ** 2);

  // Calibrated for short fingers: max comfortable reach ~60mm diagonal
  // Score scales from 1 (0mm) to 10 (>=90mm)
  const score = 1 + (totalReachMm / 90) * 9;
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}

// Reference comfortable gap maxima (cm), 95th percentile
export const GAP_REF_MAX = { thumbToIndex: 15, indexToMiddle: 9, middleToRing: 7, ringToLittle: 11 };

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
 * Finger assignment: sorted distinct fretted frets → index, middle, ring, pinky.
 * T→I uses the position of the index finger (thumb anchors ~2 frets below).
 */
export function fingerGapUsage(notes) {
  if (!notes || notes.length === 0) return null;
  const frettedFrets = [...new Set(notes.map(n => n.fret).filter(f => f > 0))].sort((a, b) => a - b);
  if (frettedFrets.length === 0) return null;

  const ff = frettedFrets.slice(0, 4);
  const ti = fretDistanceCm(Math.max(0, ff[0] - 2), ff[0]);
  const im = ff.length >= 2 ? fretDistanceCm(ff[0], ff[1]) : 0;
  const mr = ff.length >= 3 ? fretDistanceCm(ff[1], ff[2]) : 0;
  const rp = ff.length >= 4 ? fretDistanceCm(ff[2], ff[3]) : 0;

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
 * Score the difficulty of CHANGING from one chord shape to another (1-10).
 *
 * Switching chords smoothly is the #1 struggle for most players, and it depends
 * on physical movement, not just how hard each shape is to hold. We model:
 *
 *   - Hand-shift: how far the fretting hand slides along the neck, measured in mm
 *     between the two shapes' lowest fretted fret (the index-finger anchor).
 *   - Finger travel: average mm each fretted note moves to its nearest position
 *     in the other shape (captures reshaping the hand, not just sliding it).
 *   - Common-tone bonus: notes held on the exact same string+fret act as anchors
 *     and make the change easier, so each one reduces the score.
 *
 * Open-string and muted notes carry no fretting-hand cost. Two chords that are
 * identical, or differ only by open strings, score 1 (trivial).
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

  // Hand-shift: distance the index-finger anchor (lowest fret) slides, in mm.
  const anchorA = Math.min(...a.map(n => n.fret));
  const anchorB = Math.min(...b.map(n => n.fret));
  const shiftMm = fretDistanceMm(anchorA, anchorB);

  // Finger travel: for each note in A, the physical distance to its nearest
  // note in B (and vice versa), averaged. A note that stays put costs ~0.
  // String distance is weighted lightly: the fretting hand spans all strings at
  // a given position, so moving a finger to a different string is far cheaper
  // than sliding it up/down the neck. Fret movement dominates the cost.
  const STRING_WEIGHT = 0.35;
  const travel = (from, to) => {
    let sum = 0;
    for (const n of from) {
      let best = Infinity;
      for (const m of to) {
        const fr = fretDistanceMm(n.fret, m.fret);
        const sr = Math.abs(n.string - m.string) * STRING_SPACING_MM * STRING_WEIGHT;
        best = Math.min(best, Math.sqrt(fr ** 2 + sr ** 2));
      }
      sum += best;
    }
    return sum / from.length;
  };
  const avgTravelMm = (travel(a, b) + travel(b, a)) / 2;

  // Common-tone anchors: notes on the identical string+fret in both shapes.
  const keyOf = n => `${n.string}:${n.fret}`;
  const setB = new Set(b.map(keyOf));
  const commonTones = a.filter(n => setB.has(keyOf(n))).length;

  // Combine: shift and reshaping both drive difficulty; anchors relieve it.
  // ~50mm of combined movement ≈ a hard change before the anchor discount.
  const movementMm = shiftMm * 0.6 + avgTravelMm;
  let score = 1 + (movementMm / 50) * 9;
  score -= commonTones * 1.2;

  // Fingering-aware bonus: if both shapes barre the same fret, the index finger
  // never lifts — a physical anchor that eases the change. Only the non-barre
  // fingers reshape, so we discount but keep a floor: two different barre
  // chords are still a real move, not trivial.
  const fa = optimalFingering(a);
  const fb = optimalFingering(b);
  if (fa?.barreFret != null && fa.barreFret === fb?.barreFret) {
    score = Math.max(2.5, score - 1);
  }

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

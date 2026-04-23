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

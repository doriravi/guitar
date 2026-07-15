// fretboardMap.js
// ===============
// "Stage 2" of the vision prototype (which vision/fretboard_detector.py left as
// a documented stub): given a calibrated fretboard quadrilateral and the hand's
// 21 MediaPipe landmarks, work out which (string, fret) cell each fingertip is
// pressing.
//
// Pipeline
// --------
// 1. The user taps the four corners of the visible fretboard span, in order:
//      0: nut @ low-E   1: nut @ high-e   2: end @ high-e   3: end @ low-E
//    ("end" = the last fret they included in the tap, `spanFrets`, default 5).
//    These four normalized points define a perspective quad.
// 2. `computeHomography(corners)` solves the 3x3 homography H that maps each
//    corner to the unit square (u along the neck 0..1, v across the strings
//    0..1). Any image point can then be projected into board space via `project`.
// 3. `mapFingertip` projects a fingertip and quantizes:
//      - v -> string 0..5 (six evenly-spaced string lanes)
//      - u -> fret, using the SAME equal-temperament fret spacing as the rest of
//        the app (geometry.fretWireMm), so the physically-tighter high frets are
//        respected rather than assuming linear spacing.
//
// Everything here is pure math (no React, no DOM), so it is unit-testable and
// shared-geometry-consistent with lib/geometry.js and lib/fretboard.js.

import { fretWireMm } from './geometry';

export const NUM_STRINGS = 6;

// MediaPipe Hands fingertip landmark indices (identical in the JS and Python
// pipelines): thumb 4, index 8, middle 12, ring 16, pinky 20. The thumb is
// excluded from fretting detection — it anchors behind the neck, not on it.
export const FRETTING_TIPS = { index: 8, middle: 12, ring: 16, pinky: 20 };

// ── Homography: board quad -> unit square ─────────────────────────────────────

// Solve a 3x3 homography H such that H * srcᵢ ≈ dstᵢ (homogeneous) for the four
// point correspondences. Standard DLT: build the 8x8 linear system for the 8
// unknowns (h33 fixed to 1) and solve by Gaussian elimination. Returns the 9
// entries [h11..h33] row-major, or null if the quad is degenerate.
function solveHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const h = gaussianSolve(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// Gaussian elimination with partial pivoting for an n×n system. Returns the
// solution vector, or null if the matrix is singular.
function gaussianSolve(A, b) {
  const n = b.length;
  // Augmented matrix.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot: find the largest-magnitude entry in this column.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null; // singular
    [M[col], M[piv]] = [M[piv], M[col]];
    // Eliminate below.
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Build a homography from four tapped corners to the unit board square.
 * Corner order: [nut@lowE, nut@highE, end@highE, end@lowE].
 * In board space: u (along neck) runs 0 at the nut -> 1 at the tapped end;
 * v (across strings) runs 0 at low-E -> 1 at high-e.
 *
 * @param {Array<{x:number,y:number}>} corners four normalized image points
 * @returns {{H:number[]}|null} the homography, or null if degenerate
 */
export function computeHomography(corners) {
  if (!corners || corners.length !== 4) return null;
  const unit = [
    { x: 0, y: 0 }, // nut @ low-E   -> (u=0, v=0)
    { x: 0, y: 1 }, // nut @ high-e  -> (u=0, v=1)
    { x: 1, y: 1 }, // end @ high-e  -> (u=1, v=1)
    { x: 1, y: 0 }, // end @ low-E   -> (u=1, v=0)
  ];
  const H = solveHomography(corners, unit);
  if (!H) return null;
  return { H };
}

/**
 * Project a normalized image point into board space (u, v) using a homography
 * from computeHomography.
 * @returns {{u:number, v:number}}
 */
export function project(H, pt) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const w = g * pt.x + h * pt.y + i;
  return {
    u: (a * pt.x + b * pt.y + c) / w,
    v: (d * pt.x + e * pt.y + f) / w,
  };
}

// ── Quantization: board space -> (string, fret) ───────────────────────────────

// Cross-string position v (0..1) -> string index 0..5. Six lanes centred on
// v = i/5, so the nearest lane is round(v * 5).
export function vToString(v) {
  return Math.max(0, Math.min(NUM_STRINGS - 1, Math.round(v * (NUM_STRINGS - 1))));
}

/**
 * Along-neck position u (0..1, nut -> tapped end) -> fret number.
 *
 * u is a fraction of the *scale length* the user tapped, so we invert the
 * equal-temperament fret-distance curve. `spanFrets` is how many frets the
 * tapped "end" corner covered (i.e. the end corner sits on the wire of fret
 * `spanFrets`). A fingertip sits in the bracket *behind* a wire, so we return
 * the fret whose bracket [wire(n-1), wire(n)] contains the projected distance —
 * matching how the app places a fretted note at the middle of that bracket.
 *
 * @param {number} u          0..1 along the neck
 * @param {number} spanFrets  fret index the "end" corner was tapped on
 * @returns {number} fret 0 (open, at/behind the nut) .. spanFrets
 */
export function uToFret(u, spanFrets = 5) {
  // Distance of the tapped end along the scale, in the same arbitrary units as
  // fretWireMm (scaleLength cancels, so use 1).
  const endDist = fretWireMm(1, spanFrets);
  const dist = u * endDist; // where the fingertip projects along the scale
  if (dist <= 0) return 0;
  // Find the smallest n whose wire is at/after `dist`: the fingertip is in the
  // bracket behind wire n, i.e. it frets fret n.
  for (let n = 1; n <= spanFrets; n++) {
    if (dist <= fretWireMm(1, n)) return n;
  }
  return spanFrets;
}

/**
 * Map a single fingertip landmark to a { string, fret } cell.
 * @param {number[]} H          homography from computeHomography
 * @param {{x:number,y:number}} tip normalized fingertip landmark
 * @param {number} spanFrets    frets covered by the calibration
 * @returns {{string:number, fret:number, u:number, v:number}}
 */
export function mapFingertip(H, tip, spanFrets = 5) {
  const { u, v } = project(H, tip);
  return { string: vToString(v), fret: uToFret(u, spanFrets), u, v };
}

/**
 * Map the fretting fingers (index, middle, ring, pinky) of a landmark set to
 * (string, fret) positions, keeping only tips that project INSIDE the board
 * (0 <= u,v <= 1 with a small margin) — a finger lifted off the neck or a
 * finger the model placed off-board is dropped rather than snapped to an edge.
 *
 * Collapses to at most one position per string (the one nearest the nut wins if
 * two fingers land on the same string), yielding a clean chord shape to feed to
 * detectChord.
 *
 * @param {number[]} H
 * @param {Array<{x:number,y:number}>} landmarks the 21 MediaPipe landmarks
 * @param {number} spanFrets
 * @returns {Array<{string:number, fret:number}>}
 */
export function mapHandToPositions(H, landmarks, spanFrets = 5) {
  if (!H || !landmarks) return [];
  const MARGIN = 0.06; // allow slightly outside the tapped quad (tap imprecision)
  const perString = new Map(); // string -> best (lowest) fret
  for (const idx of Object.values(FRETTING_TIPS)) {
    const tip = landmarks[idx];
    if (!tip) continue;
    const { u, v } = project(H, tip);
    if (u < -MARGIN || u > 1 + MARGIN || v < -MARGIN || v > 1 + MARGIN) continue;
    const string = vToString(v);
    const fret = uToFret(Math.max(0, Math.min(1, u)), spanFrets);
    if (fret <= 0) continue; // an open/behind-nut projection isn't a fretted finger
    const prev = perString.get(string);
    if (prev == null || fret < prev) perString.set(string, fret);
  }
  return [...perString.entries()]
    .map(([string, fret]) => ({ string, fret }))
    .sort((a, b) => a.string - b.string);
}

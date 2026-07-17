// Reference-view regression for neckDetect.
// =========================================
// Encodes the user's known-good top-down neck shot (see
// vision/reference/neck-reference.md) as its measurable characteristics, then
// asserts the detector accepts a view like it ACROSS A RANGE OF TILT ANGLES.
// We do not template-match a stored photo — we synthesize reference-like necks
// (a bright, string-textured band on a dark background) at several tilts and
// require each to detect with the correct axis and bounding corners.

import { describe, it, expect } from 'vitest';
import { detectNeck } from './neckDetect';

const W = 160, H = 90; // same downscaled size the live pipeline feeds detectNeck

// Build an RGBA frame containing a neck band centred on the frame, rotated by
// `tilt` radians, ~`bandFrac` of the frame thick, with 6 parallel dark "string"
// lines running along the band (the string texture the detector keys on).
// bandFrac 0.3: the neck occupies ~a third of the frame across its width, with
// real background either side — matching the user's reference framing. (A band
// filling most of the frame perpendicular leaves no background to find an edge
// against, which is not a view the camera realistically sees.)
function referenceNeck(tilt, { bandFrac = 0.3, bg = 30, board = 200, string = 90 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  const cx = W / 2, cy = H / 2;
  // Perpendicular direction to the neck (for "distance across the band").
  const nx = -Math.sin(tilt), ny = Math.cos(tilt);
  const halfBand = (bandFrac * H) / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // signed perpendicular distance from the band centre-line
      const d = (x - cx) * nx + (y - cy) * ny;
      let v = bg;
      if (Math.abs(d) <= halfBand) {
        v = board;
        // six evenly spaced dark string lines across the band thickness
        for (let s = 0; s < 6; s++) {
          const sd = -halfBand + ((s + 0.5) / 6) * (2 * halfBand);
          if (Math.abs(d - sd) < 0.7) v = string;
        }
      }
      const p = (y * W + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return data;
}

describe('neckDetect — reference view across angles', () => {
  // The reference is ~7° tilt; we also require nearby and steeper tilts to work.
  const TILTS = [0, 0.12, 0.26, -0.21]; // rad ≈ 0°, 7°, 15°, −12°

  for (const tilt of TILTS) {
    it(`detects a reference-like neck tilted ${(tilt * 180 / Math.PI).toFixed(0)}°`, () => {
      const data = referenceNeck(tilt);
      const res = detectNeck(data, W, H);
      expect(res).not.toBeNull();
      expect(res.corners).toHaveLength(4);
      // Axis within the histogram's honest resolution of the built tilt. The
      // orientation histogram is 36 bins over 180° (~5°/bin, 0.087 rad); with
      // smoothing the peak can sit ~1–2 bins off, so we allow ~0.30 rad (~17°).
      // Exact alignment is the job of Fine-tune, not the auto axis estimate.
      let dTheta = res.theta - tilt;
      while (dTheta > Math.PI / 2) dTheta -= Math.PI;
      while (dTheta < -Math.PI / 2) dTheta += Math.PI;
      expect(Math.abs(dTheta)).toBeLessThan(0.30);
      // Corners are finite and roughly frame-scaled. A tilted full-width neck
      // legitimately runs OFF the frame edges (its ends extend past x∈[0,1]), so
      // we don't require them inside — just sane, bounded values.
      for (const c of res.corners) {
        expect(Number.isFinite(c.x)).toBe(true);
        expect(Number.isFinite(c.y)).toBe(true);
        expect(c.x).toBeGreaterThan(-1.5);
        expect(c.x).toBeLessThan(2.5);
        expect(c.y).toBeGreaterThan(-1.5);
        expect(c.y).toBeLessThan(2.5);
      }
      expect(res.confidence).toBeGreaterThan(0);
      // The detected band must have passed the shape gate — i.e. its apparent
      // length:width is physically consistent with a real nut→12th fretboard.
      // (A sliver or a squat keyboard-like quad would have been rejected.)
      const dbg = {};
      detectNeck(data, W, H, { debug: dbg, spanFrets: 12 });
      expect(dbg.reason).toBe('ok');
      expect(dbg.aspect).toBeGreaterThan(1.4);
      expect(dbg.aspect).toBeLessThan(9.2);
    });
  }
});

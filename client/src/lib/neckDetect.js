// neckDetect.js
// =============
// Lightweight, pure-JS automatic fretboard/neck detector — the in-browser
// replacement for the manual 4-corner tap. Given a downscaled camera frame it
// finds the neck as a bright strip crossed by ~6 parallel strings, and returns
// the four corners (in fretboardMap's required order) plus a confidence.
//
// No OpenCV / WASM — a small hand-rolled Sobel + orientation histogram + a 1-D
// cross-neck profile. Deterministic on an ImageData, so it's unit-testable.
//
// IMPORTANT physical limit (surfaced in the UI, not here): finding the neck does
// NOT reveal fingertips hidden behind it. This only works when the camera looks
// down the neck (over-the-shoulder) so the fingertips are visible.
//
// Output corners follow fretboardMap.computeHomography's order:
//   [ nut·lowE, nut·highE, end·highE, end·lowE ]  (normalized 0..1)
// u = along the neck (nut→end), v = across strings (low-E→high-e).

// ── Grayscale ────────────────────────────────────────────────────────────────
// Returns a Float32Array of luma (0..255) for a w×h RGBA ImageData buffer.
export function toGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return g;
}

// ── Sobel gradients ──────────────────────────────────────────────────────────
// Returns { mag, ori } Float32Arrays. `ori` is the gradient angle in radians
// (-π/2..π/2, since a line and its 180° flip are the same orientation).
export function sobel(gray, w, h) {
  const mag = new Float32Array(w * h);
  const ori = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1], tc = gray[i - w], tr = gray[i - w + 1];
      const ml = gray[i - 1],                        mr = gray[i + 1];
      const bl = gray[i + w - 1], bc = gray[i + w], br = gray[i + w + 1];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      mag[i] = Math.hypot(gx, gy);
      // Edge orientation is perpendicular to the gradient; we store gradient
      // angle folded to [-π/2, π/2] so opposite directions map together.
      let a = Math.atan2(gy, gx);
      if (a > Math.PI / 2) a -= Math.PI;
      if (a < -Math.PI / 2) a += Math.PI;
      ori[i] = a;
    }
  }
  return { mag, ori };
}

// ── Dominant orientation ─────────────────────────────────────────────────────
// Magnitude-weighted histogram of gradient angles. The strings + neck edges form
// a strong parallel bundle, so the peak bin ≈ the neck's cross-string gradient.
// Returns { theta, sharpness } where theta is the NECK LONG AXIS angle (radians)
// and sharpness is peak/mean (higher = a more clearly linear scene).
export function dominantAxis(mag, ori, w, h, { magThresh = 20, bins = 36 } = {}) {
  const hist = new Float32Array(bins);
  let total = 0;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] < magThresh) continue;
    // map -π/2..π/2 → 0..bins
    let b = Math.floor(((ori[i] + Math.PI / 2) / Math.PI) * bins);
    if (b < 0) b = 0; if (b >= bins) b = bins - 1;
    hist[b] += mag[i];
    total += mag[i];
  }
  if (total <= 0) return { theta: 0, sharpness: 0 };
  // Smooth circularly (orientation wraps) and find the peak.
  const sm = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    sm[b] = hist[(b - 1 + bins) % bins] * 0.25 + hist[b] * 0.5 + hist[(b + 1) % bins] * 0.25;
  }
  let peak = 0, peakVal = 0;
  for (let b = 0; b < bins; b++) if (sm[b] > peakVal) { peakVal = sm[b]; peak = b; }
  const mean = total / bins;
  const sharpness = mean > 0 ? peakVal / mean : 0;
  // Bin center → gradient angle. The gradient is perpendicular to the edge, so
  // the neck's LONG axis is the gradient angle + 90°.
  const gradAngle = ((peak + 0.5) / bins) * Math.PI - Math.PI / 2;
  let theta = gradAngle + Math.PI / 2;
  if (theta > Math.PI / 2) theta -= Math.PI;
  return { theta, sharpness };
}

// ── Cross-neck profile ───────────────────────────────────────────────────────
// Project brightness onto the axis PERPENDICULAR to the neck (unit vector n).
// The neck shows as a raised plateau (pale fretboard/strings vs background).
// Returns { profile, nx, ny, ox, oy } where profile[k] is mean luma in the k-th
// perpendicular slab across the frame, and (nx,ny) is the perpendicular dir.
export function crossProfile(gray, w, h, theta, slabs = 48) {
  // Perpendicular to the neck long axis.
  const nx = -Math.sin(theta), ny = Math.cos(theta);
  const cx = w / 2, cy = h / 2;
  // Signed perpendicular distance range over the frame corners.
  let dmin = Infinity, dmax = -Infinity;
  for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const d = (px - cx) * nx + (py - cy) * ny;
    if (d < dmin) dmin = d; if (d > dmax) dmax = d;
  }
  const sum = new Float32Array(slabs);
  const cnt = new Float32Array(slabs);
  const span = dmax - dmin || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = (x - cx) * nx + (y - cy) * ny;
      let k = Math.floor(((d - dmin) / span) * slabs);
      if (k < 0) k = 0; if (k >= slabs) k = slabs - 1;
      sum[k] += gray[y * w + x];
      cnt[k] += 1;
    }
  }
  const profile = new Float32Array(slabs);
  for (let k = 0; k < slabs; k++) profile[k] = cnt[k] > 0 ? sum[k] / cnt[k] : 0;
  return { profile, nx, ny, dmin, span, cx, cy, slabs };
}

// Find the contiguous bright band in a 1-D profile: the widest run of slabs
// above a threshold set between the profile's min and max. Returns {lo, hi}
// slab indices (band edges) or null if no clear band.
function findBand(profile) {
  let mn = Infinity, mx = -Infinity;
  for (const v of profile) { if (v < mn) mn = v; if (v > mx) mx = v; }
  if (mx - mn < 12) return null; // too flat → no neck contrast
  const thresh = mn + (mx - mn) * 0.5;
  let bestLo = -1, bestHi = -1, bestLen = 0;
  let lo = -1;
  for (let k = 0; k < profile.length; k++) {
    if (profile[k] >= thresh) {
      if (lo < 0) lo = k;
    } else if (lo >= 0) {
      if (k - lo > bestLen) { bestLen = k - lo; bestLo = lo; bestHi = k - 1; }
      lo = -1;
    }
  }
  if (lo >= 0 && profile.length - lo > bestLen) { bestLen = profile.length - lo; bestLo = lo; bestHi = profile.length - 1; }
  if (bestLo < 0) return null;
  return { lo: bestLo, hi: bestHi };
}

/**
 * Detect the fretboard neck in a downscaled RGBA frame.
 *
 * @param {Uint8ClampedArray|number[]} data RGBA pixel buffer (length w*h*4)
 * @param {number} w  frame width
 * @param {number} h  frame height
 * @param {object} [opts]
 * @returns {{corners:Array<{x:number,y:number}>, confidence:number, theta:number}|null}
 */
export function detectNeck(data, w, h, opts = {}) {
  const minSharpness = opts.minSharpness ?? 3.0;
  const gray = toGray(data, w, h);
  const { mag, ori } = sobel(gray, w, h);
  const { theta, sharpness } = dominantAxis(mag, ori, w, h);
  if (sharpness < minSharpness) return null; // scene isn't clearly linear

  const prof = crossProfile(gray, w, h, theta, opts.slabs ?? 48);
  const band = findBand(prof.profile);
  if (!band) return null;

  // Band must occupy a plausible fraction of the frame (a neck, not a hairline
  // or the whole image).
  const bandFrac = (band.hi - band.lo + 1) / prof.slabs;
  if (bandFrac < 0.08 || bandFrac > 0.85) return null;

  // Convert the two band-edge slabs back to signed perpendicular distances.
  const slabToDist = (k) => prof.dmin + ((k + 0.5) / prof.slabs) * prof.span;
  const dLo = slabToDist(band.lo);
  const dHi = slabToDist(band.hi);

  // Neck long-axis unit vector and perpendicular.
  const tx = Math.cos(theta), ty = Math.sin(theta);
  const nx = prof.nx, ny = prof.ny;

  // The neck runs across the frame along the long axis; clamp the along-axis
  // extent to where a line at the band centre stays in-frame.
  const midD = (dLo + dHi) / 2;
  const midX = prof.cx + nx * midD;
  const midY = prof.cy + ny * midD;
  // Intersect the centre line (point mid, dir t) with the frame rectangle.
  const ext = lineFrameExtent(midX, midY, tx, ty, w, h);
  if (!ext) return null;

  // Build the four corners: two band edges × two along-axis ends.
  const cornerAt = (along, d) => {
    const bx = prof.cx + nx * d; // a point on this band edge, at profile centre along-axis
    const by = prof.cy + ny * d;
    // move along the axis to the requested end
    return { x: (bx + tx * along) / w, y: (by + ty * along) / h };
  };
  // ext.aMin/aMax are signed along-axis offsets from mid for the two frame hits.
  // Orient so that "nut" = the end nearer the brighter/wider part is a heuristic;
  // for v1 we pick aMin as nut and let the user Recalibrate if reversed.
  const nutA = ext.aMin, endA = ext.aMax;

  // Decide which band edge is low-E vs high-e: default dLo → low-E. (Reversible
  // via Recalibrate; a taper heuristic could refine this later.)
  const corners = [
    cornerAt(nutA, dLo), // nut · low-E
    cornerAt(nutA, dHi), // nut · high-e
    cornerAt(endA, dHi), // end · high-e
    cornerAt(endA, dLo), // end · low-E
  ];

  // Confidence blends orientation sharpness and band contrast into 0..1.
  const confidence = Math.max(0, Math.min(1, (sharpness - minSharpness) / 6));
  return { corners, confidence, theta };
}

// Intersect the line through (px,py) with direction (tx,ty) against the frame
// [0,w]×[0,h]; return the two along-axis offsets {aMin, aMax} from (px,py).
function lineFrameExtent(px, py, tx, ty, w, h) {
  const hits = [];
  const add = (a) => {
    const x = px + tx * a, y = py + ty * a;
    if (x >= -1 && x <= w + 1 && y >= -1 && y <= h + 1) hits.push(a);
  };
  if (Math.abs(tx) > 1e-6) { add((0 - px) / tx); add((w - px) / tx); }
  if (Math.abs(ty) > 1e-6) { add((0 - py) / ty); add((h - py) / ty); }
  if (hits.length < 2) return null;
  let aMin = Infinity, aMax = -Infinity;
  for (const a of hits) { if (a < aMin) aMin = a; if (a > aMax) aMax = a; }
  if (!isFinite(aMin) || !isFinite(aMax) || aMax - aMin < 1) return null;
  return { aMin, aMax };
}

// ── Stability helper ─────────────────────────────────────────────────────────
// Whether two corner sets agree within `tol` (fraction of frame). Used by the
// caller's stability gate so a single fluke frame can't auto-commit.
export function cornersAgree(a, b, tol = 0.06) {
  if (!a || !b || a.length !== 4 || b.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y) > tol) return false;
  }
  return true;
}

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

import { INSTRUMENTS, fretWireMm } from './geometry';

// ── Shape plausibility ───────────────────────────────────────────────────────
// A fretboard has FIXED real-world proportions: the nut→fret-N span and the neck
// width are known in mm (lib/geometry.js — the same source the reach engine uses).
// That gives an expected length:width ratio a real neck MUST roughly have, at any
// distance. Checking it rejects boxes that cannot be a fretboard — e.g. the wide,
// squat quad a laptop keyboard's edges produce — before we ever calibrate on them.
//
// Caveat (why the tolerance is wide): a camera views the neck in perspective, so
// the apparent length foreshortens as the board tilts away. Foreshortening only
// ever makes the band look SHORTER, never longer, so the band is bounded above by
// the true ratio and can legitimately fall well below it. We therefore reject
// mainly the "far too squat / far too elongated" cases, not modest tilts.

/**
 * The real length:width ratio of the nut→`spanFrets` region of a neck.
 * @param {object} [inst]      an INSTRUMENTS entry (default classical)
 * @param {number} [spanFrets] the fret the board's "end" edge sits on
 */
export function neckAspectRatio(inst = INSTRUMENTS.classical, spanFrets = 12) {
  const lengthMm = fretWireMm(inst.scaleLength, spanFrets);
  // Neck width tapers linearly from the nut to the 12th fret; take the mean width
  // over the spanned region (extrapolating past the 12th if span > 12).
  const t = spanFrets / 12;
  const widthAtSpan = inst.nutWidth + (inst.twelfthWidth - inst.nutWidth) * t;
  const meanWidth = (inst.nutWidth + widthAtSpan) / 2;
  return lengthMm / meanWidth;
}

/**
 * Is a detected band's apparent length:width ratio physically consistent with a
 * fretboard's nut→`spanFrets` region?
 *
 * @param {number} ratio      observed apparent length / width
 * @param {object} [opts]
 * @param {object} [opts.inst]        INSTRUMENTS entry (default classical)
 * @param {number} [opts.spanFrets]   frets the calibration spans (default 12)
 * @param {number} [opts.minFactor]   how much SHORTER than true is allowed
 *                                    (perspective foreshortening) — default 0.25
 * @param {number} [opts.maxFactor]   how much LONGER than true is allowed
 *                                    (measurement slop) — default 1.6
 */
export function shapePlausible(ratio, opts = {}) {
  const inst = opts.inst ?? INSTRUMENTS.classical;
  const spanFrets = opts.spanFrets ?? 12;
  const expected = neckAspectRatio(inst, spanFrets);
  const lo = expected * (opts.minFactor ?? 0.25);
  const hi = expected * (opts.maxFactor ?? 1.6);
  return ratio >= lo && ratio <= hi;
}

// ── Grayscale ────────────────────────────────────────────────────────────────
// Returns a Float32Array of luma (0..255) for a w×h RGBA ImageData buffer.
export function toGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return g;
}

// ── Skin mask ────────────────────────────────────────────────────────────────
// In a real over-the-shoulder shot the biggest bright regions are the player's
// hands and forearms, which otherwise dominate the brightness profile and the
// orientation histogram and bury the thin neck. Flag skin-ish pixels (a simple,
// lighting-tolerant RGB rule) so the detector can DOWN-WEIGHT them. Returns a
// Uint8Array mask (1 = skin) of length w*h. Deterministic; unit-testable.
export function skinMask(data, w, h) {
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    // Classic skin heuristic: reddish, R>G>B, bright enough, not grey.
    const isSkin =
      r > 70 && g > 40 && b > 20 &&
      r > g && g >= b &&
      (mx - mn) > 12 &&
      (r - g) > 8;
    mask[i] = isSkin ? 1 : 0;
  }
  return mask;
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
export function dominantAxis(mag, ori, w, h, { magThresh = 20, bins = 36, skin = null } = {}) {
  const hist = new Float32Array(bins);
  let total = 0;
  // Bin CENTRES are placed on the cardinal angles (…, −π/2, 0, +π/2, …) rather
  // than on bin edges. A horizontal neck — the most common case — has its string
  // gradients at exactly ±π/2; with edge-centred bins that energy splits across
  // two neighbours and the recovered axis wobbles by ±half a bin. Offsetting by
  // half a bin makes the dominant direction land cleanly inside one bin.
  const HALF = 0.5 / bins;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] < magThresh) continue;
    if (skin && skin[i]) continue; // ignore edges on skin (hands/forearms)
    // map -π/2..π/2 → 0..bins, shifted so bin centres sit on cardinal angles
    let b = Math.floor((((ori[i] + Math.PI / 2) / Math.PI) + HALF) * bins);
    b = ((b % bins) + bins) % bins; // orientation wraps; no clamping to the ends
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
  // Bin center → gradient angle (undoing the half-bin shift applied above). The
  // gradient is perpendicular to the edge, so the neck's LONG axis is the
  // gradient angle + 90°. Angle resolution is the bin width (180°/bins ≈ 5°);
  // good enough for the homography, and the user can Fine-tune for an exact fit.
  // With the half-bin shift, bin b is CENTRED on this gradient angle:
  const gradAngle = (peak / bins) * Math.PI - Math.PI / 2;
  let theta = gradAngle + Math.PI / 2;
  if (theta > Math.PI / 2) theta -= Math.PI;
  return { theta, sharpness };
}

// ── Cross-neck profile ───────────────────────────────────────────────────────
// Project brightness onto the axis PERPENDICULAR to the neck (unit vector n).
// The neck shows as a raised plateau (pale fretboard/strings vs background).
// Returns { profile, nx, ny, ox, oy } where profile[k] is mean luma in the k-th
// perpendicular slab across the frame, and (nx,ny) is the perpendicular dir.
export function crossProfile(gray, w, h, theta, slabs = 48, opts = {}) {
  const { skin = null, mag = null } = opts;
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
  const edge = new Float32Array(slabs);  // accumulated gradient magnitude per slab
  const span = dmax - dmin || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (skin && skin[i]) continue;     // skip skin: hands/forearms aren't the neck
      const d = (x - cx) * nx + (y - cy) * ny;
      let k = Math.floor(((d - dmin) / span) * slabs);
      if (k < 0) k = 0; if (k >= slabs) k = slabs - 1;
      sum[k] += gray[i];
      cnt[k] += 1;
      if (mag) edge[k] += mag[i];
    }
  }
  const profile = new Float32Array(slabs);
  const rawDensity = new Float32Array(slabs);
  for (let k = 0; k < slabs; k++) {
    profile[k] = cnt[k] > 0 ? sum[k] / cnt[k] : 0;
    rawDensity[k] = cnt[k] > 0 ? edge[k] / cnt[k] : 0; // mean edge strength = string texture
  }
  // Smooth the density profile. Slabs are often THINNER than the gap between
  // strings, so a slab can land entirely between two string lines and register
  // zero edges — an interior hole that would fragment an otherwise solid band
  // into slivers (worst on a perfectly axis-aligned neck, where the strings line
  // up with the slab grid). A 3-tap blur closes those one-slab dropouts while
  // leaving the band's real outer edges intact.
  const density = new Float32Array(slabs);
  for (let k = 0; k < slabs; k++) {
    const a = rawDensity[Math.max(0, k - 1)];
    const b = rawDensity[k];
    const c = rawDensity[Math.min(slabs - 1, k + 1)];
    density[k] = 0.25 * a + 0.5 * b + 0.25 * c;
  }
  return { profile, density, rawDensity, nx, ny, dmin, span, cx, cy, slabs };
}

// max - min of a 1-D array (used to decide whether string-texture density is
// strong enough to drive band selection).
function maxRange(a) {
  let mn = Infinity, mx = -Infinity;
  for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
  return mx - mn;
}

// Find the contiguous band in a 1-D profile: the widest run of slabs above a
// threshold. Returns {lo, hi} slab indices (band edges) or null if no clear band.
//
// The threshold is deliberately LOW in the profile's range (default 20%), not at
// the midpoint. The point is to separate the band from the BACKGROUND, not to
// slice through the band's own internal variation — a string-density profile
// peaks hard on each string row and dips between them, so a 50% cut fragments a
// perfectly good band into one-slab slivers (which then read as an absurd
// length:width ratio). A low cut keeps the whole plateau together.
function findBand(profile, cutFrac = 0.2) {
  let mn = Infinity, mx = -Infinity;
  for (const v of profile) { if (v < mn) mn = v; if (v > mx) mx = v; }
  if (mx - mn < 12) return null; // too flat → no neck contrast
  const thresh = mn + (mx - mn) * cutFrac;
  let bestLo = -1, bestHi = -1, bestLen = 0;
  let lo = -1;
  const closeRun = (endInclusive) => {
    const len = endInclusive - lo + 1;
    if (len > bestLen) { bestLen = len; bestLo = lo; bestHi = endInclusive; }
    lo = -1;
  };
  for (let k = 0; k < profile.length; k++) {
    if (profile[k] >= thresh) {
      if (lo < 0) lo = k;
    } else if (lo >= 0) {
      closeRun(k - 1);
    }
  }
  if (lo >= 0) closeRun(profile.length - 1); // run reaching the end
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
  // Two-tier sharpness: a soft target (a clean, neck-dominated frame clears it
  // easily) and a hard floor (below this the scene is genuinely non-linear —
  // random noise / flat walls — and we bail regardless of texture). Between the
  // two, a real neck can still pass IF its string-texture ratio is strong. This
  // is what lets a small, cluttered, real neck through without admitting noise.
  const minSharpness = opts.minSharpness ?? 3.0;
  const floorSharpness = opts.floorSharpness ?? 1.8;
  const gray = toGray(data, w, h);
  const { mag, ori } = sobel(gray, w, h);
  // Skin mask lets us ignore hands/forearms, which otherwise dominate a real
  // over-the-shoulder shot. Only use it if it doesn't blank out the whole frame
  // (e.g. a warm-lit synthetic test) — guard against masking everything.
  let skin = opts.skin ?? skinMask(data, w, h);
  let skinCount = 0;
  for (let i = 0; i < skin.length; i++) skinCount += skin[i];
  if (skinCount > skin.length * 0.6) skin = null; // too much skin flagged → ignore mask

  const { theta, sharpness } = dominantAxis(mag, ori, w, h, { skin });
  // Optional diagnostic sink so the UI can show WHY detection failed while tuning.
  const dbg = opts.debug;
  if (dbg) { dbg.sharpness = sharpness; dbg.theta = theta; dbg.reason = ''; }
  if (sharpness < floorSharpness) { if (dbg) dbg.reason = 'low-sharpness'; return null; }
  const marginal = sharpness < minSharpness; // must earn its keep via texture

  const prof = crossProfile(gray, w, h, theta, opts.slabs ?? 48, { skin, mag });
  // Prefer the band with the strongest STRING TEXTURE (periodic parallel edges)
  // over the brightest region: in a real scene the neck, rug, and jeans can all
  // be similarly BRIGHT (→ one huge bright band that fails the size check), but
  // only the neck carries dense string edges. Use the density profile whenever it
  // has any usable contrast; fall back to brightness only when it's flat.
  const useDensity = prof.density && maxRange(prof.density) > 2;
  const band = findBand(useDensity ? prof.density : prof.profile);
  if (!band) { if (dbg) dbg.reason = 'no-band'; return null; }

  // Band must occupy a plausible fraction of the frame. A neck viewed diagonally
  // (corner-to-corner) legitimately spans a large perpendicular extent, so the
  // upper bound is generous; the lower bound just rejects hairline artifacts.
  const bandFrac = (band.hi - band.lo + 1) / prof.slabs;
  if (dbg) dbg.bandFrac = bandFrac;
  if (bandFrac < 0.06 || bandFrac > 0.92) { if (dbg) dbg.reason = 'band-size'; return null; }

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
  if (!ext) { if (dbg) dbg.reason = 'no-extent'; return null; }

  // SHAPE GATE — is this band's apparent length:width consistent with a real
  // fretboard's nut→spanFrets region? A fretboard's true proportions are known
  // (geometry.js), so a band that's far too squat cannot be a neck. This is what
  // rejects e.g. a laptop keyboard's wide, blocky quad before we calibrate on it.
  const bandWidthPx = Math.abs(dHi - dLo);
  const bandLengthPx = Math.abs(ext.aMax - ext.aMin);
  const observedRatio = bandWidthPx > 1e-6 ? bandLengthPx / bandWidthPx : Infinity;
  if (dbg) dbg.aspect = observedRatio;
  if (!shapePlausible(observedRatio, { inst: opts.inst, spanFrets: opts.spanFrets ?? 12 })) {
    if (dbg) dbg.reason = 'bad-shape';
    return null;
  }

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

  // Confidence blends orientation sharpness with how much STRING TEXTURE sits
  // inside the chosen band vs outside it — a real fretboard has strong periodic
  // edges concentrated in the band. This rewards actual necks over bright blobs.
  let inSum = 0, inCnt = 0, outSum = 0, outCnt = 0;
  if (prof.density) {
    for (let k = 0; k < prof.slabs; k++) {
      if (k >= band.lo && k <= band.hi) { inSum += prof.density[k]; inCnt++; }
      else { outSum += prof.density[k]; outCnt++; }
    }
  }
  const inMean = inCnt ? inSum / inCnt : 0;
  const outMean = outCnt ? outSum / outCnt : 0;
  const textureRatio = outMean > 1 ? inMean / outMean : (inMean > 1 ? 2 : 1);

  // A real fretboard concentrates edge texture (strings) inside the band. Random
  // noise / flat scenes spread edges evenly → ratio ≈ 1. Require the band to be
  // meaningfully more textured than its surroundings; this is what lets us relax
  // the sharpness bar for hard real necks WITHOUT admitting noise. When sharpness
  // is only "marginal" (below the soft target), demand a STRONGER texture ratio —
  // the neck must prove itself through strings if it can't through linearity.
  const minTextureRatio = opts.minTextureRatio ?? 1.15;
  const requiredRatio = marginal ? (opts.marginalTextureRatio ?? 1.35) : minTextureRatio;
  if (dbg) dbg.textureRatio = textureRatio;
  if (!prof.density || textureRatio < requiredRatio) { if (dbg) dbg.reason = 'low-texture'; return null; }

  // Confidence from sharpness (measured above the hard floor, not the soft
  // target, so marginal-but-textured necks still score) blended with texture.
  const sharpScore = Math.max(0, Math.min(1, (sharpness - floorSharpness) / 4));
  const texScore = Math.max(0, Math.min(1, (textureRatio - 1) / 1.5)); // ratio 1→0, 2.5→1
  const confidence = Math.max(0, Math.min(1, 0.4 * sharpScore + 0.6 * texScore));
  if (dbg) { dbg.confidence = confidence; dbg.reason = 'ok'; }
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

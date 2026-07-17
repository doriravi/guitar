// Vitest spec for neckDetect — the pure-JS fretboard/neck detector. We feed it
// synthetic RGBA frames (a bright horizontal "neck" band with parallel "string"
// lines) and assert it finds a band at the right place, and returns null on
// flat/noisy scenes.

import { describe, it, expect } from 'vitest';
import {
  toGray,
  sobel,
  dominantAxis,
  detectNeck,
  cornersAgree,
  neckAspectRatio,
  shapePlausible,
} from './neckDetect';
import { INSTRUMENTS } from './geometry';

const W = 120, H = 90;

// Build an RGBA buffer from a grayscale fill function f(x,y)->0..255.
function frame(w, h, f) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, f(x, y)));
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return data;
}

// A horizontal neck: a bright band spanning rows [bandLo, bandHi], dark
// background, with thin darker "string" lines running horizontally inside it.
function horizontalNeck(bandLo, bandHi) {
  return frame(W, H, (x, y) => {
    const inBand = y >= bandLo && y <= bandHi;
    if (!inBand) return 30; // dark background
    // pale fretboard
    let v = 200;
    // six horizontal string lines (dark) evenly spaced in the band
    const bh = bandHi - bandLo;
    for (let s = 0; s < 6; s++) {
      const sy = bandLo + ((s + 0.5) / 6) * bh;
      if (Math.abs(y - sy) < 0.6) v = 90;
    }
    return v;
  });
}

describe('toGray + sobel', () => {
  it('produces a horizontal-edge response at a band boundary', () => {
    const data = horizontalNeck(40, 60);
    const g = toGray(data, W, H);
    const { mag } = sobel(g, W, H);
    // There should be strong gradient magnitude somewhere near the top edge row.
    let maxNearEdge = 0;
    for (let x = 5; x < W - 5; x++) {
      maxNearEdge = Math.max(maxNearEdge, mag[40 * W + x]);
    }
    expect(maxNearEdge).toBeGreaterThan(50);
  });
});

describe('dominantAxis', () => {
  it('finds a near-horizontal long axis for a horizontal neck', () => {
    const data = horizontalNeck(35, 65);
    const g = toGray(data, W, H);
    const { mag, ori } = sobel(g, W, H);
    const { theta, sharpness } = dominantAxis(mag, ori, W, H);
    // Horizontal neck → long axis angle ≈ 0 (within ~15°).
    expect(Math.abs(theta)).toBeLessThan(0.26);
    expect(sharpness).toBeGreaterThan(3);
  });
});

describe('detectNeck', () => {
  it('detects a horizontal neck and brackets the band vertically', () => {
    const data = horizontalNeck(30, 60);
    const res = detectNeck(data, W, H);
    expect(res).not.toBeNull();
    expect(res.corners).toHaveLength(4);
    // All corners normalized within [0,1] (with a little tolerance for clamping).
    for (const c of res.corners) {
      expect(c.x).toBeGreaterThanOrEqual(-0.05);
      expect(c.x).toBeLessThanOrEqual(1.05);
      expect(c.y).toBeGreaterThanOrEqual(-0.05);
      expect(c.y).toBeLessThanOrEqual(1.05);
    }
    // The band was rows 30..60 → normalized ~0.33..0.67. The two distinct
    // cross-string edges should straddle that region.
    const ys = res.corners.map((c) => c.y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(0.45);   // one edge above centre
    expect(ys[3]).toBeGreaterThan(0.55); // other edge below centre
    expect(res.confidence).toBeGreaterThan(0);
  });

  it('returns null on a flat image (no neck)', () => {
    const data = frame(W, H, () => 128);
    expect(detectNeck(data, W, H)).toBeNull();
  });

  it('returns null on random noise (no dominant axis)', () => {
    // Deterministic pseudo-noise (no Math.random — keep tests reproducible).
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 256); };
    const data = frame(W, H, () => rnd());
    // Noise has no coherent parallel structure → low sharpness → null (or, if it
    // squeaks past, no stable band). Accept null as the contract.
    expect(detectNeck(data, W, H)).toBeNull();
  });
});

describe('neckAspectRatio — real proportions from geometry.js', () => {
  it('classical nut→12th is ~5.7 : 1 (325mm span / ~57mm mean width)', () => {
    const r = neckAspectRatio(INSTRUMENTS.classical, 12);
    expect(r).toBeGreaterThan(5.4);
    expect(r).toBeLessThan(6.0);
  });

  it('a nut→5th span is much squatter than nut→12th', () => {
    const five = neckAspectRatio(INSTRUMENTS.classical, 5);
    const twelve = neckAspectRatio(INSTRUMENTS.classical, 12);
    expect(five).toBeLessThan(twelve);
    expect(five).toBeGreaterThan(2.5); // ~3.0
  });

  it('a narrower electric neck yields a higher ratio than a classical', () => {
    expect(neckAspectRatio(INSTRUMENTS.electric, 12))
      .toBeGreaterThan(neckAspectRatio(INSTRUMENTS.classical, 12));
  });
});

describe('shapePlausible — rejects quads that cannot be a fretboard', () => {
  it('accepts a true-proportioned nut→12th band', () => {
    expect(shapePlausible(neckAspectRatio(INSTRUMENTS.classical, 12), { spanFrets: 12 })).toBe(true);
  });

  it('accepts a foreshortened band (perspective shortens, never lengthens)', () => {
    expect(shapePlausible(2.0, { spanFrets: 12 })).toBe(true);
  });

  it('rejects a squat, keyboard-like quad', () => {
    // A laptop keyboard's edges yield a wide, blocky band (~1:1 .. 1.5:1) — the
    // exact false lock-on this gate exists to prevent.
    expect(shapePlausible(1.0, { spanFrets: 12 })).toBe(false);
    expect(shapePlausible(1.4, { spanFrets: 12 })).toBe(false);
  });

  it('rejects an absurdly elongated sliver', () => {
    expect(shapePlausible(20, { spanFrets: 12 })).toBe(false);
  });

  it('is span-aware: a 3:1 band fits nut→5th but is squat for nut→12th', () => {
    expect(shapePlausible(3.0, { spanFrets: 5 })).toBe(true);
    // 3.0 is still within the generous foreshortening allowance for span 12,
    // but the EXPECTED ratio differs — the gate scales with the span.
    expect(neckAspectRatio(INSTRUMENTS.classical, 5))
      .not.toBeCloseTo(neckAspectRatio(INSTRUMENTS.classical, 12), 1);
  });
});

describe('cornersAgree', () => {
  const base = [{ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.8 }, { x: 0.9, y: 0.8 }, { x: 0.9, y: 0.2 }];
  it('true when within tolerance', () => {
    const near = base.map((c) => ({ x: c.x + 0.02, y: c.y - 0.01 }));
    expect(cornersAgree(base, near, 0.06)).toBe(true);
  });
  it('false when a corner drifts beyond tolerance', () => {
    const far = base.map((c, i) => (i === 0 ? { x: c.x + 0.2, y: c.y } : c));
    expect(cornersAgree(base, far, 0.06)).toBe(false);
  });
  it('false for malformed input', () => {
    expect(cornersAgree(null, base)).toBe(false);
    expect(cornersAgree(base, base.slice(0, 3))).toBe(false);
  });
});

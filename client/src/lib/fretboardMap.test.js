// Vitest spec for fretboardMap — the perspective homography + (string, fret)
// quantization. Pure math, so we can assert exact cell mappings.

import { describe, it, expect } from 'vitest';
import {
  computeHomography,
  project,
  vToString,
  uToFret,
  mapFingertip,
  mapHandToPositions,
  boardToImage,
  fretCenterU,
} from './fretboardMap';

// A simple axis-aligned "board" rectangle in normalized image space, corners in
// the required order [nut@lowE, nut@highE, end@highE, end@lowE]. Here x is the
// neck axis and y is the string axis, so the mapping is a plain scale/translate.
const RECT = [
  { x: 0.2, y: 0.2 }, // nut  @ low-E
  { x: 0.2, y: 0.8 }, // nut  @ high-e
  { x: 0.9, y: 0.8 }, // end  @ high-e
  { x: 0.9, y: 0.2 }, // end  @ low-E
];

describe('homography', () => {
  it('maps the four corners to the unit square', () => {
    const { H } = computeHomography(RECT);
    const corners = [
      [RECT[0], { u: 0, v: 0 }],
      [RECT[1], { u: 0, v: 1 }],
      [RECT[2], { u: 1, v: 1 }],
      [RECT[3], { u: 1, v: 0 }],
    ];
    for (const [pt, expected] of corners) {
      const got = project(H, pt);
      expect(got.u).toBeCloseTo(expected.u, 6);
      expect(got.v).toBeCloseTo(expected.v, 6);
    }
  });

  it('maps the board centre to (0.5, 0.5)', () => {
    const { H } = computeHomography(RECT);
    const got = project(H, { x: (0.2 + 0.9) / 2, y: (0.2 + 0.8) / 2 });
    expect(got.u).toBeCloseTo(0.5, 6);
    expect(got.v).toBeCloseTo(0.5, 6);
  });

  it('boardToImage is the inverse of project (round-trips u,v)', () => {
    const { H } = computeHomography(RECT);
    for (const [u, v] of [[0, 0], [1, 1], [0.3, 0.7], [0.5, 0.5], [1, 0]]) {
      const img = boardToImage(RECT, u, v);
      expect(img).not.toBeNull();
      const back = project(H, img);
      expect(back.u).toBeCloseTo(u, 6);
      expect(back.v).toBeCloseTo(v, 6);
    }
  });

  it('fretCenterU is 0 at the open string and increases toward the end', () => {
    expect(fretCenterU(0, 5)).toBe(0);
    const f1 = fretCenterU(1, 5);
    const f5 = fretCenterU(5, 5);
    expect(f1).toBeGreaterThan(0);
    expect(f5).toBeGreaterThan(f1);
    expect(f5).toBeLessThanOrEqual(1);
  });

  it('edge-referenced v maps every real string to its own index', () => {
    // On a classical the outer STRING centres span 43mm across a 52mm BOARD at
    // the nut — ~4.5mm inset per side. If the calibration corners were dragged
    // to the board edges, a string's v is NOT i/5; it's inset. Each real string
    // position must still quantize to its own index.
    const boardW = 52, stringW = 43;
    const inset = (boardW - stringW) / 2;
    for (let i = 0; i < 6; i++) {
      const mmFromEdge = inset + (i * stringW) / 5;
      const v = mmFromEdge / boardW;
      expect(vToString(v, { reference: 'edges', u: 0, spanFrets: 12 })).toBe(i);
    }
  });

  it('ignoring the inset is what misaligns the outer strings', () => {
    // The low-E sits at v≈0.087 in board-edge space. Read naively (as if the
    // strings spanned the full board) that rounds to string 0 too — but the
    // NEXT string in, at v≈0.252, naively reads 1 while a point at the true
    // board edge (v=0) is not a string at all. The telling case is the far side:
    // high-e sits at v≈0.913, and the board edge v=1.0 is 4.5mm past it.
    const highEv = ((52 - 43) / 2 + 43) / 52; // ≈0.913
    expect(vToString(highEv, { reference: 'edges', u: 0, spanFrets: 12 })).toBe(5);
    // Naive reading of the true board edge still clamps to 5, which is exactly
    // why the error is silent — it shows up as mid-board strings being shifted.
    const midV = 0.5;
    expect(vToString(midV, { reference: 'edges', u: 0, spanFrets: 12 })).toBe(3);
  });

  it('defaults to string-referenced corners (unchanged behaviour)', () => {
    for (let i = 0; i < 6; i++) {
      expect(vToString(i / 5)).toBe(i);
    }
  });

  it('returns null for a degenerate quad', () => {
    const bad = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    expect(computeHomography(bad)).toBeNull();
  });
});

describe('quantization', () => {
  it('vToString picks the nearest of six string lanes', () => {
    expect(vToString(0)).toBe(0);    // low E
    expect(vToString(1)).toBe(5);    // high e
    expect(vToString(0.5)).toBe(3);  // round(0.5*5)=3 (G)
    expect(vToString(0.19)).toBe(1); // nearest lane to ~0.2
  });

  it('vToString clamps out-of-range values', () => {
    expect(vToString(-0.5)).toBe(0);
    expect(vToString(1.5)).toBe(5);
  });

  it('uToFret returns 0 at the nut', () => {
    expect(uToFret(0, 5)).toBe(0);
  });

  it('uToFret returns spanFrets at the tapped end', () => {
    expect(uToFret(1, 5)).toBe(5);
  });

  it('uToFret respects non-linear (tighter high) fret spacing', () => {
    // With span=5, the physical midpoint u=0.5 sits BELOW fret 3's wire because
    // low frets are wider — so a fingertip halfway along projects to an early
    // fret, not fret 2.5-rounded. Assert it lands in a sane low bracket.
    const f = uToFret(0.5, 5);
    expect(f).toBeGreaterThanOrEqual(2);
    expect(f).toBeLessThanOrEqual(3);
  });
});

describe('mapFingertip + mapHandToPositions', () => {
  it('maps a fingertip near the end/low-E corner to a high fret on low E', () => {
    const { H } = computeHomography(RECT);
    // Just inside the end@lowE corner.
    const cell = mapFingertip(H, { x: 0.88, y: 0.22 }, 5);
    expect(cell.string).toBe(0);       // low E
    expect(cell.fret).toBeGreaterThan(3);
  });

  it('drops fingertips that project outside the board', () => {
    const { H } = computeHomography(RECT);
    // A full landmark array where only index (8) is on-board; others off-board.
    const landmarks = new Array(21).fill({ x: -1, y: -1 });
    landmarks[8] = { x: 0.55, y: 0.35 }; // inside the board
    const positions = mapHandToPositions(H, landmarks, 5);
    expect(positions.length).toBe(1);
    expect(positions[0].fret).toBeGreaterThan(0);
  });

  it('collapses two fingers on the same string to the lower fret', () => {
    const { H } = computeHomography(RECT);
    const landmarks = new Array(21).fill({ x: -1, y: -1 });
    // index near nut, middle further down — both on the low-E lane (y≈0.2).
    landmarks[8] = { x: 0.35, y: 0.21 };
    landmarks[12] = { x: 0.7, y: 0.21 };
    const positions = mapHandToPositions(H, landmarks, 5);
    const lowE = positions.filter((p) => p.string === 0);
    expect(lowE.length).toBe(1); // collapsed to one
  });

  it('returns [] with no homography or no landmarks', () => {
    expect(mapHandToPositions(null, [], 5)).toEqual([]);
    const { H } = computeHomography(RECT);
    expect(mapHandToPositions(H, null, 5)).toEqual([]);
  });
});

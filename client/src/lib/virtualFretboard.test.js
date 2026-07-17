// Vitest spec for virtualFretboard — the screen→virtual-board mapping and the
// occlusion honesty rules. Pure math + pure data, so we can assert exact cells.

import { describe, it, expect } from 'vitest';
import {
  makeVirtualBoard,
  screenToBoard,
  isTipVisible,
  observeHand,
  handToDiagram,
  handFrame,
  toHandSpace,
  boardTransform,
  cameraAngleAdvice,
  KNUCKLES,
  WRIST,
} from './virtualFretboard';
import { FRETTING_TIPS } from './fretboardMap';

// The virtual board occupies the middle of the frame: x 0.1..0.9, y 0.3..0.7.
const BOUNDS = { x: 0.1, y: 0.3, w: 0.8, h: 0.4 };
const BOARD = makeVirtualBoard({ spanFrets: 4 });

// Build a 21-landmark hand with realistic proportions: the wrist below, the four
// knuckles FANNED across a row above it (a real hand's MCPs are spread, not
// coincident), and each fingertip out beyond its own knuckle and nearer the
// camera. Overrides let a test occlude or reposition one finger.
const MCP_X = { index: 0.44, middle: 0.49, ring: 0.54, pinky: 0.59 };
function makeHand(overrides = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[WRIST] = { x: 0.5, y: 0.85, z: 0 };
  for (const [name, idx] of Object.entries(KNUCKLES)) {
    const x = MCP_X[name];
    lm[idx] = { x, y: 0.6, z: 0 };
    // Tip: further from the wrist than its knuckle, and closer to the camera.
    lm[FRETTING_TIPS[name]] = { x, y: 0.45, z: -0.05 };
  }
  for (const [idx, pt] of Object.entries(overrides)) lm[idx] = pt;
  return lm;
}

describe('screenToBoard', () => {
  it('maps the board rect corners to the unit square', () => {
    expect(screenToBoard({ x: 0.1, y: 0.3 }, BOUNDS)).toMatchObject({ u: 0, v: 0, inside: true });
    const far = screenToBoard({ x: 0.9, y: 0.7 }, BOUNDS);
    expect(far.u).toBeCloseTo(1, 6);
    expect(far.v).toBeCloseTo(1, 6);
    expect(far.inside).toBe(true);
  });

  it('maps the board centre to (0.5, 0.5)', () => {
    const c = screenToBoard({ x: 0.5, y: 0.5 }, BOUNDS);
    expect(c.u).toBeCloseTo(0.5, 6);
    expect(c.v).toBeCloseTo(0.5, 6);
  });

  it('flags points outside the board rather than clamping them onto an edge cell', () => {
    // A clamped point would masquerade as a real note on the outer string.
    expect(screenToBoard({ x: 0.05, y: 0.5 }, BOUNDS).inside).toBe(false);
    expect(screenToBoard({ x: 0.5, y: 0.95 }, BOUNDS).inside).toBe(false);
  });
});

describe('isTipVisible — the occlusion signal', () => {
  it('accepts a tip that is in front of its knuckle', () => {
    const lm = makeHand();
    expect(isTipVisible(lm, FRETTING_TIPS.index, KNUCKLES.index)).toBe(true);
  });

  it('rejects a tip that is DEEPER than its knuckle (curled behind the neck)', () => {
    const lm = makeHand({ [FRETTING_TIPS.index]: { x: 0.5, y: 0.45, z: 0.09 } });
    expect(isTipVisible(lm, FRETTING_TIPS.index, KNUCKLES.index)).toBe(false);
  });

  it('rejects a tip collapsed back toward the wrist (the model guessing)', () => {
    // Tip nearer the wrist than its own knuckle → geometrically implausible.
    const lm = makeHand({ [FRETTING_TIPS.ring]: { x: 0.5, y: 0.8, z: -0.05 } });
    expect(isTipVisible(lm, FRETTING_TIPS.ring, KNUCKLES.ring)).toBe(false);
  });

  it('is false when landmarks are missing', () => {
    expect(isTipVisible(null, 8, 5)).toBe(false);
    expect(isTipVisible([], 8, 5)).toBe(false);
  });
});

describe('observeHand', () => {
  it('reports absent when there is no hand', () => {
    const o = observeHand(null, BOUNDS, BOARD);
    expect(o.present).toBe(false);
    expect(o.fingers).toEqual([]);
    expect(o.confidence).toBe(0);
  });

  it('anchors hand position on the KNUCKLES (visible even when tips are not)', () => {
    // Occlude every tip; the anchor must still be reported.
    const occluded = {};
    for (const [name, tipIdx] of Object.entries(FRETTING_TIPS)) {
      occluded[tipIdx] = { x: 0.5, y: 0.45, z: 0.5 }; // way behind
    }
    const o = observeHand(makeHand(occluded), BOUNDS, BOARD);
    expect(o.present).toBe(true);
    expect(o.anchorFret).not.toBeNull();
    expect(o.confidence).toBe(0); // nothing trustworthy to see
  });

  it('confidence is the share of fingers actually visible', () => {
    const lm = makeHand({ [FRETTING_TIPS.pinky]: { x: 0.5, y: 0.45, z: 0.5 } });
    const o = observeHand(lm, BOUNDS, BOARD);
    expect(o.confidence).toBeCloseTo(0.75, 2); // 3 of 4
  });

  it('marks a tip outside the board as not inside', () => {
    const lm = makeHand({ [FRETTING_TIPS.index]: { x: 0.98, y: 0.05, z: -0.05 } });
    const o = observeHand(lm, BOUNDS, BOARD);
    const idx = o.fingers.find((f) => f.name === 'index');
    expect(idx.inside).toBe(false);
  });
});

// Apply a rigid transform + uniform scale to a whole hand — i.e. the player
// moved, leaned, turned, or the camera got closer. The hand's SHAPE is
// unchanged, so every derived cell must be unchanged too.
function transformHand(lm, { dx = 0, dy = 0, rot = 0, scale = 1 } = {}) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return lm.map((p) => ({
    x: (p.x * cos - p.y * sin) * scale + dx,
    y: (p.x * sin + p.y * cos) * scale + dy,
    z: p.z * scale,
  }));
}

describe('handFrame / toHandSpace', () => {
  it('places the wrist at the frame origin', () => {
    const lm = makeHand();
    const f = handFrame(lm);
    const w = toHandSpace(lm[WRIST], f);
    expect(w.along).toBeCloseTo(0, 6);
    expect(w.across).toBeCloseTo(0, 6);
    expect(w.dist).toBeCloseTo(0, 6);
  });

  it('returns null for an unusable hand', () => {
    expect(handFrame(null)).toBeNull();
    expect(handFrame([])).toBeNull();
    // Degenerate: wrist and middle knuckle coincide → no axis to build.
    const lm = makeHand();
    lm[KNUCKLES.middle] = { ...lm[WRIST] };
    expect(handFrame(lm)).toBeNull();
  });

  it('hand-space coordinates are invariant to translation, rotation and scale', () => {
    const lm = makeHand();
    const base = handFrame(lm);
    const tipBase = toHandSpace(lm[FRETTING_TIPS.index], base);

    const moved = transformHand(lm, { dx: 0.21, dy: -0.13, rot: 0.6, scale: 1.7 });
    const f2 = handFrame(moved);
    const tip2 = toHandSpace(moved[FRETTING_TIPS.index], f2);

    expect(tip2.along).toBeCloseTo(tipBase.along, 5);
    expect(tip2.across).toBeCloseTo(tipBase.across, 5);
    expect(tip2.dist).toBeCloseTo(tipBase.dist, 5);
  });
});

describe('observeHand is hand-relative (the static-mapping bug)', () => {
  // A hand posed so its fingertips land on distinct cells: each tip stays over
  // its own knuckle's x (so the fingers keep their across-hand order) but
  // extends a different amount up the hand (so they land on different frets).
  const posed = () => {
    const lm = makeHand();
    lm[FRETTING_TIPS.index] = { x: MCP_X.index, y: 0.34, z: -0.05 };
    lm[FRETTING_TIPS.middle] = { x: MCP_X.middle, y: 0.30, z: -0.05 };
    lm[FRETTING_TIPS.ring] = { x: MCP_X.ring, y: 0.38, z: -0.05 };
    lm[FRETTING_TIPS.pinky] = { x: MCP_X.pinky, y: 0.44, z: -0.05 };
    return lm;
  };
  const cells = (o) => o.fingers.map((f) => `${f.name}:${f.string}:${f.fret}`).join('|');

  it('same shape, moved across the screen -> same cells', () => {
    const a = observeHand(posed(), BOUNDS, BOARD);
    const b = observeHand(transformHand(posed(), { dx: 0.2, dy: 0.15 }), BOUNDS, BOARD);
    expect(b.present).toBe(true);
    expect(cells(b)).toBe(cells(a));
  });

  it('same shape, hand rotated -> same cells', () => {
    const a = observeHand(posed(), BOUNDS, BOARD);
    const b = observeHand(transformHand(posed(), { rot: 0.5 }), BOUNDS, BOARD);
    expect(cells(b)).toBe(cells(a));
  });

  it('same shape, camera closer/further -> same cells (scale-invariant)', () => {
    const a = observeHand(posed(), BOUNDS, BOARD);
    const near = observeHand(transformHand(posed(), { scale: 1.8 }), BOUNDS, BOARD);
    const far = observeHand(transformHand(posed(), { scale: 0.6 }), BOUNDS, BOARD);
    expect(cells(near)).toBe(cells(a));
    expect(cells(far)).toBe(cells(a));
  });

  it('all three at once -> still the same cells', () => {
    const a = observeHand(posed(), BOUNDS, BOARD);
    const b = observeHand(
      transformHand(posed(), { dx: -0.18, dy: 0.22, rot: -0.7, scale: 1.45 }),
      BOUNDS, BOARD,
    );
    expect(cells(b)).toBe(cells(a));
    expect(b.anchorFret).toBe(a.anchorFret);
  });

  it('the mapping ignores the drawn bounds entirely', () => {
    // bounds only says where the board is DRAWN; it must not move the cells.
    const a = observeHand(posed(), { x: 0.1, y: 0.3, w: 0.8, h: 0.4 }, BOARD);
    const b = observeHand(posed(), { x: 0.5, y: 0.01, w: 0.2, h: 0.1 }, BOARD);
    expect(cells(b)).toBe(cells(a));
  });

  it('actually CHANGING the hand shape does change the cells', () => {
    // The invariance must not be vacuous — a real shape change must register.
    const a = observeHand(posed(), BOUNDS, BOARD);
    const moved = posed();
    // Curl the index right back to its knuckle — a big, unambiguous shape change.
    moved[FRETTING_TIPS.index] = { x: MCP_X.index, y: 0.58, z: -0.05 };
    const b = observeHand(moved, BOUNDS, BOARD);
    expect(cells(b)).not.toBe(cells(a));
  });
});

describe('boardTransform — the hand-anchored DRAWING box', () => {
  it('returns null for an unusable hand', () => {
    expect(boardTransform(null)).toBeNull();
    expect(boardTransform([])).toBeNull();
  });

  it('follows the hand across the screen', () => {
    const a = boardTransform(makeHand());
    const b = boardTransform(transformHand(makeHand(), { dx: 0.2, dy: -0.1 }));
    expect(b.cx).toBeCloseTo(a.cx + 0.2, 5);
    expect(b.cy).toBeCloseTo(a.cy - 0.1, 5);
  });

  it('grows when the hand is closer to the camera and shrinks when further', () => {
    const base = boardTransform(makeHand());
    const near = boardTransform(transformHand(makeHand(), { scale: 1.8 }));
    const far = boardTransform(transformHand(makeHand(), { scale: 0.6 }));
    expect(near.w).toBeCloseTo(base.w * 1.8, 5);
    expect(far.w).toBeCloseTo(base.w * 0.6, 5);
    expect(near.h).toBeGreaterThan(base.h);
    expect(far.h).toBeLessThan(base.h);
  });

  it('rotates with the hand', () => {
    const base = boardTransform(makeHand());
    const rot = 0.5;
    const turned = boardTransform(transformHand(makeHand(), { rot }));
    // Angles wrap, so compare the wrapped difference.
    const d = Math.atan2(Math.sin(turned.angle - base.angle), Math.cos(turned.angle - base.angle));
    expect(d).toBeCloseTo(rot, 5);
  });

  it('keeps its aspect ratio under a size trim (scale is a uniform trim)', () => {
    const a = boardTransform(makeHand());
    const b = boardTransform(makeHand(), { scale: 1.5 });
    expect(b.w / b.h).toBeCloseTo(a.w / a.h, 6);
    expect(b.w).toBeCloseTo(a.w * 1.5, 6);
  });

  it('does NOT change the reported cells — drawing is not mapping', () => {
    // The whole point of the separation: where we draw the box must not be able
    // to change what the app claims the user played.
    const lm = makeHand();
    const cells = (o) => o.fingers.map((f) => `${f.name}:${f.string}:${f.fret}`).join('|');
    const a = observeHand(lm, { x: 0.1, y: 0.3, w: 0.8, h: 0.4 }, BOARD);
    const t = boardTransform(lm, { scale: 2.2 });
    const b = observeHand(lm, { x: t.cx, y: t.cy, w: t.w, h: t.h }, BOARD);
    expect(cells(b)).toBe(cells(a));
  });
});

describe('cameraAngleAdvice — the real blocker, surfaced', () => {
  it('says no hand when there is none', () => {
    expect(cameraAngleAdvice(observeHand(null, BOUNDS, BOARD)).level).toBe('nohand');
    expect(cameraAngleAdvice({ present: false }).level).toBe('nohand');
  });

  it('calls a fully-occluded hand BLIND rather than reporting a chord', () => {
    // This is the user's actual screenshot: "Fingers seen: 0%".
    const occluded = {};
    for (const tipIdx of Object.values(FRETTING_TIPS)) {
      occluded[tipIdx] = { x: 0.5, y: 0.45, z: 0.5 };
    }
    const o = observeHand(makeHand(occluded), BOUNDS, BOARD);
    const a = cameraAngleAdvice(o);
    expect(a.level).toBe('blind');
    expect(a.visible).toBe(0);
    expect(a.advice).toMatch(/shoulder|down the neck/i);
  });

  it('flags a partially-occluded hand', () => {
    const lm = makeHand({ [FRETTING_TIPS.pinky]: { x: 0.5, y: 0.45, z: 0.5 } });
    expect(cameraAngleAdvice(observeHand(lm, BOUNDS, BOARD)).level).toBe('partial'); // 3/4
  });

  it('passes a hand whose fingertips are all visible', () => {
    const a = cameraAngleAdvice(observeHand(makeHand(), BOUNDS, BOARD));
    expect(a.level).toBe('good');
    expect(a.visible).toBe(1);
  });

  it('judges OCCLUSION only — a visible finger outside the board is not bad angle', () => {
    // The fixture's pinky maps outside the board window (v > 1), so observeHand's
    // `confidence` (visible && inside) is 0.75 while all four tips are plainly
    // visible. Reading confidence here would tell the user to move their camera
    // over their shoulder to fix what is really a framing/hand-position matter.
    const o = observeHand(makeHand(), BOUNDS, BOARD);
    expect(o.confidence).toBeCloseTo(0.75, 2);      // inside-the-board share
    expect(cameraAngleAdvice(o).level).toBe('good'); // but the ANGLE is fine
  });
});

describe('handToDiagram — occluded fingers never become notes', () => {
  it('a visible finger becomes a real tab digit', () => {
    const lm = makeHand();
    // Put the index tip on a specific cell: u→fret, v→string.
    lm[FRETTING_TIPS.index] = { x: 0.5, y: 0.35, z: -0.05 };
    const o = observeHand(lm, BOUNDS, BOARD);
    const { chord } = handToDiagram(o);
    expect(chord.tab).toHaveLength(6);
    // At least one string carries a fretted digit.
    expect(/[1-9]/.test(chord.tab)).toBe(true);
    expect(chord.notes.length).toBeGreaterThan(0);
  });

  it('an OCCLUDED finger is marked uncertain, not printed as a note', () => {
    // Every tip occluded → no notes at all, only 'weak' marks.
    const occluded = {};
    for (const tipIdx of Object.values(FRETTING_TIPS)) {
      occluded[tipIdx] = { x: 0.5, y: 0.45, z: 0.5 };
    }
    const o = observeHand(makeHand(occluded), BOUNDS, BOARD);
    const { chord, marks } = handToDiagram(o);
    expect(chord.notes).toEqual([]);            // nothing asserted
    expect(chord.tab).not.toMatch(/[1-9]/);     // no fretted digit invented
    expect(Object.values(marks)).toContain('weak'); // shown as uncertain instead
  });

  it('returns an empty board when no hand is present', () => {
    const { chord, marks } = handToDiagram({ present: false });
    expect(chord.tab).toBe('xxxxxx');
    expect(chord.notes).toEqual([]);
    expect(marks).toEqual({});
  });

  it('lowest fret wins when two fingers claim the same string', () => {
    const lm = makeHand();
    // index and middle on the same string (same v), different frets (different u)
    lm[FRETTING_TIPS.index] = { x: 0.75, y: 0.5, z: -0.05 };
    lm[FRETTING_TIPS.middle] = { x: 0.35, y: 0.5, z: -0.05 };
    const o = observeHand(lm, BOUNDS, BOARD);
    const { chord } = handToDiagram(o);
    const frets = chord.notes.map((n) => n.fret);
    // Only one note on that shared string.
    const strings = chord.notes.map((n) => n.string);
    expect(new Set(strings).size).toBe(strings.length);
    if (frets.length) expect(Math.min(...frets)).toBe(frets[0]);
  });
});

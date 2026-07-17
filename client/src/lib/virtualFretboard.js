// virtualFretboard.js
// ===================
// The VIRTUAL fretboard: an app-owned neck rendered on screen, rather than a
// physical neck discovered in the camera image.
//
// Why this exists
// ---------------
// Detecting the real neck proved unreliable (clutter wins the dominant axis,
// lighting moves the band, the board drifts as you play). The virtual board is
// fixed and app-owned, so it never drifts and needs no 4-corner calibration:
// the camera's ONLY job is to say where the hand is in normalized 2D space.
//
// HONESTY (the thing this module refuses to fake)
// ----------------------------------------------
// A virtual board fixes CALIBRATION. It does not restore VISIBILITY. When the
// fretting hand curls around a real neck, the fingertips are physically hidden
// and MediaPipe *invents* their positions — we measured this: tips rendered on
// the wrist and out in the background while the real fingers were on the neck.
// So every finger carries a `visible` flag derived from real signals, and an
// occluded finger is reported as UNCERTAIN, never as a confident pressed note.
// Callers must honour that distinction; see handToDiagram().
//
// Reuse, not reinvention
// ----------------------
// Fret ratios and string lanes are NOT recomputed here. uToFret()/vToString()
// (fretboardMap.js) already implement exact equal temperament via geometry.js —
// the same source the reach engine and Fretboard Measures use. Duplicating that
// math is how a fret grid silently drifts out of sync with the rest of the app.

import { INSTRUMENTS } from './geometry';
import { uToFret, vToString, FRETTING_TIPS, NUM_STRINGS } from './fretboardMap';

// MediaPipe Hands landmark indices for the knuckle row (MCP joints). These sit
// on the BACK of the hand, so they stay visible even when the fingertips are
// curled out of sight around a neck — which is why the hand's position along the
// board is anchored to them rather than to the tips.
export const KNUCKLES = { index: 5, middle: 9, ring: 13, pinky: 17 };
export const WRIST = 0;

// ── Hand-relative frame ──────────────────────────────────────────────────────
// A board pinned to fixed SCREEN coordinates breaks the moment the player moves:
// shift the guitar or lean back and every fingertip lands in the wrong cell,
// even though the hand never changed shape. So we stop measuring fingertips in
// screen space and measure them in the HAND's own frame instead — origin at the
// wrist, axes aligned to the hand, distances in units of the hand's own size.
// Move, rotate, or lean and the numbers hold; only actually changing your hand
// shape changes them.
//
// Scale factor — why NOT wrist→index-knuckle:
//   That distance shortens when you flex your wrist, at a constant camera
//   distance, which would silently rescale the whole grid mid-chord. The
//   KNUCKLE-ROW width (index MCP ↔ pinky MCP) is pose-stable — it barely moves
//   as fingers curl or the wrist bends — so it is the primary ruler, with
//   wrist→middle-MCP as a fallback when the row is too foreshortened to measure.

/**
 * Build the hand's local coordinate frame from its landmarks.
 *
 * origin : the wrist (landmark 0)
 * ux     : unit vector wrist → middle knuckle ("up" the hand / along the fingers)
 * uy     : perpendicular to ux (across the knuckles)
 * scale  : the hand's own size in normalized screen units — everything is
 *          measured in multiples of this, so camera distance cancels out
 *
 * @param {Array} landmarks the 21 MediaPipe landmarks
 * @returns {{ox,oy,uxx,uxy,uyx,uyy,scale}|null} null if the hand is unusable
 */
export function handFrame(landmarks) {
  const wrist = landmarks?.[WRIST];
  const idxMcp = landmarks?.[KNUCKLES.index];
  const midMcp = landmarks?.[KNUCKLES.middle];
  const pinkyMcp = landmarks?.[KNUCKLES.pinky];
  if (!wrist || !idxMcp || !midMcp || !pinkyMcp) return null;

  // Primary axis: wrist → middle knuckle. Middle (not index) because it sits at
  // the hand's centre line, so the axis doesn't skew as fingers spread.
  const ax = midMcp.x - wrist.x;
  const ay = midMcp.y - wrist.y;
  const alen = Math.hypot(ax, ay);
  if (alen < 1e-6) return null; // degenerate: wrist and knuckle coincide

  const uxx = ax / alen, uxy = ay / alen;
  const uyx = -uxy, uyy = uxx; // +90° rotation → the across-hand axis

  // Ruler: pose-stable knuckle-row width, falling back to the wrist→MCP length
  // when the row is nearly edge-on (its apparent width collapses).
  const rowW = Math.hypot(idxMcp.x - pinkyMcp.x, idxMcp.y - pinkyMcp.y);
  const scale = rowW > 0.02 ? rowW : alen;
  if (scale < 1e-6) return null;

  return { ox: wrist.x, oy: wrist.y, uxx, uxy, uyx, uyy, scale };
}

/**
 * Express a screen point in the hand's frame.
 * Returns hand-relative coordinates in units of hand-size:
 *   along  — up the hand (wrist → fingers). Grows as a finger extends.
 *   across — across the knuckles. Separates the fingers from each other.
 * Both are invariant to where the hand is, how it's rotated, and how far away.
 *
 * @param {{x,y}} pt      normalized screen point
 * @param {object} frame  from handFrame()
 * @returns {{along:number, across:number, dist:number, angle:number}}
 */
export function toHandSpace(pt, frame) {
  const dx = pt.x - frame.ox;
  const dy = pt.y - frame.oy;
  const along = (dx * frame.uxx + dy * frame.uxy) / frame.scale;
  const across = (dx * frame.uyx + dy * frame.uyy) / frame.scale;
  return {
    along,
    across,
    dist: Math.hypot(along, across),   // wrist→point, in hand-sizes
    angle: Math.atan2(across, along),  // bearing from the hand's own axis
  };
}

/**
 * Build a virtual board model. Cell geometry is derived from the REAL instrument
 * proportions in geometry.js, so the virtual neck is dimensionally a guitar and
 * the reach engine's difficulty scores apply to it unchanged.
 *
 * @param {object} [opts]
 * @param {number} [opts.firstFret=1] lowest fret the board window shows
 * @param {number} [opts.spanFrets=4] frets visible in the window
 * @param {object} [opts.inst]        an INSTRUMENTS entry (default classical)
 */
export function makeVirtualBoard({ firstFret = 1, spanFrets = 4, inst = INSTRUMENTS.classical } = {}) {
  return { firstFret, spanFrets, strings: NUM_STRINGS, inst };
}

/**
 * Map a point in normalized SCREEN space to the virtual board's (u, v).
 *
 * The board is a fixed on-screen rectangle, so this is a plain affine map — no
 * homography, no calibration, nothing to drift. Points outside the rectangle
 * come back with inside:false rather than being clamped onto an edge cell (a
 * clamped point would masquerade as a real note on the outer string).
 *
 * @param {{x:number,y:number}} pt  normalized screen point (0..1 of the frame)
 * @param {{x:number,y:number,w:number,h:number}} bounds the board's rect, also
 *        in normalized frame coords
 * @returns {{u:number, v:number, inside:boolean}}
 */
export function screenToBoard(pt, bounds) {
  const u = (pt.x - bounds.x) / bounds.w;
  const v = (pt.y - bounds.y) / bounds.h;
  const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
  return { u, v, inside };
}

/**
 * Is this fingertip actually VISIBLE, or is the model guessing?
 *
 * Two real signals, no hand-waving:
 *  1. MediaPipe reports a per-landmark `z` (depth relative to the wrist, more
 *     negative = closer to camera). A fretting fingertip that has curled BEHIND
 *     the neck sits further from the camera than its own knuckle.
 *  2. Geometric sanity: a visible fingertip is normally further from the wrist
 *     than its knuckle. When a tip is occluded the model tends to collapse it
 *     back toward/behind the knuckle.
 *
 * Either signal firing marks the tip uncertain. This is deliberately eager: a
 * false "uncertain" costs a dimmed dot, a false "confident" prints a chord the
 * user never played.
 *
 * @param {Array} landmarks the 21 MediaPipe landmarks ({x,y,z})
 * @param {number} tipIdx   fingertip landmark index
 * @param {number} mcpIdx   that finger's knuckle landmark index
 * @param {object} [opts]
 * @param {number} [opts.zMargin=0.02] how much deeper than the knuckle counts as behind
 */
export function isTipVisible(landmarks, tipIdx, mcpIdx, opts = {}) {
  const tip = landmarks?.[tipIdx];
  const mcp = landmarks?.[mcpIdx];
  const wrist = landmarks?.[WRIST];
  if (!tip || !mcp || !wrist) return false;

  const zMargin = opts.zMargin ?? 0.02;
  // 1. Depth: tip meaningfully further from the camera than its knuckle.
  if (typeof tip.z === 'number' && typeof mcp.z === 'number') {
    if (tip.z > mcp.z + zMargin) return false;
  }
  // 2. Geometry: tip collapsed back toward the wrist, behind its knuckle.
  const dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  const dMcp = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
  if (dTip < dMcp * 0.9) return false;

  return true;
}

/**
 * Observe the hand against the virtual board — the honest layer.
 *
 * Returns what the camera can actually support, NOT a list of pressed cells:
 *  - `anchorFret`/`spreadFrets` come from the KNUCKLE row, which stays visible
 *    even when the tips don't, so hand POSITION along the neck is trustworthy.
 *  - each finger carries `visible`; occluded ones are reported with their best
 *    guess but flagged, so the UI can show uncertainty instead of a fake note.
 *
 * The mapping is HAND-RELATIVE: cells come from each fingertip's position in the
 * hand's own frame (see handFrame), not from where the hand happens to sit on
 * screen. Move the guitar, lean back, or turn — the cells hold. `bounds` is
 * accepted only so callers can pass the rect they DRAW the board in; it does not
 * affect the mapping.
 *
 * @param {Array} landmarks the 21 MediaPipe landmarks, or null
 * @param {{x,y,w,h}} [bounds] the drawn board's rect — unused by the mapping
 * @param {object} board     from makeVirtualBoard()
 * @returns {{present:boolean, anchorFret:number|null, spreadFrets:number,
 *            confidence:number, fingers:Array, frame:object|null}}
 */
export function observeHand(landmarks, bounds, board) {
  const absent = { present: false, anchorFret: null, spreadFrets: 0, confidence: 0, fingers: [], frame: null };
  if (!landmarks || !landmarks.length) return absent;

  // Everything below is measured in the HAND's frame, not the screen's, so the
  // reading survives the player moving, leaning, or rotating the guitar.
  const frame = handFrame(landmarks);
  if (!frame) return absent;
  const span = board.spanFrets;

  // The along-neck range is derived from THIS hand, not hardcoded: a fingertip's
  // useful travel runs from its own knuckle row (curled) outward to roughly one
  // knuckle-row-width beyond it (extended). Deriving it from the measured
  // knuckle distance keeps the mapping correct for any hand proportion instead
  // of assuming one hand's numbers.
  const mcpDists = Object.values(KNUCKLES)
    .map((i) => landmarks[i])
    .filter(Boolean)
    .map((k) => toHandSpace(k, frame).dist);
  const mcpRef = mcpDists.length
    ? mcpDists.reduce((a, b) => a + b, 0) / mcpDists.length
    : 1;
  const REACH_MIN = mcpRef;             // fingertip drawn back to the knuckles
  const REACH_MAX = mcpRef + 1.3;       // fingertip fully extended (~1.3 rows out)
  const reachToU = (dist) => (dist - REACH_MIN) / (REACH_MAX - REACH_MIN);

  // Fingers fan out across the knuckles. Half a knuckle-row width each side of
  // the hand's centre line spans index→pinky, mapped onto the six string lanes.
  const SPREAD = 0.5;
  const acrossToV = (across) => (across + SPREAD) / (2 * SPREAD);

  // Hand position along the neck, anchored on the KNUCKLE row — visible even
  // when the fingertips are not, so this stays trustworthy under occlusion.
  const knuckleAlong = [];
  for (const idx of Object.values(KNUCKLES)) {
    const k = landmarks[idx];
    if (!k) continue;
    knuckleAlong.push(toHandSpace(k, frame).dist);
  }
  let anchorFret = null;
  let spreadFrets = 0;
  if (knuckleAlong.length) {
    const mean = knuckleAlong.reduce((a, b) => a + b, 0) / knuckleAlong.length;
    const clamp01 = (n) => Math.max(0, Math.min(1, n));
    anchorFret = uToFret(clamp01(reachToU(mean)), span);
    const lo = uToFret(clamp01(reachToU(Math.min(...knuckleAlong))), span);
    const hi = uToFret(clamp01(reachToU(Math.max(...knuckleAlong))), span);
    spreadFrets = Math.abs(hi - lo);
  }

  // Per-finger cells, each carrying its own honesty flag.
  const fingers = [];
  const fingerNo = { index: 1, middle: 2, ring: 3, pinky: 4 };
  for (const [name, tipIdx] of Object.entries(FRETTING_TIPS)) {
    const tip = landmarks[tipIdx];
    if (!tip) continue;
    const hs = toHandSpace(tip, frame);
    const u = reachToU(hs.dist);
    const v = acrossToV(hs.across);
    // "inside" now means inside the HAND's usable range, not inside a screen box
    // — a finger the hand simply cannot reach with is not a note.
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    const visible = isTipVisible(landmarks, tipIdx, KNUCKLES[name]);
    fingers.push({
      finger: fingerNo[name],
      name,
      string: vToString(Math.max(0, Math.min(1, v))),
      fret: uToFret(Math.max(0, Math.min(1, u)), span),
      inside,
      visible,
      u,
      v,
      dist: hs.dist,    // wrist→tip, in hand-sizes (scale-invariant)
      angle: hs.angle,  // bearing from the hand's own axis
    });
  }

  // Confidence = the share of fretting fingers we can actually see.
  const seen = fingers.filter((f) => f.visible && f.inside).length;
  const confidence = fingers.length ? seen / fingers.length : 0;

  return { present: true, anchorFret, spreadFrets, confidence, fingers, frame };
}

/**
 * Bridge an observation to the app's existing <FretboardDiagram>.
 *
 * The diagram takes a chord ({ tab, notes }) plus `marks` — and `marks` already
 * means exactly what we need for occlusion: 'weak' = "this string is uncertain /
 * didn't ring cleanly". So:
 *   - a VISIBLE finger inside the board  -> a real tab digit (a confident note)
 *   - an OCCLUDED finger                 -> marks[string] = 'weak' (unconfirmed)
 * An occluded finger never becomes a tab digit; that's the whole point.
 *
 * @param {object} observation from observeHand()
 * @returns {{chord:{name:string,tab:string,notes:Array}, marks:object}}
 */
export function handToDiagram(observation) {
  const tab = ['x', 'x', 'x', 'x', 'x', 'x'];
  const notes = [];
  const marks = {};
  if (!observation?.present) {
    return { chord: { name: '', tab: tab.join(''), notes }, marks };
  }

  // Lowest fret per string wins when two fingers claim the same string.
  const bestByString = new Map();
  for (const f of observation.fingers) {
    if (!f.inside || f.fret <= 0) continue;
    const prev = bestByString.get(f.string);
    if (!prev || f.fret < prev.fret) bestByString.set(f.string, f);
  }

  for (const [string, f] of bestByString) {
    if (f.visible) {
      tab[string] = String(f.fret);
      notes.push({ string, fret: f.fret });
    } else {
      // Seen-but-unconfirmed: show WHERE without asserting WHAT.
      marks[string] = 'weak';
    }
  }
  return { chord: { name: '', tab: tab.join(''), notes }, marks };
}

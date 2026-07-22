import { useRef, useState, useEffect, useCallback } from 'react';
import { useT } from '../lib/i18n';

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const MCP = { thumb: 2, index: 5, middle: 9, ring: 13, pinky: 17 };
// Fallback palm width (cm, index-knuckle to pinky-knuckle) used only when
// metric world landmarks AND card calibration are both unavailable. True
// adult average ≈ 8 cm. Kept only as a last-resort fallback — see
// `indexLenToPalmRatio` for the preferred anatomical-ratio fallback.
const PALM_REF_CM = 8.0;
// Index-finger length (MCP→tip) to palm-width (index-MCP↔pinky-MCP) ratio.
// This proportion is anatomically far more stable across hand sizes than an
// absolute palm-width assumption — small and large hands scale together, so
// measuring one on-screen and knowing the other's usual ratio gives a much
// better per-user cm/pixel estimate than a fixed 8cm guess.
const INDEX_LEN_TO_PALM_WIDTH_RATIO = 1.02;

// MediaPipe's world landmarks are metric 3D (meters) fitted to an internal
// average-hand model, so they already read close to true centimeters. The old
// ×1.4 factor here existed only to mask the app's previously inflated reference
// data (average total span was modeled as 36.5 cm vs the true ~21 cm, so real
// hands read "Very small" and measurements were scaled up to compensate). With
// the reference data now anatomically correct, no correction is applied — a
// true-average splayed hand should total ≈ 21 cm across the four gaps. Tune
// only if a specific device reads consistently off against a ruler.
const WORLD_SCALE_CORRECTION = 1.0;

const GAP_KEYS = ['thumbToIndex', 'indexToMiddle', 'middleToRing', 'ringToLittle'];

// ISO/IEC 7810 ID-1 card (credit/debit/ID) — universal real-world ruler.
const CARD_LONG_CM = 8.56;   // 85.60 mm long edge
const CARD_SHORT_CM = 5.398; // 53.98 mm short edge
const CARD_ASPECT = CARD_LONG_CM / CARD_SHORT_CM; // ~1.586

const RANGES = {
  thumbToIndex:  [5, 10],
  indexToMiddle: [2.5, 7],
  middleToRing:  [2, 6],
  ringToLittle:  [3, 8.5],
};

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// 3D Euclidean distance — used with metric world landmarks (units in meters).
function dist3D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// Each tip's associated knuckle (MCP), used to measure that finger's
// z-tilt (how much it's lifted toward/away from the camera vs the palm
// plane) so we can correct for perspective foreshortening.
const TIP_TO_MCP = { [TIP.thumb]: MCP.thumb, [TIP.index]: MCP.index, [TIP.middle]: MCP.middle, [TIP.ring]: MCP.ring, [TIP.pinky]: MCP.pinky };

/**
 * Z-axis tilt correction (upgrade 1.A): a fingertip distance measured in the
 * XY (camera) plane under-reports the true 3D gap whenever a finger is bent
 * or angled toward/away from the lens — the tip's z sits closer to (or
 * farther from) the camera than its knuckle, foreshortening the on-screen
 * span. MediaPipe's world landmarks are metric, so the raw z-delta between a
 * tip and its own knuckle (`z_tip - z_knuckle`) is a real, per-finger measure
 * of that lean. We correct the flat XY gap by folding the two fingers'
 * average z-lean back in as a third dimension — recovering the true 3D reach
 * instead of trusting MediaPipe's depth-scale-prone absolute XYZ distance.
 */
function tiltCorrectedGapCm(world, tipA, tipB) {
  const a = world[tipA], b = world[tipB];
  const mcpA = world[TIP_TO_MCP[tipA]], mcpB = world[TIP_TO_MCP[tipB]];
  const flatCm = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) * 100;
  // Per-finger lean relative to its own knuckle — cancels whole-hand tilt
  // (which is roughly common to both fingers) and isolates the individual
  // finger's bend/reach toward the camera.
  const leanA = a.z - mcpA.z;
  const leanB = b.z - mcpB.z;
  const relLeanCm = (leanA - leanB) * 100;
  return Math.sqrt(flatCm ** 2 + relLeanCm ** 2);
}

/**
 * Convert a single frame's landmarks to the 4 finger gaps in cm.
 *
 * Prefers MediaPipe's metric `multiHandWorldLandmarks`, but rather than
 * trusting the model's absolute XYZ distance directly (its overall depth
 * *scale* is prone to error for hands that are larger/smaller than its
 * internal average-hand prior), we take the flat XY gap — reliable in
 * relative terms — and add back per-finger z-tilt as a correction for
 * perspective foreshortening (see `tiltCorrectedGapCm`). When world
 * landmarks are missing, falls back to `resolvePlanarScale` (card
 * calibration → index/palm skeletal ratio → fixed palm width, in that
 * preference order).
 *
 * @param {Array} lm     - normalized image landmarks (multiHandLandmarks)
 * @param {Array|null} world - metric world landmarks (multiHandWorldLandmarks)
 * @param {number|null} cardCmPerUnit - cm-per-normalized-unit from a tapped card, if active
 * @param {number} worldScaleCorrection - learned (or default) multiplier correcting MediaPipe's absolute depth scale, from a prior card calibration
 */
function landmarksToMeasurements(lm, world, cardCmPerUnit = null, worldScaleCorrection = WORLD_SCALE_CORRECTION) {
  if (world && world.length >= 21) {
    const k = worldScaleCorrection;
    return {
      thumbToIndex:  tiltCorrectedGapCm(world, TIP.thumb,  TIP.index)  * k,
      indexToMiddle: tiltCorrectedGapCm(world, TIP.index,  TIP.middle) * k,
      middleToRing:  tiltCorrectedGapCm(world, TIP.middle, TIP.ring)   * k,
      ringToLittle:  tiltCorrectedGapCm(world, TIP.ring,   TIP.pinky)  * k,
    };
  }
  // Fallback: 2D image landmarks scaled by the best available planar scale.
  const scale = resolvePlanarScale(lm, cardCmPerUnit);
  if (scale == null) return null;
  return {
    thumbToIndex:  dist(lm[TIP.thumb],  lm[TIP.index])  * scale,
    indexToMiddle: dist(lm[TIP.index],  lm[TIP.middle]) * scale,
    middleToRing:  dist(lm[TIP.middle], lm[TIP.ring])   * scale,
    ringToLittle:  dist(lm[TIP.ring],   lm[TIP.pinky])  * scale,
  };
}

// Adult-average index finger length, MCP knuckle to tip (cm) — the one
// absolute anatomical reference the ratio fallback anchors to.
const INDEX_LEN_REF_CM = 8.15;

/**
 * Skeletal-ratio fallback (upgrade 1.B): when there's no metric world data
 * and no card in frame, don't assume every hand has an 8cm palm width.
 * Instead anchor the scale to index-finger length (MCP→tip), which is more
 * reliably captured on-screen than palm width (it isn't blocked by an
 * imaged-flat palm) and — critically — cross-check it against this specific
 * hand's own index-length-to-palm-width ratio before trusting it: if the
 * ratio is wildly outside the normal anatomical band, the index reading is
 * probably foreshortened (finger not fully flat to camera) and we fall back
 * to the fixed palm-width guess instead of trusting a bad per-user estimate.
 */
function resolvePlanarScale(lm, cardCmPerUnit) {
  if (cardCmPerUnit != null) return cardCmPerUnit;
  const indexLenPx = dist(lm[MCP.index], lm[TIP.index]);
  const palmPx = dist(lm[MCP.index], lm[MCP.pinky]);
  if (palmPx < 1e-6) return null;
  if (indexLenPx > 1e-6) {
    const ratio = indexLenPx / palmPx;
    // Plausibility gate: real hands run close to INDEX_LEN_TO_PALM_WIDTH_RATIO
    // (~1.02); accept a wide band around it, reject outliers from a
    // foreshortened/occluded index finger.
    if (ratio > INDEX_LEN_TO_PALM_WIDTH_RATIO * 0.6 && ratio < INDEX_LEN_TO_PALM_WIDTH_RATIO * 1.6) {
      return INDEX_LEN_REF_CM / indexLenPx;
    }
  }
  return PALM_REF_CM / palmPx;
}

/**
 * Raw 2D fingertip gaps in normalized image units (x,y in [0,1]).
 * Used in card-calibration mode, where a known-size card supplies the real
 * cm-per-unit scale instead of the assumed palm width / world landmarks.
 */
function landmarksToGaps2D(lm) {
  return {
    thumbToIndex:  dist(lm[TIP.thumb],  lm[TIP.index]),
    indexToMiddle: dist(lm[TIP.index],  lm[TIP.middle]),
    middleToRing:  dist(lm[TIP.middle], lm[TIP.ring]),
    ringToLittle:  dist(lm[TIP.ring],   lm[TIP.pinky]),
  };
}

/**
 * From the user-tapped card corners (normalized {x,y}, in TL,TR,BR,BL order),
 * derive cm-per-normalized-unit by averaging the two long edges. Returns null
 * if the quad looks invalid (e.g. tapped wrong / too tilted).
 */
function cardCornersToScale(corners) {
  if (!corners || corners.length !== 4) return null;
  const [tl, tr, br, bl] = corners;
  const topLen = dist(tl, tr);
  const botLen = dist(bl, br);
  const leftLen = dist(tl, bl);
  const rightLen = dist(tr, br);
  // Long edges = the pair with the larger average length.
  const horizAvg = (topLen + botLen) / 2;
  const vertAvg  = (leftLen + rightLen) / 2;
  const longAvg = Math.max(horizAvg, vertAvg);
  if (longAvg < 1e-4) return null;
  // Reject if the two long edges disagree too much (card tilted in-plane).
  const longPair = horizAvg >= vertAvg ? [topLen, botLen] : [leftLen, rightLen];
  if (Math.abs(longPair[0] - longPair[1]) / longAvg > 0.25) return null;
  return CARD_LONG_CM / longAvg; // cm per normalized unit
}

// 90th-percentile of a numeric array — the peak comfortable stretch while
// rejecting the top ~10% as tracking-jitter spikes.
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(p * (s.length - 1)));
  return s[i];
}

function stdDev(values) {
  if (values.length < 2) return Infinity; // can't judge stability from <2 samples
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const STABILITY_WINDOW_MS = 500;
const STABILITY_MAX_SIGMA_CM = 0.05;

// Auto-measure: once the hand sits inside the target frame and stops moving,
// hold it still for AUTO_HOLD_MS and the measurement fires on its own — no
// button. AUTO_MOVE_EPS is the per-frame centroid drift (in normalized image
// units) below which the hand counts as "not moving"; any larger jump resets
// the hold timer.
const AUTO_HOLD_MS = 3000;
const AUTO_MOVE_EPS = 0.012;

// If the live camera goes this long without ever detecting a hand, the device
// is likely held in an orientation that crops the hand out of the sensor frame —
// prompt the user to switch between portrait and landscape.
const DETECT_TIMEOUT_MS = 20000;

/**
 * Moving-window stability gate (upgrade 1.C): the 90th-percentile peak over
 * the *whole* recording buffer can be skewed if the user hesitates or drifts
 * slowly mid-stretch — a slow "creeping" motion can register several
 * different but all-plausible-looking values, none of which is really the
 * held peak. Instead, for each gap, we walk the buffered samples and mark
 * each one "accepted" only when the trailing 500ms window ending at that
 * sample has a standard deviation below `STABILITY_MAX_SIGMA_CM` — i.e. the
 * hand was genuinely holding still there, not still moving into position or
 * jittering from tracking noise. The final pool (every accepted sample) then
 * gets the same 90th-percentile treatment as before. Falls back to the full
 * unfiltered buffer when nothing has stabilized yet, so the live bars still
 * show progress instead of sitting at zero.
 */
function stableGatedPeaks(buffers, stabilityBuffers) {
  const out = {};
  for (const k of GAP_KEYS) {
    const samples = stabilityBuffers[k];
    const stablePool = [];
    let winStart = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = samples[i].t;
      while (samples[winStart].t < t - STABILITY_WINDOW_MS) winStart++;
      const win = samples.slice(winStart, i + 1).map(s => s.v);
      if (win.length >= 3 && stdDev(win) < STABILITY_MAX_SIGMA_CM) stablePool.push(samples[i].v);
    }
    out[k] = stablePool.length ? percentile(stablePool, 0.9) : percentile(buffers[k], 0.9);
  }
  return out;
}

function clampMeasurements(m) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    out[k] = Math.min(hi, Math.max(lo, Math.round(m[k] * 10) / 10));
  }
  return out;
}

// Derive on-screen pixels-per-centimeter from the metric world landmarks.
// World landmarks are real 3D in meters; the same two points in normalized image
// space × canvas width give the pixel distance. We use the index-MCP↔pinky-MCP
// span (the palm width) as the reference — it's stable and roughly frontal.
function pxPerCmFromWorld(lm, world, W, H) {
  if (!world || world.length < 21) return null;
  // Apply the same under-report correction as the measurements so the on-screen
  // ruler and average-hand overlay stay true-to-life.
  const worldCm = dist3D(world[MCP.index], world[MCP.pinky]) * 100 * WORLD_SCALE_CORRECTION;
  if (worldCm < 1e-3) return null;
  const px = Math.sqrt(
    ((lm[MCP.index].x - lm[MCP.pinky].x) * W) ** 2 +
    ((lm[MCP.index].y - lm[MCP.pinky].y) * H) ** 2
  );
  if (px < 1e-3) return null;
  return px / worldCm; // pixels per cm
}

// Draw a centimeter ruler along the bottom of the frame. The video/canvas are
// mirrored via CSS scaleX(-1); we mirror the tick labels back so numbers read
// correctly to the user. `pxPerCm` comes from the live hand scale.
function drawRuler(ctx, W, H, pxPerCm) {
  if (!pxPerCm || pxPerCm <= 0) return;
  const marginX = 16;
  const baseY = H - 22;              // ruler baseline
  const usableW = W - marginX * 2;
  const maxCm = Math.floor(usableW / pxPerCm);
  if (maxCm < 1) return;             // hand too far / scale too small to be useful

  ctx.save();
  // Track background
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(marginX - 6, baseY - 20, Math.min(usableW, maxCm * pxPerCm) + 12, 34);

  ctx.strokeStyle = '#c9a96e';
  ctx.fillStyle = '#f0ede8';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 1;

  // Baseline
  ctx.beginPath();
  ctx.moveTo(marginX, baseY);
  ctx.lineTo(marginX + maxCm * pxPerCm, baseY);
  ctx.stroke();

  const halfCmPx = pxPerCm / 2;
  for (let cm = 0; cm <= maxCm; cm++) {
    const x = marginX + cm * pxPerCm;
    // Major (cm) tick
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, baseY - 12);
    ctx.stroke();
    // Half-cm (5mm) tick
    if (cm < maxCm) {
      ctx.beginPath();
      ctx.moveTo(x + halfCmPx, baseY);
      ctx.lineTo(x + halfCmPx, baseY - 6);
      ctx.stroke();
    }
    // Label every 2 cm to avoid crowding; un-mirror so digits read normally.
    if (cm % 2 === 0) {
      ctx.save();
      ctx.translate(x, baseY - 14);
      ctx.scale(-1, 1); // cancel the CSS mirror
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(cm), 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

// Population-average finger gaps (cm), matching DEFAULT_PROFILE. Drawn as a
// ghost reference hand so the user can compare their reach against "average".
const AVG_GAPS = {
  thumbToIndex: 7.5,
  indexToMiddle: 4.5,
  middleToRing: 3.5,
  ringToLittle: 5.5,
};
// Rough average finger lengths (cm) from the knuckle line, for a recognizable
// stylized outline. These are display-only; the gaps above drive the reach span.
const AVG_FINGER_LEN_CM = { thumb: 6.0, index: 7.5, middle: 8.2, ring: 7.6, pinky: 6.0 };

// Draw a translucent, true-to-scale "average hand" reference: a stylized skeleton
// whose fingertip spacing equals the population-average gaps, with those gap
// distances labeled in cm. `pxPerCm` gives real-world scale from the live hand.
function drawAverageHand(ctx, W, H, pxPerCm, caption) {
  if (!pxPerCm || pxPerCm <= 0) return;

  // Lay out five fingertips along an arc so adjacent tips are spaced by the
  // average gaps. We place them left-to-right: thumb, index, middle, ring, pinky.
  const gapsPx = [
    AVG_GAPS.thumbToIndex * pxPerCm,
    AVG_GAPS.indexToMiddle * pxPerCm,
    AVG_GAPS.middleToRing * pxPerCm,
    AVG_GAPS.ringToLittle * pxPerCm,
  ];
  const totalSpan = gapsPx.reduce((a, b) => a + b, 0);

  // Center the whole shape horizontally; anchor knuckles a bit below middle.
  const startX = (W - totalSpan) / 2;
  const knuckleY = H * 0.62;

  // Fingertip x positions (cumulative), and per-finger tip y (length upward).
  const names = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  const tipX = [startX];
  for (const g of gapsPx) tipX.push(tipX[tipX.length - 1] + g);
  const knuckleXs = tipX; // knuckle roughly under each tip for a splayed hand
  const tips = names.map((n, i) => ({
    name: n,
    kx: knuckleXs[i],
    ky: knuckleY,
    tx: tipX[i],
    ty: knuckleY - AVG_FINGER_LEN_CM[n] * pxPerCm,
  }));

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#6b7280';       // muted slate — clearly a "reference"
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);

  // Palm baseline connecting knuckles + a wrist.
  ctx.beginPath();
  ctx.moveTo(tips[0].kx, tips[0].ky);
  for (let i = 1; i < tips.length; i++) ctx.lineTo(tips[i].kx, tips[i].ky);
  ctx.stroke();

  // Fingers (knuckle → tip).
  for (const t of tips) {
    ctx.beginPath();
    ctx.moveTo(t.kx, t.ky);
    ctx.lineTo(t.tx, t.ty);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Fingertip dots.
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#9ca3af';
  for (const t of tips) {
    ctx.beginPath();
    ctx.arc(t.tx, t.ty, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gap labels (in cm) drawn between adjacent fingertips, un-mirrored.
  const gapCm = [AVG_GAPS.thumbToIndex, AVG_GAPS.indexToMiddle, AVG_GAPS.middleToRing, AVG_GAPS.ringToLittle];
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < gapCm.length; i++) {
    const a = tips[i], b = tips[i + 1];
    const mx = (a.tx + b.tx) / 2;
    const my = (a.ty + b.ty) / 2 - 8;
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(-1, 1); // cancel the CSS mirror so text reads normally
    ctx.fillText(`${gapCm[i]} cm`, 0, 0);
    ctx.restore();
  }

  // "Average hand" caption near the wrist, un-mirrored.
  const capX = (tips[0].kx + tips[4].kx) / 2;
  ctx.save();
  ctx.translate(capX, knuckleY + 16);
  ctx.scale(-1, 1);
  ctx.fillStyle = '#9ca3af';
  ctx.font = 'italic 10px system-ui, sans-serif';
  ctx.fillText(caption || 'average hand', 0, 0);
  ctx.restore();

  ctx.restore();
}

function drawHand(ctx, lm, W, H) {
  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17],
  ];
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#c9a96e';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
    ctx.stroke();
  }
  const tipColors = ['#a78bfa','#38bdf8','#34d399','#c9a96e','#f87171'];
  [TIP.thumb, TIP.index, TIP.middle, TIP.ring, TIP.pinky].forEach((idx, i) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = tipColors[i];
    ctx.beginPath();
    ctx.arc(lm[idx].x * W, lm[idx].y * H, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// Target frame the hand must sit inside before a measurement is approved. Given
// as a normalized rect (0..1) of the video. Sized so a correctly-distanced,
// splayed hand fills most of it — too far (small) or clipped (out of bounds)
// fails the check, which keeps reach + flexibility readings consistent.
const FRAME = { x: 0.18, y: 0.10, w: 0.64, h: 0.80 };
// Fraction of the frame the hand's bounding box should occupy to count as
// "well-sized" (not too far away). Height is the more reliable axis for a
// vertical splayed hand.
const FRAME_MIN_FILL = 0.55;

// Check the hand landmarks against the target frame. Returns { ok, reason }.
// reason ∈ 'ok' | 'outside' | 'toosmall' so the UI can give specific guidance.
function checkHandInFrame(lm) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  // Any landmark outside the frame → not contained.
  const inside = minX >= FRAME.x && maxX <= FRAME.x + FRAME.w &&
                 minY >= FRAME.y && maxY <= FRAME.y + FRAME.h;
  if (!inside) return { ok: false, reason: 'outside' };
  // Big enough? Compare the hand's height to the frame's height.
  const fill = (maxY - minY) / FRAME.h;
  if (fill < FRAME_MIN_FILL) return { ok: false, reason: 'toosmall' };
  return { ok: true, reason: 'ok' };
}

// Draw the target frame. Colored green when the hand fits, amber otherwise, with
// corner brackets for a clear "align here" affordance.
function drawFrame(ctx, W, H, ok) {
  const x = FRAME.x * W, y = FRAME.y * H, w = FRAME.w * W, h = FRAME.h * H;
  const color = ok ? '#4ade80' : '#c9a96e';
  ctx.save();
  // Dim outside the frame to draw the eye in.
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(x, y, w, h);
  ctx.fill('evenodd');

  ctx.globalAlpha = ok ? 0.95 : 0.7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Corner brackets.
  const c = Math.min(w, h) * 0.12;
  ctx.lineWidth = 4;
  ctx.beginPath();
  // TL
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  // TR
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  // BL
  ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h);
  // BR
  ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c);
  ctx.stroke();
  ctx.restore();
}

// Load MediaPipe from CDN as a classic script (avoids ESM bundling issues)
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js';
let scriptPromise = null;
function loadMediaPipeScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.Hands) { resolve(); return; }
    const s = document.createElement('script');
    s.src = CDN;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load MediaPipe from CDN'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function CameraHandMeasure({ onMeasured, lang }) {
  const tr = useT(lang);
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const handsRef  = useRef(null);
  const rafRef    = useRef(null);
  const streamRef = useRef(null);
  const latestLm  = useRef(null);
  const latestWorld = useRef(null);          // metric world landmarks (meters)

  // Auto-measure "hold still" detector: while the hand is in the target frame
  // and not moving, we count up how long it's been steady. Once it holds still
  // for AUTO_HOLD_MS the measurement fires by itself — no button press.
  const prevCentroidRef = useRef(null);      // {x,y} of last frame's hand centroid (normalized)
  const holdSinceRef    = useRef(null);       // performance.now() when the current still-hold began
  const autoTriggeredRef = useRef(false);     // guards against firing twice per session
  const autoMeasureRef  = useRef(null);       // holds the latest startRecording so onResults can fire it

  // Recording-window state (max-stretch over time)
  const recordingRef = useRef(false);        // true while buffering frames
  const buffersRef   = useRef({ thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] });
  // Card-calibration buffers: raw 2D gaps (normalized units) collected in parallel.
  const gaps2dBufferRef = useRef({ thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] });
  // Stability buffers for upgrade 1.C — rolling window of {t, value} samples
  // per gap, used to gate the peak pool on a low-variance ("hand is fully
  // still and extended") window instead of trusting every buffered frame.
  const stabilityBufferRef = useRef({ thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] });
  // World-landmark palm-width samples during the *card-calibrated* recording,
  // paired against the card's true palm-width reading — lets us derive a
  // one-time correction factor for MediaPipe's absolute depth scale (upgrade
  // 1.A) that then improves every future world-landmark-only measurement in
  // this session.
  const worldPalmDuringCardRef = useRef([]);
  const worldScaleCorrectionRef = useRef(1.0); // learned multiplier, replaces the static WORLD_SCALE_CORRECTION once calibrated
  const [worldCalibrated, setWorldCalibrated] = useState(false);

  const [phase, setPhase]         = useState('idle');
  const [statusMsg, setStatus]    = useState('');
  const [captured, setCaptured]   = useState(null);
  const [handVisible, setHandVisible] = useState(false);
  const [frameFit, setFrameFit] = useState({ ok: false, reason: 'nohand' }); // hand-in-frame gate
  const frameFitRef = useRef(false);                                          // latest ok, for handlers
  const [rulerActive, setRulerActive] = useState(false); // true when cm ruler is scaled & drawn
  const [holdProgress, setHoldProgress] = useState(0);    // 0..1 how far through the hold-still auto-measure
  const [livePeaks, setLivePeaks] = useState(null); // { gapKey: cm } running p90 for live bars
  const pendingStreamRef = useRef(null); // stream waiting for video element to mount

  // No-detection fallback (upgrade): if the camera has been live for
  // DETECT_TIMEOUT_MS without ever seeing a hand, the phone is often held in an
  // orientation where the hand doesn't fit the sensor's aspect — prompt the user
  // to rotate the device (portrait ↔ landscape) and keep nudging every interval.
  const [showOrientationHint, setShowOrientationHint] = useState(false);
  const handEverSeenRef = useRef(false); // set true the first frame a hand is detected

  // Card calibration
  const [cardMode, setCardMode]     = useState(false); // user opted to use a card
  const [frozenFrame, setFrozenFrame] = useState(null); // data URL for the tap-the-corners step
  const [cardCorners, setCardCorners] = useState([]);   // tapped [{x,y}] in normalized coords

  const stop = useCallback(() => {
    recordingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (handsRef.current) handsRef.current.close?.();
    rafRef.current = null;
    streamRef.current = null;
    handsRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setPhase('loading');
    setStatus(tr.loadingModel);
    try {
      await loadMediaPipeScript();

      // window.Hands is now available from CDN
      const hands = new window.Hands({
        locateFile: f =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
      });
      hands.onResults(results => {
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        const W = canvas.width  = video.videoWidth  || 640;
        const H = canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        if (results.multiHandLandmarks?.length) {
          const lm = results.multiHandLandmarks[0];
          const world = results.multiHandWorldLandmarks?.[0] ?? null;
          latestLm.current = lm;
          latestWorld.current = world;
          setHandVisible(true);
          // A hand is in frame — cancel/clear the "rotate your device" fallback.
          if (!handEverSeenRef.current) handEverSeenRef.current = true;
          setShowOrientationHint(false);

          // Position gate: is the hand inside the target frame and well-sized?
          const fit = checkHandInFrame(lm);
          frameFitRef.current = fit.ok;
          setFrameFit(fit);
          drawFrame(ctx, W, H, fit.ok);

          // Auto-measure: if the hand is in position and holding still, count up
          // the steady time; fire the measurement once it's held for AUTO_HOLD_MS.
          // Only runs before any recording/measure has started this session.
          if (!recordingRef.current && !autoTriggeredRef.current) {
            const now = performance.now();
            // Wrist-anchored centroid — cheap, stable proxy for "did the hand move".
            const cx = (lm[0].x + lm[MCP.index].x + lm[MCP.pinky].x) / 3;
            const cy = (lm[0].y + lm[MCP.index].y + lm[MCP.pinky].y) / 3;
            const prev = prevCentroidRef.current;
            const moved = prev ? Math.hypot(cx - prev.x, cy - prev.y) : Infinity;
            prevCentroidRef.current = { x: cx, y: cy };

            if (fit.ok && moved < AUTO_MOVE_EPS) {
              if (holdSinceRef.current == null) holdSinceRef.current = now;
              const held = now - holdSinceRef.current;
              setHoldProgress(Math.min(1, held / AUTO_HOLD_MS));
              if (held >= AUTO_HOLD_MS) {
                autoTriggeredRef.current = true;
                setHoldProgress(0);
                autoMeasureRef.current?.();   // → startRecording (captures, then freezes)
              }
            } else {
              // Moved, or drifted out of the frame — restart the hold.
              holdSinceRef.current = null;
              setHoldProgress(0);   // React bails out if already 0
            }
          }

          drawHand(ctx, lm, W, H);

          // Live cm ruler + average-hand reference, both scaled from the detected
          // hand's metric world landmarks (real-world cm).
          const pxPerCm = pxPerCmFromWorld(lm, world, W, H);
          if (pxPerCm) {
            drawAverageHand(ctx, W, H, pxPerCm, tr.averageHand || 'average hand');
            drawRuler(ctx, W, H, pxPerCm);
          }
          setRulerActive(!!pxPerCm);

          // While recording, accumulate per-frame gaps for the peak-stretch measure.
          if (recordingRef.current) {
            const now = performance.now();
            const m = landmarksToMeasurements(lm, world, null, worldScaleCorrectionRef.current);
            if (m) {
              const buf = buffersRef.current;
              const stab = stabilityBufferRef.current;
              for (const k of GAP_KEYS) {
                buf[k].push(m[k]);
                stab[k].push({ t: now, v: m[k] });
              }
              // Live running p90 (of the stability-gated pool — see
              // `stableGatedPeaks`, upgrade 1.C) drives the on-screen max bars.
              setLivePeaks(stableGatedPeaks(buf, stab));
            }
            // In card mode, also buffer raw 2D gaps to be scaled by the card
            // later, plus the world-landmark palm width alongside it so we
            // can later derive a MediaPipe depth-scale correction (1.A).
            const g2 = landmarksToGaps2D(lm);
            const b2 = gaps2dBufferRef.current;
            for (const k of GAP_KEYS) b2[k].push(g2[k]);
            if (cardMode && world && world.length >= 21) {
              worldPalmDuringCardRef.current.push(dist3D(world[MCP.index], world[MCP.pinky]) * 100);
            }
          }
        } else {
          latestLm.current = null;
          latestWorld.current = null;
          setHandVisible(false);
          setRulerActive(false);
          frameFitRef.current = false;
          setFrameFit({ ok: false, reason: 'nohand' });
          // Hand gone — cancel any in-progress auto-measure hold.
          prevCentroidRef.current = null;
          holdSinceRef.current = null;
          setHoldProgress(0);
          // Still draw the empty target frame so the user knows where to aim.
          drawFrame(ctx, W, H, false);
        }
      });
      handsRef.current = hands;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
      streamRef.current = stream;
      pendingStreamRef.current = stream;

      // Transition to ready — video element mounts after this re-render.
      // The useEffect below attaches the stream once the element is available.
      setPhase('ready');
      setStatus('');

    } catch (err) {
      console.error(err);
      setPhase('error');
      setStatus(err.message || 'Camera or model failed to load.');
    }
  }, [tr]);

  // Recording window tuning
  const MIN_RECORD_MS = 2000;   // record at least this long
  const MAX_RECORD_MS = 5000;   // hard stop so it always terminates
  const PLATEAU_MS     = 1500;  // stop early once no gap improves for this long
  const PLATEAU_EPS_CM = 0.2;   // "improvement" threshold per gap

  // p90 peak of every gap in a buffer object.
  const peakOf = (buf) => ({
    thumbToIndex:  percentile(buf.thumbToIndex,  0.9),
    indexToMiddle: percentile(buf.indexToMiddle, 0.9),
    middleToRing:  percentile(buf.middleToRing,  0.9),
    ringToLittle:  percentile(buf.ringToLittle,  0.9),
  });

  // Finalize: take the 90th-percentile peak per gap as the reach envelope.
  const finalize = useCallback(() => {
    recordingRef.current = false;
    const buf = buffersRef.current;
    if (!buf.thumbToIndex.length) {  // never saw a usable frame
      setPhase('ready');
      return;
    }

    // Card mode: freeze the current frame, then ask the user to tap the card's
    // four corners so we can derive the true cm-per-pixel scale.
    if (cardMode) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        const W = canvas.width, H = canvas.height;
        const snap = document.createElement('canvas');
        snap.width = W; snap.height = H;
        snap.getContext('2d').drawImage(video, 0, 0, W, H);
        setFrozenFrame(snap.toDataURL('image/jpeg', 0.85));
      }
      setLivePeaks(null);
      setCardCorners([]);
      setPhase('card');
      stop();
      return;
    }

    // Stability-gated peak (1.C) — prefer the filtered "hand was genuinely
    // still" pool; peakOf(buf) remains only as an empty-pool fallback inside
    // stableGatedPeaks itself.
    setCaptured(clampMeasurements(stableGatedPeaks(buf, stabilityBufferRef.current)));
    setLivePeaks(null);
    setPhase('done');
    stop();
  }, [stop, cardMode]);

  // Card mode: convert the buffered raw 2D gaps to cm using the tapped corners.
  const finalizeWithCard = useCallback((corners) => {
    const cmPerUnit = cardCornersToScale(corners);
    if (cmPerUnit == null) {
      setStatus(tr.cardInvalid || 'Couldn’t read the card — tap its 4 corners in order.');
      setCardCorners([]);
      return;
    }
    const b2 = gaps2dBufferRef.current;
    const peak2d = peakOf(b2);
    const cm = {};
    for (const k of GAP_KEYS) cm[k] = peak2d[k] * cmPerUnit;
    setCaptured(clampMeasurements(cm));

    // Upgrade 1.A: the card gives ground-truth scale for this frame, so we
    // can now check how far MediaPipe's own absolute depth scale was off and
    // learn a correction factor for future card-free (world-landmark)
    // measurements in this session — this hand's true palm width (via the
    // card-derived cm-per-unit scale) vs. what the world landmarks implied.
    const lm = latestLm.current;
    const trueCardPalmCm = lm ? dist(lm[MCP.index], lm[MCP.pinky]) * cmPerUnit : 0;
    const worldPalmSamples = worldPalmDuringCardRef.current;
    if (worldPalmSamples.length >= 3 && trueCardPalmCm > 1) {
      const medianWorldPalmCm = percentile(worldPalmSamples, 0.5);
      if (medianWorldPalmCm > 1e-3) {
        const factor = trueCardPalmCm / medianWorldPalmCm;
        // Clamp to a sane band — a wildly outsized factor almost certainly
        // means a bad card read or a frame with an unstable hand, not a
        // real depth-scale bias, so don't let it corrupt future readings.
        if (factor > 0.5 && factor < 2.0) {
          worldScaleCorrectionRef.current = factor;
          setWorldCalibrated(true);
        }
      }
    }
    worldPalmDuringCardRef.current = [];

    setFrozenFrame(null);
    setPhase('done');
  }, [tr]);

  // Start the timed recording window after the countdown.
  const startRecording = useCallback(() => {
    buffersRef.current = { thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] };
    gaps2dBufferRef.current = { thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] };
    stabilityBufferRef.current = { thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] };
    worldPalmDuringCardRef.current = [];
    setLivePeaks(null);
    recordingRef.current = true;
    setPhase('recording');

    const startedAt = performance.now();
    let lastImprovedAt = startedAt;
    let lastPeaks = { thumbToIndex: 0, indexToMiddle: 0, middleToRing: 0, ringToLittle: 0 };

    const id = setInterval(() => {
      if (!recordingRef.current) { clearInterval(id); return; }
      const now = performance.now();
      const buf = buffersRef.current;
      const cur = {
        thumbToIndex:  percentile(buf.thumbToIndex,  0.9),
        indexToMiddle: percentile(buf.indexToMiddle, 0.9),
        middleToRing:  percentile(buf.middleToRing,  0.9),
        ringToLittle:  percentile(buf.ringToLittle,  0.9),
      };
      const improved = GAP_KEYS.some(k => cur[k] - lastPeaks[k] > PLATEAU_EPS_CM);
      if (improved) lastImprovedAt = now;
      lastPeaks = cur;

      const elapsed = now - startedAt;
      const plateaued = elapsed >= MIN_RECORD_MS && (now - lastImprovedAt) >= PLATEAU_MS;
      if (plateaued || elapsed >= MAX_RECORD_MS) {
        clearInterval(id);
        finalize();
      }
    }, 200);
  }, [finalize]);

  // Keep the auto-measure trigger pointed at the current startRecording so the
  // onResults closure (created once in startCamera) can fire the freshest one.
  useEffect(() => { autoMeasureRef.current = startRecording; }, [startRecording]);


  // Attach stream to video element once it mounts after phase → 'ready'
  useEffect(() => {
    if (phase !== 'ready') return;
    const video = videoRef.current;
    const stream = pendingStreamRef.current;
    if (!video || !stream) return;
    pendingStreamRef.current = null;
    video.srcObject = stream;
    video.play().catch(console.error);

    const loop = async () => {
      if (videoRef.current && handsRef.current && videoRef.current.readyState >= 2) {
        await handsRef.current.send({ image: videoRef.current });
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [phase]);

  // No-detection fallback timer: while the camera is live and looking for a
  // hand, if none is found within DETECT_TIMEOUT_MS, surface a prompt to rotate
  // the device between portrait and landscape (a common fix — the hand is
  // getting cropped out of the sensor's aspect). `handEverSeenRef` is flipped in
  // onResults the moment a hand appears, which also clears the hint. Re-checks
  // on an interval so the nudge persists across failed orientation flips until a
  // hand is finally detected. Only meaningful in the pre-recording 'ready' phase.
  useEffect(() => {
    if (phase !== 'ready') { setShowOrientationHint(false); return undefined; }
    handEverSeenRef.current = false;
    setShowOrientationHint(false);
    const id = setInterval(() => {
      if (!handEverSeenRef.current) setShowOrientationHint(true);
    }, DETECT_TIMEOUT_MS);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => stop(), [stop]);

  const retry = () => {
    setCaptured(null);
    setPhase('idle');
    setHandVisible(false);
    setRulerActive(false);
    setFrameFit({ ok: false, reason: 'nohand' });
    frameFitRef.current = false;
    setLivePeaks(null);
    setFrozenFrame(null);
    setCardCorners([]);
    recordingRef.current = false;
    latestLm.current = null;
    latestWorld.current = null;
    // Re-arm the hold-still auto-measure for the next attempt.
    autoTriggeredRef.current = false;
    prevCentroidRef.current = null;
    holdSinceRef.current = null;
    setHoldProgress(0);
    // Re-arm the no-detection orientation prompt.
    handEverSeenRef.current = false;
    setShowOrientationHint(false);
  };

  const CARD_CORNER_LABELS = [
    tr.cardTL || 'top-left', tr.cardTR || 'top-right',
    tr.cardBR || 'bottom-right', tr.cardBL || 'bottom-left',
  ];

  // Record a tapped corner (normalized coords). The displayed image is mirrored
  // (scaleX(-1)); landmark gaps are mirror-invariant for distances, so we store
  // the raw click position in the image's own normalized space.
  const handleCardTap = (e) => {
    if (cardCorners.length >= 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const next = [...cardCorners, { x, y }];
    setCardCorners(next);
    setStatus('');
    if (next.length === 4) finalizeWithCard(next);
  };

  const GAP_LABELS = [
    { key: 'thumbToIndex',  label: tr.thumbIndex,  color: '#a78bfa' },
    { key: 'indexToMiddle', label: tr.indexMiddle, color: '#38bdf8' },
    { key: 'middleToRing',  label: tr.middleRing,  color: '#34d399' },
    { key: 'ringToLittle',  label: tr.ringPinky,   color: '#c9a96e' },
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">📷</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{tr.cameraMeasurement}</span>
        </div>
        {(phase === 'ready' || phase === 'recording' || phase === 'card') && (
          <button
            onClick={() => { stop(); setPhase('idle'); setHandVisible(false); setLivePeaks(null); setFrozenFrame(null); setCardCorners([]); autoTriggeredRef.current = false; holdSinceRef.current = null; prevCentroidRef.current = null; setHoldProgress(0); handEverSeenRef.current = false; setShowOrientationHint(false); }}
            className="text-xs px-3 py-1 rounded-lg"
            style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}
          >
            {tr.cancel}
          </button>
        )}
      </div>

      {phase === 'idle' && (
        <div className="p-5 text-center">
          <p className="text-sm mb-1" style={{ color: 'var(--color-ink-subtle)' }}>{tr.cameraInstruction}</p>
          <p className="text-xs mb-4" style={{ color: 'var(--color-ink-ghost)' }}>{tr.cameraDesc}</p>

          {/* Step-by-step guide */}
          <div className="text-left rounded-xl p-4 mb-4 space-y-2.5"
            style={{ background: 'var(--color-surface-850)', border: '1px solid var(--color-surface-650)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-ink-faint)' }}>
              {tr.guideTitle || 'How to measure'}
            </p>
            {[
              tr.guideStep1 || 'Allow camera access when your browser asks.',
              tr.guideStep2 || 'Hold your fretting hand up, palm flat toward the camera.',
              tr.guideStep3 || 'Wait until the badge turns green: “Hand detected”.',
              tr.guideStep4 || 'Tap Measure, then splay your fingers as wide as is comfortable.',
              tr.guideStep5 || 'Hold the stretch while the bars fill — your max is captured automatically.',
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                  style={{ background: 'var(--color-surface-600)', color: 'var(--color-brand)' }}>{i + 1}</span>
                <span className="text-xs leading-snug" style={{ color: 'var(--color-ink-muted)' }}>{step}</span>
              </div>
            ))}
            <p className="text-[11px] pt-1.5 mt-1.5" style={{ color: 'var(--color-ink-ghost)', borderTop: '1px solid var(--color-surface-700)' }}>
              💡 {tr.guideTip || 'Good lighting and a plain background help detection. Stretch only as far as feels comfortable — never force it.'}
            </p>
          </div>

          {/* Card-calibration toggle */}
          <button
            onClick={() => setCardMode(v => !v)}
            className="flex items-center gap-2.5 w-full text-left rounded-xl px-4 py-3 mb-4 transition-all"
            style={cardMode
              ? { background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)' }
              : { background: 'var(--color-surface-850)', border: '1px solid var(--color-surface-650)' }}
          >
            <span className="text-base shrink-0">💳</span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-semibold" style={{ color: cardMode ? 'var(--color-info)' : 'var(--color-ink-muted)' }}>
                {tr.cardToggle || 'Use a bank card for accuracy'}
              </span>
              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-ink-faint)' }}>
                {tr.cardToggleDesc || 'Hold any credit/ID card flat against your hand. Calibrates true scale.'}
              </span>
            </span>
            <span className="shrink-0 w-9 h-5 rounded-full relative transition-all"
              style={{ background: cardMode ? 'var(--color-info)' : 'var(--color-surface-550)' }}>
              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                style={{ left: cardMode ? '18px' : '2px' }} />
            </span>
          </button>

          <button
            onClick={startCamera}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}
          >
            {tr.openCamera}
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="p-5 flex items-center justify-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{ borderColor: 'var(--color-brand)', borderTopColor: 'transparent' }} />
          <span className="text-sm" style={{ color: 'var(--color-ink-faint)' }}>{tr.loadingModel}</span>
        </div>
      )}

      {(phase === 'ready' || phase === 'recording') && (
        <div>
          <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
              playsInline muted
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ transform: 'scaleX(-1)' }}
            />
            <div className="absolute top-3 left-3 flex flex-col items-start gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(0,0,0,0.75)', color: handVisible ? 'var(--color-success)' : 'var(--color-danger)' }}>
                <div className="w-2 h-2 rounded-full" style={{ background: handVisible ? 'var(--color-success)' : 'var(--color-danger)' }} />
                {handVisible ? tr.handDetected : tr.noHandDetected}
              </div>
              {handVisible && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{ background: 'rgba(0,0,0,0.75)', color: frameFit.ok ? 'var(--color-success)' : 'var(--color-brand)' }}>
                  <span>{frameFit.ok ? '✅' : '🎯'}</span>
                  {frameFit.ok
                    ? (tr.frameGoodBadge || 'Hand in frame')
                    : frameFit.reason === 'toosmall'
                      ? (tr.frameTooFarBadge || 'Move closer')
                      : (tr.frameOutsideBadge || 'Fit hand in frame')}
                </div>
              )}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(0,0,0,0.75)', color: rulerActive ? 'var(--color-brand)' : 'var(--color-ink-subtle)' }}>
                <span>📏</span>
                {rulerActive ? (tr.rulerLive || 'cm ruler live') : (tr.rulerHint || 'Show your hand to scale the ruler')}
              </div>
            </div>
            {/* No-detection fallback: after 20s with no hand, nudge the user to
                rotate the device between portrait and landscape. */}
            {phase === 'ready' && showOrientationHint && !handVisible && (
              <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl max-w-xs"
                  style={{ background: 'rgba(0,0,0,0.82)', border: '1px solid var(--color-brand)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>
                  <span className="text-lg leading-none mt-0.5 animate-pulse">🔄</span>
                  <span className="text-xs font-semibold leading-snug" style={{ color: 'var(--color-brand)' }}>
                    {tr.orientationHint || 'Still no hand detected. Try rotating your device between portrait and landscape.'}
                  </span>
                </div>
              </div>
            )}
            {/* Auto-measure "hold still" ring — fills as the hand stays steady. */}
            {phase === 'ready' && holdProgress > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <div className="relative w-28 h-28">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="8" />
                    <circle cx="50" cy="50" r="44" fill="none" stroke="var(--color-brand)" strokeWidth="8"
                      strokeLinecap="round" strokeDasharray={2 * Math.PI * 44}
                      strokeDashoffset={2 * Math.PI * 44 * (1 - holdProgress)} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-4xl font-black"
                    style={{ color: 'var(--color-brand)', textShadow: '0 0 20px rgba(201,169,110,0.9)' }}>
                    {Math.max(1, Math.ceil((1 - holdProgress) * (AUTO_HOLD_MS / 1000)))}
                  </span>
                </div>
                <span className="px-3 py-1.5 rounded-full text-xs font-bold"
                  style={{ background: 'rgba(0,0,0,0.75)', color: 'var(--color-brand)' }}>
                  {tr.holdStill || 'Hold still — measuring…'}
                </span>
              </div>
            )}
            {phase === 'recording' && (
              <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold"
                style={{ background: 'rgba(0,0,0,0.75)', color: 'var(--color-danger)' }}>
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--color-danger)' }} />
                {tr.stretchNow || 'Stretch as wide as comfortable…'}
              </div>
            )}
          </div>

          {/* Live max-stretch bars while recording */}
          {phase === 'recording' && livePeaks && (
            <div className="px-4 pt-3 space-y-1.5">
              {GAP_LABELS.map(({ key, label, color }) => {
                const [lo, hi] = RANGES[key];
                const val = livePeaks[key] ?? 0;
                const pct = Math.min(100, Math.max(0, ((val - lo) / (hi - lo)) * 100));
                return (
                  <div key={key} className="flex items-center gap-2" title={label}>
                    <span className="text-[10px] w-16 shrink-0" style={{ color }}>{label}</span>
                    <div className="relative h-2 flex-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-550)' }}>
                      <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <span className="text-[10px] tabular-nums w-12 text-right" style={{ color: 'var(--color-ink-subtle)' }}>{val.toFixed(1)} cm</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="p-4">
            <p className="text-xs" style={{ color: (phase === 'ready' && handVisible && !frameFit.ok) ? 'var(--color-brand)' : 'var(--color-ink-faint)' }}>
              {phase === 'recording'
                ? (tr.keepStretching || 'Keep stretching — capturing your max…')
                : (phase === 'ready' && handVisible && !frameFit.ok)
                  ? (frameFit.reason === 'toosmall'
                      ? (tr.frameTooFar || 'Move your hand closer — fill the frame.')
                      : (tr.frameOutside || 'Fit your whole hand inside the frame.'))
                  : cardMode
                    ? (tr.cardHoldAuto || 'Hold a card flat against your hand, both in view, and keep still — it measures automatically.')
                    : (frameFit.ok
                        ? (tr.frameGoodAuto || 'Perfect — hold still and it measures automatically.')
                        : tr.splayFingers)}
            </p>
          </div>
        </div>
      )}

      {phase === 'card' && (
        <div>
          <div className="px-4 pt-4 pb-2">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-info)' }}>
              {tr.cardTapTitle || 'Tap the card’s 4 corners'}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-ink-subtle)' }}>
              {(tr.cardTapNext || 'Tap the {corner} corner').replace('{corner}', CARD_CORNER_LABELS[cardCorners.length] || '')}
              {' '}<span style={{ color: 'var(--color-ink-ghost)' }}>({cardCorners.length}/4)</span>
            </p>
            {statusMsg && <p className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>{statusMsg}</p>}
          </div>
          <div className="relative bg-black mx-4 rounded-lg overflow-hidden" style={{ cursor: 'crosshair' }}
            onClick={handleCardTap}>
            {frozenFrame && (
              <img src={frozenFrame} alt="" className="w-full block" style={{ transform: 'scaleX(-1)' }} draggable={false} />
            )}
            {/* Corner markers/polygon are drawn in DISPLAYED (clicked) space — no
                extra mirroring, since taps were captured in that same space. The
                card-scale math uses only inter-corner distances, which are
                mirror-invariant, so this stays correct. */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {cardCorners.length >= 2 && (
                <polygon
                  points={cardCorners.map(c => `${c.x * 100},${c.y * 100}`).join(' ')}
                  fill="rgba(56,189,248,0.15)" stroke="#38bdf8" strokeWidth="0.4" />
              )}
            </svg>
            {cardCorners.map((c, i) => (
              <div key={i} className="absolute w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, background: 'var(--color-info)', border: '2px solid #fff' }} />
            ))}
          </div>
          <div className="p-4 flex items-center justify-between gap-3">
            <button
              onClick={() => { setCardCorners([]); setStatus(''); }}
              className="text-xs px-3 py-2 rounded-lg"
              style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}
            >
              {tr.cardReset || 'Reset corners'}
            </button>
            <p className="text-[11px] flex-1 text-right" style={{ color: 'var(--color-ink-ghost)' }}>
              {tr.cardTapHint || 'Tap in order: top-left → top-right → bottom-right → bottom-left.'}
            </p>
          </div>
        </div>
      )}

      {phase === 'done' && captured && (
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span>✅</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>{tr.measurementComplete}</span>
            {worldCalibrated && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                title="A prior card measurement calibrated this session's depth-scale correction — camera-only readings after that are more accurate."
                style={{ background: 'rgba(56,189,248,0.12)', color: 'var(--color-info)' }}>
                💳 card-calibrated
              </span>
            )}
          </div>
          <div className="space-y-2 mb-4">
            {GAP_LABELS.map(({ key, label, color }) => (
              <div key={key} className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ background: 'var(--color-surface-850)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--color-ink-subtle)' }}>{label}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color }}>
                  {captured[key].toFixed(1)} cm
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--color-ink-ghost)' }}>{tr.fineTune}</p>
          <div className="flex gap-2">
            <button
              onClick={() => onMeasured(captured)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}
            >
              {tr.applyMeasurements}
            </button>
            <button
              onClick={retry}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}
            >
              {tr.retake}
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="p-5 text-center">
          <p className="text-sm mb-3" style={{ color: 'var(--color-danger)' }}>⚠ {statusMsg}</p>
          <button
            onClick={retry}
            className="px-5 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}
          >
            {tr.tryAgain}
          </button>
        </div>
      )}
    </div>
  );
}

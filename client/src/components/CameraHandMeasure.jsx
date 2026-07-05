import { useRef, useState, useEffect, useCallback } from 'react';
import { useT } from '../lib/i18n';

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const MCP = { index: 5, pinky: 17 };
// Fallback palm width (cm, index-knuckle to pinky-knuckle) used only when
// metric world landmarks are unavailable. True adult average ≈ 8 cm.
const PALM_REF_CM = 8.0;

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

/**
 * Convert a single frame's landmarks to the 4 finger gaps in cm.
 *
 * Prefers MediaPipe's metric `multiHandWorldLandmarks` (real 3D in meters,
 * centered at the hand) — these give true centimeters with no palm-width
 * assumption and correct for hand tilt/foreshortening via the z-axis. When
 * world landmarks are missing, falls back to the old 2D path that scales by an
 * assumed palm width.
 *
 * @param {Array} lm     - normalized image landmarks (multiHandLandmarks)
 * @param {Array|null} world - metric world landmarks (multiHandWorldLandmarks)
 */
function landmarksToMeasurements(lm, world) {
  if (world && world.length >= 21) {
    const k = 100 * WORLD_SCALE_CORRECTION; // meters→cm, plus under-report correction
    return {
      thumbToIndex:  dist3D(world[TIP.thumb],  world[TIP.index])  * k,
      indexToMiddle: dist3D(world[TIP.index],  world[TIP.middle]) * k,
      middleToRing:  dist3D(world[TIP.middle], world[TIP.ring])   * k,
      ringToLittle:  dist3D(world[TIP.ring],   world[TIP.pinky])  * k,
    };
  }
  // Fallback: 2D image landmarks scaled by assumed palm width.
  const palmPx = dist(lm[MCP.index], lm[MCP.pinky]);
  if (palmPx < 1e-6) return null;
  const scale = PALM_REF_CM / palmPx;
  return {
    thumbToIndex:  dist(lm[TIP.thumb],  lm[TIP.index])  * scale,
    indexToMiddle: dist(lm[TIP.index],  lm[TIP.middle]) * scale,
    middleToRing:  dist(lm[TIP.middle], lm[TIP.ring])   * scale,
    ringToLittle:  dist(lm[TIP.ring],   lm[TIP.pinky])  * scale,
  };
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

  // Recording-window state (max-stretch over time)
  const recordingRef = useRef(false);        // true while buffering frames
  const buffersRef   = useRef({ thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] });
  // Card-calibration buffers: raw 2D gaps (normalized units) collected in parallel.
  const gaps2dBufferRef = useRef({ thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] });

  const [phase, setPhase]         = useState('idle');
  const [statusMsg, setStatus]    = useState('');
  const [countdown, setCountdown] = useState(null);
  const [captured, setCaptured]   = useState(null);
  const [handVisible, setHandVisible] = useState(false);
  const [frameFit, setFrameFit] = useState({ ok: false, reason: 'nohand' }); // hand-in-frame gate
  const frameFitRef = useRef(false);                                          // latest ok, for handlers
  const [rulerActive, setRulerActive] = useState(false); // true when cm ruler is scaled & drawn
  const [livePeaks, setLivePeaks] = useState(null); // { gapKey: cm } running p90 for live bars
  const pendingStreamRef = useRef(null); // stream waiting for video element to mount

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

          // Position gate: is the hand inside the target frame and well-sized?
          const fit = checkHandInFrame(lm);
          frameFitRef.current = fit.ok;
          setFrameFit(fit);
          drawFrame(ctx, W, H, fit.ok);

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
            const m = landmarksToMeasurements(lm, world);
            if (m) {
              const buf = buffersRef.current;
              for (const k of GAP_KEYS) buf[k].push(m[k]);
              // Live running p90 drives the on-screen max bars.
              setLivePeaks({
                thumbToIndex:  percentile(buf.thumbToIndex,  0.9),
                indexToMiddle: percentile(buf.indexToMiddle, 0.9),
                middleToRing:  percentile(buf.middleToRing,  0.9),
                ringToLittle:  percentile(buf.ringToLittle,  0.9),
              });
            }
            // In card mode, also buffer raw 2D gaps to be scaled by the card later.
            const g2 = landmarksToGaps2D(lm);
            const b2 = gaps2dBufferRef.current;
            for (const k of GAP_KEYS) b2[k].push(g2[k]);
          }
        } else {
          latestLm.current = null;
          latestWorld.current = null;
          setHandVisible(false);
          setRulerActive(false);
          frameFitRef.current = false;
          setFrameFit({ ok: false, reason: 'nohand' });
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

    setCaptured(clampMeasurements(peakOf(buf)));
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
    setFrozenFrame(null);
    setPhase('done');
  }, [tr]);

  // Start the timed recording window after the countdown.
  const startRecording = useCallback(() => {
    buffersRef.current = { thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] };
    gaps2dBufferRef.current = { thumbToIndex: [], indexToMiddle: [], middleToRing: [], ringToLittle: [] };
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

  const startCountdown = useCallback(() => {
    // Require the hand to be inside the target frame before approving a measure.
    if (!handVisible || !frameFitRef.current) return;
    setPhase('measuring');
    let n = 3;
    setCountdown(n);
    const id = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(id);
        setCountdown(null);
        startRecording();
      } else {
        setCountdown(n);
      }
    }, 1000);
  }, [handVisible, startRecording]);

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
        {(phase === 'ready' || phase === 'measuring' || phase === 'recording' || phase === 'card') && (
          <button
            onClick={() => { stop(); setPhase('idle'); setHandVisible(false); setLivePeaks(null); setFrozenFrame(null); setCardCorners([]); }}
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

      {(phase === 'ready' || phase === 'measuring' || phase === 'recording') && (
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
            {countdown !== null && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-8xl font-black"
                  style={{ color: 'var(--color-brand)', textShadow: '0 0 40px rgba(201,169,110,0.9)' }}>
                  {countdown}
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

          <div className="p-4 flex items-center justify-between gap-4">
            <p className="text-xs" style={{ color: (phase === 'ready' && handVisible && !frameFit.ok) ? 'var(--color-brand)' : 'var(--color-ink-faint)' }}>
              {phase === 'recording'
                ? (tr.keepStretching || 'Keep stretching — capturing your max…')
                : (phase === 'ready' && handVisible && !frameFit.ok)
                  ? (frameFit.reason === 'toosmall'
                      ? (tr.frameTooFar || 'Move your hand closer — fill the frame.')
                      : (tr.frameOutside || 'Fit your whole hand inside the frame.'))
                  : cardMode
                    ? (tr.cardHold || 'Hold a card flat against your hand, both in view, then tap Measure.')
                    : (frameFit.ok ? (tr.frameGood || 'Perfect — hold still and tap Measure.') : tr.splayFingers)}
            </p>
            <button
              onClick={startCountdown}
              disabled={!handVisible || !frameFit.ok || phase === 'measuring' || phase === 'recording'}
              className="px-5 py-2 rounded-xl text-sm font-semibold shrink-0 transition-all"
              style={handVisible && frameFit.ok && phase === 'ready'
                ? { background: 'var(--color-brand)', color: 'var(--color-surface-base)' }
                : { background: 'var(--color-surface-700)', color: 'var(--color-ink-ghost)', cursor: 'not-allowed' }}
            >
              {phase === 'measuring' || phase === 'recording' ? tr.capturing : tr.measure}
            </button>
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
          <div className="flex items-center gap-2 mb-4">
            <span>✅</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>{tr.measurementComplete}</span>
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

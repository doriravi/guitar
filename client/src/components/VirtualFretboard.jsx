// VirtualFretboard — the virtual-neck view.
//
// The physical neck is NOT detected. We render our own fretboard at a fixed
// place on screen and track only the hand, mapping fingertips onto that virtual
// grid. This removes every failure mode of physical detection (clutter winning
// the dominant axis, lighting moving the band, the board drifting as you play).
//
// What it honestly claims
// -----------------------
// A virtual board fixes CALIBRATION, not VISIBILITY. If the fretting hand curls
// around a real neck the fingertips are hidden and MediaPipe invents them, so:
//   - a VISIBLE fingertip  -> a solid glowing dot + a real note on the diagram
//   - an OCCLUDED fingertip-> a hollow dot + an amber 'weak' mark = "here-ish,
//                             unconfirmed". It never becomes a printed note.
// The hand's POSITION along the neck is anchored on the knuckle row, which stays
// visible either way, so that part of the readout is trustworthy.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useT } from '../lib/i18n';
import { useHandTrack } from '../lib/useHandTrack';
import {
  makeVirtualBoard,
  observeHand,
  handToDiagram,
  KNUCKLES,
} from '../lib/virtualFretboard';
import { FRETTING_TIPS } from '../lib/fretboardMap';
import FretboardDiagram from './FretboardDiagram';
import CameraPicker from './CameraPicker';

// The virtual board's fixed rectangle, in normalized frame coords. Also the
// Safe Zone the user places their hand into.
const DEFAULT_BOUNDS = { x: 0.12, y: 0.30, w: 0.76, h: 0.40 };
const BOARD = makeVirtualBoard({ spanFrets: 4 });
const STRINGS = 6;

const FINGER_COLOR = ['#f87171', '#fbbf24', '#34d399', '#60a5fa']; // 1..4

export default function VirtualFretboard({ lang }) {
  const tr = useT(lang);
  const [obs, setObs] = useState(null);
  // NOTE: `scale` is purely COSMETIC now. Since the mapping became hand-relative
  // (see virtualFretboard.handFrame), fingertip→cell accuracy is already
  // translation-, rotation- and scale-invariant — camera distance cancels out in
  // the math, so no calibration is needed to keep it correct. All this does is
  // size the DRAWN board to your hand so the picture looks right.
  const [scale, setScale] = useState(1);
  const [calibrating, setCalibrating] = useState(false);
  const calibSamplesRef = useRef([]);
  const obsRef = useRef(null);

  // The drawn rect, scaled about its own centre. Kept in a ref for the draw loop.
  const bounds = useCallback(() => {
    const b = DEFAULT_BOUNDS;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const w = b.w * scale, h = b.h * scale;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [scale]);
  const boundsRef = useRef(bounds());
  useEffect(() => { boundsRef.current = bounds(); }, [bounds]);

  // Per-frame: observe the hand. The mapping is HAND-RELATIVE — it reads the
  // fingertips in the hand's own frame, so moving the guitar or leaning back no
  // longer shifts the cells. `bounds` only says where we DRAW the board.
  const onFrame = useCallback((lm) => {
    const o = observeHand(lm, boundsRef.current, BOARD);
    obsRef.current = o;
    setObs(o);
  }, []);

  const cam = useHandTrack({ onFrame });
  const { videoRef, overlayRef, latestLandmarks } = cam;

  // ── "Fit to my hand" — sizes the DRAWN board only ──────────────────────────
  // We measure the KNUCKLE-ROW width, not the full hand bounding box: a bbox
  // conflates distance with POSE (a fist is a small bbox at the same distance as
  // a spread hand), so a bbox-driven box would resize every time you changed
  // chord shape. The knuckle row barely changes width as fingers curl.
  const knuckleSpan = (lm) => {
    if (!lm) return null;
    const pts = Object.values(KNUCKLES).map((i) => lm[i]).filter(Boolean);
    if (pts.length < 2) return null;
    let max = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        max = Math.max(max, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    return max;
  };

  const startCalibration = useCallback(() => {
    calibSamplesRef.current = [];
    setCalibrating(true);
  }, []);

  useEffect(() => {
    if (!calibrating) return undefined;
    const REFERENCE_SPAN = 0.14; // knuckle span (normalized) the default box suits
    const t = setInterval(() => {
      const s = knuckleSpan(latestLandmarks.current);
      if (s) calibSamplesRef.current.push(s);
    }, 100);
    const done = setTimeout(() => {
      clearInterval(t);
      const xs = calibSamplesRef.current;
      if (xs.length >= 5) {
        // Median: robust to the odd bad frame during the 2s window.
        const sorted = [...xs].sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        const next = med / REFERENCE_SPAN;
        setScale(Math.max(0.5, Math.min(2.5, next)));
      }
      setCalibrating(false);
    }, 2000);
    return () => { clearInterval(t); clearTimeout(done); };
  }, [calibrating, latestLandmarks]);

  // ── Draw loop: virtual board + fingertip dots ──────────────────────────────
  useEffect(() => {
    if (cam.phase !== 'live') return undefined;
    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = overlayRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const W = (canvas.width = video.videoWidth || 640);
      const H = (canvas.height = video.videoHeight || 480);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      const b = boundsRef.current;
      const bx = b.x * W, by = b.y * H, bw = b.w * W, bh = b.h * H;

      // The virtual neck.
      ctx.fillStyle = 'rgba(28,18,12,0.82)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = calibrating ? '#fbbf24' : '#38bdf8';
      ctx.lineWidth = calibrating ? 4 : 2;
      ctx.strokeRect(bx, by, bw, bh);

      // Fret wires: spaced by the SAME equal-temperament model as the rest of the
      // app, so the virtual neck is dimensionally a real guitar.
      ctx.lineWidth = 2;
      for (let f = 0; f <= BOARD.spanFrets; f++) {
        const u = f / BOARD.spanFrets;
        const x = bx + u * bw;
        ctx.strokeStyle = f === 0 ? '#f5f5f4' : 'rgba(203,213,225,0.75)';
        ctx.lineWidth = f === 0 ? 5 : 2;
        ctx.beginPath();
        ctx.moveTo(x, by);
        ctx.lineTo(x, by + bh);
        ctx.stroke();
      }
      // Strings.
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(226,232,240,0.65)';
      for (let s = 0; s < STRINGS; s++) {
        const y = by + (s / (STRINGS - 1)) * bh;
        ctx.beginPath();
        ctx.moveTo(bx, y);
        ctx.lineTo(bx + bw, y);
        ctx.stroke();
      }

      // Fingertips. Solid = seen; hollow = occluded (position is a guess).
      const o = obsRef.current;
      const lm = latestLandmarks.current;
      if (o?.present && lm) {
        for (const f of o.fingers) {
          const tip = lm[FRETTING_TIPS[f.name]];
          if (!tip) continue;
          const x = tip.x * W, y = tip.y * H;
          const color = FINGER_COLOR[f.finger - 1] || '#fff';
          if (f.visible) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(x, y, 9, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
          } else {
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(x, y, 9, 0, Math.PI * 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.setLineDash([]);
          }
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [cam.phase, calibrating, overlayRef, videoRef, latestLandmarks]);

  const { chord, marks } = handToDiagram(obs || { present: false });
  const occluded = (obs?.fingers || []).filter((f) => f.inside && !f.visible).length;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">🎸</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {tr.virtualTitle || 'Virtual Fretboard'}
          </span>
        </div>
        {cam.phase !== 'idle' && (
          <button onClick={cam.close} className="text-xs px-3 py-1 rounded-lg"
            style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
            {tr.cancel || 'Close'}
          </button>
        )}
      </div>

      {cam.phase === 'idle' && (
        <div className="p-6">
          <p className="text-sm mb-3 text-center" style={{ color: 'var(--color-ink-muted)' }}>
            {tr.virtualIntro ||
              'No neck detection — we draw the fretboard for you. The grid follows your hand, so moving the guitar or leaning back won’t throw it off.'}
          </p>
          <div className="text-center mb-4">
            {!cam.primed ? (
              <button onClick={cam.prime} className="text-xs px-4 py-2 rounded-lg"
                style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
                📷 {tr.chooseCamera || 'Choose camera'}
              </button>
            ) : cam.cameras.length >= 2 ? <CameraPicker cam={cam} lang={lang} /> : null}
          </div>
          <div className="text-center">
            <button onClick={cam.start} className="px-5 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
              {tr.virtualStart || 'Open camera'}
            </button>
          </div>
        </div>
      )}

      {cam.phase === 'loading' && (
        <div className="p-8 text-center text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {tr.loadingModel || 'Loading…'}
        </div>
      )}

      {cam.phase === 'error' && (
        <div className="p-6 text-center">
          <p className="text-sm mb-3" style={{ color: 'var(--color-danger, #ef4444)' }}>{cam.status}</p>
          <button onClick={cam.start} className="px-4 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}>
            {tr.retry || 'Try again'}
          </button>
        </div>
      )}

      {cam.phase === 'live' && (
        <div>
          <div className="relative">
            {/* Camera is context only — dimmed so the virtual board reads clearly. */}
            <video ref={videoRef} playsInline muted className="w-full block" style={{ opacity: 0.45 }} />
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                {calibrating
                  ? (tr.virtualCalibrating || 'Hold your hand in the box…')
                  : cam.handVisible
                    ? (tr.virtualTracking || 'Tracking your hand')
                    : (tr.virtualNoHand || 'Put your fretting hand in the box')}
              </div>
              <div className="flex gap-2">
                <button onClick={startCalibration} disabled={calibrating}
                  title={tr.virtualCalibrateTip || 'Resizes the drawn board to your hand. Tracking accuracy needs no calibration — it follows your hand automatically.'}
                  className="text-xs px-3 py-2 rounded-lg font-semibold"
                  style={calibrating
                    ? { background: 'var(--color-surface-650)', color: 'var(--color-ink-faint)' }
                    : { color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                  {calibrating ? (tr.virtualCalibrating2 || 'Hold…') : (tr.virtualCalibrate || '⤢ Resize board')}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-4 flex-wrap">
              <FretboardDiagram chord={chord} marks={marks} />
              <div className="text-xs space-y-1" style={{ color: 'var(--color-ink-muted)' }}>
                {obs?.present && obs.anchorFret != null && (
                  <div>
                    {tr.virtualHandAt || 'Hand around fret'}{' '}
                    <span style={{ color: 'var(--color-ink)', fontWeight: 600 }}>{obs.anchorFret}</span>
                  </div>
                )}
                {obs?.present && (
                  <div>
                    {tr.virtualSeen || 'Fingers seen'}:{' '}
                    <span style={{ color: 'var(--color-ink)', fontWeight: 600 }}>
                      {Math.round((obs.confidence || 0) * 100)}%
                    </span>
                  </div>
                )}
                {occluded > 0 && (
                  <div style={{ color: '#f59e0b' }}>
                    {tr.virtualOccluded ||
                      `${occluded} finger(s) hidden — shown dashed/amber, not counted as notes.`}
                  </div>
                )}
              </div>
            </div>

            <CameraPicker cam={cam} lang={lang} />
          </div>
        </div>
      )}
    </div>
  );
}

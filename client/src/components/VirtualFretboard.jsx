// VirtualFretboard — the virtual-neck view.
//
// The physical neck is NOT detected. We render our own fretboard and track only
// the hand, mapping fingertips onto that virtual grid. This removes every failure
// mode of physical detection (clutter winning the dominant axis, lighting moving
// the band, the board drifting as you play).
//
// The board is drawn PINNED TO THE HAND (boardTransform): it sits at the fretting
// fingers, tilts with the hand's axis, and scales with camera distance. Note the
// tilt is the HAND's, not the guitar neck's — we can't see the neck. Rotate your
// wrist and the drawn board follows your wrist, not your guitar. It's a drawing
// aid; it is not a claim about where the neck is.
//
// Drawing is deliberately separate from mapping. observeHand() already works in
// the hand's own frame, so the reported cells are translation/rotation/scale
// invariant and CANNOT be changed by where the box is drawn (there's a test that
// pins exactly that). Moving the board is cosmetics; it never moves the answer.
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
//
// Because visibility is the real blocker, cameraAngleAdvice() surfaces it up
// front: a face-on webcam view scores ~0% visible tips and says so, rather than
// letting a nicely-aligned board imply a reading that isn't there.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useT } from '../lib/i18n';
import { useHandTrack } from '../lib/useHandTrack';
import {
  makeVirtualBoard,
  observeHand,
  handToDiagram,
  boardTransform,
  cameraAngleAdvice,
} from '../lib/virtualFretboard';
import { FRETTING_TIPS } from '../lib/fretboardMap';
import FretboardDiagram from './FretboardDiagram';
import CameraPicker from './CameraPicker';

// Fallback rect (normalized frame coords) for when no hand is visible — with a
// hand, the board is drawn from boardTransform() instead, pinned to the hand.
const DEFAULT_BOUNDS = { x: 0.12, y: 0.30, w: 0.76, h: 0.40 };
const BOARD = makeVirtualBoard({ spanFrets: 4 });
const STRINGS = 6;

const FINGER_COLOR = ['#f87171', '#fbbf24', '#34d399', '#60a5fa']; // 1..4

export default function VirtualFretboard({ lang }) {
  const tr = useT(lang);
  const [obs, setObs] = useState(null);
  // A manual size trim for the DRAWN board, nothing more.
  //
  // There used to be a 2-second "fit to my hand" measurement here. It's gone:
  // boardTransform now sizes the board from the hand's own wrist→pinky ruler on
  // every frame, so the board already tracks hand size continuously — measuring a
  // one-off multiplier would have been re-deriving what the transform does live,
  // and then multiplying it in on top. Accuracy never needed it either: the
  // mapping is scale-invariant (see virtualFretboard.handFrame), so this only
  // changes the picture, never the reading.
  const [scale, setScale] = useState(1);
  const obsRef = useRef(null);

  // Fallback rect for the no-hand case. Kept in a ref for the draw loop.
  const boundsRef = useRef(DEFAULT_BOUNDS);
  // The draw loop reads `scale` every frame; keep it in a ref so the rAF closure
  // never goes stale against it.
  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

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

      // The board is pinned to the hand: it sits at the fretting fingers, tilts
      // with the hand's axis, and scales with camera distance. When there's no
      // hand we fall back to the default rect so the screen isn't blank.
      const lmNow = latestLandmarks.current;
      const t = lmNow ? boardTransform(lmNow, { scale: scaleRef.current }) : null;
      const b = boundsRef.current;
      const drawn = t
        ? { cx: t.cx * W, cy: t.cy * H, w: t.w * W, h: t.h * H, angle: t.angle }
        : {
            cx: (b.x + b.w / 2) * W, cy: (b.y + b.h / 2) * H,
            w: b.w * W, h: b.h * H, angle: 0,
          };

      ctx.save();
      ctx.translate(drawn.cx, drawn.cy);
      ctx.rotate(drawn.angle);
      // From here the board is axis-aligned in a rotated frame, centred on origin.
      const bx = -drawn.w / 2, by = -drawn.h / 2, bw = drawn.w, bh = drawn.h;

      // The virtual neck.
      ctx.fillStyle = 'rgba(28,18,12,0.82)';
      ctx.fillRect(bx, by, bw, bh);
      // Solid cyan when pinned to a hand; faded when it's the no-hand fallback.
      ctx.strokeStyle = t ? '#38bdf8' : 'rgba(56,189,248,0.4)';
      ctx.lineWidth = 2;
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
      ctx.restore();

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
  }, [cam.phase, overlayRef, videoRef, latestLandmarks]);

  const { chord, marks } = handToDiagram(obs || { present: false });
  const occluded = (obs?.fingers || []).filter((f) => f.inside && !f.visible).length;
  const angle = cameraAngleAdvice(obs || { present: false });
  const ANGLE_STYLE = {
    good:    { bg: 'rgba(16,185,129,0.12)', fg: '#34d399', border: 'rgba(52,211,153,0.35)', icon: '✅' },
    partial: { bg: 'rgba(245,158,11,0.12)', fg: '#fbbf24', border: 'rgba(251,191,36,0.35)', icon: '⚠️' },
    blind:   { bg: 'rgba(239,68,68,0.12)',  fg: '#f87171', border: 'rgba(248,113,113,0.35)', icon: '🚫' },
    nohand:  { bg: 'var(--color-surface-700)', fg: 'var(--color-ink-faint)', border: 'var(--color-surface-550)', icon: '👋' },
  }[angle.level];

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
            {/* Camera-angle guide — the actual blocker. A virtual board fixes
                calibration, not visibility: at a face-on angle the fretting tips
                are hidden behind the neck and every reading is invented. This
                keys off the measured visible-tip share, so it's a fact, not a
                nag. */}
            <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg"
              style={{ background: ANGLE_STYLE.bg, border: `1px solid ${ANGLE_STYLE.border}` }}>
              <span className="text-sm leading-none mt-0.5">{ANGLE_STYLE.icon}</span>
              <div className="flex-1">
                <div className="text-xs font-semibold mb-0.5" style={{ color: ANGLE_STYLE.fg }}>
                  {angle.level === 'good'
                    ? (tr.angleGood || 'Good angle')
                    : angle.level === 'partial'
                      ? (tr.anglePartial || 'Fingertips partly hidden')
                      : angle.level === 'blind'
                        ? (tr.angleBlind || 'Camera can’t see your fingertips')
                        : (tr.angleNoHand || 'Waiting for your hand')}
                  {obs?.present && (
                    <span style={{ color: 'var(--color-ink-faint)', fontWeight: 400 }}>
                      {' '}· {Math.round(angle.visible * 100)}% {tr.angleVisible || 'visible'}
                    </span>
                  )}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
                  {angle.advice}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                {cam.handVisible
                  ? (tr.virtualTracking || 'Board is following your hand')
                  : (tr.virtualNoHand || 'Bring your fretting hand into view')}
              </div>
              {/* Size trim only — the board already scales itself to your hand. */}
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-ink-faint)' }}
                title={tr.virtualSizeTip || 'Cosmetic size trim. The board already follows and scales to your hand; this never changes the reading.'}>
                <span>⤢ {tr.virtualSize || 'Size'}</span>
                <input type="range" min="0.6" max="1.8" step="0.05" value={scale}
                  onChange={(e) => setScale(parseFloat(e.target.value))}
                  style={{ width: '5rem' }} />
              </label>
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

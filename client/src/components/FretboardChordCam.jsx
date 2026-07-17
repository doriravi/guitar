// FretboardChordCam — live "what chord am I holding?" camera.
//
// The camera pipeline (MediaPipe Hands, calibration, (string,fret) mapping,
// chord detection) lives in the shared `useFretboardCam` hook so this tab and
// the Verified Practice view run ONE implementation. This component is just the
// Chord Cam UI around that hook.
//
// Detection is honest: if the finger→cell mapping doesn't form a supported
// major/minor/dom7 chord, we show "—" rather than inventing a name.

import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { useFretboardCam } from '../lib/useFretboardCam';
import { FRETTING_TIPS } from '../lib/fretboardMap';
import ChordTip from './ChordTip';
import CameraPicker from './CameraPicker';

// Labels for the four draggable corners, in fretboardMap's corner order.
const CORNER_LABELS = ['low-E · nut', 'high-e · nut', 'high-e · end', 'low-E · end'];

export default function FretboardChordCam({ lang }) {
  const tr = useT(lang);
  const cam = useFretboardCam();
  const { videoRef, overlayRef, latestLandmarks } = cam;

  // Manual fine-tune: when on, the overlay shows draggable corner handles so the
  // user can align the board quad exactly onto the strings/frets.
  const [tuning, setTuning] = useState(false);
  const dragRef = useRef(null); // index of the corner being dragged, or null

  // Draw the calibrated board quad + fretting fingertips over the video.
  useEffect(() => {
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

      // While calibrating, draw the auto-detected neck box (amber = tentative,
      // green = confident/locking). Once live, draw the committed board in blue.
      const quad = cam.phase === 'live' ? cam.corners : cam.detectedCorners;
      if (quad && quad.length === 4) {
        ctx.strokeStyle = cam.phase === 'live'
          ? '#38bdf8'
          : (cam.detectConfidence >= 0.15 ? '#34d399' : '#f59e0b');
        ctx.lineWidth = 3;
        ctx.beginPath();
        quad.forEach((c, i) => {
          const x = c.x * W, y = c.y * H;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();
      }
      const lm = latestLandmarks.current;
      if (lm) {
        for (const idx of Object.values(FRETTING_TIPS)) {
          const t = lm[idx];
          if (!t) continue;
          ctx.beginPath();
          ctx.arc(t.x * W, t.y * H, 7, 0, Math.PI * 2);
          ctx.fillStyle = '#34d399';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        }
      }

      // Fine-tune handles: big draggable dots on each corner, with labels, so the
      // user can align the board precisely on the strings/frets.
      if (tuning && cam.phase === 'live' && cam.corners?.length === 4) {
        cam.corners.forEach((c, i) => {
          const x = c.x * W, y = c.y * H;
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.fillStyle = dragRef.current === i ? '#fbbf24' : '#f59e0b';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 16px system-ui, sans-serif';
          ctx.fillText(String(i + 1), x - 5, y + 6);
        });
      }
    };
    if (cam.phase === 'calibrate' || cam.phase === 'live') raf = requestAnimationFrame(draw);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [cam.phase, cam.corners, cam.detectedCorners, cam.detectConfidence, overlayRef, videoRef, latestLandmarks, tuning]);

  // Pointer → normalized (x,y) within the displayed video, accounting for the
  // canvas being CSS-scaled to fit its container.
  const pointerToNorm = (e) => {
    const canvas = overlayRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const onPointerDown = (e) => {
    if (!tuning || cam.phase !== 'live' || cam.corners?.length !== 4) return;
    const p = pointerToNorm(e);
    if (!p) return;
    // Pick the nearest corner within a grab radius (~8% of frame).
    let best = -1, bestD = 0.08;
    cam.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) {
      dragRef.current = best;
      e.target.setPointerCapture?.(e.pointerId);
      cam.adjustCorner(best, p);
    }
  };
  const onPointerMove = (e) => {
    if (dragRef.current === null) return;
    const p = pointerToNorm(e);
    if (p) cam.adjustCorner(dragRef.current, p);
  };
  const onPointerUp = (e) => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    e.target.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">📸</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {tr.chordCamTitle || 'Chord Camera'}
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
            {tr.chordCamIntro ||
              'Mount your camera ABOVE the neck looking straight down, so it can see your fingertips on the strings. Then hold any chord — the app names what you’re playing.'}
          </p>
          <ol className="text-sm space-y-2 mb-4 mx-auto" style={{ color: 'var(--color-ink-muted)', maxWidth: '24rem' }}>
            {[
              tr.chordCamStep1 || 'Position the camera directly above the fretboard, lens pointing straight down — a phone on a stand, or propped so it looks down at the neck.',
              tr.chordCamStep2 || 'Get the neck to fill the frame against a plain background, then hold steady — the app finds the fretboard (or tap “Fine-tune” to place it exactly).',
              tr.chordCamStep3 || 'Hold a chord and keep your hand still — the chord name appears.',
            ].map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs mb-4 text-center" style={{ color: 'var(--color-ink-faint)' }}>
            {tr.chordCamScope || 'Recognizes major, minor, and dominant-7th shapes.'}
          </p>

          {/* Camera chooser — let the user pick a webcam BEFORE opening. Browsers
              hide camera names until access is granted once, so we offer a
              "Choose camera" primer; after that the named picker shows here. */}
          <div className="text-center mb-4">
            {!cam.primed ? (
              <button onClick={cam.prime}
                className="text-xs px-4 py-2 rounded-lg"
                style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
                📷 {tr.chooseCamera || 'Choose camera'}
              </button>
            ) : cam.cameras.length >= 2 ? (
              <CameraPicker cam={cam} lang={lang} />
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                {tr.oneCameraFound || 'One camera found — it will be used.'}
              </p>
            )}
          </div>

          <div className="text-center">
            <button onClick={cam.start}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
              {tr.chordCamStart || 'Open camera'}
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

      {(cam.phase === 'calibrate' || cam.phase === 'live') && (
        <div>
          <div className="relative">
            {/* Rear camera → no mirror (unlike the selfie hand-measure view). */}
            <video ref={videoRef} playsInline muted className="w-full block" />
            <canvas
              ref={overlayRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={`absolute inset-0 w-full h-full ${tuning && cam.phase === 'live' ? 'cursor-grab' : 'pointer-events-none'}`}
              style={tuning && cam.phase === 'live' ? { touchAction: 'none' } : undefined}
            />
          </div>

          {cam.phase === 'calibrate' && (
            <div className="p-4 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-ink)' }}>
                {cam.detectStatus === 'notfound'
                  ? (tr.neckNotFound || 'Can’t find the neck')
                  : (tr.neckFinding || 'Finding your fretboard…')}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                {tr.neckAngleHint ||
                  'Mount the camera above the neck looking straight down, neck filling the frame against a plain background. If it can’t lock on, tap “Set neck manually”.'}
              </p>
              {cam.detectStatus === 'notfound' && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button onClick={() => { cam.startManualAdjust(); setTuning(true); }}
                    className="text-xs px-4 py-2 rounded-lg font-semibold"
                    style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
                    {tr.chordCamSetManually || 'Set neck manually'}
                  </button>
                  <button onClick={cam.retryDetect} className="text-xs px-4 py-2 rounded-lg"
                    style={{ color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)' }}>
                    {tr.retry || 'Retry auto'}
                  </button>
                </div>
              )}
              {cam.detectDebug && (
                <p className="text-[10px] mt-2 font-mono" style={{ color: 'var(--color-ink-faint)' }}>
                  sharp {(cam.detectDebug.sharpness ?? 0).toFixed(1)} · band {(cam.detectDebug.bandFrac ?? 0).toFixed(2)} · ratio {(cam.detectDebug.aspect ?? 0).toFixed(1)} · tex {(cam.detectDebug.textureRatio ?? 0).toFixed(2)} · conf {(cam.detectDebug.confidence ?? 0).toFixed(2)} · {cam.detectDebug.reason || '—'}
                </p>
              )}
              <CameraPicker cam={cam} lang={lang} />
            </div>
          )}

          {cam.phase === 'live' && (
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: 'var(--color-ink-faint)' }}>
                    {cam.handVisible ? (tr.chordCamDetected || 'Detected chord') : (tr.chordCamShowHand || 'Show your hand on the neck')}
                  </div>
                  {cam.chord ? (
                    <ChordTip name={cam.chord}>
                      <span className="text-3xl font-bold cursor-help" style={{ color: 'var(--color-ink)' }}>{cam.chord}</span>
                    </ChordTip>
                  ) : (
                    <span className="text-3xl font-bold" style={{ color: 'var(--color-ink-faint)' }}>—</span>
                  )}
                </div>
                <div className="flex flex-col gap-2 self-start">
                  <button
                    onClick={() => setTuning((t) => !t)}
                    className="text-xs px-3 py-2 rounded-lg font-semibold"
                    style={tuning
                      ? { background: 'var(--color-brand)', color: '#0b0b0b' }
                      : { color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                    {tuning ? (tr.chordCamTuneDone || 'Done adjusting') : (tr.chordCamTune || '✥ Fine-tune')}
                  </button>
                  <button onClick={cam.recalibrate} className="text-xs px-3 py-2 rounded-lg"
                    style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                    {tr.chordCamRecalibrate || 'Recalibrate'}
                  </button>
                </div>
              </div>
              {tuning && (
                <p className="text-xs mt-2" style={{ color: 'var(--color-brand)' }}>
                  {tr.chordCamTuneHint ||
                    'Drag each dot onto a STRING (not the wood edge): ① low-E at the nut, ② high-e at the nut, ③ high-e at the 5th fret, ④ low-E at the 5th fret. The frets update live.'}
                </p>
              )}
              {!cam.handVisible && (
                <p className="text-xs mt-2" style={{ color: 'var(--color-ink-faint)' }}>
                  {tr.chordCamNoHandHint ||
                    'No hand detected. Make sure your fretting hand is fully in frame and well lit. On a laptop, aim the camera down at the neck — or switch cameras below.'}
                </p>
              )}
              <CameraPicker cam={cam} lang={lang} />
              {cam.positions.length > 0 && (
                <div className="text-xs mt-3" style={{ color: 'var(--color-ink-faint)' }}>
                  {tr.chordCamFingers || 'Fingers'}:{' '}
                  {cam.positions.map((p, i) => (
                    <span key={i} className="inline-block mr-2">
                      {['E', 'A', 'D', 'G', 'B', 'e'][p.string]}·{p.fret}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

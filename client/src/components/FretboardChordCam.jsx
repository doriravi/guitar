// FretboardChordCam — live "what chord am I holding?" camera.
//
// The camera pipeline (MediaPipe Hands, calibration, (string,fret) mapping,
// chord detection) lives in the shared `useFretboardCam` hook so this tab and
// the Verified Practice view run ONE implementation. This component is just the
// Chord Cam UI around that hook.
//
// Detection is honest: if the finger→cell mapping doesn't form a supported
// major/minor/dom7 chord, we show "—" rather than inventing a name.

import { useEffect } from 'react';
import { useT } from '../lib/i18n';
import { useFretboardCam } from '../lib/useFretboardCam';
import { FRETTING_TIPS } from '../lib/fretboardMap';
import ChordTip from './ChordTip';
import CameraPicker from './CameraPicker';

const CORNER_LABELS = [
  'nut · low-E (thick) corner',
  'nut · high-e (thin) corner',
  '5th fret · high-e (thin) corner',
  '5th fret · low-E (thick) corner',
];

export default function FretboardChordCam({ lang }) {
  const tr = useT(lang);
  const cam = useFretboardCam();
  const { videoRef, overlayRef, latestLandmarks } = cam;

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

      if (cam.corners.length) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        cam.corners.forEach((c, i) => {
          const x = c.x * W, y = c.y * H;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        if (cam.corners.length === 4) ctx.closePath();
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
    };
    if (cam.phase === 'calibrate' || cam.phase === 'live') raf = requestAnimationFrame(draw);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [cam.phase, cam.corners, overlayRef, videoRef, latestLandmarks]);

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
              'Point your camera at the fretboard, mark its corners once, then hold any chord — the app names what you’re playing.'}
          </p>
          <ol className="text-sm space-y-2 mb-4 mx-auto" style={{ color: 'var(--color-ink-muted)', maxWidth: '22rem' }}>
            {[
              tr.chordCamStep1 || 'Prop your phone so the whole fretboard is clearly in view, well lit.',
              tr.chordCamStep2 || 'Tap the four corners of the neck when asked — this maps the strings and frets.',
              tr.chordCamStep3 || 'Hold any chord shape and keep your hand still — the chord name appears.',
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
          <div className="relative" onClick={cam.tapCorner}
            style={{ cursor: cam.phase === 'calibrate' ? 'crosshair' : 'default' }}>
            {/* Rear camera → no mirror (unlike the selfie hand-measure view). */}
            <video ref={videoRef} playsInline muted className="w-full block" />
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />

            {cam.phase === 'calibrate' && cam.corners.map((c, i) => (
              <div key={i}
                className="absolute w-3.5 h-3.5 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, background: 'var(--color-info, #38bdf8)', border: '2px solid #fff' }} />
            ))}
          </div>

          {cam.phase === 'calibrate' && (
            <div className="p-4 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-ink)' }}>
                {tr.chordCamTapPrompt || 'Tap the fretboard corners'}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-brand)' }}>
                {cam.corners.length < 4
                  ? `${cam.corners.length + 1}/4 — ${CORNER_LABELS[cam.corners.length]}`
                  : 'Locking board…'}
              </p>
              {cam.status && <p className="text-xs mt-2" style={{ color: 'var(--color-danger, #ef4444)' }}>{cam.status}</p>}
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
                <button onClick={cam.recalibrate} className="text-xs px-3 py-2 rounded-lg self-start"
                  style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                  {tr.chordCamRecalibrate || 'Recalibrate'}
                </button>
              </div>
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

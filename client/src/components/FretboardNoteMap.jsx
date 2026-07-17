// FretboardNoteMap — a live "learn the neck" screen.
//
// TWO parts, stacked:
//   1. A live CAMERA view of your hand on the neck (shared useFretboardCam
//      pipeline: auto-detect the neck, or fine-tune the 4 corners by hand).
//   2. An always-on FULL NOTE MAP: every note on the fretboard (6 strings ×
//      frets 0–12), each cell labeled with its note name. This grid is pure
//      data — it is ALWAYS correct regardless of the camera — so the screen is
//      useful even before (or without) calibrating the camera.
//
// When the neck IS calibrated and a hand is visible, the cells your fingertips
// sit on light up on the grid, so you can see the note names of what you're
// pressing. That highlight depends on the camera mapping (which is approximate),
// but the note map itself never does.

import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { useFretboardCam } from '../lib/useFretboardCam';
import { FRETTING_TIPS, boardToImage, fretCenterU } from '../lib/fretboardMap';
import { OPEN_STRING_MIDI, NOTE_NAMES } from '../lib/chordAnalyzer';
import CameraPicker from './CameraPicker';

const FRETS = 12;                                   // show the first 12 frets
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']; // 0=low E … 5=high e
// Accidental note classes get a subtle tint so naturals stand out.
const IS_SHARP = (pc) => NOTE_NAMES[pc].includes('#');

// Note name at (string, fret).
function noteAt(string, fret) {
  const pc = (OPEN_STRING_MIDI[string] + fret) % 12;
  return NOTE_NAMES[pc];
}

export default function FretboardNoteMap({ lang }) {
  const tr = useT(lang);
  // Calibrate the WHOLE first octave: the box spans nut → 12th fret, so the note
  // map covers a full octave (notes repeat at fret 12) instead of just 5 frets.
  const cam = useFretboardCam({ spanFrets: 12 });
  const { videoRef, overlayRef, latestLandmarks } = cam;

  const [tuning, setTuning] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const dragRef = useRef(null);

  // Which (string,fret) cells are the fingertips currently on — for the grid
  // highlight. Comes from the camera mapping (cam.positions).
  const pressed = new Set((cam.positions || []).map((p) => `${p.string}:${p.fret}`));

  // ── Overlay: board quad + fingertips + (in tuning mode) drag handles ─────────
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

      // Show ALL notes: project every (string, fret) cell onto the live board and
      // draw its note name where it really sits. Needs a calibrated quad.
      if (showAllNotes && cam.phase === 'live' && cam.corners?.length === 4) {
        const span = cam.spanFrets || 5;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 13px system-ui, sans-serif';
        for (let s = 0; s < 6; s++) {
          const v = s / 5; // low-E (0) .. high-e (1)
          for (let f = 0; f <= span; f++) {
            const u = fretCenterU(f, span);
            const img = boardToImage(cam.corners, u, v);
            if (!img) continue;
            const x = img.x * W, y = img.y * H;
            const pc = (OPEN_STRING_MIDI[s] + f) % 12;
            const name = NOTE_NAMES[pc];
            // pill background so labels read over any fretboard colour
            const wpx = ctx.measureText(name).width + 8;
            ctx.fillStyle = 'rgba(15,15,15,0.72)';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x - wpx / 2, y - 9, wpx, 18, 5);
            else ctx.rect(x - wpx / 2, y - 9, wpx, 18); // older WebView fallback
            ctx.fill();
            ctx.fillStyle = IS_SHARP(pc) ? '#fbbf24' : '#e5faff';
            ctx.fillText(name, x, y + 1);
          }
        }
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
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
          ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      }

      if (tuning && cam.phase === 'live' && cam.corners?.length === 4) {
        cam.corners.forEach((c, i) => {
          const x = c.x * W, y = c.y * H;
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.fillStyle = dragRef.current === i ? '#fbbf24' : '#f59e0b';
          ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 16px system-ui, sans-serif';
          ctx.fillText(String(i + 1), x - 5, y + 6);
        });
      }
    };
    if (cam.phase === 'calibrate' || cam.phase === 'live') raf = requestAnimationFrame(draw);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [cam.phase, cam.corners, cam.detectedCorners, cam.detectConfidence, cam.spanFrets, overlayRef, videoRef, latestLandmarks, tuning, showAllNotes]);

  const pointerToNorm = (e) => {
    const canvas = overlayRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const onPointerDown = (e) => {
    if (!tuning || cam.phase !== 'live' || cam.corners?.length !== 4) return;
    const p = pointerToNorm(e); if (!p) return;
    let best = -1, bestD = 0.08;
    cam.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) { dragRef.current = best; e.target.setPointerCapture?.(e.pointerId); cam.adjustCorner(best, p); }
  };
  const onPointerMove = (e) => {
    if (dragRef.current === null) return;
    const p = pointerToNorm(e); if (p) cam.adjustCorner(dragRef.current, p);
  };
  const onPointerUp = (e) => {
    if (dragRef.current === null) return;
    dragRef.current = null; e.target.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">🎼</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {tr.noteMapTitle || 'Fretboard Note Map'}
          </span>
        </div>
        {cam.phase !== 'idle' && (
          <button onClick={cam.close} className="text-xs px-3 py-1 rounded-lg"
            style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
            {tr.cancel || 'Close'}
          </button>
        )}
      </div>

      {/* Camera section — optional. The note map below always shows. */}
      {cam.phase === 'idle' && (
        <div className="px-4 pt-4">
          <p className="text-sm mb-3 text-center" style={{ color: 'var(--color-ink-muted)' }}>
            {tr.noteMapIntro ||
              'Every note from the nut to the 12th fret is mapped below. Open the camera, frame the neck from the nut to the 12th fret, and it lights up the notes you press.'}
          </p>
          <div className="text-center mb-4">
            {!cam.primed ? (
              <button onClick={cam.prime} className="text-xs px-4 py-2 rounded-lg"
                style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
                📷 {tr.chooseCamera || 'Choose camera'}
              </button>
            ) : cam.cameras.length >= 2 ? (
              <CameraPicker cam={cam} lang={lang} />
            ) : null}
          </div>
          <div className="text-center mb-4">
            <button onClick={cam.start} className="px-5 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
              {tr.noteMapOpenCam || 'Open camera'}
            </button>
          </div>
        </div>
      )}

      {cam.phase === 'loading' && (
        <div className="p-6 text-center text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {tr.loadingModel || 'Loading…'}
        </div>
      )}

      {cam.phase === 'error' && (
        <div className="p-4 text-center">
          <p className="text-sm mb-2" style={{ color: 'var(--color-danger, #ef4444)' }}>{cam.status}</p>
          <button onClick={cam.start} className="text-xs px-4 py-2 rounded-lg"
            style={{ border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}>
            {tr.retry || 'Try again'}
          </button>
        </div>
      )}

      {(cam.phase === 'calibrate' || cam.phase === 'live') && (
        <div>
          <div className="relative">
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
            <div className="p-3 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-ink)' }}>
                {cam.detectStatus === 'notfound'
                  ? (tr.neckNotFound || 'Can’t find the neck')
                  : (tr.neckFinding || 'Finding your fretboard…')}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                {tr.neckAngleHint ||
                  'Mount the camera above the neck looking straight down, neck filling the frame.'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-ink-faint)' }}>
                {tr.noteMapSpanHint ||
                  'Frame the neck from the nut to the 12th fret (the double-dot / octave marker).'}
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
              <CameraPicker cam={cam} lang={lang} />
            </div>
          )}

          {cam.phase === 'live' && (
            <div className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                {cam.handVisible
                  ? (tr.noteMapPressing || 'Notes you’re pressing are highlighted below')
                  : (tr.chordCamShowHand || 'Show your hand on the neck')}
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <button onClick={() => setShowAllNotes((v) => !v)}
                  className="text-xs px-3 py-2 rounded-lg font-semibold"
                  style={showAllNotes
                    ? { background: 'var(--color-brand)', color: '#0b0b0b' }
                    : { color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                  {showAllNotes ? (tr.noteMapHideAll || 'Hide notes') : (tr.noteMapShowAll || '🎵 Show all notes')}
                </button>
                <button onClick={() => setTuning((t) => !t)}
                  className="text-xs px-3 py-2 rounded-lg font-semibold"
                  style={tuning
                    ? { background: 'var(--color-brand)', color: '#0b0b0b' }
                    : { color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                  {tuning ? (tr.chordCamTuneDone || 'Done') : (tr.chordCamTune || '✥ Fine-tune')}
                </button>
                <button onClick={cam.recalibrate} className="text-xs px-3 py-2 rounded-lg"
                  style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                  {tr.chordCamRecalibrate || 'Recalibrate'}
                </button>
              </div>
            </div>
          )}
          {tuning && cam.phase === 'live' && (
            <p className="px-4 pb-2 text-xs" style={{ color: 'var(--color-brand)' }}>
              {tr.noteMapTuneHint ||
                'Drag each dot onto a STRING (not the wood edge): ① low-E at the nut, ② high-e at the nut, ③ high-e at the 12th fret, ④ low-E at the 12th fret.'}
            </p>
          )}
        </div>
      )}

      {/* ── The always-on FULL NOTE MAP ─────────────────────────────────────── */}
      <div className="p-4 overflow-x-auto">
        <div style={{ minWidth: '34rem' }}>
          {/* Fret-number header */}
          <div className="flex items-center mb-1">
            <div style={{ width: '2rem' }} />
            {Array.from({ length: FRETS + 1 }, (_, f) => (
              <div key={f} className="flex-1 text-center text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                {f}
              </div>
            ))}
          </div>
          {/* Strings high-e (5) at top → low-E (0) at bottom, like a real tab view */}
          {[5, 4, 3, 2, 1, 0].map((s) => (
            <div key={s} className="flex items-center mb-1">
              <div className="text-xs font-bold text-center" style={{ width: '2rem', color: 'var(--color-ink-muted)' }}>
                {STRING_LABELS[s]}
              </div>
              {Array.from({ length: FRETS + 1 }, (_, f) => {
                const name = noteAt(s, f);
                const pc = (OPEN_STRING_MIDI[s] + f) % 12;
                const on = pressed.has(`${s}:${f}`);
                const open = f === 0;
                return (
                  <div key={f} className="flex-1 px-0.5">
                    <div
                      className="text-center rounded text-[11px] font-semibold py-1"
                      style={{
                        background: on
                          ? 'var(--color-brand)'
                          : open
                            ? 'var(--color-surface-650)'
                            : IS_SHARP(pc) ? 'var(--color-surface-800)' : 'var(--color-surface-700)',
                        color: on ? '#0b0b0b' : IS_SHARP(pc) ? 'var(--color-ink-faint)' : 'var(--color-ink)',
                        border: on ? '1px solid var(--color-brand)' : '1px solid var(--color-surface-650)',
                      }}
                    >
                      {name}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-[11px] mt-3" style={{ color: 'var(--color-ink-faint)' }}>
          {tr.noteMapLegend ||
            'Fret 0 = open string. Naturals are bright, sharps/flats dimmed. Highlighted = notes the camera sees you pressing.'}
        </p>
      </div>
    </div>
  );
}

// VerifiedPractice — dual-sensor chord verification.
//
// Runs the CAMERA (fingering) and the MICROPHONE (sound) at the same time
// against a chosen target chord, then fuses the two into one verdict:
//   both       — fingering AND sound match  (the strict "correct")
//   shape-only — right fingering, didn't sound right (usually a muted string)
//   sound-only — heard right, camera can't read the hand (reposition)
//   none       — neither matches yet
// The target diagram paints per-string right/wrong live (FretboardDiagram marks),
// and a plain-language reason explains WHY a chord failed.
//
// Reuse: the camera pipeline is the shared useFretboardCam hook (same code as the
// Chord Cam tab); the mic loop mirrors ChordListener's PracticeMode exactly
// (useMic + detectPeaksConfigured → evaluateStrings/matchChordConfigured); the
// target picker uses the shared groupedChords list; the fusion is lib/chordVerify.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useT } from '../lib/i18n';
import { useFretboardCam } from '../lib/useFretboardCam';
import { FRETTING_TIPS } from '../lib/fretboardMap';
import { groupedChords, CHORDS_WITH_SCORE } from '../lib/chordGroups';
import { useMic, loadConfig, detectPeaksConfigured, matchChordConfigured } from '../lib/micDetect';
import { evaluateStrings } from '../lib/pitchDetect';
import { compareShape, fuseVerdict, verdictToMarks } from '../lib/chordVerify';
import { buildAttemptAdvice, adviceContextForAI } from '../lib/practiceAdvice';
import { advise } from '../lib/api';
import FretboardDiagram from './FretboardDiagram';
import ChordTip from './ChordTip';
import DifficultyBadge from './DifficultyBadge';
import CameraPicker from './CameraPicker';

const STATUS_META = {
  both:         { icon: '✅', color: '#34d399', label: 'Verified' },
  'shape-only': { icon: '🖐️', color: '#f59e0b', label: 'Shape OK, sound off' },
  'sound-only': { icon: '🔊', color: '#38bdf8', label: 'Heard it, show your hand' },
  none:         { icon: '—',  color: 'var(--color-ink-faint)', label: 'Not yet' },
};

export default function VerifiedPractice({ lang }) {
  const tr = useT(lang);

  // ── Target chord ────────────────────────────────────────────────────────────
  const [maxDiff, setMaxDiff] = useState(6);
  const [targetChord, setTargetChord] = useState(CHORDS_WITH_SCORE[0]);
  const groups = useMemo(() => groupedChords(maxDiff), [maxDiff]);
  useEffect(() => {
    const all = groups.flatMap((g) => g.chords);
    if (all.length > 0 && !all.includes(targetChord)) setTargetChord(all[0]);
  }, [groups, targetChord]);

  // ── Camera channel (shared hook) ─────────────────────────────────────────────
  const cam = useFretboardCam();
  const { videoRef, overlayRef, latestLandmarks } = cam;

  // ── Mic channel (mirrors ChordListener PracticeMode) ─────────────────────────
  const mic = useMic();
  const micRafRef = useRef(null);
  const cfgRef = useRef(loadConfig());
  const [micListening, setMicListening] = useState(false);
  const [micChord, setMicChord] = useState(null);       // detected chord name
  const [micStringResults, setMicStringResults] = useState(null);
  const [volume, setVolume] = useState(0);
  const targetRef = useRef(targetChord);
  targetRef.current = targetChord;

  const startMic = useCallback(async () => {
    try {
      await mic.current.open(cfgRef.current.smoothing);
      setMicListening(true);
    } catch {
      /* mic denied — camera-only still works, verdict just can't reach 'both' */
    }
  }, [mic]);

  const stopMic = useCallback(() => {
    if (micRafRef.current) cancelAnimationFrame(micRafRef.current);
    mic.current.close();
    setMicListening(false);
    setMicChord(null);
    setMicStringResults(null);
    setVolume(0);
  }, [mic]);

  useEffect(() => {
    if (!micListening) return undefined;
    let last = 0;
    const loop = (ts) => {
      micRafRef.current = requestAnimationFrame(loop);
      mic.current.updateSmoothing(cfgRef.current.smoothing);
      const rms = mic.current.getRMS();
      setVolume(Math.min(1, rms * 8));
      if (ts - last < 120) return;
      last = ts;
      if (rms < cfgRef.current.silenceRms) { setMicChord(null); setMicStringResults(null); return; }
      const fd = mic.current.getFreqData();
      if (!fd || !mic.current.audioCtx) return;
      const sr = mic.current.audioCtx.sampleRate;
      const fftSz = mic.current.analyser.fftSize;
      const ps = detectPeaksConfigured(fd, sr, fftSz, cfgRef.current);
      if (!ps.length) return;
      const hzList = ps.map((p) => p.hz);
      setMicStringResults(evaluateStrings(hzList, targetRef.current));
      const m = matchChordConfigured(hzList, cfgRef.current);
      setMicChord(m?.chord?.name ?? null);
    };
    micRafRef.current = requestAnimationFrame(loop);
    return () => { if (micRafRef.current) cancelAnimationFrame(micRafRef.current); };
  }, [micListening, mic]);

  // ── Start / stop both sensors together ───────────────────────────────────────
  const startBoth = useCallback(() => { cam.start(); startMic(); }, [cam, startMic]);
  const stopBoth = useCallback(() => { cam.close(); stopMic(); }, [cam, stopMic]);
  useEffect(() => () => { stopMic(); }, [stopMic]); // cam self-cleans via its own hook

  // ── Fuse ──────────────────────────────────────────────────────────────────────
  const cameraShape = useMemo(() => compareShape(cam.positions, targetChord), [cam.positions, targetChord]);
  const verdict = useMemo(
    () => fuseVerdict({
      cameraChord: cam.chord,
      cameraShape,
      micChord,
      micStringResults,
      targetName: targetChord.name,
    }),
    [cam.chord, cameraShape, micChord, micStringResults, targetChord.name],
  );
  const marks = useMemo(() => verdictToMarks(verdict.perString), [verdict.perString]);

  // ── After-attempt advice ─────────────────────────────────────────────────────
  // An "attempt" is a captured snapshot of the current verdict, turned into a
  // short coaching summary. Captured on demand ("Grade this attempt") or
  // automatically once a clean 'both' has held steady for a moment. The local
  // rule-based summary always shows; the AI advisor enriches it when reachable.
  const [attempt, setAttempt] = useState(null); // buildAttemptAdvice(...) result
  const [aiTip, setAiTip] = useState(null);     // enriched sentence, or null
  const [aiLoading, setAiLoading] = useState(false);
  const verdictRef = useRef(verdict);
  verdictRef.current = verdict;
  const bothHoldRef = useRef(0); // consecutive frames of a clean 'both'

  const captureAttempt = useCallback(async () => {
    const v = verdictRef.current;
    const name = targetRef.current.name;
    const advice = buildAttemptAdvice(v, name);
    setAttempt(advice);
    setAiTip(null);
    // Optional AI enrichment — degrades silently to the local summary offline.
    setAiLoading(true);
    const prompt = advice.mastered
      ? `I just played ${name} cleanly on guitar (verified by camera and mic). Give me one short encouraging next-step tip.`
      : `I'm practicing ${name} on guitar. Here's what happened: ${advice.tip || advice.headline}. Give me one short, specific coaching tip to fix it.`;
    const reply = await advise.ask({
      messages: [{ role: 'user', content: prompt }],
      context: adviceContextForAI(v, name),
    });
    setAiLoading(false);
    if (reply) setAiTip(reply);
  }, []);

  // Auto-capture a sustained clean chord so the user gets a "nice!" without a tap.
  useEffect(() => {
    if (cam.phase !== 'live') { bothHoldRef.current = 0; return; }
    if (verdict.status === 'both') {
      bothHoldRef.current += 1;
      // ~ a few update cycles of holding it clean, and only if not already shown.
      if (bothHoldRef.current === 6 && (!attempt || !attempt.mastered)) captureAttempt();
    } else {
      bothHoldRef.current = 0;
    }
  }, [verdict.status, cam.phase, attempt, captureAttempt]);

  const dismissAttempt = useCallback(() => { setAttempt(null); setAiTip(null); }, []);

  // ── Overlay draw (board quad + fretting tips) ────────────────────────────────
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
    };
    if (cam.phase === 'calibrate' || cam.phase === 'live') raf = requestAnimationFrame(draw);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [cam.phase, cam.corners, cam.detectedCorners, cam.detectConfidence, overlayRef, videoRef, latestLandmarks]);

  const meta = STATUS_META[verdict.status];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">✅</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {tr.verifyTitle || 'Verified Practice'}
          </span>
        </div>
        {cam.phase !== 'idle' && (
          <button onClick={stopBoth} className="text-xs px-3 py-1 rounded-lg"
            style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
            {tr.cancel || 'Close'}
          </button>
        )}
      </div>

      {/* Target picker + difficulty gate (always visible) */}
      <div className="p-4 space-y-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-ink-faint)' }}>
            {tr.maxDiff || 'Max difficulty'}
          </span>
          <input type="range" min={1} max={10} step={1} value={maxDiff}
            onChange={(e) => setMaxDiff(Number(e.target.value))} className="flex-1" />
          <DifficultyBadge score={maxDiff} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {groups.flatMap((g) => g.chords).map((c) => (
            <ChordTip key={c.name} name={c.name}>
              <button
                onClick={() => setTargetChord(c)}
                className="text-xs px-2.5 py-1 rounded-lg cursor-help"
                style={{
                  background: c.name === targetChord.name ? 'var(--color-brand)' : 'var(--color-surface-700)',
                  color: c.name === targetChord.name ? '#0b0b0b' : 'var(--color-ink-muted)',
                  border: '1px solid var(--color-surface-550)',
                }}>
                {c.name}
              </button>
            </ChordTip>
          ))}
        </div>
      </div>

      {cam.phase === 'idle' && (
        <div className="p-6">
          <p className="text-sm mb-3 text-center" style={{ color: 'var(--color-ink-muted)' }}>
            {tr.verifyIntro ||
              'Point the camera at your fretboard and let the mic listen. We check your fingering AND the sound — a chord counts only when both agree.'}
          </p>
          <ol className="text-sm space-y-2 mb-4 mx-auto" style={{ color: 'var(--color-ink-muted)', maxWidth: '24rem' }}>
            {[
              tr.verifyStep1 || 'Pick your target chord above.',
              tr.verifyStep2 || 'Aim the camera down the neck (over your shoulder) — keep the mic near the guitar.',
              tr.verifyStep3 || 'Hold steady while the app finds your fretboard — it locks on automatically.',
              tr.verifyStep4 || 'Hold the chord and strum — we check the shape (camera) and the sound (mic) together.',
            ].map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {/* Camera chooser — pick a webcam before opening (see FretboardChordCam
              for the browser-label-permission rationale). */}
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
            <button onClick={startBoth}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
              {tr.verifyStart || 'Start camera + mic'}
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
          <button onClick={startBoth} className="px-4 py-2 rounded-lg text-sm"
            style={{ border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}>
            {tr.retry || 'Try again'}
          </button>
        </div>
      )}

      {(cam.phase === 'calibrate' || cam.phase === 'live') && (
        <div>
          <div className="relative">
            <video ref={videoRef} playsInline muted className="w-full block" />
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            {/* mic level pip */}
            {micListening && (
              <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg"
                style={{ background: 'rgba(0,0,0,0.5)' }}>
                <span className="text-xs" style={{ color: '#fff' }}>🎤</span>
                <span className="block h-1.5 rounded-full" style={{ width: 40 }}>
                  <span className="block h-full rounded-full" style={{ width: `${volume * 100}%`, background: '#34d399' }} />
                </span>
              </div>
            )}
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
                  'Aim the camera down the neck from over your shoulder so your fingertips are visible.'}
              </p>
              {cam.detectStatus === 'notfound' && (
                <button onClick={cam.retryDetect} className="text-xs px-4 py-2 rounded-lg mt-3 font-semibold"
                  style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
                  {tr.retry || 'Retry'}
                </button>
              )}
              <CameraPicker cam={cam} lang={lang} />
            </div>
          )}

          {cam.phase === 'live' && (
            <div className="p-4 space-y-4">
              {/* Fused verdict */}
              <div className="flex items-start gap-4">
                <div className="shrink-0 text-center">
                  <div className="text-xs mb-1" style={{ color: 'var(--color-ink-faint)' }}>{tr.verifyTarget || 'Target'}</div>
                  <FretboardDiagram chord={targetChord} showFingers marks={marks} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{meta.icon}</span>
                    <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>{verdict.reason}</p>

                  {/* Per-sensor readout */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--color-surface-700)' }}>
                      <div style={{ color: 'var(--color-ink-faint)' }}>📸 {tr.verifyCamera || 'Camera (shape)'}</div>
                      <div className="mt-1">
                        {cam.chord
                          ? <ChordTip name={cam.chord}><span className="font-semibold cursor-help" style={{ color: 'var(--color-ink)' }}>{cam.chord}</span></ChordTip>
                          : <span style={{ color: 'var(--color-ink-faint)' }}>{cam.handVisible ? '—' : (tr.chordCamShowHand || 'no hand')}</span>}
                      </div>
                    </div>
                    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--color-surface-700)' }}>
                      <div style={{ color: 'var(--color-ink-faint)' }}>🎤 {tr.verifyMic || 'Mic (sound)'}</div>
                      <div className="mt-1">
                        {micChord
                          ? <ChordTip name={micChord}><span className="font-semibold cursor-help" style={{ color: 'var(--color-ink)' }}>{micChord}</span></ChordTip>
                          : <span style={{ color: 'var(--color-ink-faint)' }}>{micListening ? '—' : (tr.verifyMicOff || 'mic off')}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={cam.recalibrate} className="text-xs px-3 py-2 rounded-lg"
                  style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                  {tr.chordCamRecalibrate || 'Recalibrate'}
                </button>
                {!micListening && (
                  <button onClick={startMic} className="text-xs px-3 py-2 rounded-lg"
                    style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
                    🎤 {tr.verifyEnableMic || 'Enable mic'}
                  </button>
                )}
                <button onClick={captureAttempt} className="text-xs px-3 py-2 rounded-lg font-semibold ml-auto"
                  style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
                  {tr.verifyGrade || 'Grade this attempt'}
                </button>
              </div>

              {!cam.handVisible && (
                <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                  {tr.chordCamNoHandHint ||
                    'No hand detected. Make sure your fretting hand is fully in frame and well lit. On a laptop, aim the camera down at the neck — or switch cameras below.'}
                </p>
              )}
              <CameraPicker cam={cam} lang={lang} />

              {/* After-attempt coaching summary */}
              {attempt && (
                <div className="rounded-xl p-4 mt-1" style={{ background: 'var(--color-surface-800)', border: '1px solid var(--color-surface-600)' }}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-bold" style={{ color: 'var(--color-ink)' }}>{attempt.headline}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm" title={`${attempt.stars}/5`}>
                        {'★'.repeat(attempt.stars)}<span style={{ color: 'var(--color-ink-ghost)' }}>{'★'.repeat(5 - attempt.stars)}</span>
                      </span>
                      <button onClick={dismissAttempt} aria-label={tr.close || 'Close'}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-xs"
                        style={{ color: 'var(--color-ink-faint)' }}>✕</button>
                    </div>
                  </div>
                  {attempt.positive && (
                    <p className="text-sm mb-1" style={{ color: '#34d399' }}>{attempt.positive}</p>
                  )}
                  {attempt.tip && (
                    <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>💡 {attempt.tip}</p>
                  )}
                  {/* AI-enriched coaching line, when the backend is reachable */}
                  {aiLoading && (
                    <p className="text-xs mt-2" style={{ color: 'var(--color-ink-faint)' }}>{tr.verifyCoachThinking || 'Coach is thinking…'}</p>
                  )}
                  {aiTip && (
                    <p className="text-sm mt-2 pt-2" style={{ color: 'var(--color-ink-muted)', borderTop: '1px solid var(--color-surface-600)' }}>
                      🎓 {aiTip}
                    </p>
                  )}
                  <div className="mt-3">
                    <button onClick={dismissAttempt} className="text-xs px-3 py-2 rounded-lg font-semibold"
                      style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
                      {tr.verifyTryAgain || 'Try again'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

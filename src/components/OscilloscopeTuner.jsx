import { useState, useEffect, useRef, useCallback } from 'react';
import { detectPitchYIN, hzToNote } from '../lib/pitchDetect';

// Standard open-string frequencies for reference indicator
const OPEN_STRINGS = [
  { name: 'E2',  hz: 82.41  },
  { name: 'A2',  hz: 110.0  },
  { name: 'D3',  hz: 146.83 },
  { name: 'G3',  hz: 196.0  },
  { name: 'B3',  hz: 246.94 },
  { name: 'e4',  hz: 329.63 },
];

const CENT_RANGE = 50; // ±50 cents shown on needle

function centColor(cents) {
  const abs = Math.abs(cents);
  if (abs <= 5)  return '#4ade80';
  if (abs <= 15) return '#c9a96e';
  if (abs <= 30) return '#fb923c';
  return '#f87171';
}

// ── Oscilloscope canvas ───────────────────────────────────────────────────────

function drawOscilloscope(canvas, timeData, color = '#38bdf8', active = true) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = '#1a1a2a';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (H / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let i = 1; i < 8; i++) {
    const x = (W / 8) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  // Zero line
  ctx.strokeStyle = '#2a2a3a';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

  if (!active || !timeData) return;

  // Find a zero crossing for stable display (triggering)
  let startIdx = 0;
  for (let i = 1; i < timeData.length - 1; i++) {
    if (timeData[i - 1] < 0 && timeData[i] >= 0) { startIdx = i; break; }
  }

  const drawLen = Math.min(timeData.length - startIdx, W);

  // Glow effect — draw twice, once blurred
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    ctx.strokeStyle = pass === 0 ? `${color}44` : color;
    ctx.lineWidth = pass === 0 ? 4 : 1.5;
    ctx.shadowColor = pass === 0 ? color : 'transparent';
    ctx.shadowBlur = pass === 0 ? 8 : 0;

    for (let i = 0; i < drawLen; i++) {
      const x = (i / drawLen) * W;
      const y = ((1 - timeData[startIdx + i]) / 2) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

// ── Tuner needle ─────────────────────────────────────────────────────────────

function TunerNeedle({ cents, active }) {
  // cents: number (-50..+50), active: bool
  const pct = active ? Math.max(-1, Math.min(1, cents / CENT_RANGE)) : 0;
  const color = active ? centColor(cents) : '#2a2a2a';

  // Needle angle: -60° to +60°
  const angle = pct * 60;
  const cx = 100, cy = 110, r = 80;
  const rad = (angle - 90) * (Math.PI / 180);
  const nx = cx + r * Math.cos(rad);
  const ny = cy + r * Math.sin(rad);

  // Arc tick marks
  const ticks = [-50,-40,-30,-20,-10,0,10,20,30,40,50];

  return (
    <svg viewBox="0 0 200 130" className="w-full" style={{ maxWidth: 280 }}>
      {/* Arc */}
      <path d="M 20 110 A 80 80 0 0 1 180 110" fill="none" stroke="#1e1e1e" strokeWidth="18" strokeLinecap="round" />
      {/* Colored arc zones */}
      {/* Green zone center */}
      <path d="M 93 32 A 80 80 0 0 1 107 32" fill="none" stroke="#4ade8044" strokeWidth="18" strokeLinecap="round" />

      {/* Tick marks */}
      {ticks.map(t => {
        const a = (t / CENT_RANGE) * 60;
        const ra = (a - 90) * (Math.PI / 180);
        const isMajor = t % 10 === 0;
        const r1 = isMajor ? 68 : 72;
        const r2 = 78;
        return (
          <g key={t}>
            <line
              x1={cx + r1 * Math.cos(ra)} y1={cy + r1 * Math.sin(ra)}
              x2={cx + r2 * Math.cos(ra)} y2={cy + r2 * Math.sin(ra)}
              stroke={t === 0 ? '#4ade80' : '#3a3a3a'}
              strokeWidth={t === 0 ? 2 : 1}
            />
            {isMajor && t !== 0 && (
              <text
                x={cx + 58 * Math.cos(ra)} y={cy + 58 * Math.sin(ra) + 3}
                textAnchor="middle" fontSize="7" fill="#3a3a3a">
                {t > 0 ? `+${t}` : t}
              </text>
            )}
          </g>
        );
      })}

      {/* "0" label */}
      <text x={cx} y={cy - 86} textAnchor="middle" fontSize="8" fill="#4ade80" fontWeight="bold">0</text>

      {/* Needle */}
      <line
        x1={cx} y1={cy}
        x2={nx} y2={ny}
        stroke={color} strokeWidth={2.5} strokeLinecap="round"
        style={{ transition: 'all 0.08s ease-out', filter: active ? `drop-shadow(0 0 4px ${color})` : 'none' }}
      />
      <circle cx={cx} cy={cy} r={5} fill={color} style={{ transition: 'fill 0.08s' }} />

      {/* Labels */}
      <text x={22} y={125} fontSize="8" fill="#3a3a3a">♭ Flat</text>
      <text x={178} y={125} textAnchor="end" fontSize="8" fill="#3a3a3a">Sharp ♯</text>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OscilloscopeTuner() {
  const [listening, setListening]     = useState(false);
  const [permDenied, setPermDenied]   = useState(false);
  const [note, setNote]               = useState(null);   // { name, octave, cents, hz }
  const [volume, setVolume]           = useState(0);
  const [activeView, setActiveView]   = useState('both'); // 'both' | 'scope' | 'tuner'

  const canvasRef   = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef   = useRef(null);
  const rafRef      = useRef(null);
  const freqRef     = useRef(null);
  const timeRef     = useRef(null);
  const yinRef      = useRef(null);
  const lastDrawRef = useRef(0);

  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) audioCtxRef.current.close();
    audioCtxRef.current = null; analyserRef.current = null;
    streamRef.current = null; freqRef.current = null;
    timeRef.current = null; yinRef.current = null;
    setListening(false);
    setNote(null);
    setVolume(0);
  }, []);

  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 44100 });
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      freqRef.current = new Float32Array(analyser.frequencyBinCount);
      timeRef.current = new Float32Array(analyser.fftSize);
      yinRef.current  = new Float32Array(analyser.fftSize);

      setListening(true);
      setPermDenied(false);
    } catch (err) {
      if (err.name === 'NotAllowedError') setPermDenied(true);
    }
  }, []);

  // Main analysis + draw loop
  useEffect(() => {
    if (!listening) return;

    function loop(ts) {
      rafRef.current = requestAnimationFrame(loop);
      const analyser = analyserRef.current;
      if (!analyser) return;

      analyser.getFloatTimeDomainData(timeRef.current);

      // RMS
      let rms = 0;
      for (let i = 0; i < timeRef.current.length; i++) rms += timeRef.current[i] ** 2;
      rms = Math.sqrt(rms / timeRef.current.length);
      setVolume(Math.min(1, rms * 10));

      // Oscilloscope — draw at ~30fps
      if (ts - lastDrawRef.current > 33) {
        lastDrawRef.current = ts;
        const canvas = canvasRef.current;
        if (canvas) drawOscilloscope(canvas, timeRef.current, '#38bdf8', rms > 0.005);
      }

      // Pitch detection — only when there's enough signal, throttled to ~12fps
      if (rms > 0.01) {
        const hz = detectPitchYIN(timeRef.current, audioCtxRef.current.sampleRate);
        if (hz && hz > 60 && hz < 1400) {
          setNote(hzToNote(hz));
        } else if (rms < 0.015) {
          setNote(null);
        }
      } else {
        setNote(null);
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [listening]);

  useEffect(() => () => stopListening(), [stopListening]);

  // Find nearest open string
  const nearestString = note
    ? OPEN_STRINGS.reduce((best, s) => {
        const diff = Math.abs(Math.log2(note.hz / s.hz) * 1200);
        return diff < Math.abs(Math.log2(note.hz / best.hz) * 1200) ? s : best;
      }, OPEN_STRINGS[0])
    : null;

  const inTune = note && Math.abs(note.cents) <= 5;
  const volPct = Math.round(volume * 100);
  const volColor = volume > 0.7 ? '#f87171' : volume > 0.25 ? '#4ade80' : '#2a2a2a';

  return (
    <div className="p-3 sm:p-5 space-y-4">

      {/* Header + mic button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base sm:text-lg font-bold mb-0.5" style={{ color: '#f0ede8' }}>
            Oscilloscope &amp; Tuner
          </h2>
          <p className="text-xs" style={{ color: '#5a5a5a' }}>
            Real-time waveform and chromatic tuner — pluck one string at a time.
          </p>
        </div>

        {!listening ? (
          <button onClick={startListening}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shrink-0"
            style={{ background: '#c9a96e', color: '#0f0f0f' }}>
            🎙️ Start
          </button>
        ) : (
          <button onClick={stopListening}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shrink-0"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="animate-pulse">●</span> Stop
          </button>
        )}
      </div>

      {permDenied && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
          Microphone access denied. Please allow mic in your browser settings.
        </p>
      )}

      {/* View toggle */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: '#161616' }}>
        {[['both','Both'],['scope','Oscilloscope'],['tuner','Tuner']].map(([v, l]) => (
          <button key={v} onClick={() => setActiveView(v)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={activeView === v
              ? { background: '#1e1e1e', color: '#c9a96e', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
              : { color: '#5a5a5a' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Volume bar */}
      {listening && (
        <div className="flex items-center gap-2">
          <span className="text-xs w-6 shrink-0" style={{ color: '#3a3a3a' }}>Vol</span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1e1e1e' }}>
            <div className="h-full rounded-full transition-all duration-75"
              style={{ width: `${volPct}%`, background: volColor }} />
          </div>
          <span className="text-xs tabular-nums w-8 text-right shrink-0" style={{ color: '#3a3a3a' }}>{volPct}%</span>
        </div>
      )}

      {/* ── Oscilloscope ── */}
      {(activeView === 'both' || activeView === 'scope') && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #1a1a2a' }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ background: '#0d0d1a', borderBottom: '1px solid #1a1a2a' }}>
            <span className="text-xs font-semibold" style={{ color: '#38bdf8' }}>Waveform</span>
            {listening && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: '#2a2a4a' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#38bdf8' }} />
                Live
              </span>
            )}
          </div>
          <canvas
            ref={canvasRef}
            width={800}
            height={180}
            className="w-full block"
            style={{ background: '#0a0a12' }}
          />
          {!listening && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ position: 'relative', height: 0, marginTop: -90 }}>
              <span className="text-xs" style={{ color: '#2a2a3a' }}>Press Start to see your waveform</span>
            </div>
          )}
        </div>
      )}

      {/* ── Tuner ── */}
      {(activeView === 'both' || activeView === 'tuner') && (
        <div className="rounded-2xl overflow-hidden" style={{ background: '#111118', border: '1px solid #1e1e2e' }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid #1e1e2e' }}>
            <span className="text-xs font-semibold" style={{ color: '#c9a96e' }}>Chromatic Tuner</span>
            <span className="text-xs" style={{ color: '#3a3a3a' }}>A4 = 440 Hz</span>
          </div>

          <div className="p-4">
            {/* Note display */}
            <div className="flex items-end justify-center gap-3 mb-4">
              <div className="text-center">
                {note ? (
                  <>
                    <div className="text-6xl font-black leading-none mb-1 transition-all"
                      style={{ color: inTune ? '#4ade80' : centColor(note.cents) }}>
                      {note.name}
                    </div>
                    <div className="text-lg font-bold" style={{ color: '#3a3a3a' }}>
                      {note.octave}
                    </div>
                  </>
                ) : (
                  <div className="text-5xl font-black leading-none" style={{ color: '#2a2a2a' }}>—</div>
                )}
              </div>
              {note && (
                <div className="text-left pb-1">
                  <div className="text-xs tabular-nums mb-0.5" style={{ color: '#5a5a5a' }}>
                    {note.hz.toFixed(1)} Hz
                  </div>
                  <div className="text-xs font-bold" style={{ color: centColor(note.cents) }}>
                    {note.cents === 0 ? '± 0¢' : note.cents > 0 ? `+${note.cents}¢` : `${note.cents}¢`}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: inTune ? '#4ade80' : '#5a5a5a' }}>
                    {inTune ? '✓ In tune' : note.cents > 0 ? '↑ Too sharp' : '↓ Too flat'}
                  </div>
                </div>
              )}
            </div>

            {/* Needle */}
            <div className="flex justify-center mb-3">
              <TunerNeedle cents={note?.cents ?? 0} active={!!note} />
            </div>

            {/* Cents bar */}
            <div className="relative h-3 rounded-full overflow-hidden mb-3" style={{ background: '#1a1a1a' }}>
              {/* Zones */}
              <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: '#4ade8055', transform: 'translateX(-50%)' }} />
              {note && (
                <div
                  className="absolute top-0 h-full rounded-full transition-all duration-75"
                  style={{
                    width: 6, height: '100%',
                    left: `calc(50% + ${(note.cents / CENT_RANGE) * 50}% - 3px)`,
                    background: centColor(note.cents),
                    boxShadow: `0 0 8px ${centColor(note.cents)}`,
                  }}
                />
              )}
              <div className="absolute inset-y-0 rounded-full" style={{ left: 'calc(50% - 3%)', width: '6%', background: '#4ade8022' }} />
            </div>

            {/* Open string reference */}
            <div className="pt-3" style={{ borderTop: '1px solid #1a1a1a' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3a3a3a' }}>
                Standard tuning reference
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {OPEN_STRINGS.map(s => {
                  const isNearest = nearestString?.name === s.name && !!note;
                  return (
                    <div key={s.name}
                      className="flex flex-col items-center px-2.5 py-1.5 rounded-lg transition-all"
                      style={{
                        background: isNearest ? (inTune ? 'rgba(74,222,128,0.1)' : 'rgba(201,169,110,0.1)') : '#1a1a1a',
                        border: `1px solid ${isNearest ? (inTune ? 'rgba(74,222,128,0.3)' : 'rgba(201,169,110,0.3)') : '#222'}`,
                      }}>
                      <span className="text-sm font-black leading-none"
                        style={{ color: isNearest ? (inTune ? '#4ade80' : '#c9a96e') : '#3a3a3a' }}>
                        {s.name.replace(/[0-9]/g, '')}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: isNearest ? '#5a5a5a' : '#2a2a2a' }}>
                        {s.hz}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Idle hint */}
      {!listening && (
        <div className="text-center py-6" style={{ color: '#3a3a3a' }}>
          <p className="text-3xl mb-2">🎸</p>
          <p className="text-sm">Hit <strong style={{ color: '#c9a96e' }}>Start</strong>, then pluck a single string.</p>
        </div>
      )}
    </div>
  );
}

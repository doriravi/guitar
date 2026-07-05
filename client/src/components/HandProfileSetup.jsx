import { useState, useCallback, useEffect, useRef } from 'react';
import { DEFAULT_PROFILE, abilityLabel, reachMultiplier, flexibilityScore, flexibilityLabel } from '../lib/handProfile';
import CameraHandMeasure from './CameraHandMeasure';
import { useT } from '../lib/i18n';
import { handAnalysis } from '../lib/api';

const GAPS = [
  { key: 'thumbToIndex',  labelKey: 'thumbIndex',  descKey: 'thumbIndexTip',  range: [5, 10],    step: 0.25, color: '#a78bfa', fingers: ['T','I'] },
  { key: 'indexToMiddle', labelKey: 'indexMiddle', descKey: 'indexMiddleTip', range: [2.5, 7],   step: 0.25, color: '#38bdf8', fingers: ['I','M'] },
  { key: 'middleToRing',  labelKey: 'middleRing',  descKey: 'middleRingTip',  range: [2, 6],     step: 0.25, color: '#34d399', fingers: ['M','R'] },
  { key: 'ringToLittle',  labelKey: 'ringPinky',   descKey: 'ringPinkyTip',   range: [3, 8.5],   step: 0.25, color: '#c9a96e', fingers: ['R','P'] },
];

// Bands are on the raw reach multiplier; the average hand scores ≈ 0.713
// against the 95th-percentile reference, so "average" is the band around it.
const GUITAR_LEVELS = [
  { minM: 0.79, level: 5, titleKey: 'eliteReach',        color: '#4ade80', summary: 'Virtually no chord is out of reach. 4-fret stretches and jazz voicings all feel natural.',             chords: ['Full barré', '4-fret stretches', 'Jazz voicings', 'Extended 9th/13th'] },
  { minM: 0.73, level: 4, titleKey: 'strongReach',       color: '#38bdf8', summary: 'Most standard chords comfortable. Wide stretches need a warm-up but are achievable.',                  chords: ['Open chords', 'Power chords', 'Most barré', '3-fret stretches'] },
  { minM: 0.65, level: 3, titleKey: 'averageReach',      color: '#c9a96e', summary: 'Comfortable with everyday chords. Wide stretches (fret 4+) may need repositioning.',                   chords: ['Open chords', 'Power chords', 'Partial barré', '2–3 fret stretches'] },
  { minM: 0.57, level: 2, titleKey: 'limitedReach',      color: '#fb923c', summary: 'Basic chords are fine. Barré chords and 3-fret spans need effort or alternative fingerings.',          chords: ['Open chords', 'Power chords', 'Simple 2-fret shapes'] },
  { minM: 0,    level: 1, titleKey: 'veryLimitedReach',  color: '#f87171', summary: 'Many shapes are physically difficult. Focus on open chords, capo use, and adapted fingerings.',        chords: ['Open chords', 'Capo-assisted', 'Simplified voicings'] },
];

const GAP_IMPACT = {
  thumbToIndex:  { low: [6.5, 'Thumb reach limited — thumb-over-neck bass notes will be difficult.'], high: [8.5, 'Strong thumb span — thumb-over-neck technique feels natural.'], mid: 'Adequate thumb span for standard fretting.' },
  indexToMiddle: { low: [3.5, 'Tight index-middle gap — fret spreads beyond 2 frets will feel strained.'], high: [5.5, 'Wide gap — 3–4 fret spreads are comfortable.'], mid: 'Standard index-middle spread — 2–3 fret spans manageable.' },
  middleToRing:  { low: [2.5, 'Limited middle-ring independence — chord transitions may be slow.'], high: [4.5, 'Good spread — smooth transitions between chord shapes.'], mid: 'Average middle-ring spread — most shapes achievable.' },
  ringToLittle:  { low: [4.5, 'Weak pinky reach — 4th finger notes on high frets will be very hard.'], high: [6.5, 'Strong pinky — can anchor high voicings and extensions.'], mid: 'Moderate pinky reach — standard use fine, wide extensions need effort.' },
};

function getImpact(key, value) {
  const imp = GAP_IMPACT[key];
  if (value <= imp.low[0])  return { text: imp.low[1],  color: '#f87171' };
  if (value >= imp.high[0]) return { text: imp.high[1], color: '#4ade80' };
  return { text: imp.mid, color: '#5a5a5a' };
}

function getCurrentLevel(m) {
  return GUITAR_LEVELS.find(l => m >= l.minM) || GUITAR_LEVELS[GUITAR_LEVELS.length - 1];
}

function GapSlider({ gap, value, onChange, tr }) {
  const [min, max] = gap.range;
  const pct = ((value - min) / (max - min)) * 100;
  const impact = getImpact(gap.key, value);

  return (
    <div className="rounded-xl p-4 bg-surface-750 border border-surface-650">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {gap.fingers.map((f, i) => (
              <span key={f} className="flex items-center">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-black" style={{ background: gap.color }}>{f}</span>
                {i === 0 && <span className="text-xs mx-1 text-ink-ghost">↔</span>}
              </span>
            ))}
          </div>
          <span className="text-sm font-semibold text-ink">{tr[gap.labelKey]}</span>
        </div>
        <span className="text-base font-bold tabular-nums" style={{ color: gap.color }}>{value.toFixed(1)} cm</span>
      </div>

      <p className="text-xs mb-3 text-ink-ghost">{tr[gap.descKey]}</p>

      <div className="mb-3">
        <input
          type="range" min={min} max={max} step={gap.step} value={value}
          onChange={e => onChange(gap.key, parseFloat(e.target.value))}
          className="w-full"
          style={{ background: `linear-gradient(to right, ${gap.color} ${pct}%, var(--color-surface-550) ${pct}%)`, color: gap.color }}
        />
        <div className="flex justify-between text-xs mt-1 text-ink-ghost">
          <span>{min} cm</span><span>{max} cm</span>
        </div>
      </div>

      <div className="flex items-start gap-2 pt-2 border-t border-surface-650">
        <span className="text-sm leading-none mt-0.5">🎸</span>
        <p className="text-xs" style={{ color: impact.color }}>{impact.text}</p>
      </div>
    </div>
  );
}

function GuitarReachLevel({ profile, tr }) {
  const m = reachMultiplier(profile);
  const current = getCurrentLevel(m);

  return (
    <div className="rounded-xl p-5 bg-surface-750" style={{ border: `1px solid ${current.color}22` }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs uppercase tracking-widest font-semibold mb-1 text-ink-faint">Guitar Reach Level</p>
          <p className="text-2xl font-bold" style={{ color: current.color }}>{tr[current.titleKey]}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-1">
            {[1,2,3,4,5].map(l => (
              <div key={l} className="w-5 h-2 rounded-sm transition-all" style={{ background: l <= current.level ? current.color : 'var(--color-surface-650)' }} />
            ))}
          </div>
          <p className="text-xs font-semibold" style={{ color: current.color }}>Level {current.level} / 5</p>
        </div>
      </div>

      <p className="text-sm mb-4 text-ink-subtle">{current.summary}</p>

      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-semibold mb-2 text-ink-ghost">{tr.withinYourReach}</p>
        <div className="flex flex-wrap gap-2">
          {current.chords.map(c => (
            <span key={c} className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: `${current.color}15`, color: current.color, border: `1px solid ${current.color}30` }}>{c}</span>
          ))}
        </div>
      </div>

      <div className="space-y-1 border-t border-surface-700" style={{ paddingTop: '1rem' }}>
        <p className="text-xs uppercase tracking-wide font-semibold mb-2 text-ink-ghost">{tr.allLevels}</p>
        {GUITAR_LEVELS.slice().reverse().map(l => {
          const isActive = l.level === current.level;
          return (
            <div key={l.level} className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all" style={{
              background: isActive ? `${l.color}10` : 'transparent',
              borderLeft: `2px solid ${isActive ? l.color : 'var(--color-surface-700)'}`,
              opacity: isActive ? 1 : 0.4,
            }}>
              <span className="text-xs font-bold w-4" style={{ color: l.color }}>{l.level}</span>
              <span className="text-xs font-medium" style={{ color: isActive ? l.color : 'var(--color-ink-faint)' }}>{tr[l.titleKey]}</span>
              {isActive && <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: `${l.color}20`, color: l.color }}>{tr.you}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HandDiagram({ profile }) {
  const m = reachMultiplier(profile);
  const palmY = 160;
  const fingerLength = 60;
  const bases = [
    { x: 48, label: 'T', color: '#a78bfa' },
    { x: 72, label: 'I', color: '#38bdf8' },
    { x: 92, label: 'M', color: '#34d399' },
    { x: 112,label: 'R', color: '#c9a96e' },
    { x: 132,label: 'P', color: '#f87171' },
  ];
  const userGaps = [
    profile.thumbToIndex  ?? DEFAULT_PROFILE.thumbToIndex,
    profile.indexToMiddle ?? DEFAULT_PROFILE.indexToMiddle,
    profile.middleToRing  ?? DEFAULT_PROFILE.middleToRing,
    profile.ringToLittle  ?? DEFAULT_PROFILE.ringToLittle,
  ];
  const s = 0.72;   // px per cm ÷ 3 — sized for true-scale gap values (avg ≈ 7.5/4.5/3.5/5.5 cm)
  const tipXs = [0,0,0,0,0];
  tipXs[1] = bases[1].x;
  tipXs[2] = tipXs[1] + userGaps[1] * s * 3;
  tipXs[3] = tipXs[2] + userGaps[2] * s * 3;
  tipXs[4] = tipXs[3] + userGaps[3] * s * 3;
  tipXs[0] = tipXs[1] - userGaps[0] * s * 3;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 230" className="w-44 h-44">
        <ellipse cx="95" cy="185" rx="52" ry="38" fill="#1e1e1e" stroke="#2a2a2a" strokeWidth="1.5" />
        {bases.map((b, i) => (
          <g key={b.label}>
            <line x1={b.x} y1={palmY-5} x2={tipXs[i]} y2={palmY - fingerLength - (i===0?-15:i===1||i===4?5:10)} stroke={b.color} strokeWidth={i===0?8:6} strokeLinecap="round" opacity="0.9" />
            <circle cx={tipXs[i]} cy={palmY - fingerLength - (i===0?-15:i===1||i===4?5:10)} r="5" fill={b.color} />
          </g>
        ))}
        {bases.map((b, i) => (
          <text key={`l${b.label}`} x={tipXs[i]} y={palmY - fingerLength - (i===0?-15:i===1||i===4?5:10) - 9} textAnchor="middle" fontSize="8" fill={b.color} fontWeight="bold">{b.label}</text>
        ))}
      </svg>
      <p className="text-xs mt-1" style={{ color: '#3a3a3a' }}>{Math.round(m * 100)}% of reference reach</p>
    </div>
  );
}

// Map AI report → hand profile cm measurements.
// Uses direct cm estimates if present, falls back to span/splay buckets.
function aiReportToProfile(report) {
  const m = report.measurements;
  if (m && typeof m.thumb_to_index_cm === 'number') {
    return {
      thumbToIndex:  clamp(m.thumb_to_index_cm,  5,   10),
      indexToMiddle: clamp(m.index_to_middle_cm, 2.5,  7),
      middleToRing:  clamp(m.middle_to_ring_cm,  2,    6),
      ringToLittle:  clamp(m.ring_to_pinky_cm,   3,    8.5),
    };
  }
  // Fallback: bucket from span/splay
  const bp    = report.biomechanical_profile;
  const span  = bp.absolute_span_assessment;
  const splay = bp.inferred_flexibility_splay;
  return {
    thumbToIndex:  span  === 'Large' ? 9.0 : span  === 'Medium' ? 7.5 : 6.5,
    indexToMiddle: splay === 'High'  ? 5.5 : splay === 'Medium' ? 4.5 : 3.5,
    middleToRing:  splay === 'High'  ? 4.5 : splay === 'Medium' ? 3.5 : 2.5,
    ringToLittle:  (span === 'Large' && splay === 'High') ? 7.5 : span === 'Large' ? 6.5 : splay === 'High' ? 6.0 : 5.5,
  };
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// ── AI Hand Analysis (Claude vision) ─────────────────────────────────────────

function AIHandAnalysis({ lang, onMeasured }) {
  const [phase, setPhase]       = useState('idle'); // idle | capturing | analysing | done | error
  const [report, setReport]     = useState(null);
  const [errMsg, setErrMsg]     = useState('');
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
      streamRef.current = stream;
      setPhase('capturing'); // mount video element first, then attach in effect
    } catch (e) {
      setErrMsg(e.name === 'NotAllowedError' ? 'Camera access denied.' : e.message);
      setPhase('error');
    }
  };

  // attach stream once video element is in the DOM (after phase → 'capturing')
  useEffect(() => {
    if (phase !== 'capturing') return;
    const v = videoRef.current;
    if (!v || !streamRef.current) return;
    v.srcObject = streamRef.current;
    v.play().catch(() => {});
  }, [phase]);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const capture = async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    c.width  = v.videoWidth  || 640;
    c.height = v.videoHeight || 480;
    c.getContext('2d').drawImage(v, 0, 0);
    stopStream();
    setPhase('analysing');
    const b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
    try {
      // The Anthropic key and biomechanics prompt live on the backend
      // (ClaudeHandAnalysisController) — the browser only ships the photo.
      const parsed = await handAnalysis.claude(b64);
      if (!parsed || !parsed.biomechanical_profile) {
        throw new Error('Analysis returned no report. Please retake the photo and try again.');
      }
      setReport(parsed);
      setPhase('done');
      if (onMeasured) onMeasured(aiReportToProfile(parsed), parsed.biomechanical_profile?.fingers || null);
    } catch (e) {
      setErrMsg(e.message || 'Analysis failed.');
      setPhase('error');
    }
  };

  const reset = () => { setPhase('idle'); setReport(null); setErrMsg(''); stopStream(); };

  const STATUS_ICON = { 'Optimal': '✅', 'Challenging': '⚠️', 'Structurally Restricted': '❌' };
  const STATUS_COLOR = { 'Optimal': '#4ade80', 'Challenging': '#c9a96e', 'Structurally Restricted': '#f87171' };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #222' }}>
        <div className="flex items-center gap-2">
          <span>🤖</span>
          <span className="text-sm font-semibold" style={{ color: '#f0ede8' }}>AI Hand Analysis</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>Claude</span>
        </div>
        {phase !== 'idle' && (
          <button onClick={reset} className="text-xs px-3 py-1 rounded-lg" style={{ color: '#5a5a5a', border: '1px solid #2a2a2a' }}>
            Reset
          </button>
        )}
      </div>

      {phase === 'idle' && (
        <div className="p-5 text-center">
          <p className="text-sm mb-1" style={{ color: '#7a7a7a' }}>Take a photo of your left hand — AI will grade your chord reach capability across 5 levels.</p>
          <p className="text-xs mb-4" style={{ color: '#4a4a4a' }}>Splay your fingers wide, palm facing the camera.</p>
          <button onClick={startCamera} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#6366f1', color: '#fff' }}>
            📷 Open Camera
          </button>
        </div>
      )}

      {phase === 'capturing' && (
        <div>
          <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
            <video ref={videoRef} className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="p-4 flex items-center justify-between gap-4">
            <p className="text-xs" style={{ color: '#5a5a5a' }}>Splay your left hand wide in frame, then capture.</p>
            <div className="flex gap-2 shrink-0">
              <button onClick={reset} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: '#1e1e1e', color: '#5a5a5a', border: '1px solid #2a2a2a' }}>
                Cancel
              </button>
              <button onClick={capture} className="px-5 py-2 rounded-xl text-sm font-semibold" style={{ background: '#6366f1', color: '#fff' }}>
                Capture & Analyse
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'analysing' && (
        <div className="p-6 flex items-center justify-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: '#6366f1', borderTopColor: 'transparent' }} />
          <span className="text-sm" style={{ color: '#5a5a5a' }}>Analysing with Claude…</span>
        </div>
      )}

      {phase === 'error' && (
        <div className="p-5 text-center">
          <p className="text-sm mb-3" style={{ color: '#f87171' }}>⚠ {errMsg}</p>
          <button onClick={reset} className="px-5 py-2 rounded-xl text-sm font-semibold" style={{ background: '#1e1e1e', color: '#5a5a5a', border: '1px solid #2a2a2a' }}>Try Again</button>
        </div>
      )}

      {phase === 'done' && report && (() => {
        const bp      = report.biomechanical_profile;
        const fingers = bp.fingers || {};
        const meas    = aiReportToProfile(report);
        const FINGER_COLOR = { thumb: '#a78bfa', index: '#38bdf8', middle: '#34d399', ring: '#c9a96e', pinky: '#f87171' };
        const FINGER_LABEL = { thumb: 'T', index: 'I', middle: 'M', ring: 'R', pinky: 'P' };
        const GAP_LABELS = [
          { label: 'Thumb → Index', value: meas.thumbToIndex,  color: '#a78bfa' },
          { label: 'Index → Middle', value: meas.indexToMiddle, color: '#38bdf8' },
          { label: 'Middle → Ring',  value: meas.middleToRing,  color: '#34d399' },
          { label: 'Ring → Pinky',   value: meas.ringToLittle,  color: '#c9a96e' },
        ];
        return (
          <div className="p-4 space-y-4">

            {/* Profile applied banner */}
            <div className="rounded-lg px-4 py-3 flex items-center gap-2" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
              <span className="text-base">✅</span>
              <div>
                <p className="text-xs font-semibold" style={{ color: '#4ade80' }}>Hand profile updated & saved</p>
                <p className="text-xs" style={{ color: '#3a6a4a' }}>All difficulty scores across the app now reflect your hand.</p>
              </div>
            </div>

            {/* Measured gap values */}
            <div className="rounded-lg p-3" style={{ background: '#111', border: '1px solid #1e1e1e' }}>
              <p className="text-xs uppercase tracking-wide font-semibold mb-3" style={{ color: '#3a3a3a' }}>Measured Finger Gaps</p>
              <div className="grid grid-cols-2 gap-2">
                {GAP_LABELS.map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: '#0a0a0a', border: `1px solid ${color}22` }}>
                    <span className="text-xs" style={{ color: '#5a5a5a' }}>{label}</span>
                    <span className="text-sm font-bold tabular-nums" style={{ color }}>{value.toFixed(1)} cm</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-finger cards */}
            {Object.keys(fingers).length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: '#3a3a3a' }}>Finger Analysis</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {['thumb','index','middle','ring','pinky'].map(name => {
                    const f = fingers[name];
                    if (!f) return null;
                    const color = FINGER_COLOR[name];
                    const lengthPct = f.length === 'Long' ? 100 : f.length === 'Medium' ? 60 : 25;
                    return (
                      <div key={name} className="rounded-lg p-2 flex flex-col items-center gap-1.5" style={{ background: '#111', border: `1px solid ${color}22` }}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black" style={{ background: color }}>
                          {FINGER_LABEL[name]}
                        </div>
                        <p className="text-[10px] font-semibold capitalize" style={{ color }}>{name}</p>
                        <div className="w-full rounded-full h-1" style={{ background: '#222' }}>
                          <div className="h-1 rounded-full" style={{ width: `${lengthPct}%`, background: color }} />
                        </div>
                        <p className="text-[9px] text-center leading-tight" style={{ color: '#5a5a5a' }}>{f.length}</p>
                        {f.flexibility && <p className="text-[9px]" style={{ color: f.flexibility === 'High' ? '#4ade80' : f.flexibility === 'Low' ? '#f87171' : '#c9a96e' }}>{f.flexibility} flex</p>}
                        {f.straightness && <p className="text-[9px]" style={{ color: '#5a5a5a' }}>{f.straightness}</p>}
                        {f.independence && <p className="text-[9px]" style={{ color: f.independence === 'High' ? '#4ade80' : f.independence === 'Low' ? '#f87171' : '#c9a96e' }}>{f.independence} indep</p>}
                        {f.reach && <p className="text-[9px]" style={{ color: f.reach === 'Strong' ? '#4ade80' : f.reach === 'Weak' ? '#f87171' : '#c9a96e' }}>{f.reach}</p>}
                        {f.note && <p className="text-[9px] text-center leading-tight mt-0.5" style={{ color: '#3a3a3a' }}>{f.note}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Overall span / splay */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg px-3 py-2" style={{ background: '#111', border: '1px solid #1e1e1e' }}>
                <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#3a3a3a' }}>Overall Span</p>
                <p className="text-sm font-bold" style={{ color: '#f0ede8' }}>{bp.absolute_span_assessment}</p>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: '#111', border: '1px solid #1e1e1e' }}>
                <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#3a3a3a' }}>Splay / Flexibility</p>
                <p className="text-sm font-bold" style={{ color: '#f0ede8' }}>{bp.inferred_flexibility_splay}</p>
              </div>
            </div>

            {/* Grades */}
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: '#3a3a3a' }}>Chord Capability Grades</p>
              {report.chord_capability_grades.map((g) => (
                <div key={g.grade_level} className="rounded-lg p-3" style={{ background: '#111', border: `1px solid ${STATUS_COLOR[g.status]}22` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span>{STATUS_ICON[g.status]}</span>
                    <span className="text-sm font-bold" style={{ color: STATUS_COLOR[g.status] }}>{g.grade_level}</span>
                    <span className="text-xs" style={{ color: '#5a5a5a' }}>{g.status}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {g.supported_voicings.map(v => (
                      <span key={v} className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: `${STATUS_COLOR[g.status]}15`, color: STATUS_COLOR[g.status] }}>{v}</span>
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: '#4a4a4a' }}>{g.anatomical_reasoning}</p>
                </div>
              ))}
            </div>

            {/* Recommended focus */}
            <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <p className="text-xs font-semibold mb-1" style={{ color: '#818cf8' }}>Recommended Focus</p>
              <p className="text-sm" style={{ color: '#d0cdc8' }}>{report.recommended_focus}</p>
            </div>

          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function HandProfileSetup({ profile, onSave, onSaveAIFingers, saveError, lang }) {
  const tr = useT(lang);
  const [local, setLocal] = useState({ ...DEFAULT_PROFILE, ...profile });
  const [saved, setSaved] = useState(false);
  const [showCamera, setShowCamera]   = useState(false);
  const [showAICamera, setShowAICamera] = useState(false);

  // Sync when profile loads from server after login
  useEffect(() => {
    setLocal({ ...DEFAULT_PROFILE, ...profile });
  }, [profile]);

  const handleChange = useCallback((key, val) => {
    setLocal(prev => ({ ...prev, [key]: val }));
    setSaved(false);
  }, []);

  const handleSave = () => {
    onSave(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCameraMeasured = useCallback((measurements) => {
    setLocal(prev => ({ ...prev, ...measurements }));
    setShowCamera(false);
    setSaved(false);
  }, []);

  const ability = abilityLabel(local);
  const m = reachMultiplier(local);
  const levelColor = m >= 0.95 ? '#4ade80' : m >= 0.87 ? '#38bdf8' : m >= 0.78 ? '#c9a96e' : m >= 0.68 ? '#fb923c' : '#f87171';

  // Flexibility — how well fingers splay relative to their span (size-independent).
  const flex = flexibilityScore(local);
  const flexInfo = flexibilityLabel(local);
  const flexColor = flex >= 7.5 ? '#4ade80' : flex >= 5.5 ? '#38bdf8' : flex >= 3.5 ? '#c9a96e' : '#f87171';

  return (
    <div className="p-3 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold mb-1 text-ink">{tr.handProfile}</h2>
          <p className="text-sm text-ink-faint">{tr.handProfileDesc}</p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={() => { setShowCamera(v => !v); setShowAICamera(false); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${showCamera ? 'text-brand' : 'bg-surface-750 text-ink-subtle border-surface-650'}`}
            style={showCamera
              ? { background: 'rgba(201,169,110,0.12)', borderColor: 'rgba(201,169,110,0.25)' }
              : undefined}
          >
            <span>📷</span>
            <span>{showCamera ? tr.hideCamera : tr.measureWithCamera}</span>
          </button>
          <button
            onClick={() => { setShowAICamera(v => !v); setShowCamera(false); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${showAICamera ? '' : 'bg-surface-750 text-ink-subtle border-surface-650'}`}
            style={showAICamera
              ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.3)' }
              : undefined}
          >
            <span>🤖</span>
            <span>{showAICamera ? 'Hide AI Analysis' : 'AI Hand Analysis'}</span>
          </button>
        </div>
      </div>

      {/* Camera measurement panel */}
      {showCamera && (
        <div className="mb-6">
          <CameraHandMeasure onMeasured={handleCameraMeasured} lang={lang} />
        </div>
      )}

      {/* AI hand analysis panel */}
      {showAICamera && (
        <div className="mb-6">
          <AIHandAnalysis lang={lang} onMeasured={(measurements, fingers) => {
            setLocal(prev => ({ ...prev, ...measurements }));
            setSaved(false);
            onSave({ ...local, ...measurements });
            if (fingers && onSaveAIFingers) onSaveAIFingers(fingers);
          }} />
        </div>
      )}

      {/* Summary card */}
      <div className="flex flex-col sm:flex-row gap-4 items-center mb-6 p-4 rounded-xl bg-surface-750 border border-surface-650">
        <HandDiagram profile={local} />
        <div className="flex-1 text-center sm:text-left">
          <p className="text-xs uppercase tracking-widest mb-1 text-ink-ghost">{tr.reachAssessment}</p>
          <p className="text-2xl font-bold mb-1" style={{ color: levelColor }}>{ability.label}</p>
          <p className="text-sm mb-4 text-ink-faint">{ability.desc}</p>
          <div className="w-full max-w-xs rounded-full h-1.5 bg-surface-650">
            <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.round(m * 100)}%`, background: levelColor }} />
          </div>

          {/* Flexibility — finger spread relative to span (independent of hand size) */}
          <div className="mt-4 pt-4 border-t border-surface-650">
            <p className="text-xs uppercase tracking-widest mb-1 text-ink-ghost">
              {tr.flexibilityAssessment || 'Finger flexibility'}
            </p>
            <div className="flex items-baseline gap-2 mb-1 justify-center sm:justify-start">
              <p className="text-lg font-bold" style={{ color: flexColor }}>{flexInfo.label}</p>
              <span className="text-xs tabular-nums text-ink-faint">{flex.toFixed(1)}/10</span>
            </div>
            <p className="text-xs mb-2 text-ink-faint">{flexInfo.desc}</p>
            <div className="w-full max-w-xs rounded-full h-1.5 bg-surface-650">
              <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.round((flex / 10) * 100)}%`, background: flexColor }} />
            </div>
          </div>
        </div>
      </div>

      {/* Reference image */}
      <div className="mb-5 rounded-xl overflow-hidden border border-surface-700">
        <img src="/hand-span-diagram.jpg" alt="Hand span diagram" className="w-full object-cover" />
      </div>

      {/* How to measure */}
      <div className="flex gap-3 rounded-xl px-4 py-3 mb-5 text-xs text-brand"
        style={{ background: 'rgba(201,169,110,0.06)', border: '1px solid rgba(201,169,110,0.12)' }}>
        <span className="text-base leading-none mt-0.5 shrink-0">📏</span>
        <span><strong>{tr.howToMeasure}</strong> {tr.howToMeasureDesc}</span>
      </div>

      {/* Sliders */}
      <div className="space-y-3 mb-6">
        {GAPS.map(gap => (
          <GapSlider key={gap.key} gap={gap} value={local[gap.key]} onChange={handleChange} tr={tr} />
        ))}
      </div>

      {/* Reach level */}
      <GuitarReachLevel profile={local} tr={tr} />

      {/* Save */}
      <div className="mt-6 flex flex-col items-end gap-2">
        {saveError && (
          <p className="text-xs text-danger">{tr.failedToSave}</p>
        )}
        <button
          onClick={handleSave}
          className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${saved ? 'text-success' : 'bg-brand text-surface-base'}`}
          style={saved ? { background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)' } : undefined}
        >
          {saved ? tr.saved : tr.saveProfile}
        </button>
      </div>
    </div>
  );
}

import { useState, useCallback, useRef } from 'react';

// Standard tuning: E2 A2 D3 G3 B3 E4
const OPEN_HZ   = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
const STRING_NAMES  = ['E', 'A', 'D', 'G', 'B', 'e'];
const NOTE_NAMES    = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const STRING_COLORS = ['#a78bfa','#38bdf8','#34d399','#c9a96e','#fb923c','#f87171'];
const STRING_THICK  = [3.5, 3.0, 2.5, 2.0, 1.5, 1.0]; // visual thickness px

const FRET_COUNT = 12;

function fretHz(stringIdx, fret) {
  return OPEN_HZ[stringIdx] * 2 ** (fret / 12);
}

function noteNameAt(stringIdx, fret) {
  // E2 = midi 40, A2=45, D3=50, G3=55, B3=59, E4=64
  const openMidi = [40, 45, 50, 55, 59, 64];
  const midi = openMidi[stringIdx] + fret;
  return NOTE_NAMES[midi % 12];
}

// ── Audio engine ──────────────────────────────────────────────────────────────

let _ctx = null;
function getCtx() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
    const comp = _ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.25;
    comp.connect(_ctx.destination);
    _ctx._out = comp;
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function pluckNote(hz, decay = 2.2) {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const env = ctx.createGain();
  env.connect(ctx._out);
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.28, now + 0.003);
  env.gain.exponentialRampToValueAtTime(0.001, now + decay);

  [
    [1, 'triangle', 0.55],
    [2, 'sine',     0.26],
    [3, 'sine',     0.12],
    [4, 'sine',     0.07],
  ].forEach(([h, type, amp]) => {
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz * h;
    g.gain.value = amp;
    osc.connect(g);
    g.connect(env);
    osc.start(now);
    osc.stop(now + decay + 0.1);
  });
}

function strumNotes(frets) {
  // frets: array of 6 values, null = muted
  const ctx = getCtx();
  frets.forEach((fret, s) => {
    if (fret === null) return;
    const hz = fretHz(s, fret);
    const decay = 2.0 - s * 0.05;
    const delay = s * 0.018; // low→high strum
    const now = ctx.currentTime + delay;

    const env = ctx.createGain();
    env.connect(ctx._out);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, now + decay);

    [[1,'triangle',0.55],[2,'sine',0.26],[3,'sine',0.12],[4,'sine',0.07]].forEach(([h,type,amp]) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = type;
      osc.frequency.value = hz * h;
      g.gain.value = amp;
      osc.connect(g);
      g.connect(env);
      osc.start(now);
      osc.stop(now + decay + 0.1);
    });
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GuitarStrings() {
  // selected fret per string: 0 = open, null = muted
  const [selected, setSelected] = useState([0, 0, 0, 0, 0, 0]);
  const [ripple, setRipple]     = useState({}); // { `${s}-${f}`: timestamp }
  const [strumming, setStrumming] = useState(false);
  const strumTimer = useRef(null);

  const triggerRipple = useCallback((s, f) => {
    const key = `${s}-${f}`;
    setRipple(r => ({ ...r, [key]: Date.now() }));
    setTimeout(() => setRipple(r => { const n = {...r}; delete n[key]; return n; }), 500);
  }, []);

  const handleFretClick = useCallback((stringIdx, fret) => {
    setSelected(prev => {
      const next = [...prev];
      // clicking the already-selected fret toggles to muted
      next[stringIdx] = prev[stringIdx] === fret ? null : fret;
      return next;
    });
    triggerRipple(stringIdx, fret);
    pluckNote(fretHz(stringIdx, fret));
  }, [triggerRipple]);

  const handleOpenClick = useCallback((stringIdx) => {
    setSelected(prev => {
      const next = [...prev];
      next[stringIdx] = prev[stringIdx] === 0 ? null : 0;
      return next;
    });
    triggerRipple(stringIdx, 0);
    pluckNote(fretHz(stringIdx, 0), 2.6);
  }, [triggerRipple]);

  const handleStrum = useCallback(() => {
    strumNotes(selected);
    setStrumming(true);
    if (strumTimer.current) clearTimeout(strumTimer.current);
    strumTimer.current = setTimeout(() => setStrumming(false), 300);
  }, [selected]);

  const handleMuteAll = useCallback(() => {
    setSelected([null, null, null, null, null, null]);
  }, []);

  const handleOpenAll = useCallback(() => {
    setSelected([0, 0, 0, 0, 0, 0]);
    strumNotes([0, 0, 0, 0, 0, 0]);
  }, []);

  const activeCount = selected.filter(f => f !== null).length;

  return (
    <div className="p-3 sm:p-5 select-none">

      {/* Header */}
      <div className="mb-4">
        <h2 className="text-base sm:text-lg font-bold mb-0.5" style={{ color: '#f0ede8' }}>
          Guitar Strings
        </h2>
        <p className="text-xs" style={{ color: '#5a5a5a' }}>
          Tap a fret to select &amp; hear it. Tap the string name to play open. Hit Strum to play all selected strings.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <button
          onClick={handleStrum}
          disabled={activeCount === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
          style={activeCount > 0
            ? { background: strumming ? '#b8913a' : '#c9a96e', color: '#0f0f0f', transform: strumming ? 'scale(0.97)' : 'scale(1)' }
            : { background: '#1a1a1a', color: '#3a3a3a', cursor: 'not-allowed' }}
        >
          🎸 Strum
          {activeCount > 0 && <span className="text-xs font-normal opacity-70">({activeCount} strings)</span>}
        </button>
        <button
          onClick={handleOpenAll}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: '#1a1a1a', color: '#7a7a7a', border: '1px solid #222' }}
        >
          All Open
        </button>
        <button
          onClick={handleMuteAll}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: '#1a1a1a', color: '#7a7a7a', border: '1px solid #222' }}
        >
          Mute All
        </button>
      </div>

      {/* Fretboard */}
      <div className="rounded-2xl overflow-hidden" style={{ background: '#1a1010', border: '1px solid #2a1a1a' }}>

        {/* Fret number header */}
        <div className="flex" style={{ borderBottom: '1px solid #2a2a2a' }}>
          {/* String label column */}
          <div className="shrink-0" style={{ width: 44 }} />
          {/* Open column */}
          <div className="flex items-center justify-center text-xs font-semibold py-2"
            style={{ width: 40, color: '#3a3a3a' }}>
            O
          </div>
          {/* Fret columns */}
          {Array.from({ length: FRET_COUNT }, (_, f) => (
            <div key={f} className="flex-1 flex items-center justify-center text-xs py-2"
              style={{ color: [3,5,7,9,12].includes(f+1) ? '#c9a96e' : '#2a2a2a', fontWeight: [3,5,7,9,12].includes(f+1) ? 700 : 400, minWidth: 0 }}>
              {f + 1}
            </div>
          ))}
        </div>

        {/* Strings */}
        {[0,1,2,3,4,5].map(s => {
          const sel = selected[s]; // null | 0..FRET_COUNT
          const isMuted = sel === null;

          return (
            <div key={s} className="flex items-center relative"
              style={{ borderBottom: s < 5 ? '1px solid #1e1010' : 'none', minHeight: 52 }}>

              {/* String name + mute indicator */}
              <button
                onClick={() => handleOpenClick(s)}
                className="shrink-0 flex flex-col items-center justify-center gap-0.5 transition-all"
                style={{ width: 44, height: 52 }}
                title={`Play ${STRING_NAMES[s]} open`}
              >
                <span className="text-sm font-black leading-none" style={{ color: isMuted ? '#2a2a2a' : STRING_COLORS[s] }}>
                  {STRING_NAMES[s]}
                </span>
                {isMuted && <span className="text-xs leading-none" style={{ color: '#3a3a3a' }}>✕</span>}
              </button>

              {/* Open string dot */}
              <div className="flex items-center justify-center shrink-0" style={{ width: 40, height: 52 }}>
                <button
                  onClick={() => handleOpenClick(s)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={sel === 0
                    ? { background: STRING_COLORS[s], color: '#0f0f0f', boxShadow: `0 0 10px ${STRING_COLORS[s]}66` }
                    : { background: '#1e1e1e', color: '#3a3a3a', border: '1px solid #2a2a2a' }}
                  title={`${STRING_NAMES[s]}2 open — ${noteNameAt(s, 0)}`}
                >
                  {noteNameAt(s, 0)}
                </button>
              </div>

              {/* The string line (drawn behind fret buttons) */}
              <div className="absolute pointer-events-none"
                style={{
                  left: 84, right: 0, top: '50%',
                  height: STRING_THICK[s],
                  transform: 'translateY(-50%)',
                  background: isMuted
                    ? '#1e1e1e'
                    : `linear-gradient(to right, ${STRING_COLORS[s]}cc, ${STRING_COLORS[s]}44)`,
                  borderRadius: 9999,
                  opacity: isMuted ? 0.3 : 1,
                }}
              />

              {/* Fret buttons */}
              {Array.from({ length: FRET_COUNT }, (_, f) => {
                const fretNum = f + 1;
                const isSelected = sel === fretNum;
                const rippleKey = `${s}-${fretNum}`;
                const hasRipple = !!ripple[rippleKey];
                const isDot = [3,5,7,9,12].includes(fretNum);

                return (
                  <div key={f} className="flex-1 flex items-center justify-center relative" style={{ minWidth: 0, height: 52 }}>
                    {/* Fret wire */}
                    <div className="absolute left-0 top-0 bottom-0 pointer-events-none"
                      style={{ width: 1.5, background: '#3a2a2a', opacity: 0.6 }} />

                    <button
                      onClick={() => handleFretClick(s, fretNum)}
                      className="relative z-10 flex items-center justify-center rounded-full transition-all text-xs font-bold"
                      style={{
                        width: 28, height: 28,
                        background: isSelected
                          ? STRING_COLORS[s]
                          : isDot ? '#1e1616' : 'transparent',
                        color: isSelected ? '#0f0f0f' : isDot ? '#3a3a3a' : 'transparent',
                        boxShadow: isSelected ? `0 0 12px ${STRING_COLORS[s]}88` : 'none',
                        transform: hasRipple ? 'scale(1.25)' : isSelected ? 'scale(1.1)' : 'scale(1)',
                        border: isSelected ? 'none' : isDot ? '1px solid #2a2020' : 'none',
                      }}
                      title={`${STRING_NAMES[s]} fret ${fretNum} — ${noteNameAt(s, fretNum)}`}
                    >
                      {isSelected ? noteNameAt(s, fretNum) : isDot ? '·' : ''}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Fret position markers (dots) */}
        <div className="flex" style={{ borderTop: '1px solid #1e1010' }}>
          <div style={{ width: 84 }} />
          {Array.from({ length: FRET_COUNT }, (_, f) => {
            const fretNum = f + 1;
            const isDot   = [3,5,7,9].includes(fretNum);
            const isDouble = fretNum === 12;
            return (
              <div key={f} className="flex-1 flex items-center justify-center py-2" style={{ minWidth: 0 }}>
                {isDouble ? (
                  <div className="flex gap-0.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#c9a96e55' }} />
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#c9a96e55' }} />
                  </div>
                ) : isDot ? (
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#c9a96e55' }} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active chord info */}
      {activeCount > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <span className="text-xs" style={{ color: '#3a3a3a' }}>Playing:</span>
          {[0,1,2,3,4,5].map(s => {
            const f = selected[s];
            if (f === null) return (
              <span key={s} className="text-xs px-2 py-1 rounded-lg font-semibold"
                style={{ background: '#141414', color: '#2a2a2a' }}>
                {STRING_NAMES[s]} ✕
              </span>
            );
            return (
              <span key={s} className="text-xs px-2 py-1 rounded-lg font-semibold"
                style={{ background: `${STRING_COLORS[s]}18`, color: STRING_COLORS[s], border: `1px solid ${STRING_COLORS[s]}33` }}>
                {STRING_NAMES[s]}{f === 0 ? ' open' : ` fret ${f}`} · {noteNameAt(s, f)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

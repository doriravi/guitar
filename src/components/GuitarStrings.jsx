import { useState, useCallback, useRef, useMemo } from 'react';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import DifficultyBadge from './DifficultyBadge';

// ── Constants ─────────────────────────────────────────────────────────────────

const OPEN_HZ      = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
const OPEN_MIDI    = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];
const NOTE_NAMES   = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_FLAT    = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const STRING_COLORS= ['#a78bfa','#38bdf8','#34d399','#c9a96e','#fb923c','#f87171'];
const STRING_THICK = [3.5, 3.0, 2.5, 2.0, 1.5, 1.0];
const FRET_COUNT   = 12;
const MARKER_FRETS = [3,5,7,9,12];

// ── Scale definitions ─────────────────────────────────────────────────────────

const SCALE_TYPES = {
  'Major':           [0,2,4,5,7,9,11],
  'Natural Minor':   [0,2,3,5,7,8,10],
  'Pentatonic Major':[0,2,4,7,9],
  'Pentatonic Minor':[0,3,5,7,10],
  'Blues':           [0,3,5,6,7,10],
  'Dorian':          [0,2,3,5,7,9,10],
  'Mixolydian':      [0,2,4,5,7,9,10],
  'Phrygian':        [0,1,3,5,7,8,10],
  'Lydian':          [0,2,4,6,7,9,11],
  'Harmonic Minor':  [0,2,3,5,7,8,11],
  'Melodic Minor':   [0,2,3,5,7,9,11],
  'Whole Tone':      [0,2,4,6,8,10],
  'Diminished':      [0,2,3,5,6,8,9,11],
};

const ROOTS = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

const NOTE_TO_SEMITONE = {
  C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11
};

function noteDisplayName(semitone) {
  // prefer sharp names except for Eb, Ab, Bb
  return NOTE_NAMES[((semitone % 12) + 12) % 12];
}

function semitoneAt(stringIdx, fret) {
  return (OPEN_MIDI[stringIdx] + fret) % 12;
}

// ── Audio ─────────────────────────────────────────────────────────────────────

let _ctx = null;
function getCtx() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
    const comp = _ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 5;
    comp.attack.value = 0.002;  comp.release.value = 0.25;
    comp.connect(_ctx.destination);
    _ctx._out = comp;
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function pluck(hz, decay = 2.2) {
  const ctx = getCtx();
  const now = ctx.currentTime;
  const env = ctx.createGain();
  env.connect(ctx._out);
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.28, now + 0.003);
  env.gain.exponentialRampToValueAtTime(0.001, now + decay);
  [[1,'triangle',0.55],[2,'sine',0.26],[3,'sine',0.12],[4,'sine',0.07]].forEach(([h,t,a]) => {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = t; osc.frequency.value = hz * h; g.gain.value = a;
    osc.connect(g); g.connect(env); osc.start(now); osc.stop(now + decay + 0.1);
  });
}

function strum(frets) {
  const ctx = getCtx();
  frets.forEach((fret, s) => {
    if (fret === null) return;
    const hz = OPEN_HZ[s] * 2 ** (fret / 12);
    const decay = 2.0 - s * 0.05;
    const now = ctx.currentTime + s * 0.018;
    const env = ctx.createGain();
    env.connect(ctx._out);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, now + decay);
    [[1,'triangle',0.55],[2,'sine',0.26],[3,'sine',0.12],[4,'sine',0.07]].forEach(([h,t,a]) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = t; osc.frequency.value = hz * h; g.gain.value = a;
      osc.connect(g); g.connect(env); osc.start(now); osc.stop(now + decay + 0.1);
    });
  });
}

// ── Chord voicing from tab ────────────────────────────────────────────────────

function tabToFrets(tab) {
  return tab.split('').map(c => (c === 'x' ? null : parseInt(c, 10)));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModeBar({ mode, setMode }) {
  const modes = [
    { id: 'play',   label: 'Play',   icon: '🎸' },
    { id: 'scale',  label: 'Scale',  icon: '🎵' },
    { id: 'chord',  label: 'Chords', icon: '🎼' },
    { id: 'editor', label: 'Editor', icon: '🎹' },
  ];
  return (
    <div className="flex gap-1 p-1 rounded-xl mb-4" style={{ background: '#161616' }}>
      {modes.map(m => (
        <button key={m.id} onClick={() => setMode(m.id)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
          style={mode === m.id
            ? { background: '#1e1e1e', color: '#c9a96e', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
            : { color: '#5a5a5a' }}>
          <span>{m.icon}</span><span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Fretboard ─────────────────────────────────────────────────────────────────
// Shared visual component used by all three modes.
// dotStyle(s, f) → null | { bg, color, glow, label }

function Fretboard({ dotStyle, onFretClick, onOpenClick }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#1a1010', border: '1px solid #2a1a1a' }}>
      {/* Fret number header */}
      <div className="flex" style={{ borderBottom: '1px solid #2a2a2a' }}>
        <div style={{ width: 44 }} className="shrink-0" />
        <div className="flex items-center justify-center text-xs font-semibold py-2 shrink-0"
          style={{ width: 40, color: '#3a3a3a' }}>O</div>
        {Array.from({ length: FRET_COUNT }, (_, f) => (
          <div key={f} className="flex-1 flex items-center justify-center text-xs py-2"
            style={{ minWidth: 0, color: MARKER_FRETS.includes(f+1) ? '#c9a96e' : '#2a2a2a', fontWeight: MARKER_FRETS.includes(f+1) ? 700 : 400 }}>
            {f+1}
          </div>
        ))}
      </div>

      {/* Strings */}
      {[0,1,2,3,4,5].map(s => {
        const openDot = dotStyle(s, 0);
        return (
          <div key={s} className="flex items-center relative"
            style={{ borderBottom: s < 5 ? '1px solid #1e1010' : 'none', minHeight: 52 }}>

            {/* String label */}
            <button onClick={() => onOpenClick?.(s)}
              className="shrink-0 flex items-center justify-center"
              style={{ width: 44, height: 52 }}>
              <span className="text-sm font-black" style={{ color: STRING_COLORS[s] }}>
                {STRING_NAMES[s]}
              </span>
            </button>

            {/* Open fret dot */}
            <div className="flex items-center justify-center shrink-0" style={{ width: 40, height: 52 }}>
              <button onClick={() => onOpenClick?.(s)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                style={openDot
                  ? { background: openDot.bg, color: openDot.color, boxShadow: openDot.glow }
                  : { background: '#1e1e1e', color: '#3a3a3a', border: '1px solid #2a2a2a' }}>
                {openDot?.label ?? NOTE_NAMES[(OPEN_MIDI[s]) % 12]}
              </button>
            </div>

            {/* String line */}
            <div className="absolute pointer-events-none"
              style={{ left: 84, right: 0, top: '50%', height: STRING_THICK[s],
                transform: 'translateY(-50%)',
                background: `linear-gradient(to right, ${STRING_COLORS[s]}cc, ${STRING_COLORS[s]}33)`,
                borderRadius: 9999 }} />

            {/* Fret buttons */}
            {Array.from({ length: FRET_COUNT }, (_, f) => {
              const fretNum = f + 1;
              const dot = dotStyle(s, fretNum);
              const isMark = MARKER_FRETS.includes(fretNum);
              return (
                <div key={f} className="flex-1 flex items-center justify-center relative"
                  style={{ minWidth: 0, height: 52 }}>
                  <div className="absolute left-0 top-0 bottom-0 pointer-events-none"
                    style={{ width: 1.5, background: '#3a2a2a', opacity: 0.6 }} />
                  <button onClick={() => onFretClick?.(s, fretNum)}
                    className="relative z-10 flex items-center justify-center rounded-full transition-all text-xs font-bold"
                    style={{
                      width: 28, height: 28,
                      background: dot ? dot.bg : isMark ? '#1e1616' : 'transparent',
                      color: dot ? dot.color : isMark ? '#3a3a3a' : 'transparent',
                      boxShadow: dot?.glow ?? 'none',
                      transform: dot ? 'scale(1.05)' : 'scale(1)',
                      border: dot ? 'none' : isMark ? '1px solid #2a2020' : 'none',
                    }}>
                    {dot?.label ?? (isMark ? '·' : '')}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Bottom position markers */}
      <div className="flex" style={{ borderTop: '1px solid #1e1010' }}>
        <div style={{ width: 84 }} />
        {Array.from({ length: FRET_COUNT }, (_, f) => {
          const fn = f + 1;
          return (
            <div key={f} className="flex-1 flex items-center justify-center py-2" style={{ minWidth: 0 }}>
              {fn === 12 ? (
                <div className="flex gap-0.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#c9a96e55' }} />
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#c9a96e55' }} />
                </div>
              ) : [3,5,7,9].includes(fn) ? (
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#c9a96e55' }} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MODE: PLAY ────────────────────────────────────────────────────────────────

function PlayMode() {
  const [selected, setSelected] = useState([0, 0, 0, 0, 0, 0]);
  const [ripple, setRipple]     = useState({});
  const [strumming, setStrumming] = useState(false);
  const strumTimer = useRef(null);

  const fire = useCallback((s, f) => {
    const key = `${s}-${f}`;
    setRipple(r => ({ ...r, [key]: 1 }));
    setTimeout(() => setRipple(r => { const n={...r}; delete n[key]; return n; }), 400);
  }, []);

  const handleFret = useCallback((s, f) => {
    setSelected(p => { const n=[...p]; n[s] = p[s]===f ? null : f; return n; });
    fire(s, f);
    pluck(OPEN_HZ[s] * 2 ** (f / 12));
  }, [fire]);

  const handleOpen = useCallback((s) => {
    setSelected(p => { const n=[...p]; n[s] = p[s]===0 ? null : 0; return n; });
    fire(s, 0);
    pluck(OPEN_HZ[s], 2.6);
  }, [fire]);

  const handleStrum = () => {
    strum(selected);
    setStrumming(true);
    clearTimeout(strumTimer.current);
    strumTimer.current = setTimeout(() => setStrumming(false), 300);
  };

  const activeCount = selected.filter(f => f !== null).length;

  const dotStyle = useCallback((s, f) => {
    const sel = selected[s];
    if (sel !== f) return null;
    const hasRipple = !!ripple[`${s}-${f}`];
    return {
      bg: STRING_COLORS[s],
      color: '#0f0f0f',
      glow: `0 0 12px ${STRING_COLORS[s]}88`,
      label: NOTE_NAMES[semitoneAt(s, f)],
      scale: hasRipple ? 1.3 : 1.1,
    };
  }, [selected, ripple]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={handleStrum} disabled={activeCount === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
          style={activeCount > 0
            ? { background: strumming ? '#b8913a' : '#c9a96e', color: '#0f0f0f', transform: strumming ? 'scale(0.97)' : 'scale(1)' }
            : { background: '#1a1a1a', color: '#3a3a3a', cursor: 'not-allowed' }}>
          🎸 Strum {activeCount > 0 && <span className="text-xs font-normal opacity-70">({activeCount})</span>}
        </button>
        <button onClick={() => { setSelected([0,0,0,0,0,0]); strum([0,0,0,0,0,0]); }}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: '#1a1a1a', color: '#7a7a7a', border: '1px solid #222' }}>
          All Open
        </button>
        <button onClick={() => setSelected([null,null,null,null,null,null])}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: '#1a1a1a', color: '#7a7a7a', border: '1px solid #222' }}>
          Mute All
        </button>
      </div>

      <Fretboard dotStyle={dotStyle} onFretClick={handleFret} onOpenClick={handleOpen} />

      {activeCount > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <span className="text-xs" style={{ color: '#3a3a3a' }}>Playing:</span>
          {[0,1,2,3,4,5].map(s => {
            const f = selected[s];
            if (f === null) return null;
            return (
              <span key={s} className="text-xs px-2 py-1 rounded-lg font-semibold"
                style={{ background: `${STRING_COLORS[s]}18`, color: STRING_COLORS[s], border: `1px solid ${STRING_COLORS[s]}33` }}>
                {STRING_NAMES[s]}{f === 0 ? ' open' : ` fr.${f}`} · {NOTE_NAMES[semitoneAt(s,f)]}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MODE: SCALE ───────────────────────────────────────────────────────────────

function ScaleMode() {
  const [root, setRoot]           = useState('C');
  const [scaleName, setScaleName] = useState('Major');

  const rootSemitone = NOTE_TO_SEMITONE[root] ?? 0;
  const intervals    = SCALE_TYPES[scaleName] ?? [];
  const scaleSet     = new Set(intervals.map(i => (rootSemitone + i) % 12));
  const rootPc       = rootSemitone % 12;

  // Compute the notes in the scale for display
  const scaleNotes = intervals.map(i => {
    const pc = (rootSemitone + i) % 12;
    return NOTE_NAMES[pc];
  });

  const dotStyle = useCallback((s, f) => {
    const pc = semitoneAt(s, f);
    if (!scaleSet.has(pc)) return null;
    const isRoot = pc === rootPc;
    return {
      bg: isRoot ? '#c9a96e' : `${STRING_COLORS[s]}33`,
      color: isRoot ? '#0f0f0f' : STRING_COLORS[s],
      glow: isRoot ? '0 0 14px #c9a96e88' : 'none',
      label: NOTE_NAMES[pc],
    };
  }, [scaleSet, rootPc]);

  const handleFret = useCallback((s, f) => {
    const pc = semitoneAt(s, f);
    if (scaleSet.has(pc)) pluck(OPEN_HZ[s] * 2 ** (f / 12));
  }, [scaleSet]);

  const handleOpen = useCallback((s) => {
    const pc = semitoneAt(s, 0);
    if (scaleSet.has(pc)) pluck(OPEN_HZ[s], 2.6);
  }, [scaleSet]);

  // Play scale ascending
  const playScale = useCallback(() => {
    const ctx = getCtx();
    // Collect scale notes on string 1 (A) across frets 0-12
    const notes = [];
    for (let f = 0; f <= FRET_COUNT; f++) {
      const pc = semitoneAt(1, f);
      if (scaleSet.has(pc)) notes.push({ s: 1, f });
    }
    notes.forEach(({ s, f }, i) => {
      const hz = OPEN_HZ[s] * 2 ** (f / 12);
      const t  = ctx.currentTime + i * 0.35;
      const env = ctx.createGain();
      env.connect(ctx._out);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.2, t + 0.003);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      [[1,'triangle',0.55],[2,'sine',0.26]].forEach(([h,tp,a]) => {
        const osc = ctx.createOscillator(); const g = ctx.createGain();
        osc.type = tp; osc.frequency.value = hz * h; g.gain.value = a;
        osc.connect(g); g.connect(env); osc.start(t); osc.stop(t + 0.7);
      });
    });
  }, [scaleSet]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5a5a5a' }}>Root</label>
          <div className="flex flex-wrap gap-1">
            {ROOTS.map(r => (
              <button key={r} onClick={() => setRoot(r)}
                className="px-2 py-1 rounded-lg text-xs font-bold transition-all"
                style={root === r
                  ? { background: '#c9a96e', color: '#0f0f0f' }
                  : { background: '#1a1a1a', color: '#5a5a5a', border: '1px solid #222' }}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5a5a5a' }}>Scale</label>
          <div className="flex flex-wrap gap-1">
            {Object.keys(SCALE_TYPES).map(sn => (
              <button key={sn} onClick={() => setScaleName(sn)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                style={scaleName === sn
                  ? { background: '#c9a96e', color: '#0f0f0f' }
                  : { background: '#1a1a1a', color: '#5a5a5a', border: '1px solid #222' }}>
                {sn}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scale info + play button */}
      <div className="flex items-center justify-between gap-3 mb-4 px-3 py-2.5 rounded-xl"
        style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <div>
          <p className="text-xs font-bold mb-1" style={{ color: '#c9a96e' }}>
            {root} {scaleName}
          </p>
          <p className="text-xs font-mono" style={{ color: '#5a5a5a' }}>
            {scaleNotes.join('  ·  ')}
          </p>
        </div>
        <button onClick={playScale}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: '#252525', color: '#c9a96e', border: '1px solid #2a2a2a' }}>
          ▶ Play
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-xs mb-3" style={{ color: '#3a3a3a' }}>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full inline-block" style={{ background: '#c9a96e' }} />
          Root note
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full inline-block" style={{ background: `${STRING_COLORS[0]}44`, border: `1px solid ${STRING_COLORS[0]}` }} />
          Scale note (tap to hear)
        </span>
      </div>

      <Fretboard dotStyle={dotStyle} onFretClick={handleFret} onOpenClick={handleOpen} />
    </div>
  );
}

// ── MODE: CHORD FINDER ────────────────────────────────────────────────────────

// Group unique chord names from the CHORDS library
const CHORD_NAMES = (() => {
  const seen = new Set();
  const names = [];
  for (const c of CHORDS) {
    if (!seen.has(c.name)) { seen.add(c.name); names.push(c.name); }
  }
  return names;
})();

// Chord type groups for the selector
const CHORD_TYPE_GROUPS = [
  { label: 'Major',    match: t => /^Major/.test(t) || t === 'Maj 7' || t === 'Maj 7 (barre)' || t === 'Maj 9' || t === '6th' },
  { label: 'Minor',    match: t => /^Minor/.test(t) || t === 'Half-dim' },
  { label: '7th+',     match: t => /^Dom 7|^7sus|^7#9|^7b9|^13th|^9th|^Dom 9/.test(t) },
  { label: 'Sus',      match: t => /^Sus/.test(t) },
  { label: 'Other',    match: ()  => true },
];

function groupChordsByType(voicings) {
  const groups = CHORD_TYPE_GROUPS.map(g => ({ ...g, items: [] }));
  const assigned = new Set();
  for (const g of groups.slice(0, -1)) {
    for (const v of voicings) {
      if (!assigned.has(v) && g.match(v.type)) { g.items.push(v); assigned.add(v); }
    }
  }
  groups[groups.length - 1].items = voicings.filter(v => !assigned.has(v));
  return groups.filter(g => g.items.length > 0);
}

function ChordDiagram({ chord, isActive, onClick }) {
  const frets = tabToFrets(chord.tab);
  const activeFrets = frets.filter(f => f !== null);
  const minFret = activeFrets.length ? Math.min(...activeFrets.filter(f => f > 0)) : 1;
  const maxFret = activeFrets.length ? Math.max(...activeFrets) : 1;
  const spanFrets = Math.max(4, maxFret - (minFret > 1 ? minFret - 1 : 0) + 1);
  const startFret = minFret > 1 ? minFret - 1 : 0;
  const score = calcDifficulty(chord.notes);

  const W = 90, H = 110;
  const padL = 14, padR = 8, padT = 22, padB = 12;
  const fretW = (W - padL - padR) / Math.min(spanFrets, 4);
  const strH  = (H - padT - padB) / 5;

  return (
    <button
      onClick={onClick}
      className="rounded-xl p-2 transition-all flex flex-col items-center gap-1"
      style={{
        background: isActive ? 'rgba(201,169,110,0.1)' : '#141414',
        border: `1px solid ${isActive ? 'rgba(201,169,110,0.4)' : '#222'}`,
        minWidth: 100,
      }}
    >
      <p className="text-xs font-semibold" style={{ color: isActive ? '#c9a96e' : '#7a7a7a' }}>
        {chord.type}
      </p>
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        {/* Nut or fret marker */}
        {startFret === 0
          ? <line x1={padL} y1={padT} x2={padL} y2={padT + 5 * strH} stroke="#c9a96e" strokeWidth={3} strokeLinecap="round" />
          : <text x={padL - 4} y={padT + 2 * strH} textAnchor="end" fontSize={9} fill="#5a5a5a">{startFret + 1}</text>
        }
        {/* Fret wires */}
        {Array.from({ length: Math.min(spanFrets, 4) + 1 }, (_, i) => (
          <line key={i} x1={padL + i * fretW} y1={padT} x2={padL + i * fretW} y2={padT + 5 * strH}
            stroke="#2a2020" strokeWidth={1} />
        ))}
        {/* String lines */}
        {[0,1,2,3,4,5].map(s => (
          <line key={s} x1={padL} y1={padT + s * strH} x2={padL + Math.min(spanFrets, 4) * fretW} y2={padT + s * strH}
            stroke={STRING_COLORS[s]} strokeWidth={STRING_THICK[s] * 0.45} opacity={0.6} />
        ))}
        {/* Muted / open markers */}
        {frets.map((f, s) => f === null && (
          <text key={s} x={padL - 7} y={padT + s * strH + 3.5} textAnchor="middle" fontSize={8} fill="#3a3a3a">✕</text>
        ))}
        {frets.map((f, s) => f === 0 && (
          <circle key={s} cx={padL - 7} cy={padT + s * strH} r={3} fill="none" stroke="#5a5a5a" strokeWidth={1} />
        ))}
        {/* Fret dots */}
        {frets.map((f, s) => {
          if (f === null || f === 0) return null;
          const col = f - startFret;
          if (col < 1 || col > 4) return null;
          const cx = padL + (col - 0.5) * fretW;
          const cy = padT + s * strH;
          return (
            <g key={s}>
              <circle cx={cx} cy={cy} r={6} fill={STRING_COLORS[s]} opacity={0.9} />
              <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={7} fill="#0f0f0f" fontWeight="bold">
                {NOTE_NAMES[semitoneAt(s, f)]}
              </text>
            </g>
          );
        })}
      </svg>
      <DifficultyBadge score={score} />
    </button>
  );
}

function ChordFinderMode({ diffMax }) {
  const [search, setSearch]       = useState('');
  const [selectedName, setSelectedName] = useState('Am');
  const [activeVoicing, setActiveVoicing] = useState(null);

  // All voicings for selected chord name, filtered by difficulty
  const voicings = useMemo(() =>
    CHORDS.filter(c => c.name === selectedName && calcDifficulty(c.notes) <= diffMax).slice(0, 4),
    [selectedName, diffMax]
  );

  // Reset active voicing if it no longer passes the filter
  const activeVoicingValid = activeVoicing && calcDifficulty(activeVoicing.notes) <= diffMax;

  // Active voicing frets for the fretboard
  const activeFrets = useMemo(() => {
    if (!activeVoicingValid) return null;
    return tabToFrets(activeVoicing.tab);
  }, [activeVoicingValid, activeVoicing]);

  // When chord name changes, reset voicing
  const selectChord = useCallback((name) => {
    setSelectedName(name);
    setActiveVoicing(null);
  }, []);

  const selectVoicing = useCallback((v) => {
    setActiveVoicing(v);
    strum(tabToFrets(v.tab));
  }, []);

  // Chord names that have at least one voicing within the difficulty limit
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const names = q ? CHORD_NAMES.filter(n => n.toLowerCase().includes(q)) : CHORD_NAMES;
    return names.filter(name => CHORDS.some(c => c.name === name && calcDifficulty(c.notes) <= diffMax));
  }, [search, diffMax]);

  // Dot style: show the active voicing on the fretboard, greyed out if no voicing selected
  const dotStyle = useCallback((s, f) => {
    if (!activeFrets) return null;
    const expected = activeFrets[s];
    if (expected !== f) return null;
    if (f === null) return null;
    return {
      bg: STRING_COLORS[s],
      color: '#0f0f0f',
      glow: `0 0 12px ${STRING_COLORS[s]}88`,
      label: NOTE_NAMES[semitoneAt(s, f)],
    };
  }, [activeFrets]);

  const handleFret = useCallback((s, f) => {
    pluck(OPEN_HZ[s] * 2 ** (f / 12));
  }, []);

  const handleOpen = useCallback((s) => {
    pluck(OPEN_HZ[s], 2.6);
  }, []);

  return (
    <div>
      {/* Search + chord list */}
      <div className="mb-4">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search chord… e.g. Bm7, F#"
          className="w-full px-3 py-2 rounded-xl text-sm outline-none mb-3"
          style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f0ede8' }}
        />
        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
          {filtered.map(name => (
            <button key={name} onClick={() => selectChord(name)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
              style={selectedName === name
                ? { background: '#c9a96e', color: '#0f0f0f' }
                : { background: '#1a1a1a', color: '#7a7a7a', border: '1px solid #222' }}>
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Voicings */}
      {voicings.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3a3a3a' }}>
            {selectedName} — {voicings.length} voicing{voicings.length > 1 ? 's' : ''} · tap to show on fretboard
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {voicings.map((v, i) => (
              <ChordDiagram key={i} chord={v} isActive={activeVoicing === v} onClick={() => selectVoicing(v)} />
            ))}
          </div>
        </div>
      )}

      {voicings.length === 0 && selectedName && (
        <div className="mb-4 text-sm text-center py-6" style={{ color: '#3a3a3a' }}>
          No voicings for "{selectedName}" within difficulty ≤ {diffMax}
        </div>
      )}

      {/* Fretboard — shows selected voicing */}
      {activeVoicing ? (
        <>
          <p className="text-xs mb-2" style={{ color: '#3a3a3a' }}>
            Showing: <span style={{ color: '#c9a96e' }}>{activeVoicing.name} ({activeVoicing.type})</span>
            &nbsp;· Tab: <span className="font-mono" style={{ color: '#5a5a5a' }}>{activeVoicing.tab}</span>
          </p>
          <Fretboard dotStyle={dotStyle} onFretClick={handleFret} onOpenClick={handleOpen} />
        </>
      ) : (
        <div className="rounded-2xl flex items-center justify-center text-sm"
          style={{ background: '#141414', border: '1px dashed #2a2a2a', height: 120, color: '#3a3a3a' }}>
          Select a voicing above to see it on the fretboard
        </div>
      )}
    </div>
  );
}

// ── MODE: MUSIC EDITOR ───────────────────────────────────────────────────────

const EMPTY_BEAT = () => [null, null, null, null, null, null];

function ChordPicker({ onApply, diffMax }) {
  const [search, setSearch] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const names = q ? CHORD_NAMES.filter(n => n.toLowerCase().includes(q)) : CHORD_NAMES;
    return names.filter(name => CHORDS.some(c => c.name === name && calcDifficulty(c.notes) <= diffMax));
  }, [search, diffMax]);

  const voicings = useMemo(() =>
    selectedName ? CHORDS.filter(c => c.name === selectedName && calcDifficulty(c.notes) <= diffMax).slice(0, 4) : [],
    [selectedName, diffMax]
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
        style={{ background: '#1a1a1a', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)' }}>
        + Add chord
      </button>
    );
  }

  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: '#161616', border: '1px solid #2a2a2a' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#a78bfa' }}>Add chord to beat</span>
        <button onClick={() => { setOpen(false); setSelectedName(''); setSearch(''); }}
          className="text-xs" style={{ color: '#5a5a5a' }}>✕ close</button>
      </div>

      <input
        value={search} onChange={e => { setSearch(e.target.value); setSelectedName(''); }}
        placeholder="Search chord… e.g. Am, Bm7"
        className="w-full px-3 py-2 rounded-lg text-xs outline-none mb-2"
        style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f0ede8' }}
        autoFocus
      />

      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto mb-2">
        {filtered.slice(0, 40).map(name => (
          <button key={name} onClick={() => setSelectedName(name)}
            className="px-2 py-0.5 rounded-md text-xs font-semibold transition-all"
            style={selectedName === name
              ? { background: '#a78bfa', color: '#0f0f0f' }
              : { background: '#1e1e1e', color: '#7a7a7a', border: '1px solid #252525' }}>
            {name}
          </button>
        ))}
      </div>

      {voicings.length > 0 && (
        <div>
          <p className="text-[10px] mb-1.5" style={{ color: '#3a3a3a' }}>Pick voicing:</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {voicings.map((v, i) => (
              <button
                key={i}
                onClick={() => { onApply(v); setOpen(false); setSelectedName(''); setSearch(''); }}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all flex flex-col items-center gap-0.5"
                style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#a78bfa', minWidth: 70 }}>
                <span className="font-bold" style={{ color: '#f0ede8' }}>{v.name}</span>
                <span style={{ color: '#5a5a5a' }}>{v.type}</span>
                <span className="font-mono text-[10px]" style={{ color: '#3a3a3a' }}>{v.tab}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BeatCard({ beat, index, isActive, isEditing, onSelect, onDelete, onMove, total }) {
  const hasNotes = beat.frets.some(f => f !== null);
  return (
    <div
      className="rounded-xl p-2 flex flex-col gap-1.5 cursor-pointer transition-all shrink-0"
      style={{
        background: isActive ? 'rgba(201,169,110,0.12)' : isEditing ? 'rgba(56,189,248,0.08)' : '#1a1a1a',
        border: `1.5px solid ${isActive ? '#c9a96e' : isEditing ? '#38bdf8' : '#222'}`,
        minWidth: 82,
        maxWidth: 82,
      }}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold tabular-nums" style={{ color: isActive ? '#c9a96e' : '#5a5a5a' }}>
          {index + 1}
        </span>
        <div className="flex gap-0.5">
          <button
            className="w-5 h-5 rounded flex items-center justify-center text-[10px] transition-all"
            style={{ background: '#111', color: '#4a4a4a' }}
            onClick={e => { e.stopPropagation(); onMove(-1); }}
            disabled={index === 0}
          >‹</button>
          <button
            className="w-5 h-5 rounded flex items-center justify-center text-[10px] transition-all"
            style={{ background: '#111', color: '#4a4a4a' }}
            onClick={e => { e.stopPropagation(); onMove(1); }}
            disabled={index === total - 1}
          >›</button>
          <button
            className="w-5 h-5 rounded flex items-center justify-center text-[10px]"
            style={{ background: '#111', color: '#f87171' }}
            onClick={e => { e.stopPropagation(); onDelete(); }}
          >✕</button>
        </div>
      </div>

      {/* Mini fretboard preview — 6 string dots */}
      <div className="flex flex-col gap-0.5">
        {[0,1,2,3,4,5].map(s => {
          const f = beat.frets[s];
          return (
            <div key={s} className="flex items-center gap-1">
              <span className="text-[8px] font-bold w-3" style={{ color: STRING_COLORS[s] }}>
                {STRING_NAMES[s]}
              </span>
              <div className="flex-1 h-2 rounded-full relative" style={{ background: '#111' }}>
                {f !== null && (
                  <div
                    className="absolute top-0 bottom-0 rounded-full"
                    style={{
                      left: f === 0 ? 0 : `${Math.min(((f - 1) / 11) * 100, 92)}%`,
                      width: 8, background: STRING_COLORS[s],
                    }}
                  />
                )}
              </div>
              <span className="text-[8px] font-mono w-4 text-right" style={{ color: f === null ? '#2a2a2a' : '#7a7a7a' }}>
                {f === null ? '–' : f === 0 ? 'O' : f}
              </span>
            </div>
          );
        })}
      </div>

      {beat.chordLabel && (
        <div className="text-[9px] text-center font-bold rounded px-1 py-0.5 truncate"
          style={{ background: 'rgba(167,139,250,0.12)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}>
          {beat.chordLabel}
        </div>
      )}
      {isEditing && (
        <div className="text-[9px] text-center font-semibold rounded px-1 py-0.5" style={{ background: '#38bdf820', color: '#38bdf8' }}>
          editing
        </div>
      )}
      {!hasNotes && !isEditing && !beat.chordLabel && (
        <div className="text-[9px] text-center" style={{ color: '#2a2a2a' }}>empty</div>
      )}
    </div>
  );
}

function MusicEditorMode({ diffMax }) {
  const [beats, setBeats] = useState([{ frets: EMPTY_BEAT(), id: 0 }]);
  const [editIdx, setEditIdx] = useState(0);
  const [playIdx, setPlayIdx] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [loop, setLoop] = useState(false);
  const nextId = useRef(1);
  const playTimer = useRef(null);
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const beatsRef = useRef(beats);
  beatsRef.current = beats;

  // Current beat being edited
  const editBeat = beats[editIdx] ?? beats[0];

  const addBeat = () => {
    const newBeat = { frets: [...(editBeat?.frets ?? EMPTY_BEAT())], id: nextId.current++ };
    setBeats(prev => {
      const next = [...prev];
      next.splice(editIdx + 1, 0, newBeat);
      return next;
    });
    setEditIdx(editIdx + 1);
  };

  const deleteBeat = (i) => {
    if (beats.length === 1) { setBeats([{ frets: EMPTY_BEAT(), id: nextId.current++ }]); setEditIdx(0); return; }
    setBeats(prev => prev.filter((_, idx) => idx !== i));
    setEditIdx(Math.max(0, i >= beats.length - 1 ? i - 1 : i));
  };

  const moveBeat = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= beats.length) return;
    setBeats(prev => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setEditIdx(j);
  };

  const handleFret = useCallback((s, f) => {
    pluck(OPEN_HZ[s] * 2 ** (f / 12));
    setBeats(prev => {
      const next = prev.map((b, i) => {
        if (i !== editIdx) return b;
        const frets = [...b.frets];
        frets[s] = frets[s] === f ? null : f;
        return { ...b, frets };
      });
      return next;
    });
  }, [editIdx]);

  const handleOpen = useCallback((s) => {
    pluck(OPEN_HZ[s], 2.6);
    setBeats(prev => {
      const next = prev.map((b, i) => {
        if (i !== editIdx) return b;
        const frets = [...b.frets];
        frets[s] = frets[s] === 0 ? null : 0;
        return { ...b, frets };
      });
      return next;
    });
  }, [editIdx]);

  const dotStyle = useCallback((s, f) => {
    const sel = editBeat?.frets[s];
    if (sel !== f || sel === null) return null;
    return {
      bg: STRING_COLORS[s],
      color: '#0f0f0f',
      glow: `0 0 12px ${STRING_COLORS[s]}88`,
      label: NOTE_NAMES[semitoneAt(s, f)],
    };
  }, [editBeat]);

  const playAll = useCallback(() => {
    if (isPlaying) {
      clearTimeout(playTimer.current);
      setIsPlaying(false);
      setPlayIdx(null);
      return;
    }
    setIsPlaying(true);
    const msPerBeat = (60 / bpmRef.current) * 1000;
    let i = 0;
    const tick = () => {
      const currentBeats = beatsRef.current;
      if (i >= currentBeats.length) {
        if (loopRef.current) { i = 0; } else { setIsPlaying(false); setPlayIdx(null); return; }
      }
      setPlayIdx(i);
      strum(currentBeats[i].frets);
      i++;
      playTimer.current = setTimeout(tick, msPerBeat);
    };
    tick();
  }, [isPlaying]);

  const clearBeat = () => {
    setBeats(prev => prev.map((b, i) => i === editIdx ? { ...b, frets: EMPTY_BEAT(), chordLabel: null } : b));
  };

  const applyChord = useCallback((voicing) => {
    const frets = tabToFrets(voicing.tab);
    strum(frets);
    setBeats(prev => prev.map((b, i) =>
      i === editIdx ? { ...b, frets, chordLabel: `${voicing.name} ${voicing.type}` } : b
    ));
  }, [editIdx]);

  const pct = ((bpm - 40) / (200 - 40)) * 100;

  return (
    <div>
      {/* Transport controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2.5 rounded-xl"
        style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <button
          onClick={playAll}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all"
          style={isPlaying
            ? { background: '#f87171', color: '#0f0f0f' }
            : { background: '#c9a96e', color: '#0f0f0f' }}>
          {isPlaying ? '■ Stop' : '▶ Play'}
        </button>

        <button
          onClick={() => setLoop(l => !l)}
          className="px-3 py-2 rounded-xl text-xs font-semibold transition-all"
          style={loop
            ? { background: 'rgba(201,169,110,0.15)', color: '#c9a96e', border: '1px solid rgba(201,169,110,0.3)' }
            : { background: '#141414', color: '#5a5a5a', border: '1px solid #222' }}>
          ↻ Loop
        </button>

        {/* BPM slider */}
        <div className="flex items-center gap-2 flex-1 min-w-[120px]">
          <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: '#5a5a5a' }}>BPM</span>
          <input
            type="range" min={40} max={200} value={bpm}
            onChange={e => setBpm(Number(e.target.value))}
            className="flex-1"
            style={{ background: `linear-gradient(to right, #c9a96e ${pct}%, #2a2a2a ${pct}%)` }}
          />
          <span className="text-sm font-bold tabular-nums w-8 text-right" style={{ color: '#c9a96e' }}>{bpm}</span>
        </div>

        <span className="text-xs tabular-nums" style={{ color: '#3a3a3a' }}>
          {beats.length} beat{beats.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Beat track */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
        {beats.map((beat, i) => (
          <BeatCard
            key={beat.id}
            beat={beat}
            index={i}
            total={beats.length}
            isActive={playIdx === i}
            isEditing={editIdx === i && !isPlaying}
            onSelect={() => { setEditIdx(i); if (isPlaying) return; strum(beat.frets); }}
            onDelete={() => deleteBeat(i)}
            onMove={dir => moveBeat(i, dir)}
          />
        ))}

        {/* Add beat button */}
        <button
          onClick={addBeat}
          className="shrink-0 rounded-xl flex flex-col items-center justify-center gap-1 transition-all"
          style={{ minWidth: 50, minHeight: 80, background: '#141414', border: '1px dashed #2a2a2a', color: '#3a3a3a' }}>
          <span className="text-xl leading-none">+</span>
          <span className="text-[9px]">beat</span>
        </button>
      </div>

      {/* Chord picker */}
      <ChordPicker onApply={applyChord} diffMax={diffMax} />

      {/* Fretboard editor */}
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: '#38bdf8' }}>
            Editing beat {editIdx + 1}
            {editBeat?.chordLabel && (
              <span className="ml-1.5 font-normal" style={{ color: '#a78bfa' }}>· {editBeat.chordLabel}</span>
            )}
          </span>
          <span className="text-xs" style={{ color: '#3a3a3a' }}>— tap frets to modify</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={clearBeat}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: '#1a1a1a', color: '#7a7a7a', border: '1px solid #222' }}>
            Clear beat
          </button>
          <button
            onClick={() => strum(editBeat?.frets ?? EMPTY_BEAT())}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: '#1a1a1a', color: '#c9a96e', border: '1px solid rgba(201,169,110,0.25)' }}>
            🎸 Strum
          </button>
        </div>
      </div>

      <Fretboard dotStyle={dotStyle} onFretClick={handleFret} onOpenClick={handleOpen} />

      {/* Playback indicator */}
      {isPlaying && playIdx !== null && (
        <div className="mt-3 text-center text-xs font-semibold" style={{ color: '#c9a96e' }}>
          ♪ Playing beat {playIdx + 1} of {beats.length}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

function DiffSlider({ diffMax, setDiffMax }) {
  const pct = ((diffMax - 1) / 9) * 100;
  const color = diffMax <= 3 ? '#4ade80' : diffMax <= 6 ? '#c9a96e' : '#f87171';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-3"
      style={{ background: '#161616', border: '1px solid #1e1e1e' }}>
      <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: '#5a5a5a' }}>
        Max difficulty
      </span>
      <input
        type="range" min={1} max={10} value={diffMax}
        onChange={e => setDiffMax(Number(e.target.value))}
        className="flex-1"
        style={{ background: `linear-gradient(to right, ${color} ${pct}%, #2a2a2a ${pct}%)` }}
      />
      <span className="text-sm font-bold tabular-nums w-5 text-right" style={{ color }}>
        {diffMax}
      </span>
    </div>
  );
}

export default function GuitarStrings() {
  const [mode, setMode] = useState('play');
  const [diffMax, setDiffMax] = useState(10);

  return (
    <div className="p-3 sm:p-5 select-none">
      <ModeBar mode={mode} setMode={setMode} />
      {(mode === 'chord' || mode === 'editor') && (
        <DiffSlider diffMax={diffMax} setDiffMax={setDiffMax} />
      )}
      {mode === 'play'   && <PlayMode />}
      {mode === 'scale'  && <ScaleMode />}
      {mode === 'chord'  && <ChordFinderMode diffMax={diffMax} />}
      {mode === 'editor' && <MusicEditorMode diffMax={diffMax} />}
    </div>
  );
}

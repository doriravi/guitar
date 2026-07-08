import { useState, useCallback, useRef, useMemo } from 'react';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import DifficultyBadge from './DifficultyBadge';
import ChordTip from './ChordTip';
import Lazy3D from './Lazy3D';
import FloatingPanel from './FloatingPanel';
import { useT } from '../lib/i18n';

// The Composer header shows an instanced GPU particle field that reacts to the
// music the editor PLAYS (every strum / the whole song on Play), not the mic —
// it taps getComposerAnalyser() off our own audio bus. Lazy-loaded + code-split
// (three stays out of the main bundle) and gated: on reduced-motion / no real
// WebGPU it renders nothing and the styled placeholder below carries the strip.
// Static-literal specifier so Vite can split it (see Lazy3D / vite.config.js).
const loadParticleField = () => import('./three/ParticleField3D');
import { useHandProfile, useAIFingers } from '../App';
import { recommendedMaxDifficulty, abilityLabel } from '../lib/handProfile';
import { MAJOR_PROGRESSIONS } from '../lib/progressions';
import { getDiatonicChords } from '../lib/scales';
import { compose } from '../lib/api';
import { allLibrarySongs, songToComposerSong } from '../lib/composerLibrary';

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
let _unlocked = false;
let _analyser = null;   // taps ctx._out so visualizers can "hear" what WE synthesize
function getCtx() {
  if (!_ctx || _ctx.state === 'closed') {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    _ctx = new Ctor();
    const comp = _ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 5;
    comp.attack.value = 0.002;  comp.release.value = 0.25;
    comp.connect(_ctx.destination);
    _ctx._out = comp;
    _analyser = null;   // stale analyser belonged to the closed context
    _unlocked = false;
  }
  // iOS: prime once with a silent buffer inside the user gesture so audio
  // actually unlocks, then resume.
  if (!_unlocked) {
    try {
      const b = _ctx.createBuffer(1, 1, 22050);
      const s = _ctx.createBufferSource();
      s.buffer = b; s.connect(_ctx.destination); s.start(0);
      _unlocked = true;
    } catch { /* ignore */ }
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// Analyser tapped off the Composer's master bus (ctx._out). Everything the editor
// plays — every strum, the whole song on Play — flows through _out, so this reads
// exactly what the app is sounding, with NO microphone involved. Connecting _out →
// analyser is a parallel branch (analyser has no output wired on), so it never
// changes what reaches the speakers. Lazily created and reused. Returned to the
// particle visualizer, which pulls time-/frequency-domain data from it each frame.
// (Exported so ParticleField3D can subscribe without owning any audio itself.)
export function getComposerAnalyser() {
  const ctx = getCtx();
  if (!_analyser) {
    const a = ctx.createAnalyser();
    a.fftSize = 1024;             // 512 frequency bins, 1024 time-domain samples
    a.smoothingTimeConstant = 0.8; // gentle so the field breathes, not jitters
    try { ctx._out.connect(a); } catch { /* ignore double-connect */ }
    _analyser = a;
  }
  return _analyser;
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

function strum(frets, capo = 0) {
  const ctx = getCtx();
  frets.forEach((fret, s) => {
    if (fret === null) return;
    // A capo on fret `capo` raises every sounding note by `capo` semitones.
    const hz = OPEN_HZ[s] * 2 ** ((fret + capo) / 12);
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

// Reach difficulty for a beat's frets, accounting for a capo. A capo shifts the
// played shape `capo` frets up the neck, where fret spacing is tighter, so the
// same shape is physically a little easier — calcDifficulty captures that via
// the shrinking fret-spacing model when we offset each fret by the capo.
function beatDifficulty(frets, capo = 0) {
  const notes = frets
    .map((f, s) => (f === null ? null : { string: s, fret: f + capo }))
    .filter(Boolean);
  return notes.length >= 2 ? calcDifficulty(notes) : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

// ── Fretboard ─────────────────────────────────────────────────────────────────
// Shared visual component used by all three modes.
// dotStyle(s, f) → null | { bg, color, glow, label }

function Fretboard({ dotStyle, onFretClick, onOpenClick, capo = 0 }) {
  // Horizontal center of a fret column, as a CSS calc(). The left label+open
  // area is a fixed 84px; the remaining width is split into FRET_COUNT columns.
  const fretCenter = (fretNum) =>
    `calc(84px + (100% - 84px) * ${(fretNum - 0.5) / FRET_COUNT})`;
  const showCapo = capo > 0 && capo <= FRET_COUNT;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#1a1010', border: '1px solid #2a1a1a' }}>
      {/* Fret number header */}
      <div className="flex" style={{ borderBottom: '1px solid var(--color-surface-550)' }}>
        <div style={{ width: 44 }} className="shrink-0" />
        <div className="flex items-center justify-center text-xs font-semibold py-2 shrink-0"
          style={{ width: 40, color: 'var(--color-ink-ghost)' }}>O</div>
        {Array.from({ length: FRET_COUNT }, (_, f) => (
          <div key={f} className="flex-1 flex items-center justify-center text-xs py-2"
            style={{ minWidth: 0, color: MARKER_FRETS.includes(f+1) ? 'var(--color-brand)' : 'var(--color-surface-550)', fontWeight: MARKER_FRETS.includes(f+1) ? 700 : 400 }}>
            {f+1}
          </div>
        ))}
      </div>

      {/* Capo bar — a clamp across all strings at the capo fret. Wraps the string
          rows so the absolute bar can span their full height. */}
      <div className="relative">
        {showCapo && (
          <div className="absolute z-20 pointer-events-none flex items-center justify-center"
            style={{
              left: `calc(${fretCenter(capo)} - 7px)`,
              top: 0, bottom: 0, width: 14,
              background: 'linear-gradient(to bottom, #4b3a24, #34d399aa, #4b3a24)',
              borderRadius: 6,
              boxShadow: '0 0 10px rgba(52,211,153,0.5), inset 0 0 3px rgba(0,0,0,0.6)',
              border: '1px solid #2a2a2a',
            }}>
            <span className="text-[9px] font-black" style={{ color: '#0f0f0f', writingMode: 'vertical-rl', letterSpacing: 1 }}>
              CAPO {capo}
            </span>
          </div>
        )}

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
                  : { background: 'var(--color-surface-700)', color: 'var(--color-ink-ghost)', border: '1px solid var(--color-surface-550)' }}>
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
      </div>

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

function PlayMode({ tr }) {
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
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${activeCount > 0 ? 'text-surface-base' : 'bg-surface-750 text-ink-ghost cursor-not-allowed'}`}
          style={activeCount > 0
            ? { background: strumming ? 'var(--color-brand-hover)' : 'var(--color-brand)', transform: strumming ? 'scale(0.97)' : 'scale(1)' }
            : undefined}>
          🎸 Strum {activeCount > 0 && <span className="text-xs font-normal opacity-70">({activeCount})</span>}
        </button>
        <button onClick={() => { setSelected([0,0,0,0,0,0]); strum([0,0,0,0,0,0]); }}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-surface-750 text-ink-subtle border border-surface-650">
          {tr.allOpen}
        </button>
        <button onClick={() => setSelected([null,null,null,null,null,null])}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-surface-750 text-ink-subtle border border-surface-650">
          {tr.muteAll}
        </button>
      </div>

      <Fretboard dotStyle={dotStyle} onFretClick={handleFret} onOpenClick={handleOpen} />

      {activeCount > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <span className="text-xs text-ink-ghost">{tr.playing}</span>
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

function ScaleMode({ tr }) {
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
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{tr.root}</label>
          <div className="flex flex-wrap gap-1">
            {ROOTS.map(r => (
              <button key={r} onClick={() => setRoot(r)}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition-all border ${root === r ? 'bg-brand text-surface-base border-transparent' : 'bg-surface-750 text-ink-faint border-surface-650'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{tr.scale}</label>
          <div className="flex flex-wrap gap-1">
            {Object.keys(SCALE_TYPES).map(sn => (
              <button key={sn} onClick={() => setScaleName(sn)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${scaleName === sn ? 'bg-brand text-surface-base border-transparent' : 'bg-surface-750 text-ink-faint border-surface-650'}`}>
                {sn}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scale info + play button */}
      <div className="flex items-center justify-between gap-3 mb-4 px-3 py-2.5 rounded-xl bg-surface-750 border border-surface-650">
        <div>
          <p className="text-xs font-bold mb-1 text-brand">
            {root} {scaleName}
          </p>
          <p className="text-xs font-mono text-ink-faint">
            {scaleNotes.join('  ·  ')}
          </p>
        </div>
        <button onClick={playScale}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-600 text-brand border border-surface-550">
          ▶ Play
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-xs mb-3 text-ink-ghost">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full inline-block bg-brand" />
          {tr.rootNote}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full inline-block" style={{ background: `${STRING_COLORS[0]}44`, border: `1px solid ${STRING_COLORS[0]}` }} />
          {tr.scaleNote}
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
      className={`rounded-xl p-2 transition-all flex flex-col items-center gap-1 border ${isActive ? '' : 'bg-surface-850 border-surface-650'}`}
      style={isActive
        ? { background: 'rgba(201,169,110,0.1)', borderColor: 'rgba(201,169,110,0.4)', minWidth: 100 }
        : { minWidth: 100 }}
    >
      <p className={`text-xs font-semibold ${isActive ? 'text-brand' : 'text-ink-subtle'}`}>
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

function ChordFinderMode({ diffMax, tr }) {
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
          placeholder={tr.searchChord}
          className="w-full px-3 py-2 rounded-xl text-sm outline-none mb-3 bg-surface-750 text-ink border border-surface-550"
        />
        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
          {filtered.map(name => (
            <button key={name} onClick={() => selectChord(name)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${selectedName === name ? 'bg-brand text-surface-base border-transparent' : 'bg-surface-750 text-ink-subtle border-surface-650'}`}>
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Voicings */}
      {voicings.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-ink-ghost">
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
        <div className="mb-4 text-sm text-center py-6 text-ink-ghost">
          No voicings for "{selectedName}" within difficulty ≤ {diffMax}
        </div>
      )}

      {/* Fretboard — shows selected voicing */}
      {activeVoicing ? (
        <>
          <p className="text-xs mb-2 text-ink-ghost">
            Showing: <span className="text-brand">{activeVoicing.name} ({activeVoicing.type})</span>
            &nbsp;· Tab: <span className="font-mono text-ink-faint">{activeVoicing.tab}</span>
          </p>
          <Fretboard dotStyle={dotStyle} onFretClick={handleFret} onOpenClick={handleOpen} />
        </>
      ) : (
        <div className="rounded-2xl flex items-center justify-center text-sm bg-surface-850 text-ink-ghost"
          style={{ border: '1px dashed var(--color-surface-550)', height: 120 }}>
          Select a voicing above to see it on the fretboard
        </div>
      )}
    </div>
  );
}

// ── MODE: MUSIC EDITOR ───────────────────────────────────────────────────────

const EMPTY_BEAT = () => [null, null, null, null, null, null];

// ── Notation sheet ─────────────────────────────────────────────────────────
// Renders the composed beats as notes on a treble staff. Guitar music is
// notated an octave above where it sounds (treble clef, 8vb), so we map the
// actual MIDI pitch up one octave for a readable staff position.

// Diatonic step index for each pitch class (C=0, D=1, … B=6) and whether it
// needs a sharp accidental in the key of C.
const PC_STEP  = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // C C# D D# E F F# G G# A A# B
const PC_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

// Key signatures. Each major key has a fixed count of sharps (+) or flats (−)
// applied in a fixed order of letter names. This drives both the notated
// key-signature glyphs and whether an accidental is spelled sharp or flat.
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];       // order sharps appear
const FLAT_ORDER  = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];       // order flats appear
const LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// tonic pitch class → { name, count, accidental } (count of sharps/flats).
const KEYS = [
  { name: 'C',  pc: 0,  acc: 'sharp', count: 0 },
  { name: 'G',  pc: 7,  acc: 'sharp', count: 1 },
  { name: 'D',  pc: 2,  acc: 'sharp', count: 2 },
  { name: 'A',  pc: 9,  acc: 'sharp', count: 3 },
  { name: 'E',  pc: 4,  acc: 'sharp', count: 4 },
  { name: 'B',  pc: 11, acc: 'sharp', count: 5 },
  { name: 'F♯', pc: 6,  acc: 'sharp', count: 6 },
  { name: 'F',  pc: 5,  acc: 'flat',  count: 1 },
  { name: 'B♭', pc: 10, acc: 'flat',  count: 2 },
  { name: 'E♭', pc: 3,  acc: 'flat',  count: 3 },
  { name: 'A♭', pc: 8,  acc: 'flat',  count: 4 },
  { name: 'D♭', pc: 1,  acc: 'flat',  count: 5 },
];

function keyByName(name) {
  return KEYS.find(k => k.name === name) ?? KEYS[0];
}

// Pitch classes of the major scale for a key (used to flag "in-key" chords).
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
function keyScalePcs(key) {
  return new Set(MAJOR_SCALE.map(i => (key.pc + i) % 12));
}

// Composer key names use ♯/♭ glyphs (e.g. "F♯", "B♭"); getDiatonicChords wants
// ASCII (# / b). Normalize the tonic letter for that lookup.
function keyRootAscii(keyName) {
  return keyName.replace('♯', '#').replace('♭', 'b');
}

// Map a library song's key (ASCII root + scaleType) to the composer's key name.
// Minor keys use their relative major (same key signature and diatonic set).
function songKeyToComposerKey(root, scaleType) {
  let pc = NOTE_TO_SEMITONE[root];
  if (pc == null) return null;
  if (scaleType === 'minor') pc = (pc + 3) % 12;
  return KEYS.find(k => k.pc === pc)?.name ?? null;
}

// Find the easiest playable voicing (lowest reach difficulty) for a chord name,
// within the difficulty ceiling. Falls back to the easiest overall if none fit.
function easiestVoicing(chordName, diffMax) {
  const matches = CHORDS.filter(c => c.name === chordName);
  if (matches.length === 0) return null;
  const scored = matches
    .map(c => ({ chord: c, diff: calcDifficulty(c.notes) }))
    .sort((a, b) => a.diff - b.diff);
  const withinLimit = scored.find(s => s.diff <= diffMax);
  return (withinLimit ?? scored[0]).chord;
}

// Parse a chord name's root note into a pitch class. Chord names look like
// "Am", "C#", "F#m7", "Bb", "Gsus4" — the root is the leading letter plus an
// optional accidental.
function chordRootPc(name) {
  const m = /^([A-G])([#b♯♭]?)/.exec(name);
  if (!m) return null;
  const base = NOTE_TO_SEMITONE[m[1]];
  if (base == null) return null;
  const acc = m[2];
  if (acc === '#' || acc === '♯') return (base + 1) % 12;
  if (acc === 'b' || acc === '♭') return (base + 11) % 12;
  return base;
}

// The set of letter names altered by a key's signature (e.g. G major → {F}).
function keySignatureLetters(key) {
  const order = key.acc === 'sharp' ? SHARP_ORDER : FLAT_ORDER;
  return order.slice(0, key.count);
}

// Spell a pitch class within a key: returns { letter, accidental } where
// accidental is '', '♯', or '♭'. Flat keys prefer flat spelling of the black
// keys; sharp keys prefer sharp spelling. Natural notes have no accidental.
const SHARP_SPELL = [ // pc → [letter, accidental]
  ['C',''],['C','♯'],['D',''],['D','♯'],['E',''],['F',''],
  ['F','♯'],['G',''],['G','♯'],['A',''],['A','♯'],['B',''],
];
const FLAT_SPELL = [
  ['C',''],['D','♭'],['D',''],['E','♭'],['E',''],['F',''],
  ['G','♭'],['G',''],['A','♭'],['A',''],['B','♭'],['B',''],
];

function spellPitch(pc, key) {
  return (key.acc === 'flat' ? FLAT_SPELL : SHARP_SPELL)[((pc % 12) + 12) % 12];
}

// A note's vertical staff position, computed from its spelled letter + octave
// so an F♯ and G♭ land on different lines. dia = "diatonic number": letter-steps
// above C0. midi octave = floor(midi/12) - 1 (C4/midi 60 → octave 4).
function diatonicNumberFor(midi, letter, accidental) {
  let octave = Math.floor(midi / 12) - 1;
  const pc = ((midi % 12) + 12) % 12;
  // A B♭/B-flat spelling of A♯ keeps the same octave; but Cb/B# would cross an
  // octave boundary. Guard the two wrap cases: B♯ (pc 0 spelled B) and C♭.
  if (accidental === '♯' && letter === 'B' && pc === 0) octave -= 1;
  if (accidental === '♭' && letter === 'C' && pc === 11) octave += 1;
  return octave * 7 + LETTER_STEP[letter];
}

// Simple diatonic number for a natural midi pitch (used for staff-line refs).
function diatonicNumber(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return octave * 7 + PC_STEP[pc];
}

// Convert a beat's frets into notated note descriptors for the given key.
// `capo` raises every sounding note by that many semitones.
function beatToStaffNotes(frets, key, capo = 0) {
  const sigLetters = new Set(keySignatureLetters(key));
  const notes = [];
  for (let s = 0; s < 6; s++) {
    const f = frets[s];
    if (f === null) continue;
    const midi = OPEN_MIDI[s] + f + capo + 12; // +capo: capo shift; +12: notate an octave up (treble 8vb)
    const pc = midi % 12;
    const [letter, accidental] = spellPitch(pc, key);
    // The key signature already alters these letters, so only draw an explicit
    // accidental when the note's accidental disagrees with the signature.
    const alteredBySig = sigLetters.has(letter);
    let glyph = '';
    if (accidental && !alteredBySig) glyph = accidental;   // e.g. F♯ in C major
    else if (!accidental && alteredBySig) glyph = '♮';     // natural cancels the sig
    notes.push({
      dia: diatonicNumberFor(midi, letter, accidental),
      glyph,
      color: STRING_COLORS[s],
    });
  }
  // Draw lowest pitch first so stems/heads stack predictably.
  return notes.sort((a, b) => a.dia - b.dia);
}

function NotationSheet({ beats, activeIdx, musicKey, capo = 0, tr }) {
  const key = keyByName(musicKey);

  // Staff geometry. One space = STEP px between adjacent diatonic positions is
  // half a line gap, so a full line-to-line gap is 2*STEP.
  const STEP     = 5;               // px per diatonic step (half staff space)
  const TOP_PAD  = 40;              // room for high ledger lines
  const BOT_PAD  = 40;              // room for low ledger lines
  const COL_W    = 34;             // px per beat column
  const CLEF_W   = 34;
  const H        = TOP_PAD + BOT_PAD + 8 * STEP; // 5 lines span 8 half-steps

  // Reference diatonic numbers for the treble staff lines (bottom→top): E4 G4 B4 D5 F5.
  // Top line F5 (midi 77) sits at y = TOP_PAD; each diatonic step up moves up STEP.
  const F5_DIA = diatonicNumber(77);
  const yFor = (dia) => TOP_PAD + (F5_DIA - dia) * STEP;

  // Staff line diatonic numbers (top F5 down to bottom E4).
  const lineDias = [77, 74, 71, 67, 64].map(diatonicNumber);

  // Key-signature accidentals: place each altered letter at its conventional
  // staff position in the treble clef, in signature order.
  const sigLetters = keySignatureLetters(key);
  // Conventional dia positions for treble-clef sharps (F♯ high) and flats (B♭).
  const SHARP_DIA = { F: diatonicNumber(77), C: diatonicNumber(72), G: diatonicNumber(79),
                      D: diatonicNumber(74), A: diatonicNumber(69), E: diatonicNumber(76), B: diatonicNumber(71) };
  const FLAT_DIA  = { B: diatonicNumber(71), E: diatonicNumber(76), A: diatonicNumber(69),
                      D: diatonicNumber(74), G: diatonicNumber(67), C: diatonicNumber(72), F: diatonicNumber(65) };
  const sigGlyph  = key.acc === 'sharp' ? '♯' : '♭';
  const SIG_X0    = CLEF_W;
  const SIG_STEP  = 7;
  const sigW      = sigLetters.length * SIG_STEP + (sigLetters.length ? 6 : 0);
  const NOTES_X0  = SIG_X0 + sigW;

  const width = NOTES_X0 + Math.max(beats.length, 1) * COL_W + 12;

  // Ledger lines needed for a note far above/below the staff.
  const ledgersFor = (dia) => {
    const lines = [];
    const topLine = lineDias[0];      // F5
    const botLine = lineDias[4];      // E4
    // Above the staff: A5 (topLine+2), C6, … at even step offsets.
    for (let d = topLine + 2; d <= dia; d += 2) lines.push(d);
    for (let d = botLine - 2; d >= dia; d -= 2) lines.push(d);
    return lines;
  };

  return (
    <div className="rounded-xl mb-3 overflow-x-auto"
      style={{ background: '#faf8f3', border: '1px solid #2a2a2a' }}>
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#8a7a5a' }}>
          {tr.notationSheet}
        </span>
      </div>
      <svg width={width} height={H + 12} style={{ display: 'block', minWidth: '100%' }}>
        {/* Staff lines */}
        {lineDias.map((d, i) => (
          <line key={i} x1={8} y1={yFor(d)} x2={width - 6} y2={yFor(d)}
            stroke="#3a3a3a" strokeWidth={1} />
        ))}
        {/* Treble clef glyph */}
        <text x={10} y={yFor(lineDias[3]) + 10} fontSize={44} fill="#1a1a1a"
          style={{ fontFamily: 'serif' }}>𝄞</text>

        {/* Key signature */}
        {sigLetters.map((letter, i) => {
          const dia = (key.acc === 'sharp' ? SHARP_DIA : FLAT_DIA)[letter];
          return (
            <text key={letter} x={SIG_X0 + 4 + i * SIG_STEP} y={yFor(dia) + 4}
              fontSize={15} textAnchor="middle" fill="#1a1a1a" style={{ fontFamily: 'serif' }}>
              {sigGlyph}
            </text>
          );
        })}

        {/* Beats */}
        {beats.map((beat, bi) => {
          const cx = NOTES_X0 + bi * COL_W + COL_W / 2;
          const staffNotes = beatToStaffNotes(beat.frets, key, capo);
          const isActive = bi === activeIdx;
          return (
            <g key={beat.id ?? bi}>
              {/* Active-beat highlight */}
              {isActive && (
                <rect x={cx - COL_W / 2 + 2} y={4} width={COL_W - 4} height={H}
                  rx={4} fill="rgba(56,189,248,0.12)" stroke="#38bdf8" strokeWidth={1} />
              )}
              {/* Barline between beats */}
              {bi < beats.length - 1 && (
                <line x1={cx + COL_W / 2} y1={yFor(lineDias[0])} x2={cx + COL_W / 2} y2={yFor(lineDias[4])}
                  stroke="#d8d0c0" strokeWidth={1} />
              )}
              {staffNotes.length === 0 ? (
                // Rest glyph for an empty beat
                <text x={cx} y={yFor(lineDias[2]) + 4} fontSize={18} textAnchor="middle" fill="#8a7a5a"
                  style={{ fontFamily: 'serif' }}>𝄽</text>
              ) : staffNotes.map((n, ni) => {
                const y = yFor(n.dia);
                return (
                  <g key={ni}>
                    {/* Ledger lines */}
                    {ledgersFor(n.dia).map((ld, li) => (
                      <line key={li} x1={cx - 8} y1={yFor(ld)} x2={cx + 8} y2={yFor(ld)}
                        stroke="#3a3a3a" strokeWidth={1} />
                    ))}
                    {/* Accidental */}
                    {n.glyph && (
                      <text x={cx - 11} y={y + 3.5} fontSize={12} textAnchor="middle" fill="#1a1a1a"
                        style={{ fontFamily: 'serif' }}>{n.glyph}</text>
                    )}
                    {/* Note head */}
                    <ellipse cx={cx} cy={y} rx={4.2} ry={3.2}
                      transform={`rotate(-20 ${cx} ${y})`}
                      fill={n.color} stroke="#1a1a1a" strokeWidth={0.75} />
                  </g>
                );
              })}
              {/* Stem (single, from lowest note upward) — only when notes exist */}
              {staffNotes.length > 0 && (
                <line
                  x1={cx + 4} y1={yFor(staffNotes[0].dia)}
                  x2={cx + 4} y2={yFor(staffNotes[staffNotes.length - 1].dia) - 22}
                  stroke="#1a1a1a" strokeWidth={1} />
              )}
              {/* Beat number */}
              <text x={cx} y={H + 8} fontSize={8} textAnchor="middle"
                fill={isActive ? '#0284c7' : '#b0a890'} fontWeight={isActive ? 700 : 400}>
                {bi + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Resolve a progression's diatonic degrees into concrete chords for a key,
// each with the easiest voicing within the difficulty ceiling.
function resolveProgression(prog, musicKey, diffMax) {
  const diatonic = getDiatonicChords(keyRootAscii(musicKey), 'major');
  return prog.degrees.map(deg => {
    const chordName = diatonic[deg]?.chordName;
    const voicing = chordName ? easiestVoicing(chordName, diffMax) : null;
    return { degree: deg, roman: diatonic[deg]?.roman, chordName, voicing };
  });
}

// "Ask the expert" — sends the current composition to the AI melody/harmony
// expert and offers its suggestions as beats you can drop onto the track.
function ExpertPicker({ beats, onInsert, musicKey, diffMax, want = 'chords', tr }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState(false);

  const handProfile = useHandProfile();
  const aiFingers = useAIFingers();

  const ask = useCallback(async () => {
    setLoading(true);
    setError(false);
    setSuggestions(null);
    // Give the expert the player's hand so it only suggests reachable shapes.
    const ability = abilityLabel(handProfile);
    const hand = {
      // gap measurements in cm (reach / flexibility signal)
      thumbToIndex: handProfile.thumbToIndex,
      indexToMiddle: handProfile.indexToMiddle,
      middleToRing: handProfile.middleToRing,
      ringToLittle: handProfile.ringToLittle,
      abilityLabel: ability.label,       // e.g. "Very small hands"
      abilityNote: ability.desc,         // e.g. "Limited reach — many standard chords…"
      recommendedMaxDifficulty: recommendedMaxDifficulty(handProfile),
      difficultyCeiling: diffMax,        // the user's current Max Difficulty setting
      // Optional per-finger capability from the AI hand-photo analysis, if present.
      fingerCapability: aiFingers ?? undefined,
    };
    const payload = {
      key: musicKey,
      want,
      hand,
      beats: beats.map(b => ({
        chordLabel: b.chordLabel ?? '',
        tab: b.frets.map(f => (f === null ? 'x' : f)).join(''),
      })),
    };
    const res = await compose.get(payload);
    setLoading(false);
    if (res && Array.isArray(res.suggestions) && res.suggestions.length > 0) {
      setSuggestions(res.suggestions);
    } else {
      setError(true); // no key configured / error / empty → show unavailable
    }
  }, [beats, musicKey, want, diffMax, handProfile, aiFingers]);

  const insertOne = (s) => {
    const frets = tabToFrets(s.tab);
    strum(frets);
    onInsert([{ tab: s.tab, name: s.label || 'Expert', type: 'suggested' }]);
  };

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); ask(); }}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all mb-3 bg-surface-750 text-info"
        style={{ border: '1px solid rgba(56,189,248,0.3)' }}>
        {tr.askExpert}
      </button>
    );
  }

  return (
    <div className="rounded-xl p-3 mb-3 bg-surface-800 border border-surface-550">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-info">
          🎓 {tr.expertSuggestions}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={ask} disabled={loading}
            className={`text-xs font-semibold ${loading ? 'text-ink-ghost' : 'text-info'}`}>
            {loading ? tr.expertThinking : '↻'}
          </button>
          <button onClick={() => setOpen(false)} className="text-xs text-ink-faint">
            {tr.close}
          </button>
        </div>
      </div>

      {loading && (
        <p className="text-xs text-center py-4 text-ink-faint">{tr.expertThinking}</p>
      )}

      {error && !loading && (
        <p className="text-xs text-center py-4 text-ink-faint">{tr.expertUnavailable}</p>
      )}

      {suggestions && !loading && (
        <div className="flex flex-col gap-1.5">
          {suggestions.map((s, i) => {
            const notes = tabToFrets(s.tab)
              .map((f, str) => (f === null ? null : { string: str, fret: f }))
              .filter(Boolean);
            const diff = notes.length ? calcDifficulty(notes) : null;
            return (
              <div key={i} className="flex items-center gap-2 rounded-lg px-2.5 py-2 bg-surface-750 border border-surface-650">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ink">{s.label || '—'}</span>
                    <span className="font-mono text-[10px] text-ink-faint">{s.tab}</span>
                    {diff != null && <DifficultyBadge score={diff} />}
                  </div>
                  {s.reason && (
                    <p className="text-[10px] mt-0.5 truncate text-ink-subtle">{s.reason}</p>
                  )}
                </div>
                <button
                  onClick={() => insertOne(s)}
                  className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold text-info"
                  style={{ background: 'rgba(56,189,248,0.14)', border: '1px solid rgba(56,189,248,0.3)' }}>
                  {tr.add}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProgressionPicker({ onInsert, diffMax, musicKey, progName, setProgName, tr }) {
  const [open, setOpen] = useState(false);

  const prog = useMemo(
    () => MAJOR_PROGRESSIONS.find(p => p.name === progName) ?? MAJOR_PROGRESSIONS[0],
    [progName]
  );

  // Resolved chords for the current key + selected progression.
  const resolved = useMemo(
    () => resolveProgression(prog, musicKey, diffMax),
    [prog, musicKey, diffMax]
  );

  const canInsert = resolved.some(r => r.voicing);

  const handleInsert = () => {
    const voicings = resolved.filter(r => r.voicing).map(r => r.voicing);
    if (voicings.length === 0) return;
    onInsert(voicings);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all mb-3 bg-surface-750 text-success"
        style={{ border: '1px solid rgba(52,211,153,0.25)' }}>
        {tr.addProgression}
      </button>
    );
  }

  return (
    <div className="rounded-xl p-3 mb-3 bg-surface-800 border border-surface-550">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-success">
          {tr.progressionInKey} <span className="text-brand">{musicKey}</span>
        </span>
        <button onClick={() => setOpen(false)} className="text-xs text-ink-faint">
          {tr.close}
        </button>
      </div>

      {/* Progression combo box */}
      <select
        value={progName}
        onChange={e => setProgName(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none mb-2 appearance-none bg-surface-750 text-ink border border-surface-550"
      >
        {MAJOR_PROGRESSIONS.map(p => (
          <option key={p.name} value={p.name} style={{ background: 'var(--color-surface-750)' }}>
            {p.name}  ·  {p.genre}
          </option>
        ))}
      </select>

      {/* Resolved chord preview */}
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {resolved.map((r, i) => (
          <div key={i} className="flex flex-col items-center rounded-lg px-2.5 py-1.5"
            style={{
              background: r.voicing ? 'var(--color-surface-700)' : '#161010',
              border: `1px solid ${r.voicing ? 'var(--color-surface-550)' : 'rgba(248,113,113,0.3)'}`,
              minWidth: 54,
            }}>
            <span className="text-[9px] text-ink-faint">{r.roman}</span>
            {r.chordName ? (
              <ChordTip name={r.chordName}>
                <span className={`text-xs font-bold cursor-help ${r.voicing ? 'text-ink' : 'text-danger'}`}>
                  {r.chordName}
                </span>
              </ChordTip>
            ) : (
              <span className="text-xs font-bold text-danger">—</span>
            )}
            {r.voicing && (
              <span className="font-mono text-[9px] text-ink-ghost">{r.voicing.tab}</span>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleInsert}
        disabled={!canInsert}
        className={`w-full px-3 py-2 rounded-lg text-xs font-bold transition-all ${canInsert ? 'bg-success text-surface-base' : 'bg-surface-750 text-ink-ghost cursor-not-allowed'}`}>
        {tr.insertProgression}
      </button>
    </div>
  );
}

function ChordPicker({ onApply, diffMax, musicKey, tr }) {
  const [search, setSearch] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [open, setOpen] = useState(false);

  // Chords whose root is in the selected key are flagged and sorted first.
  const inKeyPcs = useMemo(() => keyScalePcs(keyByName(musicKey)), [musicKey]);
  const isInKey = useCallback((name) => {
    const pc = chordRootPc(name);
    return pc != null && inKeyPcs.has(pc);
  }, [inKeyPcs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const names = q ? CHORD_NAMES.filter(n => n.toLowerCase().includes(q)) : CHORD_NAMES;
    const avail = names.filter(name => CHORDS.some(c => c.name === name && calcDifficulty(c.notes) <= diffMax));
    // In-key chords first, preserving original order within each group.
    return [...avail].sort((a, b) => (isInKey(b) ? 1 : 0) - (isInKey(a) ? 1 : 0));
  }, [search, diffMax, isInKey]);

  const voicings = useMemo(() =>
    selectedName ? CHORDS.filter(c => c.name === selectedName && calcDifficulty(c.notes) <= diffMax).slice(0, 4) : [],
    [selectedName, diffMax]
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-surface-750 text-accent"
        style={{ border: '1px solid rgba(167,139,250,0.25)' }}>
        {tr.addChord}
      </button>
    );
  }

  return (
    <div className="rounded-xl p-3 mb-3 bg-surface-800 border border-surface-550">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent">{tr.addChordToBeat}</span>
        <button onClick={() => { setOpen(false); setSelectedName(''); setSearch(''); }}
          className="text-xs text-ink-faint">{tr.close}</button>
      </div>

      <input
        value={search} onChange={e => { setSearch(e.target.value); setSelectedName(''); }}
        placeholder={tr.searchChordShort}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none mb-2 bg-surface-750 text-ink border border-surface-550"
        autoFocus
      />

      <p className="text-[10px] mb-1.5 flex items-center gap-1.5 text-ink-ghost">
        <span className="inline-block w-2 h-2 rounded-full bg-brand" />
        {tr.inKeyOf} <span className="text-brand">{musicKey}</span>
      </p>

      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto mb-2">
        {filtered.slice(0, 40).map(name => {
          const inKey = isInKey(name);
          const selected = selectedName === name;
          return (
            <button key={name} onClick={() => setSelectedName(name)}
              className={`px-2 py-0.5 rounded-md text-xs font-semibold transition-all ${selected ? 'bg-accent text-surface-base' : inKey ? 'text-brand' : 'bg-surface-700 text-ink-subtle border border-surface-600'}`}
              style={!selected && inKey
                ? { background: 'rgba(201,169,110,0.14)', border: '1px solid rgba(201,169,110,0.4)' }
                : undefined}>
              {name}
            </button>
          );
        })}
      </div>

      {voicings.length > 0 && (
        <div>
          <p className="text-[10px] mb-1.5 text-ink-ghost">{tr.pickVoicing}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {voicings.map((v, i) => (
              <button
                key={i}
                onClick={() => { onApply(v); setOpen(false); setSelectedName(''); setSearch(''); }}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all flex flex-col items-center gap-0.5 bg-surface-700 border border-surface-550 text-accent"
                style={{ minWidth: 70 }}>
                <ChordTip name={v.name}>
                  <span className="font-bold text-ink cursor-help">{v.name}</span>
                </ChordTip>
                <span className="text-ink-faint">{v.type}</span>
                <span className="font-mono text-[10px] text-ink-ghost">{v.tab}</span>
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
        background: isActive ? 'rgba(201,169,110,0.12)' : isEditing ? 'rgba(56,189,248,0.08)' : 'var(--color-surface-750)',
        border: `1.5px solid ${isActive ? 'var(--color-brand)' : isEditing ? 'var(--color-info)' : 'var(--color-surface-650)'}`,
        minWidth: 82,
        maxWidth: 82,
      }}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] font-bold tabular-nums ${isActive ? 'text-brand' : 'text-ink-faint'}`}>
          {index + 1}
        </span>
        <div className="flex gap-0.5">
          <button
            className="w-5 h-5 rounded flex items-center justify-center text-[10px] transition-all bg-surface-900 text-ink-ghost"
            onClick={e => { e.stopPropagation(); onMove(-1); }}
            disabled={index === 0}
          >‹</button>
          <button
            className="w-5 h-5 rounded flex items-center justify-center text-[10px] transition-all bg-surface-900 text-ink-ghost"
            onClick={e => { e.stopPropagation(); onMove(1); }}
            disabled={index === total - 1}
          >›</button>
          <button
            className="w-5 h-5 rounded flex items-center justify-center text-[10px] bg-surface-900 text-danger"
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
              <div className="flex-1 h-2 rounded-full relative bg-surface-900">
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
              <span className={`text-[8px] font-mono w-4 text-right ${f === null ? 'text-surface-550' : 'text-ink-subtle'}`}>
                {f === null ? '–' : f === 0 ? 'O' : f}
              </span>
            </div>
          );
        })}
      </div>

      {beat.chordLabel && (
        <div className="text-[9px] text-center font-bold rounded px-1 py-0.5 truncate text-accent"
          style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.2)' }}>
          {beat.chordLabel}
        </div>
      )}
      {isEditing && (
        <div className="text-[9px] text-center font-semibold rounded px-1 py-0.5 text-info" style={{ background: '#38bdf820' }}>
          editing
        </div>
      )}
      {!hasNotes && !isEditing && !beat.chordLabel && (
        <div className="text-[9px] text-center text-surface-550">empty</div>
      )}
    </div>
  );
}

const SONGS_KEY = 'guitar_songs';

function loadSongs() {
  try { return JSON.parse(localStorage.getItem(SONGS_KEY)) || []; } catch { return []; }
}

function saveSongs(songs) {
  try { localStorage.setItem(SONGS_KEY, JSON.stringify(songs)); } catch {}
}

function SongManager({ beats, bpm, loop, capo, musicKey, progName, onLoad, onClose }) {
  const [songs, setSongs] = useState(loadSongs);
  const [nameInput, setNameInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [libQuery, setLibQuery] = useState('');
  const library = useMemo(() => allLibrarySongs(), []);

  const filteredLibrary = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    if (!q) return library;
    return library.filter(s =>
      `${s.title} ${s.artist || ''}`.toLowerCase().includes(q));
  }, [library, libQuery]);

  const handleSave = () => {
    const name = nameInput.trim();
    if (!name) return;
    const song = { name, bpm, loop, capo: capo ?? 0, key: musicKey, progression: progName, beats: beats.map(b => ({ frets: b.frets, chordLabel: b.chordLabel ?? null })), savedAt: Date.now() };
    const updated = [...songs.filter(s => s.name !== name), song];
    saveSongs(updated);
    setSongs(updated);
    setNameInput('');
  };

  const handleLoad = (song) => {
    onLoad(song);
    onClose();
  };

  const handleLoadLibrary = (s) => {
    const song = songToComposerSong(s);
    if (!song) return; // none of its chords are catalogued — nothing to load
    onLoad(song);
    onClose();
  };

  const handleDelete = (name) => {
    const updated = songs.filter(s => s.name !== name);
    saveSongs(updated);
    setSongs(updated);
    setConfirmDelete(null);
  };

  return (
    <div className="rounded-xl p-3 mb-3 bg-surface-800 border border-surface-550">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">Songs</span>
        <button onClick={onClose} className="text-xs text-ink-faint">✕ Close</button>
      </div>

      {/* Save current as */}
      <div className="flex gap-2 mb-3">
        <input
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="Song name…"
          className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none bg-surface-750 text-ink border border-surface-550"
        />
        <button
          onClick={handleSave}
          disabled={!nameInput.trim()}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${nameInput.trim() ? 'bg-brand text-surface-base' : 'bg-surface-750 text-ink-ghost cursor-not-allowed'}`}>
          Save
        </button>
      </div>

      {/* Saved songs list */}
      {songs.length === 0 ? (
        <p className="text-xs text-center py-3 text-ink-ghost">No saved songs yet</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-0.5">
          {[...songs].reverse().map(s => (
            <div key={s.name}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 bg-surface-750 border border-surface-650">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate text-ink">{s.name}</p>
                <p className="text-[10px] text-ink-ghost">
                  {s.beats.length} beat{s.beats.length !== 1 ? 's' : ''} · {s.bpm} BPM
                  {s.loop ? ' · loop' : ''}
                </p>
              </div>
              <button
                onClick={() => handleLoad(s)}
                className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold text-brand"
                style={{ background: 'rgba(201,169,110,0.12)', border: '1px solid rgba(201,169,110,0.2)' }}>
                Load
              </button>
              {confirmDelete === s.name ? (
                <button
                  onClick={() => handleDelete(s.name)}
                  className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold text-danger"
                  style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.25)' }}>
                  Confirm
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(s.name)}
                  className="shrink-0 px-2 py-1 rounded-md text-xs text-ink-ghost">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Song library — every song from the Progression tab (built-in + custom),
          loadable as beats using the easiest voicing of each chord. */}
      <div className="mt-3 pt-3 border-t border-surface-650">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand">Song library</span>
          <span className="text-[10px] text-ink-ghost">{filteredLibrary.length} songs</span>
        </div>
        <input
          value={libQuery}
          onChange={e => setLibQuery(e.target.value)}
          placeholder="Search title or artist…"
          className="w-full px-3 py-1.5 rounded-lg text-xs outline-none mb-2 bg-surface-750 text-ink border border-surface-550"
        />
        {filteredLibrary.length === 0 ? (
          <p className="text-xs text-center py-3 text-ink-ghost">No matching songs</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-0.5">
            {filteredLibrary.slice(0, 60).map((s, i) => (
              <div key={`${s.title}|${s.artist || ''}|${i}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 bg-surface-750 border border-surface-650">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate text-ink">{s.title}</p>
                  <p className="text-[10px] truncate text-ink-ghost">
                    {s.custom ? 'My song' : s.artist}{!s.custom && s.year ? ` · ${s.year}` : ''}{s.key ? ` · ${s.key}${s.scaleType === 'minor' ? 'm' : ''}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleLoadLibrary(s)}
                  className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold text-brand"
                  style={{ background: 'rgba(201,169,110,0.12)', border: '1px solid rgba(201,169,110,0.2)' }}>
                  Load
                </button>
              </div>
            ))}
            {filteredLibrary.length > 60 && (
              <p className="text-[10px] text-center py-1 text-ink-ghost">
                Showing 60 of {filteredLibrary.length} — refine the search
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MusicEditorMode({ diffMax, tr }) {
  const [beats, setBeats] = useState([{ frets: EMPTY_BEAT(), id: 0 }]);
  const [editIdx, setEditIdx] = useState(0);
  const [playIdx, setPlayIdx] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [loop, setLoop] = useState(false);
  const [showSongs, setShowSongs] = useState(false);
  const [musicKey, setMusicKey] = useState('C');
  const [progName, setProgName] = useState(MAJOR_PROGRESSIONS[0].name);
  const [capo, setCapo] = useState(0); // capo fret (0 = none); raises pitch, eases reach
  const capoRef = useRef(capo);
  capoRef.current = capo;
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
    pluck(OPEN_HZ[s] * 2 ** ((f + capo) / 12));
    setBeats(prev => {
      const next = prev.map((b, i) => {
        if (i !== editIdx) return b;
        const frets = [...b.frets];
        frets[s] = frets[s] === f ? null : f;
        return { ...b, frets };
      });
      return next;
    });
  }, [editIdx, capo]);

  const handleOpen = useCallback((s) => {
    pluck(OPEN_HZ[s] * 2 ** (capo / 12), 2.6);
    setBeats(prev => {
      const next = prev.map((b, i) => {
        if (i !== editIdx) return b;
        const frets = [...b.frets];
        frets[s] = frets[s] === 0 ? null : 0;
        return { ...b, frets };
      });
      return next;
    });
  }, [editIdx, capo]);

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
      strum(currentBeats[i].frets, capoRef.current);
      i++;
      playTimer.current = setTimeout(tick, msPerBeat);
    };
    tick();
  }, [isPlaying]);

  const clearBeat = () => {
    setBeats(prev => prev.map((b, i) => i === editIdx ? { ...b, frets: EMPTY_BEAT(), chordLabel: null } : b));
  };

  const loadSong = useCallback((song) => {
    const loaded = song.beats.map(b => ({ frets: b.frets, chordLabel: b.chordLabel ?? null, id: nextId.current++ }));
    setBeats(loaded);
    setBpm(song.bpm);
    setLoop(song.loop ?? false);
    setCapo(song.capo ?? 0);
    // Adopt the song's key and progression when it carries them. Saved composer
    // songs store the key as-is (♯/♭ glyph name); library songs carry an ASCII
    // root + scaleType that needs mapping (minor → relative major).
    if (song.key) {
      const keyName = KEYS.some(k => k.name === song.key)
        ? song.key
        : songKeyToComposerKey(song.key, song.scaleType);
      if (keyName) setMusicKey(keyName);
    }
    if (song.progression && MAJOR_PROGRESSIONS.some(p => p.name === song.progression)) {
      setProgName(song.progression);
    }
    setEditIdx(0);
    setPlayIdx(null);
    setIsPlaying(false);
    clearTimeout(playTimer.current);
  }, []);

  const applyChord = useCallback((voicing) => {
    const frets = tabToFrets(voicing.tab);
    strum(frets, capo);
    setBeats(prev => prev.map((b, i) =>
      i === editIdx ? { ...b, frets, chordLabel: `${voicing.name} ${voicing.type}` } : b
    ));
  }, [editIdx, capo]);

  // Insert a whole progression (list of voicings) as new beats at the cursor.
  const insertProgression = useCallback((voicings) => {
    const newBeats = voicings.map(v => ({
      frets: tabToFrets(v.tab),
      chordLabel: `${v.name} ${v.type}`,
      id: nextId.current++,
    }));
    if (newBeats.length === 0) return;
    setBeats(prev => {
      const next = [...prev];
      next.splice(editIdx + 1, 0, ...newBeats);
      return next;
    });
    setEditIdx(editIdx + newBeats.length);
    strum(newBeats[0].frets, capo);
  }, [editIdx, capo]);

  const pct = ((bpm - 40) / (200 - 40)) * 100;

  const sheetActiveIdx = isPlaying && playIdx !== null ? playIdx : editIdx;

  return (
    <div>
      {/* Floating, draggable particle field that LISTENS to the music the editor
          plays (taps our own audio bus, not the mic) — particles surge per
          frequency band so the field follows each strum / the whole song. It
          floats over the app (fixed position, drag by the grip) so you can place
          it anywhere, and carries its own Play/Stop button wired to playAll.
          Lazy-loaded + gated via Lazy3D (renders nothing when 3D is off / no GPU
          / reduced-motion, leaving just the empty panel with its Play button). */}
      <FloatingPanel storageKey="composer-field" width={280} height={170}
        defaultPos={{ x: 24, y: 110 }} title={tr.play || 'Play'}>
        {/* Field fills the panel (decorative, non-interactive). */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
          <Lazy3D load={loadParticleField} fallback={null} />
        </div>
        {/* Play / Stop — drives the same playback as the main transport. */}
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-2.5" style={{ zIndex: 10 }}>
          <button
            onClick={playAll}
            className={`ui-press flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-bold text-surface-base shadow-lg transition-all ${isPlaying ? 'bg-danger' : 'bg-brand'}`}>
            {isPlaying ? '■ Stop' : '▶ Play'}
          </button>
        </div>
      </FloatingPanel>

      {/* Key selector */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {tr.key}
        </span>
        <div className="flex flex-wrap gap-1">
          {KEYS.map(k => (
            <button key={k.name} onClick={() => setMusicKey(k.name)}
              className={`px-2 py-0.5 rounded-md text-xs font-bold transition-all border ${musicKey === k.name ? 'bg-brand text-surface-base border-transparent' : 'bg-surface-750 text-ink-faint border-surface-650'}`}>
              {k.name}
            </button>
          ))}
        </div>
      </div>

      {/* Capo selector */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          🎸 {tr.capo}
        </span>
        <div className="flex flex-wrap gap-1">
          {[0,1,2,3,4,5,6,7].map(n => (
            <button key={n} onClick={() => setCapo(n)}
              className={`px-2 py-0.5 rounded-md text-xs font-bold transition-all border ${capo === n ? 'bg-success text-surface-base border-transparent' : 'bg-surface-750 text-ink-faint border-surface-650'}`}>
              {n === 0 ? tr.capoOff : n}
            </button>
          ))}
        </div>
        {capo > 0 && (
          <span className="text-[10px] text-success">
            {(tr.capoOn || 'Capo on fret {n} · +{n} semitones').replace(/\{n\}/g, capo)}
          </span>
        )}
      </div>

      {/* Music notation sheet */}
      <NotationSheet beats={beats} activeIdx={sheetActiveIdx} musicKey={musicKey} capo={capo} tr={tr} />

      {/* Transport controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2.5 rounded-xl bg-surface-750 border border-surface-650">
        <button
          onClick={playAll}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all text-surface-base ${isPlaying ? 'bg-danger' : 'bg-brand'}`}>
          {isPlaying ? '■ Stop' : '▶ Play'}
        </button>

        <button
          onClick={() => setLoop(l => !l)}
          className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${loop ? 'text-brand' : 'bg-surface-850 text-ink-faint border-surface-650'}`}
          style={loop ? { background: 'rgba(201,169,110,0.15)', borderColor: 'rgba(201,169,110,0.3)' } : undefined}>
          ↻ Loop
        </button>

        <button
          onClick={() => setShowSongs(s => !s)}
          className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${showSongs ? 'text-brand' : 'bg-surface-850 text-ink-faint border-surface-650'}`}
          style={showSongs ? { background: 'rgba(201,169,110,0.15)', borderColor: 'rgba(201,169,110,0.3)' } : undefined}>
          💾 Songs
        </button>

        {/* BPM slider */}
        <div className="flex items-center gap-2 flex-1 min-w-[120px]">
          <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-ink-faint">BPM</span>
          <input
            type="range" min={40} max={200} value={bpm}
            onChange={e => setBpm(Number(e.target.value))}
            className="flex-1"
            style={{ background: `linear-gradient(to right, var(--color-brand) ${pct}%, var(--color-surface-550) ${pct}%)` }}
          />
          <span className="text-sm font-bold tabular-nums w-8 text-right text-brand">{bpm}</span>
        </div>

        <span className="text-xs tabular-nums text-ink-ghost">
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
            onSelect={() => { setEditIdx(i); if (isPlaying) return; strum(beat.frets, capo); }}
            onDelete={() => deleteBeat(i)}
            onMove={dir => moveBeat(i, dir)}
          />
        ))}

        {/* Add beat button */}
        <button
          onClick={addBeat}
          className="shrink-0 rounded-xl flex flex-col items-center justify-center gap-1 transition-all bg-surface-850 text-ink-ghost"
          style={{ minWidth: 50, minHeight: 80, border: '1px dashed var(--color-surface-550)' }}>
          <span className="text-xl leading-none">+</span>
          <span className="text-[9px]">beat</span>
        </button>
      </div>

      {/* Song manager */}
      {showSongs && (
        <SongManager
          beats={beats}
          bpm={bpm}
          loop={loop}
          capo={capo}
          musicKey={musicKey}
          progName={progName}
          onLoad={loadSong}
          onClose={() => setShowSongs(false)}
        />
      )}

      {/* Ask the expert — AI melody/harmony suggestions */}
      <ExpertPicker beats={beats} onInsert={insertProgression} musicKey={musicKey} diffMax={diffMax} tr={tr} />

      {/* Progression picker — fills the track with a diatonic progression */}
      <ProgressionPicker onInsert={insertProgression} diffMax={diffMax} musicKey={musicKey} progName={progName} setProgName={setProgName} tr={tr} />

      {/* Chord picker */}
      <ChordPicker onApply={applyChord} diffMax={diffMax} musicKey={musicKey} tr={tr} />

      {/* Fretboard editor */}
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-info">
            Editing beat {editIdx + 1}
            {editBeat?.chordLabel && (
              <span className="ml-1.5 font-normal text-accent">· {editBeat.chordLabel}</span>
            )}
          </span>
          {(() => {
            const d = editBeat ? beatDifficulty(editBeat.frets, capo) : null;
            return d != null ? <DifficultyBadge score={d} /> : null;
          })()}
          <span className="text-xs text-ink-ghost">— tap frets to modify</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={clearBeat}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-750 text-ink-subtle border border-surface-650">
            Clear beat
          </button>
          <button
            onClick={() => strum(editBeat?.frets ?? EMPTY_BEAT(), capo)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-750 text-brand"
            style={{ border: '1px solid rgba(201,169,110,0.25)' }}>
            🎸 Strum
          </button>
        </div>
      </div>

      <Fretboard dotStyle={dotStyle} onFretClick={handleFret} onOpenClick={handleOpen} capo={capo} />

      {/* Playback indicator */}
      {isPlaying && playIdx !== null && (
        <div className="mt-3 text-center text-xs font-semibold text-brand">
          ♪ Playing beat {playIdx + 1} of {beats.length}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

function DiffSlider({ diffMax, setDiffMax, tr }) {
  const pct = ((diffMax - 1) / 9) * 100;
  const color = diffMax <= 3 ? '#4ade80' : diffMax <= 6 ? '#c9a96e' : '#f87171';

  // Recommended ceiling for the user's hand size — shown as a marker on the track.
  const handProfile = useHandProfile();
  const recommended = recommendedMaxDifficulty(handProfile);
  const recPct = ((recommended - 1) / 9) * 100;

  return (
    <div className="px-3 py-2.5 rounded-xl mb-3 bg-surface-800 border border-surface-700">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-ink-faint">
          {tr.maxDifficulty}
        </span>
        <div className="relative flex-1">
          <input
            type="range" min={1} max={10} value={diffMax}
            onChange={e => setDiffMax(Number(e.target.value))}
            className="w-full block"
            style={{ background: `linear-gradient(to right, ${color} ${pct}%, var(--color-surface-550) ${pct}%)` }}
          />
          {/* Recommended-for-your-hand marker */}
          <button
            type="button"
            onClick={() => setDiffMax(recommended)}
            title={`${tr.recommendedForHand}: ${recommended}`}
            className="absolute -top-1 w-3 h-3 rounded-full pointer-events-auto"
            style={{
              left: `calc(${recPct}% - 6px)`,
              background: 'var(--color-accent)',
              border: '2px solid var(--color-surface-800)',
              boxShadow: '0 0 6px rgba(167,139,250,0.7)',
            }}
          />
        </div>
        <span className="text-sm font-bold tabular-nums w-5 text-right" style={{ color }}>
          {diffMax}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 pl-0.5">
        <span className="inline-block w-2 h-2 rounded-full bg-accent" />
        <span className="text-[10px] text-ink-subtle">
          {tr.recommendedForHand} · <span className="text-accent font-semibold">{recommended}</span>
        </span>
      </div>
    </div>
  );
}

// The Composer tab now shows only the music editor. The Play / Scale / Chord
// Finder tools live in their own top-level tabs and mount this component with a
// `mode` prop. `diffMax` is only relevant to the chord/editor modes.
export default function GuitarStrings({ lang, mode = 'editor' }) {
  const tr = useT(lang);
  const handProfile = useHandProfile();
  // Default the difficulty ceiling to what's comfortable for the user's hand,
  // not the max — so small-handed players don't start out seeing 10/10 shapes.
  const [diffMax, setDiffMax] = useState(() => recommendedMaxDifficulty(handProfile));

  return (
    <div className="p-3 sm:p-5 select-none">
      {(mode === 'chord' || mode === 'editor') && (
        <DiffSlider diffMax={diffMax} setDiffMax={setDiffMax} tr={tr} />
      )}
      {mode === 'play'   && <PlayMode tr={tr} />}
      {mode === 'scale'  && <ScaleMode tr={tr} />}
      {mode === 'chord'  && <ChordFinderMode diffMax={diffMax} tr={tr} />}
      {mode === 'editor' && <MusicEditorMode diffMax={diffMax} tr={tr} />}
    </div>
  );
}

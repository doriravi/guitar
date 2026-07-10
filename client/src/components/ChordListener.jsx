import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import {
  evaluateStrings,
  hzToNote,
  detectPitchYIN,
  STRING_LABELS,
} from '../lib/pitchDetect';
import {
  useMic,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  detectPeaksConfigured,
  matchChordConfigured,
} from '../lib/micDetect';
import { playProgression, stopAudio } from '../lib/audio';
import { composeSong } from '../lib/melodyCompose';
import { getActiveStyle, loadStyle, saveStyle, learnStyle,
         SCALE_FLAVORS, CHORD_COLORS, GENRES } from '../lib/styleProfile';
import { saveCustomSong } from '../lib/customSongs';
import { useAuth } from '../App';
import PracticeGame from './PracticeGame';
import FretboardDiagram from './FretboardDiagram';
import ChordTip from './ChordTip';
import DifficultyBadge from './DifficultyBadge';
import { useT } from '../lib/i18n';

const STRING_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#a855f7'];
const NOTE_NAMES    = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const CHORD_GROUPS = [
  { label: 'Open Major',  types: ['Major','Major (easy)'] },
  { label: 'Open Minor',  types: ['Minor'] },
  { label: 'Dom 7',       types: ['Dom 7'] },
  { label: 'Minor 7',     types: ['Minor 7','Minor 7 (barre)'] },
  { label: 'Major 7',     types: ['Maj 7'] },
  { label: 'Barre',       types: ['Major (barre)','Minor (barre)'] },
  { label: 'Power',       types: ['Power'] },
  { label: 'Other',       types: [] },
];

const CHORDS_WITH_SCORE = CHORDS.map(c => ({ ...c, score: calcDifficulty(c.notes) }));
const SAVED_KEY = 'guitar_saved_sequences';

// Detection config + mic hook + configured peak/chord matching all live in
// lib/micDetect.js now (shared with the Play-Along game).

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
}
function persistSaved(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch {}
}

function groupedChords(maxDiff) {
  const known = new Set(CHORD_GROUPS.flatMap(g => g.types));
  return CHORD_GROUPS.map(g => ({
    ...g,
    chords: (g.label === 'Other'
      ? CHORDS_WITH_SCORE.filter(c => !known.has(c.type))
      : CHORDS_WITH_SCORE.filter(c => g.types.includes(c.type))
    ).filter(c => c.score <= maxDiff),
  })).filter(g => g.chords.length > 0);
}

function noteSetFromHz(hzList) {
  const pcs = new Set();
  for (const hz of hzList) {
    if (hz <= 0) continue;
    const midi = Math.round(69 + 12 * Math.log2(hz / 440));
    pcs.add(NOTE_NAMES[((midi % 12) + 12) % 12]);
  }
  return [...pcs];
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function VolumeBar({ level }) {
  const pct   = Math.round(level * 100);
  const color = level > 0.7 ? 'var(--color-danger)' : level > 0.3 ? 'var(--color-success)' : 'var(--color-ink-ghost)';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-6" style={{ color: 'var(--color-ink-ghost)' }}>Vol</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-650)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums w-7 text-right" style={{ color: 'var(--color-ink-ghost)' }}>{pct}%</span>
    </div>
  );
}

function StringFeedback({ stringResults }) {
  if (!stringResults) return null;
  return (
    <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
      {stringResults.map((s, i) => (
        <div key={i} className="flex flex-col items-center rounded-xl py-2 px-1 transition-all"
          style={{
            background:
              s.status === 'correct' ? 'rgba(34,197,94,0.12)' :
              s.status === 'wrong'   ? 'rgba(239,68,68,0.12)' :
              s.status === 'missing' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
            border: `1.5px solid ${
              s.status === 'correct' ? 'rgba(34,197,94,0.3)' :
              s.status === 'wrong'   ? 'rgba(239,68,68,0.3)' :
              s.status === 'missing' ? 'var(--color-surface-550)' : 'var(--color-surface-700)'}`,
            opacity: s.status === 'muted' ? 0.35 : 1,
          }}>
          <span className="text-xs font-bold mb-1" style={{ color: STRING_COLORS[i] }}>{STRING_LABELS[i]}</span>
          {s.status === 'correct' && <span style={{ color: 'var(--color-success)', fontSize: 14 }}>✓</span>}
          {s.status === 'wrong'   && <span style={{ color: 'var(--color-danger)', fontSize: 14 }}>✗</span>}
          {s.status === 'missing' && <span style={{ color: 'var(--color-ink-faint)', fontSize: 14 }}>–</span>}
          {s.status === 'muted'   && <span style={{ color: 'var(--color-ink-ghost)', fontSize: 12 }}>×</span>}
        </div>
      ))}
    </div>
  );
}

// ── ConfigSlider ──────────────────────────────────────────────────────────────

function ConfigSlider({ label, hint, value, min, max, step, format, onChange, color = 'var(--color-brand)' }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: 'var(--color-ink)' }}>{label}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{format(value)}</span>
      </div>
      {hint && <p className="text-xs mb-2" style={{ color: 'var(--color-ink-ghost)' }}>{hint}</p>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full"
        style={{ background: `linear-gradient(to right, ${color} ${pct}%, var(--color-surface-550) ${pct}%)` }}
      />
      <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--color-surface-550)' }}>
        <span>{format(min)}</span><span>{format(max)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE: TUNE — live detection preview with all parameter controls
// ─────────────────────────────────────────────────────────────────────────────

function TuneMode({ cfg, setCfg }) {
  const [active, setActive]       = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [volume, setVolume]       = useState(0);
  const [peaks, setPeaks]         = useState([]);           // [{ hz, amplitude, note }]
  const [matched, setMatched]     = useState(null);         // { chord, score }
  const [notes, setNotes]         = useState([]);           // ['C','G',...]

  const mic    = useMic();
  const rafRef = useRef(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    mic.current.close();
    setActive(false); setVolume(0); setPeaks([]); setMatched(null); setNotes([]);
  }, [mic]);

  const start = useCallback(async () => {
    setPermDenied(false);
    try {
      await mic.current.open(cfgRef.current.smoothing);
      setActive(true);
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const rms = mic.current.getRMS();
        setVolume(Math.min(1, rms * 8));
        mic.current.updateSmoothing(cfgRef.current.smoothing);
        const fd = mic.current.getFreqData();
        if (!fd || !mic.current.audioCtx) return;
        const sr    = mic.current.audioCtx.sampleRate;
        const fftSz = mic.current.analyser.fftSize;
        const ps    = detectPeaksConfigured(fd, sr, fftSz, cfgRef.current);
        const pNotes = ps.map(p => ({ ...p, note: hzToNote(p.hz) }));
        setPeaks(pNotes);
        const hzList = ps.map(p => p.hz);
        setNotes(noteSetFromHz(hzList));
        const m = matchChordConfigured(hzList, cfgRef.current);
        setMatched(m);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      if (e.name === 'NotAllowedError') setPermDenied(true);
    }
  }, [mic]);

  useEffect(() => () => stop(), [stop]);

  const set = (key) => (val) => {
    const next = { ...cfg, [key]: val };
    setCfg(next);
    saveConfig(next);
  };

  const reset = () => { setCfg({ ...DEFAULT_CONFIG }); saveConfig({ ...DEFAULT_CONFIG }); };

  return (
    <div className="space-y-4">

      {/* Live preview card */}
      <div className="rounded-xl p-4" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-3 mb-3">
          {!active ? (
            <button onClick={start}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
              🎙️ Start preview
            </button>
          ) : (
            <button onClick={stop}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <span className="animate-pulse">●</span> Stop
            </button>
          )}
          {permDenied && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>Mic access denied.</p>}
          {active && <div className="flex-1"><VolumeBar level={volume} /></div>}
          <button onClick={reset}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg"
            style={{ border: '1px solid var(--color-surface-550)', color: 'var(--color-ink-ghost)' }}>
            Reset defaults
          </button>
        </div>

        {/* Live readout */}
        {active && (
          <div className="space-y-3 mt-2">

            {/* ── Chord / fretboard monitor ── */}
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-900)', border: `1.5px solid ${matched ? (matched.score >= 0.6 ? 'rgba(74,222,128,0.3)' : matched.score >= 0.4 ? 'rgba(201,169,110,0.35)' : 'rgba(251,146,60,0.3)') : 'var(--color-surface-700)'}`, transition: 'border-color 0.3s' }}>
              <div className="px-3 pt-3 pb-2 flex items-start gap-3">
                {/* left: diagram or placeholder */}
                <div className="shrink-0">
                  {matched ? (
                    <FretboardDiagram chord={matched.chord} />
                  ) : (
                    <div className="flex items-center justify-center rounded-lg" style={{ width: 72, height: 90, background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-550)' }}>
                      <span style={{ fontSize: 28, opacity: 0.25 }}>🎸</span>
                    </div>
                  )}
                </div>

                {/* right: chord info */}
                <div className="flex-1 min-w-0 pt-1">
                  {matched ? (
                    <>
                      <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                        <span className="text-2xl font-black leading-none" style={{ color: 'var(--color-ink)' }}>{matched.chord.name}</span>
                        <span className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>{matched.chord.type}</span>
                        <DifficultyBadge score={calcDifficulty(matched.chord.notes)} />
                      </div>
                      <p className="text-xs font-mono mb-2" style={{ color: 'var(--color-ink-ghost)' }}>{matched.chord.tab}</p>
                      {/* score bar */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-550)' }}>
                          <div className="h-full rounded-full transition-all duration-200"
                            style={{ width: `${matched.score * 100}%`,
                              background: matched.score >= 0.6 ? 'var(--color-success)' : matched.score >= 0.4 ? 'var(--color-brand)' : 'var(--color-warning)' }} />
                        </div>
                        <span className="text-xs tabular-nums font-bold w-9 text-right"
                          style={{ color: matched.score >= 0.6 ? 'var(--color-success)' : matched.score >= 0.4 ? 'var(--color-brand)' : 'var(--color-warning)' }}>
                          {Math.round(matched.score * 100)}%
                        </span>
                      </div>
                      {/* string indicators */}
                      <div className="flex gap-1">
                        {matched.chord.tab.split('').map((ch, s) => (
                          <span key={s} className="inline-flex flex-col items-center px-1 py-0.5 rounded text-[10px]"
                            style={{
                              border: `1px solid ${ch === 'x' ? 'var(--color-surface-550)' : STRING_COLORS[s] + '55'}`,
                              background: ch === 'x' ? 'var(--color-surface-850)' : STRING_COLORS[s] + '18',
                              color: ch === 'x' ? 'var(--color-ink-ghost)' : STRING_COLORS[s],
                            }}>
                            <span className="font-bold leading-none">{STRING_LABELS[s]}</span>
                            <span className="leading-none mt-0.5">{ch === 'x' ? '×' : ch === '0' ? 'o' : ch}</span>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col justify-center h-full">
                      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-ink-ghost)' }}>No chord detected</p>
                      <p className="text-xs" style={{ color: 'var(--color-surface-550)' }}>
                        {peaks.length ? `Match score below ${Math.round(cfg.minScore * 100)}% threshold` : 'No signal — play or sing louder'}
                      </p>
                      {notes.length > 0 && (
                        <p className="text-xs mt-1" style={{ color: 'var(--color-ink-ghost)' }}>Notes heard: {notes.join(' · ')}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* detected note classes row */}
              {notes.length > 0 && (
                <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>Notes:</span>
                  {notes.map(n => (
                    <span key={n} className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--color-surface-700)', color: 'var(--color-brand)', border: '1px solid var(--color-surface-550)' }}>
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Peaks panel ── */}
            <div className="rounded-lg p-3" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-ink-ghost)' }}>
                Detected peaks ({peaks.length})
              </p>
              {peaks.length === 0 ? (
                <p className="text-xs italic" style={{ color: 'var(--color-surface-550)' }}>no peaks — try playing or singing louder</p>
              ) : (
                <div className="space-y-1.5">
                  {peaks.slice(0, 6).map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full overflow-hidden shrink-0" style={{ background: 'var(--color-surface-550)' }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${Math.max(0, ((p.amplitude - cfg.ampThresh) / Math.abs(cfg.ampThresh)) * 100)}%`, background: 'var(--color-brand)' }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-brand)', minWidth: 44 }}>
                        {Math.round(p.hz)} Hz
                      </span>
                      {p.note && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink)' }}>
                          {p.note.name}{p.note.octave}
                        </span>
                      )}
                      <span className="text-xs tabular-nums" style={{ color: 'var(--color-ink-ghost)' }}>
                        {Math.round(p.amplitude)} dB
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* ── Parameter sliders ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-ink-ghost)' }}>
          Detection parameters
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          <ConfigSlider
            label="Smoothing"
            hint="Higher = more stable but slower to react. Lower = more responsive but noisy."
            value={cfg.smoothing} min={0} max={0.97} step={0.01}
            format={v => v.toFixed(2)}
            onChange={set('smoothing')}
            color="#38bdf8"
          />

          <ConfigSlider
            label="Amplitude threshold (dB)"
            hint="Minimum peak loudness to consider. Raise to filter out faint overtones."
            value={cfg.ampThresh} min={-90} max={-10} step={1}
            format={v => `${v} dB`}
            onChange={set('ampThresh')}
            color="#fb923c"
          />

          <ConfigSlider
            label="Min frequency (Hz)"
            hint="Lowest pitch scanned. 60 Hz covers bass. Raise for voice-only input."
            value={cfg.minHz} min={40} max={300} step={5}
            format={v => `${v} Hz`}
            onChange={set('minHz')}
            color="#a78bfa"
          />

          <ConfigSlider
            label="Max frequency (Hz)"
            hint="Highest pitch scanned. 1200 Hz covers upper guitar harmonics."
            value={cfg.maxHz} min={400} max={2000} step={50}
            format={v => `${v} Hz`}
            onChange={set('maxHz')}
            color="#a78bfa"
          />

          <ConfigSlider
            label="Max peaks"
            hint="How many frequency peaks are passed to the chord matcher. More = richer but noisier."
            value={cfg.maxPeaks} min={1} max={16} step={1}
            format={v => `${v}`}
            onChange={set('maxPeaks')}
            color="#34d399"
          />

          <ConfigSlider
            label="Min match score"
            hint="Jaccard similarity required to accept a chord match. Lower = more guesses, higher = stricter."
            value={cfg.minScore} min={0.05} max={0.9} step={0.05}
            format={v => `${Math.round(v * 100)}%`}
            onChange={set('minScore')}
            color="#f59e0b"
          />

          <ConfigSlider
            label="Silence threshold (RMS)"
            hint="Segments quieter than this are skipped in the recorder. Lower = more sensitive."
            value={cfg.silenceRms} min={0.001} max={0.05} step={0.001}
            format={v => v.toFixed(3)}
            onChange={set('silenceRms')}
            color="#6366f1"
          />

          <ConfigSlider
            label="Segment length (ms)"
            hint="How often the recorder takes a chord snapshot. Shorter = more segments, longer = more stable."
            value={cfg.segmentMs} min={500} max={5000} step={250}
            format={v => `${v} ms`}
            onChange={set('segmentMs')}
            color="#ec4899"
          />
        </div>
      </div>

      {/* Tips */}
      <div className="rounded-xl px-4 py-3 text-xs space-y-1" style={{ background: 'rgba(201,169,110,0.06)', border: '1px solid rgba(201,169,110,0.12)', color: 'var(--color-ink-subtle)' }}>
        <p className="font-semibold" style={{ color: 'var(--color-brand)' }}>Tips for singing / humming</p>
        <p>• Raise <strong>Min Hz</strong> to ~100 Hz if the mic picks up low rumble.</p>
        <p>• Lower <strong>Amplitude threshold</strong> (e.g. −45 dB) if peaks are not showing.</p>
        <p>• Set <strong>Min match score</strong> to 20–30% for more lenient matching of voice.</p>
        <p>• Lower <strong>Smoothing</strong> to ~0.5 if the match lags behind your singing.</p>
        <p>• Increase <strong>Segment length</strong> to 3000 ms if you hold notes slowly.</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE: RECORDER
// ─────────────────────────────────────────────────────────────────────────────

function RecordingDot({ recording }) {
  return (
    <span className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ background: recording ? 'var(--color-danger)' : 'var(--color-ink-ghost)', boxShadow: recording ? '0 0 8px #f87171' : 'none' }} />
  );
}

function ChordCard({ entry, onPlay, onRemove, active }) {
  const [showDiagram, setShowDiagram] = useState(false);
  const chord = entry.chord;

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{ border: `1.5px solid ${active ? 'var(--color-brand)' : 'var(--color-surface-700)'}`, background: active ? 'rgba(201,169,110,0.06)' : 'var(--color-surface-800)' }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs tabular-nums font-mono shrink-0" style={{ color: 'var(--color-ink-ghost)', minWidth: 32 }}>
          {entry.ts}
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-sm" style={{ color: active ? 'var(--color-brand)' : 'var(--color-ink)' }}>
            {chord ? chord.name : '?'}
          </span>
          {chord && <span className="text-xs ml-1.5" style={{ color: 'var(--color-ink-ghost)' }}>{chord.type}</span>}
          {entry.score != null && (
            <span className="text-xs ml-2 tabular-nums" style={{ color: entry.score >= 0.5 ? 'var(--color-success)' : entry.score >= 0.3 ? 'var(--color-brand)' : 'var(--color-warning)' }}>
              {Math.round(entry.score * 100)}%
            </span>
          )}
        </div>
        <div className="hidden sm:flex gap-1 flex-wrap justify-end max-w-[120px]">
          {entry.notes.map(n => (
            <span key={n} className="text-[10px] px-1.5 py-0.5 rounded font-bold"
              style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)' }}>{n}</span>
          ))}
        </div>
        {chord && <div className="shrink-0"><DifficultyBadge score={calcDifficulty(chord.notes)} /></div>}
        <div className="flex items-center gap-1 shrink-0">
          {chord && (
            <button onClick={() => setShowDiagram(v => !v)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
              style={showDiagram ? { background: 'rgba(201,169,110,0.12)', color: 'var(--color-brand)' } : { background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)' }}>
              🎸
            </button>
          )}
          <button onClick={() => onPlay(entry)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
            style={active ? { background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)' } : { background: 'var(--color-surface-700)', color: 'var(--color-brand)' }}>
            {active ? '■' : '▶'}
          </button>
          <button onClick={() => onRemove(entry.id)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
            style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-ghost)' }}>✕</button>
        </div>
      </div>
      {showDiagram && chord && (
        <div className="px-3 pb-3 pt-1 flex gap-3 items-start" style={{ borderTop: '1px solid var(--color-surface-700)' }}>
          <FretboardDiagram chord={chord} />
          <div className="text-xs space-y-1 pt-1" style={{ color: 'var(--color-ink-ghost)' }}>
            <p className="font-mono">{chord.tab}</p>
            <p>Notes: {entry.notes.join(', ')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SavedSequences({ sequences, onLoad, onDelete }) {
  if (!sequences.length) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-ink-ghost)' }}>Saved sessions</p>
      <div className="space-y-1.5">
        {sequences.map(seq => (
          <div key={seq.id} className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-700)' }}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-ink)' }}>{seq.name}</p>
              <p className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>{seq.entries.length} chords · {seq.date}</p>
            </div>
            <button onClick={() => onLoad(seq)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(201,169,110,0.1)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.2)' }}>
              Load
            </button>
            <button onClick={() => onDelete(seq.id)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
              style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-ghost)' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PitchTracker ──────────────────────────────────────────────────────────────
// Real-time single-note (monophonic) pitch tracker — the browser-native
// equivalent of a pyaudio + librosa.yin loop. Runs the YIN algorithm on the
// mic's time-domain buffer, maps f0 → closest note / MIDI / octave and the
// tuning deviation in cents, and captures a live queue of the notes played
// (e.g. E3 · G3 · A3) so a sequence can be copied/reused elsewhere.

// A note is "stable" once the same note class is seen on N consecutive frames,
// which debounces the queue so vibrato / attack transients don't spam it.
const STABLE_FRAMES = 3;

function PitchTracker({ cfg, style, loggedIn, onComposed }) {
  const [active, setActive]       = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [volume, setVolume]       = useState(0);
  const [live, setLive]           = useState(null);   // { name, octave, hz, cents, midi }
  const [queue, setQueue]         = useState([]);      // [{ id, name, octave, midi, hz }]
  const [copied, setCopied]       = useState(false);
  const [composed, setComposed]   = useState(null);    // { song } after Compose
  const [composing, setComposing] = useState(false);
  const [songTitle, setSongTitle] = useState('My melody');

  const mic       = useMic();
  const rafRef    = useRef(null);
  const cfgRef    = useRef(cfg);
  cfgRef.current  = cfg;
  // Debounce state for the queue (kept in refs so the RAF loop stays stable).
  const candRef   = useRef({ midi: null, count: 0 }); // note being confirmed
  const lastMidiRef = useRef(null);                   // last note pushed to queue
  const nextIdRef = useRef(1);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    mic.current.close();
    setActive(false); setVolume(0); setLive(null);
  }, [mic]);

  const start = useCallback(async () => {
    setPermDenied(false);
    try {
      // Open raw (no AEC/NS/AGC) — those DSP stages hurt sustained-pitch tracking.
      await mic.current.open(cfgRef.current.smoothing, { raw: true });
      setActive(true);
      candRef.current = { midi: null, count: 0 };
      lastMidiRef.current = null;
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const rms = mic.current.getRMS();
        setVolume(Math.min(1, rms * 8));
        // Noise gate: below the silence RMS we treat it as silence (script parity).
        if (rms < cfgRef.current.silenceRms) {
          setLive(null);
          candRef.current = { midi: null, count: 0 };
          return;
        }
        const td = mic.current.getTimeData();
        const sr = mic.current.sampleRate;
        if (!td || !sr) return;
        const hz = detectPitchYIN(td, sr);
        if (!hz) { setLive(null); return; }
        const note = hzToNote(hz);
        if (!note) return;
        setLive(note);

        // Queue debounce: confirm a note after STABLE_FRAMES identical frames,
        // then push it once (until a different note is confirmed).
        const cand = candRef.current;
        if (cand.midi === note.midi) cand.count++;
        else { cand.midi = note.midi; cand.count = 1; }
        if (cand.count === STABLE_FRAMES && note.midi !== lastMidiRef.current) {
          lastMidiRef.current = note.midi;
          setQueue(prev => [...prev, {
            id: nextIdRef.current++, name: note.name, octave: note.octave, midi: note.midi, hz: note.hz,
          }]);
        }
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      if (e.name === 'NotAllowedError') setPermDenied(true);
    }
  }, [mic]);

  useEffect(() => () => stop(), [stop]);

  const clearQueue = () => { setQueue([]); lastMidiRef.current = null; setComposed(null); };
  const seqText = queue.map(n => `${n.name}${n.octave}`).join(' ');
  const copySeq = async () => {
    if (!seqText) return;
    try { await navigator.clipboard.writeText(seqText); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };

  // Compose a song from the captured melody using the active style, then save it.
  const compose = async () => {
    if (!queue.length || composing) return;
    setComposing(true);
    try {
      const noteNames = queue.map(n => n.name); // pitch classes in play order
      const song = composeSong(noteNames, style, { title: songTitle.trim() || 'My melody' });
      await saveCustomSong(song, loggedIn);
      setComposed({ song });
      onComposed?.(song);
    } finally {
      setComposing(false);
    }
  };

  // Cents meter geometry: -50..+50 cents mapped to 0..100% around center.
  const centsPct = live ? Math.max(0, Math.min(100, 50 + live.cents)) : 50;
  const inTune   = live && Math.abs(live.cents) <= 5;

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-ghost)' }}>
          🎯 Pitch tracker
        </p>
        {!active ? (
          <button onClick={start}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold"
            style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
            🎙️ Start
          </button>
        ) : (
          <button onClick={stop}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold"
            style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <span className="animate-pulse">●</span> Stop
          </button>
        )}
      </div>

      {permDenied && <p className="text-xs mb-2" style={{ color: 'var(--color-danger)' }}>Microphone access denied.</p>}

      {active && (
        <div className="space-y-3">
          <VolumeBar level={volume} />

          {/* Live note readout: note + octave, Hz, cents (script's output format). */}
          <div className="rounded-xl px-4 py-4 flex items-center gap-4"
            style={{ background: 'var(--color-surface-900)',
              border: `1.5px solid ${live ? (inTune ? 'rgba(74,222,128,0.35)' : 'var(--color-surface-700)') : 'var(--color-surface-700)'}`,
              transition: 'border-color 0.2s' }}>
            {live ? (
              <>
                <div className="text-center shrink-0" style={{ minWidth: 72 }}>
                  <div className="text-4xl font-black leading-none" style={{ color: inTune ? 'var(--color-success)' : 'var(--color-ink)' }}>
                    {live.name}<span className="text-lg align-top" style={{ color: 'var(--color-ink-ghost)' }}>{live.octave}</span>
                  </div>
                  <div className="text-xs mt-1 tabular-nums" style={{ color: 'var(--color-ink-ghost)' }}>{live.hz.toFixed(1)} Hz</div>
                </div>
                <div className="flex-1 min-w-0">
                  {/* Cents deviation meter */}
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>♭</span>
                    <span className="text-xs font-bold tabular-nums"
                      style={{ color: inTune ? 'var(--color-success)' : Math.abs(live.cents) > 25 ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                      {live.cents > 0 ? `+${live.cents}` : live.cents} ¢
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>♯</span>
                  </div>
                  <div className="relative h-2 rounded-full" style={{ background: 'var(--color-surface-700)' }}>
                    {/* center line */}
                    <div className="absolute top-0 bottom-0" style={{ left: '50%', width: 1, background: 'var(--color-surface-550)' }} />
                    {/* deviation marker */}
                    <div className="absolute top-1/2 rounded-full"
                      style={{ left: `${centsPct}%`, width: 10, height: 10, transform: 'translate(-50%,-50%)',
                        background: inTune ? 'var(--color-success)' : 'var(--color-brand)',
                        boxShadow: inTune ? '0 0 8px rgba(74,222,128,0.6)' : 'none', transition: 'left 0.08s linear' }} />
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--color-ink-ghost)' }}>MIDI {live.midi}</p>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 py-2" style={{ color: 'var(--color-ink-ghost)' }}>
                <span className="text-2xl">🎸</span>
                <span className="text-sm">{volume < 0.05 ? 'Silence… play or sing a note.' : 'Listening…'}</span>
              </div>
            )}
          </div>

          {/* Note queue (the captured sequence array). */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-ghost)' }}>
                Note queue{queue.length > 0 ? ` (${queue.length})` : ''}
              </p>
              {queue.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={copySeq}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: 'rgba(201,169,110,0.1)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.2)' }}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                  <button onClick={clearQueue}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ color: 'var(--color-ink-ghost)', border: '1px solid var(--color-surface-700)' }}>
                    Clear
                  </button>
                </div>
              )}
            </div>
            {queue.length === 0 ? (
              <p className="text-xs italic" style={{ color: 'var(--color-surface-550)' }}>
                Detected notes are captured here in order, e.g. E3 · G3 · A3.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {queue.map(n => (
                  <span key={n.id} className="text-xs font-bold px-2 py-1 rounded-lg tabular-nums"
                    style={{ background: 'var(--color-surface-800)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-700)' }}>
                    {n.name}{n.octave}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Compose a song from the captured melody, in the user's style. */}
          {queue.length > 0 && (
            <div className="rounded-xl p-3" style={{ background: 'var(--color-surface-800)', border: '1px solid var(--color-surface-700)' }}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <input value={songTitle} onChange={e => setSongTitle(e.target.value)}
                  placeholder="Song title"
                  className="flex-1 min-w-[120px] px-3 py-2 rounded-lg text-xs outline-none"
                  style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }} />
                <button onClick={compose} disabled={composing}
                  className="px-4 py-2 rounded-lg text-xs font-bold"
                  style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)', opacity: composing ? 0.6 : 1 }}>
                  {composing ? 'Composing…' : '🎼 Compose song from melody'}
                </button>
              </div>
              {composed && (
                <div className="rounded-lg p-3 mt-1" style={{ background: 'var(--color-surface-900)', border: '1px solid rgba(74,222,128,0.25)' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-success)' }}>
                    ✓ Saved “{composed.song.title}” — {composed.song.key}{composed.song.scaleType === 'minor' ? 'm' : ''} · {composed.song.bpm} bpm
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    <span className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>Chords:</span>
                    {composed.song.lyricLines.map((ln, i) => ln.chordNames[0] && (
                      <ChordTip key={i} name={ln.chordNames[0]}>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-lg"
                          style={{ background: 'var(--color-surface-800)', color: 'var(--color-brand)', border: '1px solid var(--color-surface-700)' }}>
                          {ln.chordNames[0]}
                        </span>
                      </ChordTip>
                    ))}
                  </div>
                  {composed.song.tabBlocks?.[0] && (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--color-ink-ghost)' }}>
                      + {composed.song.tabBlocks[0].events.length}-note solo. Find it in <strong style={{ color: 'var(--color-brand)' }}>Progressions</strong> and Play-Along.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!active && (
        <p className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>
          Tracks a single note in real time (YIN pitch detection) and builds a sequence
          of the notes you play, then composes chords + a solo in your style. Tune
          detection sensitivity in the <strong style={{ color: 'var(--color-brand)' }}>Tune</strong> tab.
        </p>
      )}
    </div>
  );
}

// ── StylePanel ────────────────────────────────────────────────────────────────
// "My style" settings — auto-learns a starting profile from the user's saved
// songs, then lets them override genre / scale flavor / chord color / tempo.
// The composer (composeSong) reads getActiveStyle(), which folds these over the
// learned profile.
function StylePanel({ style, setStyle }) {
  const [open, setOpen] = useState(false);
  const learned = useMemo(() => learnStyle(), []);

  const set = (key) => (val) => {
    const next = { ...style, [key]: val };
    setStyle(next);
    saveStyle(next);
  };

  const Pill = ({ active, onClick, children }) => (
    <button onClick={onClick}
      className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
      style={active
        ? { background: 'var(--color-brand)', color: 'var(--color-surface-base)' }
        : { background: 'var(--color-surface-850)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}>
      {children}
    </button>
  );

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-ghost)' }}>🎨 My style</span>
        <span className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>
          {style.scaleFlavor === 'auto' ? (learned.minorLeaning ? 'minor' : 'major') : style.scaleFlavor}
          {style.chordColor !== 'clean' ? ` · ${style.chordColor}` : ''}
          {style.tempo ? ` · ${style.tempo} bpm` : ''}
        </span>
        <span className="ml-auto text-xs" style={{ color: 'var(--color-ink-ghost)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3 mt-3">
          {learned.songCount > 0 && (
            <p className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>
              Learned from your {learned.songCount} saved song{learned.songCount !== 1 ? 's' : ''}:
              {learned.topKey ? ` favors ${learned.topKey};` : ''}
              {learned.likesSevenths ? ' uses 7th chords;' : ''}
              {learned.avgBpm ? ` ~${learned.avgBpm} bpm.` : ''}
            </p>
          )}

          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>Genre</p>
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map(g => <Pill key={g} active={style.genre === g} onClick={() => set('genre')(g)}>{g}</Pill>)}
            </div>
          </div>

          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>Scale flavor</p>
            <div className="flex flex-wrap gap-1.5">
              {SCALE_FLAVORS.map(f => <Pill key={f} active={style.scaleFlavor === f} onClick={() => set('scaleFlavor')(f)}>{f}</Pill>)}
            </div>
          </div>

          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>Chord color</p>
            <div className="flex flex-wrap gap-1.5">
              {CHORD_COLORS.map(c => <Pill key={c} active={style.chordColor === c} onClick={() => set('chordColor')(c)}>{c}</Pill>)}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>Tempo</p>
              <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>
                {style.tempo ? `${style.tempo} bpm` : 'auto'}
              </span>
            </div>
            <input type="range" min={0} max={200} step={5} value={style.tempo}
              onChange={e => set('tempo')(Number(e.target.value))} className="w-full" />
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-surface-550)' }}>0 = auto (learned average)</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RecorderMode({ cfg }) {
  const [phase, setPhase]         = useState('idle');
  const [entries, setEntries]     = useState([]);
  const [elapsed, setElapsed]     = useState(0);
  const [volume, setVolume]       = useState(0);
  const [activeId, setActiveId]   = useState(null);
  const [savedSeqs, setSavedSeqs] = useState(loadSaved);
  const [saveName, setSaveName]   = useState('');
  const [showSave, setShowSave]   = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [manualStyle, setManualStyle] = useState(loadStyle); // raw settings shown in the panel
  const loggedIn                  = !!useAuth();
  // The composer uses the resolved style (manual folded over the learned
  // profile). Recompute whenever the manual settings change.
  const activeStyle = useMemo(() => getActiveStyle(), [manualStyle]);

  const mic         = useMic();
  const rafRef      = useRef(null);
  const timerRef    = useRef(null);
  const segTimerRef = useRef(null);
  const startMsRef  = useRef(0);
  const nextIdRef   = useRef(1);
  const cfgRef      = useRef(cfg);
  cfgRef.current    = cfg;

  const MAX_S = 60;

  const fmt = ms => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  };

  const analyseSegment = useCallback(() => {
    if (!mic.current.audioCtx || !mic.current.analyser) return;
    const rms = mic.current.getRMS();
    if (rms < cfgRef.current.silenceRms) return;
    const fd   = mic.current.getFreqData();
    if (!fd) return;
    const sr    = mic.current.audioCtx.sampleRate;
    const fftSz = mic.current.analyser.fftSize;
    const ps    = detectPeaksConfigured(fd, sr, fftSz, cfgRef.current);
    if (!ps.length) return;
    const hzList = ps.map(p => p.hz);
    const m      = matchChordConfigured(hzList, cfgRef.current);
    const notes  = noteSetFromHz(hzList);
    const ts     = fmt(Date.now() - startMsRef.current);
    setEntries(prev => [...prev, {
      id: nextIdRef.current++,
      ts,
      chord: m?.chord ?? null,
      score: m?.score ?? null,
      notes,
    }]);
  }, [mic]);

  const volLoop = useCallback(() => {
    rafRef.current = requestAnimationFrame(volLoop);
    mic.current.updateSmoothing(cfgRef.current.smoothing);
    setVolume(Math.min(1, mic.current.getRMS() * 8));
  }, [mic]);

  const stopHardware = useCallback(() => {
    if (rafRef.current)   cancelAnimationFrame(rafRef.current);
    if (timerRef.current)  clearInterval(timerRef.current);
    if (segTimerRef.current) clearInterval(segTimerRef.current);
    mic.current.close();
  }, [mic]);

  const stopRecording = useCallback(() => {
    analyseSegment();
    stopHardware();
    setPhase('done'); setVolume(0);
  }, [analyseSegment, stopHardware]);

  const startRecording = useCallback(async () => {
    setPermDenied(false);
    try {
      await mic.current.open(cfgRef.current.smoothing);
      startMsRef.current = Date.now();
      setElapsed(0); setEntries([]); setActiveId(null); nextIdRef.current = 1;
      setPhase('recording');
      timerRef.current = setInterval(() => {
        const el = Date.now() - startMsRef.current;
        setElapsed(el);
        if (el >= MAX_S * 1000) stopRecording();
      }, 500);
      segTimerRef.current = setInterval(analyseSegment, cfgRef.current.segmentMs);
      rafRef.current = requestAnimationFrame(volLoop);
    } catch (e) {
      if (e.name === 'NotAllowedError') setPermDenied(true);
    }
  }, [mic, analyseSegment, volLoop, stopRecording]);

  useEffect(() => () => stopHardware(), [stopHardware]);

  // restart segment interval when segmentMs changes during recording
  useEffect(() => {
    if (phase !== 'recording') return;
    clearInterval(segTimerRef.current);
    segTimerRef.current = setInterval(analyseSegment, cfg.segmentMs);
  }, [cfg.segmentMs, phase, analyseSegment]);

  const handlePlay = useCallback((entry) => {
    if (!entry.chord) return;
    if (activeId === entry.id) { stopAudio(); setActiveId(null); return; }
    stopAudio(); setActiveId(entry.id);
    playProgression([entry.chord], 80, () => {}, () => setActiveId(null));
  }, [activeId]);

  const handlePlayAll = useCallback(() => {
    const playable = entries.filter(e => e.chord);
    if (!playable.length) return;
    if (activeId === 'all') { stopAudio(); setActiveId(null); return; }
    stopAudio(); setActiveId('all');
    let i = 0;
    const next = () => {
      if (i >= playable.length) { setActiveId(null); return; }
      const e = playable[i++];
      setActiveId(e.id);
      playProgression([e.chord], 80, () => {}, next);
    };
    next();
  }, [entries, activeId]);

  const handleRemove = useCallback((id) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    if (activeId === id) { stopAudio(); setActiveId(null); }
  }, [activeId]);

  const handleSave = () => {
    if (!entries.length) return;
    const name = saveName.trim() || `Session ${new Date().toLocaleTimeString()}`;
    const seq  = { id: Date.now(), name, date: new Date().toLocaleDateString(), entries };
    const upd  = [seq, ...savedSeqs];
    setSavedSeqs(upd); persistSaved(upd);
    setSaveName(''); setShowSave(false);
  };

  const handleDeleteSaved = id => {
    const upd = savedSeqs.filter(s => s.id !== id);
    setSavedSeqs(upd); persistSaved(upd);
  };

  const handleLoadSaved = seq => {
    stopAudio(); setActiveId(null);
    setEntries(seq.entries); setPhase('done');
  };

  const elPct = Math.min(100, (elapsed / (MAX_S * 1000)) * 100);

  return (
    <div className="space-y-4">
      {/* "My style" settings that shape the composer */}
      <StylePanel style={manualStyle} setStyle={setManualStyle} />

      {/* Real-time single-note pitch tracker + note-sequence queue + composer */}
      <PitchTracker cfg={cfg} style={activeStyle} loggedIn={loggedIn} />

      <div className="rounded-xl p-4" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {phase === 'idle' && (
            <button onClick={startRecording}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-bold"
              style={{ background: 'var(--color-danger)', color: 'var(--color-surface-base)' }}>
              <RecordingDot recording={false} /> Record
            </button>
          )}
          {phase === 'recording' && (
            <button onClick={stopRecording}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-bold"
              style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <RecordingDot recording={true} /> Stop
            </button>
          )}
          {phase === 'done' && (
            <button onClick={() => { setPhase('idle'); setEntries([]); stopAudio(); setActiveId(null); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}>
              New recording
            </button>
          )}

          {phase === 'recording' && (
            <div className="flex-1 min-w-[120px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono" style={{ color: 'var(--color-danger)' }}>{fmt(elapsed)}</span>
                <span className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>{MAX_S}s max</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-550)' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${elPct}%`, background: 'var(--color-danger)' }} />
              </div>
            </div>
          )}

          {phase === 'done' && entries.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={handlePlayAll}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                style={activeId === 'all'
                  ? { background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.25)' }
                  : { background: 'rgba(201,169,110,0.1)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.25)' }}>
                {activeId === 'all' ? '■' : '▶'} Play all
              </button>
              <button onClick={() => setShowSave(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                style={showSave
                  ? { background: 'rgba(74,222,128,0.12)', color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.25)' }
                  : { background: 'var(--color-surface-700)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}>
                💾 Save
              </button>
            </div>
          )}
        </div>

        {phase === 'recording' && <VolumeBar level={volume} />}
        {permDenied && <p className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>Microphone access denied.</p>}

        {showSave && (
          <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-surface-700)' }}>
            <input value={saveName} onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Session name (optional)"
              className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
              style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}
              autoFocus />
            <button onClick={handleSave}
              className="px-4 py-2 rounded-xl text-xs font-bold"
              style={{ background: 'var(--color-success)', color: 'var(--color-surface-base)' }}>Save</button>
          </div>
        )}
      </div>

      {phase === 'idle' && !entries.length && (
        <div className="text-center py-10" style={{ color: 'var(--color-ink-ghost)' }}>
          <p className="text-4xl mb-3">🎤</p>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-ink-faint)' }}>Sing or hum a melody</p>
          <p className="text-xs">Hit record, then sing — chords are sampled every {cfg.segmentMs / 1000}s.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-surface-550)' }}>Use the <strong style={{ color: 'var(--color-brand)' }}>Tune</strong> tab to calibrate detection for your voice.</p>
        </div>
      )}

      {phase === 'recording' && entries.length === 0 && (
        <div className="text-center py-8" style={{ color: 'var(--color-ink-ghost)' }}>
          <p className="text-3xl mb-2 animate-pulse">🎙️</p>
          <p className="text-sm">Listening… sing or hum steadily.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-ghost)' }}>
              {entries.length} segment{entries.length !== 1 ? 's' : ''}
            </p>
            <button onClick={() => { setEntries([]); stopAudio(); setActiveId(null); }}
              className="text-xs px-2 py-1 rounded-lg"
              style={{ color: 'var(--color-ink-ghost)', border: '1px solid var(--color-surface-700)' }}>
              Clear
            </button>
          </div>
          {entries.map(entry => (
            <ChordCard key={entry.id} entry={entry} onPlay={handlePlay} onRemove={handleRemove} active={activeId === entry.id} />
          ))}
        </div>
      )}

      <SavedSequences sequences={savedSeqs} onLoad={handleLoadSaved} onDelete={handleDeleteSaved} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE: PRACTICE
// ─────────────────────────────────────────────────────────────────────────────

function PracticeMode({ cfg, tr }) {
  const [listening, setListening]               = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [targetChord, setTargetChord]           = useState(CHORDS_WITH_SCORE[0]);
  const [maxDiff, setMaxDiff]                   = useState(10);
  const [stringResults, setStringResults]       = useState(null);
  const [detectedNote, setDetectedNote]         = useState(null);
  const [autoDetected, setAutoDetected]         = useState(null);
  const [volume, setVolume]                     = useState(0);

  const mic    = useMic();
  const rafRef = useRef(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const groups = useMemo(() => groupedChords(maxDiff), [maxDiff]);

  useEffect(() => {
    const all = groups.flatMap(g => g.chords);
    if (all.length > 0 && !all.includes(targetChord)) { setTargetChord(all[0]); setStringResults(null); setAutoDetected(null); }
  }, [groups, targetChord]);

  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    mic.current.close();
    setListening(false); setStringResults(null); setDetectedNote(null); setAutoDetected(null); setVolume(0);
  }, [mic]);

  const startListening = useCallback(async () => {
    try {
      await mic.current.open(cfgRef.current.smoothing);
      setListening(true); setPermissionDenied(false);
    } catch (err) {
      if (err.name === 'NotAllowedError') setPermissionDenied(true);
    }
  }, [mic]);

  useEffect(() => {
    if (!listening) return;
    let last = 0;
    const loop = (ts) => {
      rafRef.current = requestAnimationFrame(loop);
      mic.current.updateSmoothing(cfgRef.current.smoothing);
      const rms = mic.current.getRMS();
      setVolume(Math.min(1, rms * 8));
      if (ts - last < 120) return;
      last = ts;
      if (rms < cfgRef.current.silenceRms) { setStringResults(null); setDetectedNote(null); setAutoDetected(null); return; }
      const fd = mic.current.getFreqData();
      if (!fd || !mic.current.audioCtx) return;
      const sr    = mic.current.audioCtx.sampleRate;
      const fftSz = mic.current.analyser.fftSize;
      const ps    = detectPeaksConfigured(fd, sr, fftSz, cfgRef.current);
      if (!ps.length) return;
      setDetectedNote(hzToNote(ps[0].hz));
      const hzList = ps.map(p => p.hz);
      setStringResults(evaluateStrings(hzList, targetChord));
      setAutoDetected(matchChordConfigured(hzList, cfgRef.current));
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [listening, targetChord, mic]);

  useEffect(() => () => stopListening(), [stopListening]);

  const correctCount = stringResults?.filter(s => s.status === 'correct').length ?? 0;
  const playCount    = stringResults?.filter(s => s.expected === 'play').length ?? 0;
  const allCorrect   = playCount > 0 && correctCount === playCount;
  const pctDiff      = ((maxDiff - 1) / 9) * 100;

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 rounded-xl" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
        <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--color-ink-faint)' }}>{tr.maxDiff}</span>
        <input type="range" min={1} max={10} step={1} value={maxDiff}
          onChange={e => setMaxDiff(Number(e.target.value))} className="flex-1"
          style={{ background: `linear-gradient(to right, var(--color-brand) ${pctDiff}%, var(--color-surface-550) ${pctDiff}%)` }} />
        <DifficultyBadge score={maxDiff} />
        <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--color-ink-ghost)' }}>
          {groups.reduce((n, g) => n + g.chords.length, 0)}
        </span>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
        <div className="px-3 sm:px-4 pt-3 pb-2">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-ink-ghost)' }}>{tr.targetChord}</p>
          <div className="flex flex-wrap gap-y-2 gap-x-3">
            {groups.map(g => (
              <div key={g.label} className="flex flex-wrap gap-1 items-center">
                <span className="text-xs mr-0.5" style={{ color: 'var(--color-ink-ghost)' }}>{g.label}:</span>
                {g.chords.map(chord => (
                  <ChordTip key={chord.name + chord.type} name={chord.name}>
                    <button
                      onClick={() => { setTargetChord(chord); setStringResults(null); setAutoDetected(null); }}
                      className="px-2 py-1 rounded-lg text-xs font-semibold transition-all"
                      style={targetChord === chord
                        ? { background: 'var(--color-brand)', color: 'var(--color-surface-base)' }
                        : { background: 'var(--color-surface-850)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}>
                      {chord.name}
                    </button>
                  </ChordTip>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-3 sm:gap-4 px-3 sm:px-4 py-3" style={{ borderTop: '1px solid var(--color-surface-700)' }}>
          <div className="shrink-0"><FretboardDiagram chord={targetChord} /></div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base sm:text-lg mb-0.5" style={{ color: 'var(--color-ink)' }}>{targetChord.name}</p>
            <p className="text-xs mb-2" style={{ color: 'var(--color-ink-faint)' }}>{targetChord.type} · {targetChord.tab}</p>
            <div className="flex gap-1 flex-wrap">
              {targetChord.tab.split('').map((ch, s) => (
                <span key={s} className="inline-flex flex-col items-center px-1.5 py-1 rounded text-xs"
                  style={{
                    border: `1px solid ${ch === 'x' ? 'var(--color-surface-550)' : STRING_COLORS[s] + '55'}`,
                    background: ch === 'x' ? 'var(--color-surface-850)' : STRING_COLORS[s] + '18',
                    color: ch === 'x' ? 'var(--color-ink-ghost)' : STRING_COLORS[s],
                  }}>
                  <span className="font-bold leading-none">{STRING_LABELS[s]}</span>
                  <span className="leading-none mt-0.5">{ch === 'x' ? '×' : ch === '0' ? 'o' : ch}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {!listening ? (
          <button onClick={startListening}
            className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
            {tr.startListening}
          </button>
        ) : (
          <button onClick={stopListening}
            className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="animate-pulse">●</span> {tr.stop}
          </button>
        )}
        {permissionDenied && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{tr.micAccessDenied}</p>}
        {listening && <div className="flex-1"><VolumeBar level={volume} /></div>}
      </div>

      {listening && (
        <div className="space-y-3">
          {autoDetected && (
            <div className="flex items-center gap-3 rounded-xl px-3 sm:px-4 py-3"
              style={{ background: autoDetected.chord === targetChord ? 'rgba(74,222,128,0.08)' : 'var(--color-surface-750)', border: `1px solid ${autoDetected.chord === targetChord ? 'rgba(74,222,128,0.25)' : 'var(--color-surface-650)'}` }}>
              <span className="text-xl">{autoDetected.chord === targetChord ? '🎯' : '🎵'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-ink-ghost)' }}>{tr.detected}</p>
                <p className="font-bold text-base" style={{ color: autoDetected.chord === targetChord ? 'var(--color-success)' : 'var(--color-ink)' }}>
                  {autoDetected.chord.name}
                  <span className="text-xs font-normal ml-2" style={{ color: 'var(--color-ink-faint)' }}>{autoDetected.chord.type}</span>
                </p>
              </div>
              {autoDetected.chord === targetChord
                ? <span className="text-xs font-bold" style={{ color: 'var(--color-success)' }}>{tr.correct}</span>
                : <span className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>{tr.expected} <strong style={{ color: 'var(--color-brand)' }}>{targetChord.name}</strong></span>}
            </div>
          )}
          {detectedNote && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              <span>{tr.strongest}</span>
              <span className="font-bold" style={{ color: 'var(--color-ink)' }}>{detectedNote.name}{detectedNote.octave}</span>
              <span className="tabular-nums">{Math.round(detectedNote.hz)} Hz</span>
              {Math.abs(detectedNote.cents) > 5 && (
                <span style={{ color: detectedNote.cents > 0 ? 'var(--color-warning)' : 'var(--color-info)' }}>
                  {detectedNote.cents > 0 ? `+${detectedNote.cents}¢` : `${detectedNote.cents}¢`}
                </span>
              )}
            </div>
          )}
          {stringResults && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-ghost)' }}>{tr.stringAnalysis}</p>
                {playCount > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={allCorrect ? { background: 'rgba(74,222,128,0.1)', color: 'var(--color-success)' } : { background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)' }}>
                    {correctCount}/{playCount}
                  </span>
                )}
              </div>
              <StringFeedback stringResults={stringResults} />
            </div>
          )}
          {!stringResults && volume < 0.05 && (
            <div className="text-center py-8" style={{ color: 'var(--color-ink-ghost)' }}>
              <p className="text-3xl mb-2">🎸</p>
              <p className="text-sm">{tr.playGuitar}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * With no `mode` prop: the classic four-tool screen with its own sub-tab bar.
 * With `mode` ('recorder' | 'practice' | 'game' | 'tune'): renders that single
 * tool with no sub-tab bar — used by App.jsx, which now exposes Recorder,
 * Practice and Tune as their own ☰-menu entries and keeps Play-Along as the
 * main tab.
 */
export default function ChordListener({ lang, mode = null }) {
  const tr  = useT(lang);
  const [tab, setTab] = useState('recorder');
  const [cfg, setCfg] = useState(loadConfig);
  const active = mode || tab;

  const TABS = [
    { id: 'recorder', icon: '🎤', label: 'Recorder' },
    { id: 'practice', icon: '🎸', label: 'Practice' },
    { id: 'game',     icon: '🎮', label: 'Play-Along' },
    { id: 'tune',     icon: '⚙️',  label: 'Tune' },
  ];

  return (
    <div className="p-3 sm:p-5">
      {!mode && (
        <div className="flex gap-1 p-1 rounded-xl mb-4" style={{ background: 'var(--color-surface-800)' }}>
          {TABS.map(({ id, icon, label }) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
              style={tab === id
                ? { background: 'var(--color-surface-700)', color: 'var(--color-brand)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
                : { color: 'var(--color-ink-faint)' }}>
              <span>{icon}</span><span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {active === 'recorder' && <RecorderMode cfg={cfg} />}
      {active === 'practice' && <PracticeMode cfg={cfg} tr={tr} />}
      {active === 'game'     && <PracticeGame cfg={cfg} />}
      {active === 'tune'     && <TuneMode cfg={cfg} setCfg={setCfg} />}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import {
  detectPeaksFFT,
  evaluateStrings,
  matchChord,
  hzToNote,
  STRING_LABELS,
} from '../lib/pitchDetect';
import { playProgression, stopAudio } from '../lib/audio';
import FretboardDiagram from './FretboardDiagram';
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
const CFG_KEY   = 'guitar_detect_config';

// ── Detection config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  smoothing:    0.70,   // AnalyserNode smoothingTimeConstant  0..0.99
  minHz:        60,     // lowest frequency scanned (Hz)
  maxHz:        1200,   // highest frequency scanned (Hz)
  ampThresh:   -55,     // peak must be above this dB level   -90..-20
  maxPeaks:     8,      // how many peaks passed to matcher   1..16
  silenceRms:   0.008,  // RMS below which a segment is skipped
  segmentMs:    2000,   // recorder: ms between chord snapshots
  minScore:     0.25,   // Jaccard score threshold to accept match  0..1
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
}

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

function detectPeaksConfigured(freqData, sampleRate, fftSize, cfg) {
  const binHz  = sampleRate / fftSize;
  const minBin = Math.max(1, Math.floor(cfg.minHz / binHz));
  const maxBin = Math.min(freqData.length - 2, Math.ceil(cfg.maxHz / binHz));
  const peaks  = [];
  for (let i = minBin + 1; i < maxBin; i++) {
    const v = freqData[i];
    if (v > freqData[i - 1] && v > freqData[i + 1] && v > cfg.ampThresh) {
      const shift = (freqData[i + 1] - freqData[i - 1]) /
        (2 * (2 * freqData[i] - freqData[i - 1] - freqData[i + 1])) || 0;
      peaks.push({ hz: (i + shift) * binHz, amplitude: v });
    }
  }
  peaks.sort((a, b) => b.amplitude - a.amplitude);
  return peaks.slice(0, cfg.maxPeaks);
}

function matchChordConfigured(hzList, cfg) {
  const result = matchChord(hzList, CHORDS);
  if (!result) return null;
  return result.score >= cfg.minScore ? result : null;
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
  const color = level > 0.7 ? '#f87171' : level > 0.3 ? '#4ade80' : '#3a3a3a';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-6" style={{ color: '#3a3a3a' }}>Vol</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#222' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums w-7 text-right" style={{ color: '#3a3a3a' }}>{pct}%</span>
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
              s.status === 'missing' ? '#2a2a2a' : '#1e1e1e'}`,
            opacity: s.status === 'muted' ? 0.35 : 1,
          }}>
          <span className="text-xs font-bold mb-1" style={{ color: STRING_COLORS[i] }}>{STRING_LABELS[i]}</span>
          {s.status === 'correct' && <span style={{ color: '#4ade80', fontSize: 14 }}>✓</span>}
          {s.status === 'wrong'   && <span style={{ color: '#f87171', fontSize: 14 }}>✗</span>}
          {s.status === 'missing' && <span style={{ color: '#5a5a5a', fontSize: 14 }}>–</span>}
          {s.status === 'muted'   && <span style={{ color: '#3a3a3a', fontSize: 12 }}>×</span>}
        </div>
      ))}
    </div>
  );
}

// ── ConfigSlider ──────────────────────────────────────────────────────────────

function ConfigSlider({ label, hint, value, min, max, step, format, onChange, color = '#c9a96e' }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="rounded-xl p-3" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: '#d0cdc8' }}>{label}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{format(value)}</span>
      </div>
      {hint && <p className="text-xs mb-2" style={{ color: '#4a4a4a' }}>{hint}</p>}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full"
        style={{ background: `linear-gradient(to right, ${color} ${pct}%, #2a2a2a ${pct}%)` }}
      />
      <div className="flex justify-between text-xs mt-1" style={{ color: '#2a2a2a' }}>
        <span>{format(min)}</span><span>{format(max)}</span>
      </div>
    </div>
  );
}

// ── useMic — shared mic setup hook ───────────────────────────────────────────
// Returns a stable ref whose .current always has the latest API.
// This avoids identity-change problems when passed to useCallback deps.

function useMic() {
  const streamRef   = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const freqDataRef = useRef(null);
  const timeDataRef = useRef(null);

  // Stable API object — never reassigned, so it's safe as a useCallback dep
  const api = useRef({
    async open(smoothing) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 44100 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = smoothing;
      source.connect(analyser);
      analyserRef.current = analyser;
      freqDataRef.current = new Float32Array(analyser.frequencyBinCount);
      timeDataRef.current = new Float32Array(analyser.fftSize);
    },
    close() {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
      streamRef.current = null; audioCtxRef.current = null; analyserRef.current = null;
      freqDataRef.current = null; timeDataRef.current = null;
    },
    getRMS() {
      const td = timeDataRef.current;
      if (!td || !analyserRef.current) return 0;
      analyserRef.current.getFloatTimeDomainData(td);
      let sum = 0;
      for (let i = 0; i < td.length; i++) sum += td[i] ** 2;
      return Math.sqrt(sum / td.length);
    },
    getFreqData() {
      if (!analyserRef.current) return null;
      analyserRef.current.getFloatFrequencyData(freqDataRef.current);
      return freqDataRef.current;
    },
    updateSmoothing(v) {
      if (analyserRef.current) analyserRef.current.smoothingTimeConstant = v;
    },
    get audioCtx() { return audioCtxRef.current; },
    get analyser() { return analyserRef.current; },
  });

  return api;
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
      <div className="rounded-xl p-4" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <div className="flex items-center gap-3 mb-3">
          {!active ? (
            <button onClick={start}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#c9a96e', color: '#0f0f0f' }}>
              🎙️ Start preview
            </button>
          ) : (
            <button onClick={stop}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              <span className="animate-pulse">●</span> Stop
            </button>
          )}
          {permDenied && <p className="text-xs" style={{ color: '#f87171' }}>Mic access denied.</p>}
          {active && <div className="flex-1"><VolumeBar level={volume} /></div>}
          <button onClick={reset}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg"
            style={{ border: '1px solid #2a2a2a', color: '#3a3a3a' }}>
            Reset defaults
          </button>
        </div>

        {/* Live readout */}
        {active && (
          <div className="space-y-3 mt-2">

            {/* ── Chord / fretboard monitor ── */}
            <div className="rounded-xl overflow-hidden" style={{ background: '#111', border: `1.5px solid ${matched ? (matched.score >= 0.6 ? 'rgba(74,222,128,0.3)' : matched.score >= 0.4 ? 'rgba(201,169,110,0.35)' : 'rgba(251,146,60,0.3)') : '#1e1e1e'}`, transition: 'border-color 0.3s' }}>
              <div className="px-3 pt-3 pb-2 flex items-start gap-3">
                {/* left: diagram or placeholder */}
                <div className="shrink-0">
                  {matched ? (
                    <FretboardDiagram chord={matched.chord} />
                  ) : (
                    <div className="flex items-center justify-center rounded-lg" style={{ width: 72, height: 90, background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                      <span style={{ fontSize: 28, opacity: 0.25 }}>🎸</span>
                    </div>
                  )}
                </div>

                {/* right: chord info */}
                <div className="flex-1 min-w-0 pt-1">
                  {matched ? (
                    <>
                      <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                        <span className="text-2xl font-black leading-none" style={{ color: '#f0ede8' }}>{matched.chord.name}</span>
                        <span className="text-xs" style={{ color: '#5a5a5a' }}>{matched.chord.type}</span>
                        <DifficultyBadge score={calcDifficulty(matched.chord.notes)} />
                      </div>
                      <p className="text-xs font-mono mb-2" style={{ color: '#4a4a4a' }}>{matched.chord.tab}</p>
                      {/* score bar */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#2a2a2a' }}>
                          <div className="h-full rounded-full transition-all duration-200"
                            style={{ width: `${matched.score * 100}%`,
                              background: matched.score >= 0.6 ? '#4ade80' : matched.score >= 0.4 ? '#c9a96e' : '#fb923c' }} />
                        </div>
                        <span className="text-xs tabular-nums font-bold w-9 text-right"
                          style={{ color: matched.score >= 0.6 ? '#4ade80' : matched.score >= 0.4 ? '#c9a96e' : '#fb923c' }}>
                          {Math.round(matched.score * 100)}%
                        </span>
                      </div>
                      {/* string indicators */}
                      <div className="flex gap-1">
                        {matched.chord.tab.split('').map((ch, s) => (
                          <span key={s} className="inline-flex flex-col items-center px-1 py-0.5 rounded text-[10px]"
                            style={{
                              border: `1px solid ${ch === 'x' ? '#2a2a2a' : STRING_COLORS[s] + '55'}`,
                              background: ch === 'x' ? '#141414' : STRING_COLORS[s] + '18',
                              color: ch === 'x' ? '#3a3a3a' : STRING_COLORS[s],
                            }}>
                            <span className="font-bold leading-none">{STRING_LABELS[s]}</span>
                            <span className="leading-none mt-0.5">{ch === 'x' ? '×' : ch === '0' ? 'o' : ch}</span>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col justify-center h-full">
                      <p className="text-sm font-semibold mb-1" style={{ color: '#3a3a3a' }}>No chord detected</p>
                      <p className="text-xs" style={{ color: '#2a2a2a' }}>
                        {peaks.length ? `Match score below ${Math.round(cfg.minScore * 100)}% threshold` : 'No signal — play or sing louder'}
                      </p>
                      {notes.length > 0 && (
                        <p className="text-xs mt-1" style={{ color: '#4a4a4a' }}>Notes heard: {notes.join(' · ')}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* detected note classes row */}
              {notes.length > 0 && (
                <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs" style={{ color: '#3a3a3a' }}>Notes:</span>
                  {notes.map(n => (
                    <span key={n} className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: '#1e1e1e', color: '#c9a96e', border: '1px solid #2a2a2a' }}>
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Peaks panel ── */}
            <div className="rounded-lg p-3" style={{ background: '#111', border: '1px solid #1e1e1e' }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3a3a3a' }}>
                Detected peaks ({peaks.length})
              </p>
              {peaks.length === 0 ? (
                <p className="text-xs italic" style={{ color: '#2a2a2a' }}>no peaks — try playing or singing louder</p>
              ) : (
                <div className="space-y-1.5">
                  {peaks.slice(0, 6).map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full overflow-hidden shrink-0" style={{ background: '#2a2a2a' }}>
                        <div className="h-full rounded-full"
                          style={{ width: `${Math.max(0, ((p.amplitude - cfg.ampThresh) / Math.abs(cfg.ampThresh)) * 100)}%`, background: '#c9a96e' }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: '#c9a96e', minWidth: 44 }}>
                        {Math.round(p.hz)} Hz
                      </span>
                      {p.note && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                          style={{ background: '#1e1e1e', color: '#f0ede8' }}>
                          {p.note.name}{p.note.octave}
                        </span>
                      )}
                      <span className="text-xs tabular-nums" style={{ color: '#3a3a3a' }}>
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
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#3a3a3a' }}>
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
      <div className="rounded-xl px-4 py-3 text-xs space-y-1" style={{ background: 'rgba(201,169,110,0.06)', border: '1px solid rgba(201,169,110,0.12)', color: '#7a7a7a' }}>
        <p className="font-semibold" style={{ color: '#c9a96e' }}>Tips for singing / humming</p>
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
      style={{ background: recording ? '#f87171' : '#3a3a3a', boxShadow: recording ? '0 0 8px #f87171' : 'none' }} />
  );
}

function ChordCard({ entry, onPlay, onRemove, active }) {
  const [showDiagram, setShowDiagram] = useState(false);
  const chord = entry.chord;

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{ border: `1.5px solid ${active ? '#c9a96e' : '#1e1e1e'}`, background: active ? 'rgba(201,169,110,0.06)' : '#161616' }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs tabular-nums font-mono shrink-0" style={{ color: '#3a3a3a', minWidth: 32 }}>
          {entry.ts}
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-sm" style={{ color: active ? '#c9a96e' : '#f0ede8' }}>
            {chord ? chord.name : '?'}
          </span>
          {chord && <span className="text-xs ml-1.5" style={{ color: '#4a4a4a' }}>{chord.type}</span>}
          {entry.score != null && (
            <span className="text-xs ml-2 tabular-nums" style={{ color: entry.score >= 0.5 ? '#4ade80' : entry.score >= 0.3 ? '#c9a96e' : '#fb923c' }}>
              {Math.round(entry.score * 100)}%
            </span>
          )}
        </div>
        <div className="hidden sm:flex gap-1 flex-wrap justify-end max-w-[120px]">
          {entry.notes.map(n => (
            <span key={n} className="text-[10px] px-1.5 py-0.5 rounded font-bold"
              style={{ background: '#1e1e1e', color: '#5a5a5a' }}>{n}</span>
          ))}
        </div>
        {chord && <div className="shrink-0"><DifficultyBadge score={calcDifficulty(chord.notes)} /></div>}
        <div className="flex items-center gap-1 shrink-0">
          {chord && (
            <button onClick={() => setShowDiagram(v => !v)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
              style={showDiagram ? { background: 'rgba(201,169,110,0.12)', color: '#c9a96e' } : { background: '#1e1e1e', color: '#5a5a5a' }}>
              🎸
            </button>
          )}
          <button onClick={() => onPlay(entry)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
            style={active ? { background: 'rgba(239,68,68,0.15)', color: '#f87171' } : { background: '#1e1e1e', color: '#c9a96e' }}>
            {active ? '■' : '▶'}
          </button>
          <button onClick={() => onRemove(entry.id)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
            style={{ background: '#1e1e1e', color: '#3a3a3a' }}>✕</button>
        </div>
      </div>
      {showDiagram && chord && (
        <div className="px-3 pb-3 pt-1 flex gap-3 items-start" style={{ borderTop: '1px solid #1e1e1e' }}>
          <FretboardDiagram chord={chord} />
          <div className="text-xs space-y-1 pt-1" style={{ color: '#4a4a4a' }}>
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
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3a3a3a' }}>Saved sessions</p>
      <div className="space-y-1.5">
        {sequences.map(seq => (
          <div key={seq.id} className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: '#1a1a1a', border: '1px solid #1e1e1e' }}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: '#f0ede8' }}>{seq.name}</p>
              <p className="text-xs" style={{ color: '#3a3a3a' }}>{seq.entries.length} chords · {seq.date}</p>
            </div>
            <button onClick={() => onLoad(seq)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(201,169,110,0.1)', color: '#c9a96e', border: '1px solid rgba(201,169,110,0.2)' }}>
              Load
            </button>
            <button onClick={() => onDelete(seq.id)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
              style={{ background: '#1e1e1e', color: '#3a3a3a' }}>✕</button>
          </div>
        ))}
      </div>
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
      <div className="rounded-xl p-4" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {phase === 'idle' && (
            <button onClick={startRecording}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-bold"
              style={{ background: '#f87171', color: '#0f0f0f' }}>
              <RecordingDot recording={false} /> Record
            </button>
          )}
          {phase === 'recording' && (
            <button onClick={stopRecording}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-bold"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              <RecordingDot recording={true} /> Stop
            </button>
          )}
          {phase === 'done' && (
            <button onClick={() => { setPhase('idle'); setEntries([]); stopAudio(); setActiveId(null); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#1e1e1e', color: '#7a7a7a', border: '1px solid #2a2a2a' }}>
              New recording
            </button>
          )}

          {phase === 'recording' && (
            <div className="flex-1 min-w-[120px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono" style={{ color: '#f87171' }}>{fmt(elapsed)}</span>
                <span className="text-xs" style={{ color: '#3a3a3a' }}>{MAX_S}s max</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: '#2a2a2a' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${elPct}%`, background: '#f87171' }} />
              </div>
            </div>
          )}

          {phase === 'done' && entries.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={handlePlayAll}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                style={activeId === 'all'
                  ? { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }
                  : { background: 'rgba(201,169,110,0.1)', color: '#c9a96e', border: '1px solid rgba(201,169,110,0.25)' }}>
                {activeId === 'all' ? '■' : '▶'} Play all
              </button>
              <button onClick={() => setShowSave(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                style={showSave
                  ? { background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }
                  : { background: '#1e1e1e', color: '#7a7a7a', border: '1px solid #2a2a2a' }}>
                💾 Save
              </button>
            </div>
          )}
        </div>

        {phase === 'recording' && <VolumeBar level={volume} />}
        {permDenied && <p className="text-xs mt-2" style={{ color: '#f87171' }}>Microphone access denied.</p>}

        {showSave && (
          <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #1e1e1e' }}>
            <input value={saveName} onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Session name (optional)"
              className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
              style={{ background: '#111', border: '1px solid #2a2a2a', color: '#f0ede8' }}
              autoFocus />
            <button onClick={handleSave}
              className="px-4 py-2 rounded-xl text-xs font-bold"
              style={{ background: '#4ade80', color: '#0f0f0f' }}>Save</button>
          </div>
        )}
      </div>

      {phase === 'idle' && !entries.length && (
        <div className="text-center py-10" style={{ color: '#3a3a3a' }}>
          <p className="text-4xl mb-3">🎤</p>
          <p className="text-sm font-semibold mb-1" style={{ color: '#5a5a5a' }}>Sing or hum a melody</p>
          <p className="text-xs">Hit record, then sing — chords are sampled every {cfg.segmentMs / 1000}s.</p>
          <p className="text-xs mt-1" style={{ color: '#2a2a2a' }}>Use the <strong style={{ color: '#c9a96e' }}>Tune</strong> tab to calibrate detection for your voice.</p>
        </div>
      )}

      {phase === 'recording' && entries.length === 0 && (
        <div className="text-center py-8" style={{ color: '#3a3a3a' }}>
          <p className="text-3xl mb-2 animate-pulse">🎙️</p>
          <p className="text-sm">Listening… sing or hum steadily.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#3a3a3a' }}>
              {entries.length} segment{entries.length !== 1 ? 's' : ''}
            </p>
            <button onClick={() => { setEntries([]); stopAudio(); setActiveId(null); }}
              className="text-xs px-2 py-1 rounded-lg"
              style={{ color: '#3a3a3a', border: '1px solid #1e1e1e' }}>
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
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 rounded-xl" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: '#5a5a5a' }}>{tr.maxDiff}</span>
        <input type="range" min={1} max={10} step={1} value={maxDiff}
          onChange={e => setMaxDiff(Number(e.target.value))} className="flex-1"
          style={{ background: `linear-gradient(to right, #c9a96e ${pctDiff}%, #2a2a2a ${pctDiff}%)` }} />
        <DifficultyBadge score={maxDiff} />
        <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: '#3a3a3a' }}>
          {groups.reduce((n, g) => n + g.chords.length, 0)}
        </span>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <div className="px-3 sm:px-4 pt-3 pb-2">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3a3a3a' }}>{tr.targetChord}</p>
          <div className="flex flex-wrap gap-y-2 gap-x-3">
            {groups.map(g => (
              <div key={g.label} className="flex flex-wrap gap-1 items-center">
                <span className="text-xs mr-0.5" style={{ color: '#3a3a3a' }}>{g.label}:</span>
                {g.chords.map(chord => (
                  <button key={chord.name + chord.type}
                    onClick={() => { setTargetChord(chord); setStringResults(null); setAutoDetected(null); }}
                    className="px-2 py-1 rounded-lg text-xs font-semibold transition-all"
                    style={targetChord === chord
                      ? { background: '#c9a96e', color: '#0f0f0f' }
                      : { background: '#141414', color: '#7a7a7a', border: '1px solid #2a2a2a' }}>
                    {chord.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-3 sm:gap-4 px-3 sm:px-4 py-3" style={{ borderTop: '1px solid #1e1e1e' }}>
          <div className="shrink-0"><FretboardDiagram chord={targetChord} /></div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base sm:text-lg mb-0.5" style={{ color: '#f0ede8' }}>{targetChord.name}</p>
            <p className="text-xs mb-2" style={{ color: '#5a5a5a' }}>{targetChord.type} · {targetChord.tab}</p>
            <div className="flex gap-1 flex-wrap">
              {targetChord.tab.split('').map((ch, s) => (
                <span key={s} className="inline-flex flex-col items-center px-1.5 py-1 rounded text-xs"
                  style={{
                    border: `1px solid ${ch === 'x' ? '#2a2a2a' : STRING_COLORS[s] + '55'}`,
                    background: ch === 'x' ? '#141414' : STRING_COLORS[s] + '18',
                    color: ch === 'x' ? '#3a3a3a' : STRING_COLORS[s],
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
            style={{ background: '#c9a96e', color: '#0f0f0f' }}>
            {tr.startListening}
          </button>
        ) : (
          <button onClick={stopListening}
            className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
            <span className="animate-pulse">●</span> {tr.stop}
          </button>
        )}
        {permissionDenied && <p className="text-xs" style={{ color: '#f87171' }}>{tr.micAccessDenied}</p>}
        {listening && <div className="flex-1"><VolumeBar level={volume} /></div>}
      </div>

      {listening && (
        <div className="space-y-3">
          {autoDetected && (
            <div className="flex items-center gap-3 rounded-xl px-3 sm:px-4 py-3"
              style={{ background: autoDetected.chord === targetChord ? 'rgba(74,222,128,0.08)' : '#1a1a1a', border: `1px solid ${autoDetected.chord === targetChord ? 'rgba(74,222,128,0.25)' : '#222'}` }}>
              <span className="text-xl">{autoDetected.chord === targetChord ? '🎯' : '🎵'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#3a3a3a' }}>{tr.detected}</p>
                <p className="font-bold text-base" style={{ color: autoDetected.chord === targetChord ? '#4ade80' : '#f0ede8' }}>
                  {autoDetected.chord.name}
                  <span className="text-xs font-normal ml-2" style={{ color: '#5a5a5a' }}>{autoDetected.chord.type}</span>
                </p>
              </div>
              {autoDetected.chord === targetChord
                ? <span className="text-xs font-bold" style={{ color: '#4ade80' }}>{tr.correct}</span>
                : <span className="text-xs" style={{ color: '#5a5a5a' }}>{tr.expected} <strong style={{ color: '#c9a96e' }}>{targetChord.name}</strong></span>}
            </div>
          )}
          {detectedNote && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#5a5a5a' }}>
              <span>{tr.strongest}</span>
              <span className="font-bold" style={{ color: '#f0ede8' }}>{detectedNote.name}{detectedNote.octave}</span>
              <span className="tabular-nums">{Math.round(detectedNote.hz)} Hz</span>
              {Math.abs(detectedNote.cents) > 5 && (
                <span style={{ color: detectedNote.cents > 0 ? '#fb923c' : '#38bdf8' }}>
                  {detectedNote.cents > 0 ? `+${detectedNote.cents}¢` : `${detectedNote.cents}¢`}
                </span>
              )}
            </div>
          )}
          {stringResults && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#3a3a3a' }}>{tr.stringAnalysis}</p>
                {playCount > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={allCorrect ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80' } : { background: '#1e1e1e', color: '#5a5a5a' }}>
                    {correctCount}/{playCount}
                  </span>
                )}
              </div>
              <StringFeedback stringResults={stringResults} />
            </div>
          )}
          {!stringResults && volume < 0.05 && (
            <div className="text-center py-8" style={{ color: '#3a3a3a' }}>
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

export default function ChordListener({ lang }) {
  const tr  = useT(lang);
  const [tab, setTab] = useState('recorder');
  const [cfg, setCfg] = useState(loadConfig);

  const TABS = [
    { id: 'recorder', icon: '🎤', label: 'Recorder' },
    { id: 'practice', icon: '🎸', label: 'Practice' },
    { id: 'tune',     icon: '⚙️',  label: 'Tune' },
  ];

  return (
    <div className="p-3 sm:p-5">
      <div className="flex gap-1 p-1 rounded-xl mb-4" style={{ background: '#161616' }}>
        {TABS.map(({ id, icon, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all"
            style={tab === id
              ? { background: '#1e1e1e', color: '#c9a96e', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
              : { color: '#5a5a5a' }}>
            <span>{icon}</span><span>{label}</span>
          </button>
        ))}
      </div>

      {tab === 'recorder' && <RecorderMode cfg={cfg} />}
      {tab === 'practice' && <PracticeMode cfg={cfg} tr={tr} />}
      {tab === 'tune'     && <TuneMode cfg={cfg} setCfg={setCfg} />}
    </div>
  );
}

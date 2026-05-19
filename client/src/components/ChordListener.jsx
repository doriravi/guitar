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

const CHORD_GROUPS = [
  { label: 'Open Major',    types: ['Major','Major (easy)'] },
  { label: 'Open Minor',    types: ['Minor'] },
  { label: 'Dom 7',         types: ['Dom 7'] },
  { label: 'Minor 7',       types: ['Minor 7','Minor 7 (barre)'] },
  { label: 'Major 7',       types: ['Maj 7'] },
  { label: 'Barre',         types: ['Major (barre)','Minor (barre)'] },
  { label: 'Power',         types: ['Power'] },
  { label: 'Other',         types: [] },
];

const CHORDS_WITH_SCORE = CHORDS.map(c => ({ ...c, score: calcDifficulty(c.notes) }));

const SAVED_KEY = 'guitar_saved_sequences';

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
}
function persistSaved(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch {}
}

// ── Shared sub-components ─────────────────────────────────────────────────────

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

function StringFeedback({ stringResults }) {
  if (!stringResults) return null;
  return (
    <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
      {stringResults.map((s, i) => (
        <div
          key={i}
          className="flex flex-col items-center rounded-xl py-2 px-1 transition-all"
          style={{
            background:
              s.status === 'correct' ? 'rgba(34,197,94,0.12)' :
              s.status === 'wrong'   ? 'rgba(239,68,68,0.12)' :
              s.status === 'missing' ? 'rgba(255,255,255,0.04)' :
                                       'rgba(255,255,255,0.02)',
            border: `1.5px solid ${
              s.status === 'correct' ? 'rgba(34,197,94,0.3)' :
              s.status === 'wrong'   ? 'rgba(239,68,68,0.3)' :
              s.status === 'missing' ? '#2a2a2a' : '#1e1e1e'
            }`,
            opacity: s.status === 'muted' ? 0.35 : 1,
          }}
        >
          <span className="text-xs font-bold mb-1" style={{ color: STRING_COLORS[i] }}>
            {STRING_LABELS[i]}
          </span>
          {s.status === 'correct' && <span style={{ color: '#4ade80', fontSize: 14 }}>✓</span>}
          {s.status === 'wrong'   && <span style={{ color: '#f87171', fontSize: 14 }}>✗</span>}
          {s.status === 'missing' && <span style={{ color: '#5a5a5a', fontSize: 14 }}>–</span>}
          {s.status === 'muted'   && <span style={{ color: '#3a3a3a', fontSize: 12 }}>×</span>}
          {!['correct','wrong','missing','muted'].includes(s.status) && <span style={{ color: '#3a3a3a' }}>?</span>}
          {s.status !== 'muted' && s.detectedHz && (
            <span className="text-xs tabular-nums mt-1 hidden sm:block" style={{ color: '#3a3a3a' }}>
              {Math.round(s.detectedHz)}Hz
            </span>
          )}
          {s.status === 'wrong' && s.centsDiff != null && (
            <span className="text-xs mt-0.5 hidden sm:block" style={{ color: '#fb923c' }}>
              {s.centsDiff}¢
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function VolumeBar({ level }) {
  const pct = Math.round(level * 100);
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

// ── MODE: PRACTICE ────────────────────────────────────────────────────────────

function PracticeMode({ tr }) {
  const [listening, setListening]               = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [targetChord, setTargetChord]           = useState(CHORDS_WITH_SCORE[0]);
  const [maxDiff, setMaxDiff]                   = useState(10);
  const [stringResults, setStringResults]       = useState(null);
  const [detectedNote, setDetectedNote]         = useState(null);
  const [autoDetected, setAutoDetected]         = useState(null);
  const [volume, setVolume]                     = useState(0);

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef   = useRef(null);
  const rafRef      = useRef(null);
  const freqDataRef = useRef(null);
  const timeDataRef = useRef(null);

  const groups = useMemo(() => groupedChords(maxDiff), [maxDiff]);

  useEffect(() => {
    const allVisible = groups.flatMap(g => g.chords);
    if (allVisible.length > 0 && !allVisible.includes(targetChord)) {
      setTargetChord(allVisible[0]);
      setStringResults(null);
      setAutoDetected(null);
    }
  }, [groups, targetChord]);

  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) audioCtxRef.current.close();
    audioCtxRef.current = null; analyserRef.current = null;
    streamRef.current = null; freqDataRef.current = null; timeDataRef.current = null;
    setListening(false); setStringResults(null); setDetectedNote(null);
    setAutoDetected(null); setVolume(0);
  }, []);

  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 44100 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyserRef.current = analyser;
      freqDataRef.current = new Float32Array(analyser.frequencyBinCount);
      timeDataRef.current = new Float32Array(analyser.fftSize);
      setListening(true);
      setPermissionDenied(false);
    } catch (err) {
      if (err.name === 'NotAllowedError') setPermissionDenied(true);
    }
  }, []);

  useEffect(() => {
    if (!listening) return;
    let lastEvalTime = 0;
    function loop(ts) {
      rafRef.current = requestAnimationFrame(loop);
      const analyser = analyserRef.current;
      if (!analyser) return;
      analyser.getFloatFrequencyData(freqDataRef.current);
      analyser.getFloatTimeDomainData(timeDataRef.current);
      let rms = 0;
      for (let i = 0; i < timeDataRef.current.length; i++) rms += timeDataRef.current[i] ** 2;
      rms = Math.sqrt(rms / timeDataRef.current.length);
      setVolume(Math.min(1, rms * 8));
      if (ts - lastEvalTime < 120) return;
      lastEvalTime = ts;
      if (rms < 0.01) {
        setStringResults(null); setDetectedNote(null); setAutoDetected(null);
        return;
      }
      const sampleRate = audioCtxRef.current.sampleRate;
      const peaks = detectPeaksFFT(freqDataRef.current, sampleRate, analyser.fftSize, 8);
      if (!peaks.length) return;
      setDetectedNote(hzToNote(peaks[0].hz));
      const detectedHzList = peaks.map(p => p.hz);
      setStringResults(evaluateStrings(detectedHzList, targetChord));
      setAutoDetected(matchChord(detectedHzList, CHORDS));
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [listening, targetChord]);

  useEffect(() => () => stopListening(), [stopListening]);

  const correctCount = stringResults?.filter(s => s.status === 'correct').length ?? 0;
  const playCount    = stringResults?.filter(s => s.expected === 'play').length ?? 0;
  const allCorrect   = playCount > 0 && correctCount === playCount;
  const pctDiff      = ((maxDiff - 1) / 9) * 100;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Max difficulty */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 rounded-xl"
        style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: '#5a5a5a' }}>
          {tr.maxDiff}
        </span>
        <input
          type="range" min={1} max={10} step={1} value={maxDiff}
          onChange={e => setMaxDiff(Number(e.target.value))}
          className="flex-1"
          style={{ background: `linear-gradient(to right, #c9a96e ${pctDiff}%, #2a2a2a ${pctDiff}%)` }}
        />
        <DifficultyBadge score={maxDiff} />
        <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: '#3a3a3a' }}>
          {groups.reduce((n, g) => n + g.chords.length, 0)}
        </span>
      </div>

      {/* Chord selector */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <div className="px-3 sm:px-4 pt-3 pb-2">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3a3a3a' }}>{tr.targetChord}</p>
          <div className="flex flex-wrap gap-y-2 gap-x-3">
            {groups.map(g => (
              <div key={g.label} className="flex flex-wrap gap-1 items-center">
                <span className="text-xs mr-0.5" style={{ color: '#3a3a3a' }}>{g.label}:</span>
                {g.chords.map(chord => (
                  <button
                    key={chord.name + chord.type}
                    onClick={() => { setTargetChord(chord); setStringResults(null); setAutoDetected(null); }}
                    className="px-2 py-1 rounded-lg text-xs font-semibold transition-all"
                    style={targetChord === chord
                      ? { background: '#c9a96e', color: '#0f0f0f' }
                      : { background: '#141414', color: '#7a7a7a', border: '1px solid #2a2a2a' }}
                  >
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

      {/* Mic control */}
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
              style={{
                background: autoDetected.chord === targetChord ? 'rgba(74,222,128,0.08)' : '#1a1a1a',
                border: `1px solid ${autoDetected.chord === targetChord ? 'rgba(74,222,128,0.25)' : '#222'}`,
              }}>
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
                : <span className="text-xs" style={{ color: '#5a5a5a' }}>{tr.expected} <strong style={{ color: '#c9a96e' }}>{targetChord.name}</strong></span>
              }
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
                    style={allCorrect
                      ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80' }
                      : { background: '#1e1e1e', color: '#5a5a5a' }}>
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
          <div className="flex flex-wrap gap-3 text-xs pt-2" style={{ borderTop: '1px solid #1e1e1e', color: '#3a3a3a' }}>
            <span><span style={{ color: '#4ade80' }}>✓</span> correct</span>
            <span><span style={{ color: '#f87171' }}>✗</span> wrong</span>
            <span>– not heard</span>
            <span>× muted</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODE: RECORDER ────────────────────────────────────────────────────────────

const SEGMENT_MS   = 2000;   // analyse a new chord every 2 s
const MAX_RECORD_S = 60;     // cap recording at 60 s
const SILENCE_RMS  = 0.008;  // below this = silence, skip segment

function noteSetFromHz(hzList) {
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const pcs = new Set();
  for (const hz of hzList) {
    if (hz <= 0) continue;
    const midi = Math.round(69 + 12 * Math.log2(hz / 440));
    pcs.add(NOTE_NAMES[((midi % 12) + 12) % 12]);
  }
  return [...pcs];
}

function RecordingDot({ recording }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{
        background: recording ? '#f87171' : '#3a3a3a',
        boxShadow: recording ? '0 0 8px #f87171' : 'none',
        animation: recording ? 'pulse 1.2s ease-in-out infinite' : 'none',
      }}
    />
  );
}

function ChordCard({ entry, onPlay, onRemove, active }) {
  const [showDiagram, setShowDiagram] = useState(false);
  const chord = entry.chord;

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        border: `1.5px solid ${active ? '#c9a96e' : '#1e1e1e'}`,
        background: active ? 'rgba(201,169,110,0.06)' : '#161616',
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs tabular-nums font-mono shrink-0" style={{ color: '#3a3a3a', minWidth: 32 }}>
          {entry.ts}
        </span>

        <div className="flex-1 min-w-0">
          <span className="font-bold text-sm" style={{ color: active ? '#c9a96e' : '#f0ede8' }}>
            {chord ? chord.name : '?'}
          </span>
          {chord && (
            <span className="text-xs ml-1.5" style={{ color: '#4a4a4a' }}>{chord.type}</span>
          )}
        </div>

        {/* Notes pills */}
        <div className="hidden sm:flex gap-1 flex-wrap justify-end max-w-[120px]">
          {entry.notes.map(n => (
            <span key={n} className="text-[10px] px-1.5 py-0.5 rounded font-bold"
              style={{ background: '#1e1e1e', color: '#5a5a5a' }}>
              {n}
            </span>
          ))}
        </div>

        {/* Difficulty */}
        {chord && (
          <div className="shrink-0">
            <DifficultyBadge score={calcDifficulty(chord.notes)} />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {chord && (
            <button
              onClick={() => setShowDiagram(v => !v)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
              style={showDiagram
                ? { background: 'rgba(201,169,110,0.12)', color: '#c9a96e' }
                : { background: '#1e1e1e', color: '#5a5a5a' }}>
              🎸
            </button>
          )}
          <button
            onClick={() => onPlay(entry)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
            style={active
              ? { background: 'rgba(239,68,68,0.15)', color: '#f87171' }
              : { background: '#1e1e1e', color: '#c9a96e' }}>
            {active ? '■' : '▶'}
          </button>
          <button
            onClick={() => onRemove(entry.id)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
            style={{ background: '#1e1e1e', color: '#3a3a3a' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Fretboard diagram (toggle) */}
      {showDiagram && chord && (
        <div className="px-3 pb-3 pt-1 flex gap-3 items-start"
          style={{ borderTop: '1px solid #1e1e1e' }}>
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

function SavedSequences({ sequences, onLoad, onDelete, tr }) {
  if (!sequences.length) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3a3a3a' }}>
        Saved sequences
      </p>
      <div className="space-y-1.5">
        {sequences.map(seq => (
          <div key={seq.id} className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: '#1a1a1a', border: '1px solid #1e1e1e' }}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: '#f0ede8' }}>{seq.name}</p>
              <p className="text-xs" style={{ color: '#3a3a3a' }}>
                {seq.entries.length} chords · {seq.date}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => onLoad(seq)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(201,169,110,0.1)', color: '#c9a96e', border: '1px solid rgba(201,169,110,0.2)' }}>
                Load
              </button>
              <button
                onClick={() => onDelete(seq.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
                style={{ background: '#1e1e1e', color: '#3a3a3a' }}>
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecorderMode({ tr }) {
  const [phase, setPhase]           = useState('idle');   // idle | recording | done
  const [entries, setEntries]       = useState([]);       // { id, ts, chord, notes }
  const [elapsed, setElapsed]       = useState(0);
  const [volume, setVolume]         = useState(0);
  const [activeId, setActiveId]     = useState(null);     // currently playing card id
  const [savedSeqs, setSavedSeqs]   = useState(loadSaved);
  const [saveName, setSaveName]     = useState('');
  const [showSaveBox, setShowSaveBox] = useState(false);
  const [permDenied, setPermDenied] = useState(false);

  const streamRef   = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const freqDataRef = useRef(null);
  const timeDataRef = useRef(null);
  const rafRef      = useRef(null);
  const timerRef    = useRef(null);
  const startMsRef  = useRef(0);
  const segTimerRef = useRef(null);
  const nextIdRef   = useRef(1);

  const formatTs = ms => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  };

  // ── Analyse one segment ──────────────────────────────────────────────────────
  const analyseSegment = useCallback(() => {
    const analyser = analyserRef.current;
    const ctx      = audioCtxRef.current;
    if (!analyser || !ctx) return;

    analyser.getFloatFrequencyData(freqDataRef.current);
    analyser.getFloatTimeDomainData(timeDataRef.current);

    let rms = 0;
    for (let i = 0; i < timeDataRef.current.length; i++) rms += timeDataRef.current[i] ** 2;
    rms = Math.sqrt(rms / timeDataRef.current.length);

    if (rms < SILENCE_RMS) return;  // silence — skip

    const peaks       = detectPeaksFFT(freqDataRef.current, ctx.sampleRate, analyser.fftSize, 8);
    if (!peaks.length) return;

    const hzList      = peaks.map(p => p.hz);
    const matched     = matchChord(hzList, CHORDS);
    const notes       = noteSetFromHz(hzList);
    const ts          = formatTs(Date.now() - startMsRef.current);

    setEntries(prev => [
      ...prev,
      { id: nextIdRef.current++, ts, chord: matched?.chord ?? null, notes },
    ]);
  }, []);

  // ── Volume RAF loop ──────────────────────────────────────────────────────────
  const volLoop = useCallback(() => {
    rafRef.current = requestAnimationFrame(volLoop);
    const analyser = analyserRef.current;
    if (!analyser) return;
    analyser.getFloatTimeDomainData(timeDataRef.current);
    let rms = 0;
    for (let i = 0; i < timeDataRef.current.length; i++) rms += timeDataRef.current[i] ** 2;
    setVolume(Math.min(1, Math.sqrt(rms / timeDataRef.current.length) * 8));
  }, []);

  const stopHardware = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (segTimerRef.current) clearInterval(segTimerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) audioCtxRef.current.close();
    streamRef.current = null; audioCtxRef.current = null; analyserRef.current = null;
    freqDataRef.current = null; timeDataRef.current = null;
  }, []);

  // ── Start recording ──────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setPermDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 44100 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;
      freqDataRef.current = new Float32Array(analyser.frequencyBinCount);
      timeDataRef.current = new Float32Array(analyser.fftSize);

      startMsRef.current = Date.now();
      setElapsed(0);
      setEntries([]);
      setActiveId(null);
      nextIdRef.current = 1;
      setPhase('recording');

      // Elapsed timer
      timerRef.current = setInterval(() => {
        const el = Date.now() - startMsRef.current;
        setElapsed(el);
        if (el >= MAX_RECORD_S * 1000) stopRecording();
      }, 500);

      // Segment analyser — fires every SEGMENT_MS
      segTimerRef.current = setInterval(analyseSegment, SEGMENT_MS);

      // Volume RAF
      rafRef.current = requestAnimationFrame(volLoop);

    } catch (err) {
      if (err.name === 'NotAllowedError') setPermDenied(true);
    }
  }, [analyseSegment, volLoop]);

  // ── Stop recording ───────────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    analyseSegment();  // capture final segment
    stopHardware();
    setPhase('done');
    setVolume(0);
  }, [analyseSegment, stopHardware]);

  useEffect(() => () => stopHardware(), [stopHardware]);

  // ── Playback ─────────────────────────────────────────────────────────────────
  const handlePlay = useCallback((entry) => {
    if (!entry.chord) return;
    if (activeId === entry.id) {
      stopAudio();
      setActiveId(null);
      return;
    }
    stopAudio();
    setActiveId(entry.id);
    playProgression([entry.chord], 80, () => {}, () => setActiveId(null));
  }, [activeId]);

  const handlePlayAll = useCallback(() => {
    const playable = entries.filter(e => e.chord);
    if (!playable.length) return;
    if (activeId === 'all') {
      stopAudio();
      setActiveId(null);
      return;
    }
    stopAudio();
    setActiveId('all');
    let idx = 0;
    const advance = () => {
      if (idx >= playable.length) { setActiveId(null); return; }
      const e = playable[idx++];
      setActiveId(e.id);
      playProgression([e.chord], 80, () => {}, advance);
    };
    advance();
  }, [entries, activeId]);

  const handleRemove = useCallback((id) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    if (activeId === id) { stopAudio(); setActiveId(null); }
  }, [activeId]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!entries.length) return;
    const name  = saveName.trim() || `Session ${new Date().toLocaleTimeString()}`;
    const seq   = {
      id: Date.now(),
      name,
      date: new Date().toLocaleDateString(),
      entries,
    };
    const updated = [seq, ...savedSeqs];
    setSavedSeqs(updated);
    persistSaved(updated);
    setSaveName('');
    setShowSaveBox(false);
  };

  const handleDeleteSaved = (id) => {
    const updated = savedSeqs.filter(s => s.id !== id);
    setSavedSeqs(updated);
    persistSaved(updated);
  };

  const handleLoadSaved = (seq) => {
    stopAudio();
    setActiveId(null);
    setEntries(seq.entries);
    setPhase('done');
  };

  const elapsedPct = Math.min(100, (elapsed / (MAX_RECORD_S * 1000)) * 100);
  const elapsedStr = formatTs(elapsed);

  return (
    <div className="space-y-4">

      {/* ── Record controls ── */}
      <div className="rounded-xl p-4" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <div className="flex items-center gap-3 mb-3">
          {phase === 'idle' && (
            <button
              onClick={startRecording}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{ background: '#f87171', color: '#0f0f0f' }}>
              <RecordingDot recording={false} />
              Record
            </button>
          )}
          {phase === 'recording' && (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              <RecordingDot recording={true} />
              Stop
            </button>
          )}
          {phase === 'done' && (
            <button
              onClick={() => { setPhase('idle'); setEntries([]); stopAudio(); setActiveId(null); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#1e1e1e', color: '#7a7a7a', border: '1px solid #2a2a2a' }}>
              New recording
            </button>
          )}

          {phase === 'recording' && (
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono" style={{ color: '#f87171' }}>{elapsedStr}</span>
                <span className="text-xs" style={{ color: '#3a3a3a' }}>{MAX_RECORD_S}s max</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: '#2a2a2a' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${elapsedPct}%`, background: '#f87171' }} />
              </div>
            </div>
          )}

          {phase === 'done' && entries.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={handlePlayAll}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                style={activeId === 'all'
                  ? { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }
                  : { background: 'rgba(201,169,110,0.1)', color: '#c9a96e', border: '1px solid rgba(201,169,110,0.25)' }}>
                {activeId === 'all' ? '■' : '▶'} Play all
              </button>
              <button
                onClick={() => setShowSaveBox(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
                style={showSaveBox
                  ? { background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }
                  : { background: '#1e1e1e', color: '#7a7a7a', border: '1px solid #2a2a2a' }}>
                💾 Save
              </button>
            </div>
          )}
        </div>

        {/* Volume bar while recording */}
        {phase === 'recording' && (
          <VolumeBar level={volume} />
        )}

        {/* Permission denied */}
        {permDenied && (
          <p className="text-xs mt-2" style={{ color: '#f87171' }}>{tr.micAccessDenied}</p>
        )}

        {/* Save box */}
        {showSaveBox && (
          <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #1e1e1e' }}>
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Session name (optional)"
              className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
              style={{ background: '#111', border: '1px solid #2a2a2a', color: '#f0ede8' }}
              autoFocus
            />
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-xl text-xs font-bold"
              style={{ background: '#4ade80', color: '#0f0f0f' }}>
              Save
            </button>
          </div>
        )}
      </div>

      {/* ── Idle hint ── */}
      {phase === 'idle' && !entries.length && (
        <div className="text-center py-10" style={{ color: '#3a3a3a' }}>
          <p className="text-4xl mb-3">🎤</p>
          <p className="text-sm font-semibold mb-1" style={{ color: '#5a5a5a' }}>Sing or hum a melody</p>
          <p className="text-xs">Hit record, then sing — the system identifies chords every 2 seconds.</p>
        </div>
      )}

      {/* ── Recording hint ── */}
      {phase === 'recording' && entries.length === 0 && (
        <div className="text-center py-8" style={{ color: '#3a3a3a' }}>
          <p className="text-3xl mb-2 animate-pulse">🎙️</p>
          <p className="text-sm">Listening… sing or hum steadily.</p>
        </div>
      )}

      {/* ── Chord timeline ── */}
      {entries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#3a3a3a' }}>
              Detected chords — {entries.length} segment{entries.length !== 1 ? 's' : ''}
            </p>
            {entries.length > 0 && (
              <button
                onClick={() => { setEntries([]); stopAudio(); setActiveId(null); }}
                className="text-xs px-2 py-1 rounded-lg"
                style={{ color: '#3a3a3a', border: '1px solid #1e1e1e' }}>
                Clear
              </button>
            )}
          </div>
          {entries.map(entry => (
            <ChordCard
              key={entry.id}
              entry={entry}
              onPlay={handlePlay}
              onRemove={handleRemove}
              active={activeId === entry.id}
            />
          ))}
        </div>
      )}

      {/* ── Saved sequences ── */}
      <SavedSequences
        sequences={savedSeqs}
        onLoad={handleLoadSaved}
        onDelete={handleDeleteSaved}
        tr={tr}
      />
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function ChordListener({ lang }) {
  const tr = useT(lang);
  const [tab, setTab] = useState('recorder');

  return (
    <div className="p-3 sm:p-5">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-xl mb-4" style={{ background: '#161616' }}>
        {[['recorder', '🎤', 'Recorder'], ['practice', '🎸', 'Practice']].map(([id, icon, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all"
            style={tab === id
              ? { background: '#1e1e1e', color: '#c9a96e', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }
              : { color: '#5a5a5a' }}>
            <span>{icon}</span><span>{label}</span>
          </button>
        ))}
      </div>

      {tab === 'recorder' && <RecorderMode tr={tr} />}
      {tab === 'practice' && <PracticeMode tr={tr} />}
    </div>
  );
}

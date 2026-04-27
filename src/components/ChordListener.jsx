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
import FretboardDiagram from './FretboardDiagram';
import DifficultyBadge from './DifficultyBadge';

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

export default function ChordListener() {
  const [listening, setListening]           = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [targetChord, setTargetChord]       = useState(CHORDS_WITH_SCORE[0]);
  const [maxDiff, setMaxDiff]               = useState(10);
  const [stringResults, setStringResults]   = useState(null);
  const [detectedNote, setDetectedNote]     = useState(null);
  const [autoDetected, setAutoDetected]     = useState(null);
  const [volume, setVolume]                 = useState(0);

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
    audioCtxRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    freqDataRef.current = null;
    timeDataRef.current = null;
    setListening(false);
    setStringResults(null);
    setDetectedNote(null);
    setAutoDetected(null);
    setVolume(0);
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
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">

      {/* Max difficulty */}
      <div className="flex items-center gap-3 px-3 sm:px-4 py-3 rounded-xl"
        style={{ background: '#1a1a1a', border: '1px solid #222' }}>
        <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: '#5a5a5a' }}>
          Max diff
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
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3a3a3a' }}>
            Target chord
          </p>
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

        {/* Selected chord preview */}
        <div className="flex items-start gap-3 sm:gap-4 px-3 sm:px-4 py-3"
          style={{ borderTop: '1px solid #1e1e1e' }}>
          <div className="shrink-0">
            <FretboardDiagram chord={targetChord} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base sm:text-lg mb-0.5" style={{ color: '#f0ede8' }}>
              {targetChord.name}
            </p>
            <p className="text-xs mb-2" style={{ color: '#5a5a5a' }}>
              {targetChord.type} · {targetChord.tab}
            </p>
            <div className="flex gap-1 flex-wrap">
              {targetChord.tab.split('').map((ch, s) => (
                <span
                  key={s}
                  className="inline-flex flex-col items-center px-1.5 py-1 rounded text-xs"
                  style={{
                    border: `1px solid ${ch === 'x' ? '#2a2a2a' : STRING_COLORS[s] + '55'}`,
                    background: ch === 'x' ? '#141414' : STRING_COLORS[s] + '18',
                    color: ch === 'x' ? '#3a3a3a' : STRING_COLORS[s],
                  }}
                >
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
          <button
            onClick={startListening}
            className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: '#c9a96e', color: '#0f0f0f' }}
          >
            <span>🎙️</span> Start Listening
          </button>
        ) : (
          <button
            onClick={stopListening}
            className="flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <span className="animate-pulse">●</span> Stop
          </button>
        )}
        {permissionDenied && (
          <p className="text-xs" style={{ color: '#f87171' }}>Mic access denied.</p>
        )}
        {listening && (
          <div className="flex-1">
            <VolumeBar level={volume} />
          </div>
        )}
      </div>

      {/* Live feedback */}
      {listening && (
        <div className="space-y-3">

          {/* Auto-detected chord */}
          {autoDetected && (
            <div className="flex items-center gap-3 rounded-xl px-3 sm:px-4 py-3"
              style={{
                background: autoDetected.chord === targetChord
                  ? 'rgba(74,222,128,0.08)' : '#1a1a1a',
                border: `1px solid ${autoDetected.chord === targetChord ? 'rgba(74,222,128,0.25)' : '#222'}`,
              }}>
              <span className="text-xl">{autoDetected.chord === targetChord ? '🎯' : '🎵'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: '#3a3a3a' }}>Detected</p>
                <p className="font-bold text-base" style={{
                  color: autoDetected.chord === targetChord ? '#4ade80' : '#f0ede8'
                }}>
                  {autoDetected.chord.name}
                  <span className="text-xs font-normal ml-2" style={{ color: '#5a5a5a' }}>
                    {autoDetected.chord.type}
                  </span>
                </p>
              </div>
              {autoDetected.chord === targetChord
                ? <span className="text-xs font-bold" style={{ color: '#4ade80' }}>Correct!</span>
                : <span className="text-xs" style={{ color: '#5a5a5a' }}>Expected: <strong style={{ color: '#c9a96e' }}>{targetChord.name}</strong></span>
              }
            </div>
          )}

          {/* Dominant note */}
          {detectedNote && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#5a5a5a' }}>
              <span>Strongest:</span>
              <span className="font-bold" style={{ color: '#f0ede8' }}>
                {detectedNote.name}{detectedNote.octave}
              </span>
              <span className="tabular-nums">{Math.round(detectedNote.hz)} Hz</span>
              {Math.abs(detectedNote.cents) > 5 && (
                <span style={{ color: detectedNote.cents > 0 ? '#fb923c' : '#38bdf8' }}>
                  {detectedNote.cents > 0 ? `+${detectedNote.cents}¢` : `${detectedNote.cents}¢`}
                </span>
              )}
            </div>
          )}

          {/* Per-string */}
          {stringResults && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#3a3a3a' }}>
                  String analysis
                </p>
                {playCount > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={allCorrect
                      ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80' }
                      : { background: '#1e1e1e', color: '#5a5a5a' }}>
                    {correctCount}/{playCount} correct
                  </span>
                )}
              </div>
              <StringFeedback stringResults={stringResults} />
            </div>
          )}

          {/* No signal */}
          {!stringResults && volume < 0.05 && (
            <div className="text-center py-8" style={{ color: '#3a3a3a' }}>
              <p className="text-3xl mb-2">🎸</p>
              <p className="text-sm">Play your guitar — listening…</p>
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-xs pt-2" style={{ borderTop: '1px solid #1e1e1e', color: '#3a3a3a' }}>
            <span><span style={{ color: '#4ade80' }}>✓</span> correct</span>
            <span><span style={{ color: '#f87171' }}>✗</span> wrong</span>
            <span><span>–</span> not heard</span>
            <span><span>×</span> muted</span>
          </div>
        </div>
      )}
    </div>
  );
}

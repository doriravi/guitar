// Shared microphone + detection-config layer for every mic-driven feature
// (the Listen tab's Recorder / Practice / Tune modes and the Play-Along game).
//
// Extracted verbatim from ChordListener.jsx so PracticeGame can reuse the exact
// same mic pipeline and the user's saved detection calibration without a
// circular component import. No behavior change for the existing modes.

import { useRef } from 'react';
import { matchChord } from './pitchDetect';
import { CHORDS } from './chords';
import { recording } from './guideBus';

export const CFG_KEY = 'guitar_detect_config';

// ── Detection config ──────────────────────────────────────────────────────────

export const DEFAULT_CONFIG = {
  smoothing:    0.70,   // AnalyserNode smoothingTimeConstant  0..0.99
  minHz:        60,     // lowest frequency scanned (Hz)
  maxHz:        1200,   // highest frequency scanned (Hz)
  ampThresh:   -55,     // peak must be above this dB level   -90..-20
  maxPeaks:     8,      // how many peaks passed to matcher   1..16
  silenceRms:   0.008,  // RMS below which a segment is skipped
  segmentMs:    2000,   // recorder: ms between chord snapshots
  minScore:     0.25,   // Jaccard score threshold to accept match  0..1
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}
export function saveConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
}

// ── Peak detection / chord matching with the user's config ───────────────────

export function detectPeaksConfigured(freqData, sampleRate, fftSize, cfg) {
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

export function matchChordConfigured(hzList, cfg) {
  const result = matchChord(hzList, CHORDS);
  if (!result) return null;
  return result.score >= cfg.minScore ? result : null;
}

// ── useMic — shared mic setup hook ───────────────────────────────────────────
// Returns a stable ref whose .current always has the latest API.
// This avoids identity-change problems when passed to useCallback deps.
//
// open(smoothing, { raw }) — `raw: true` disables the browser's voice DSP
// (echoCancellation / noiseSuppression / autoGainControl). All three hurt
// guitar detection: AEC gates sustained strings as "echo", NS eats steady
// harmonic content, AGC pumps levels and breaks the silenceRms/dB-threshold
// semantics. The Play-Along game opens raw; the older modes keep the default.

export function useMic() {
  const streamRef   = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const freqDataRef = useRef(null);
  const timeDataRef = useRef(null);

  // Stable API object — never reassigned, so it's safe as a useCallback dep
  const api = useRef({
    async open(smoothing, { raw = false } = {}) {
      const audio = raw
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
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
      recording(true);   // the mic is live → make the guide dance
    },
    close() {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current) audioCtxRef.current.close();
      streamRef.current = null; audioCtxRef.current = null; analyserRef.current = null;
      freqDataRef.current = null; timeDataRef.current = null;
      recording(false);
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
    // Raw time-domain samples — what the YIN pitch detector needs (the browser
    // equivalent of librosa reading a PCM buffer). Reuses the shared buffer.
    getTimeData() {
      const td = timeDataRef.current;
      if (!td || !analyserRef.current) return null;
      analyserRef.current.getFloatTimeDomainData(td);
      return td;
    },
    get sampleRate() { return audioCtxRef.current ? audioCtxRef.current.sampleRate : 0; },
    updateSmoothing(v) {
      if (analyserRef.current) analyserRef.current.smoothingTimeConstant = v;
    },
    get audioCtx() { return audioCtxRef.current; },
    get analyser() { return analyserRef.current; },
  });

  return api;
}

// Chord recordings — capture the user playing a single named chord through the
// mic, GRADE it with the existing Play-Along scorer (no new detector), and save
// the SCORE only (no audio) so it can later drive a level/skill indication.
//
// Local-first, sync-ready: results are written to localStorage under
// guitar_chord_recordings_v1 with the same v1/clientId/serverId shape as
// practiceGame.js / transitionDrills.js, so a logged-in user's scores can sync
// to the backend (POST /api/users/me/recordings) exactly like the other stores.
//
// This module is React-hook + pure-logic; the mic/FFT plumbing is reused from
// micDetect.js (useMic, detectPeaksConfigured, loadConfig) and the grading from
// practiceGame.js (classifyChordPCs, windowScorer, GRADE_POINTS).

import { useRef, useState, useCallback, useEffect } from 'react';
import { useMic, detectPeaksConfigured, loadConfig } from './micDetect';
import { classifyChordPCs, windowScorer, GRADE_POINTS, gradeFor } from './practiceGame';
import { advanceForRecording } from './levelPlan';
import { makeCountdownCue } from './countdownCue';

// One recording window: how long we listen, and the detection cadence — matched
// to Play-Along (100 ms FFT ticks). 1.6 s is long enough for a strum to ring and
// the amplitude-weighted histogram to settle, short enough to feel instant.
const RECORD_MS = 1600;
const FFT_MS = 100;
const COUNT_IN_MS = 250;   // brief lead-in so the first frames aren't half-silence
// A 5-second countdown before the chord window: the mic is live (so the user
// can get set) but nothing is scored until it elapses. Mirrors scale practice.
export const COUNTDOWN_MS = 5000;

// A single-window "timeline" the scorer understands. durSec sets the onset-beat
// scale inside windowScorer; we treat the whole capture as one 4-beat bar so the
// perfect/good onset gates behave like a normal chord window.
function targetWindow(chordName, durSec) {
  return {
    kind: 'chord',
    name: chordName,
    pcs: classifyChordPCs(chordName),
    durSec,
    beats: 4,
  };
}

// ── Score → 1-10 level (the "level indication" this feeds) ────────────────────
// windowScorer returns q ∈ [0,1] and a quality label. We surface both a 0-100
// score and a 1-10 level so the UI and any later progression logic can use either.

// Letter-grade colors — mirror the Play-Along summary (GRADE_COLOR there) so a
// recording grade reads the same everywhere in the app.
export const GRADE_COLOR = {
  S: 'var(--color-brand)', A: 'var(--color-success)', B: 'var(--color-info)',
  C: 'var(--color-warning)', D: 'var(--color-danger)',
};

export function qualityLabel(quality) {
  return quality === 'perfect' ? 'Perfect'
    : quality === 'good' ? 'Clean'
    : quality === 'partial' ? 'Almost'
    : quality === 'silent' ? 'No sound'
    : 'Off';
}

export function scoreToLevel(score0to100) {
  // 0..100 → 1..10, clamped. A clean chord (~70+) lands 7+, perfect ~10.
  return Math.max(1, Math.min(10, Math.round(score0to100 / 10)));
}

// 0-100 score → 1-5 star grade (shown to the user + gates Level-Plan advance).
// Same thresholds as scale practice so a "grade" means the same everywhere:
// <40→1, <55→2, <70→3, <85→4, else 5. A clean chord (70%+) earns 4★ and PASSES.
export function scoreToStars(score0to100) {
  if (score0to100 >= 85) return 5;
  if (score0to100 >= 70) return 4;
  if (score0to100 >= 55) return 3;
  if (score0to100 >= 40) return 2;
  return 1;
}

// ── Store (guitar_chord_recordings_v1) ────────────────────────────────────────

const KEY = 'guitar_chord_recordings_v1';
const MAX_PER_CHORD = 20;
const MAX_TOTAL = 400;

function readStore() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && data.v === 1 && Array.isArray(data.recordings)) return data;
  } catch { /* fall through */ }
  return { v: 1, recordings: [] };
}

function writeStore(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore quota */ }
}

/**
 * Persist one graded attempt. Record shape is flat with a clientId/serverId,
 * mirroring practiceGame.js saveSession, so a later /api sync is a copy-paste.
 * @returns the saved record.
 */
export function saveRecording(rec) {
  const data = readStore();
  const record = {
    clientId: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    serverId: null,
    synced: false,
    chord: rec.chord,
    score: rec.score,           // 0..100
    stars: rec.stars,           // 1..5
    level: rec.level,           // 1..10
    grade: rec.grade,           // S|A|B|C|D letter grade
    quality: rec.quality,       // perfect|good|partial|miss|silent
    createdAt: new Date().toISOString(),
  };
  data.recordings.unshift(record);
  // Prune: per-chord cap, then global cap — newest kept.
  const perChord = new Map();
  data.recordings = data.recordings.filter((r) => {
    const n = (perChord.get(r.chord) || 0) + 1;
    perChord.set(r.chord, n);
    return n <= MAX_PER_CHORD;
  }).slice(0, MAX_TOTAL);
  writeStore(data);
  return record;
}

export function loadRecordings() {
  return readStore().recordings;
}

export function recordingsForChord(chord) {
  return readStore().recordings.filter((r) => r.chord === chord);
}

/** Best (highest-score) attempt for a chord, or null. */
export function bestForChord(chord) {
  const list = recordingsForChord(chord);
  if (!list.length) return null;
  return list.reduce((a, b) => (b.score > a.score ? b : a));
}

/** Records not yet pushed to the backend (for sync-on-login). */
export function unsyncedRecordings() {
  return readStore().recordings.filter((r) => !r.synced && !r.serverId);
}

/** Mark a set of clientIds as synced (after a successful backend save). */
export function markSynced(clientIds, serverIdByClient = {}) {
  const ids = new Set(clientIds);
  const data = readStore();
  for (const r of data.recordings) {
    if (ids.has(r.clientId)) {
      r.synced = true;
      if (serverIdByClient[r.clientId] != null) r.serverId = serverIdByClient[r.clientId];
    }
  }
  writeStore(data);
}

// ── Summary for the Level Plan display ────────────────────────────────────────
// The Level Plan shows the player their recorded per-chord grades as progress.
// A chord counts as "mastered" once its BEST attempt reaches grade A or better.

const GRADE_RANK = { D: 0, C: 1, B: 2, A: 3, S: 4 };
export const MASTERY_GRADE = 'A';   // best grade ≥ this = mastered

/** Grade for a record, backfilling legacy rows that predate grade storage. */
function recGrade(rec) {
  return rec.grade || gradeFor(rec.score);
}

/**
 * Per-chord best result across all recordings, newest-first-by-attempt, for the
 * Level Plan "recorded chords" panel. Each item:
 *   { chord, best:{score,level,grade,quality,attempts}, mastered }
 * Sorted best-grade / best-score first. Also returns aggregate counts.
 */
export function recordedChordSummary() {
  const byChord = new Map();
  for (const r of loadRecordings()) {
    const cur = byChord.get(r.chord);
    if (!cur || r.score > cur.best.score) {
      byChord.set(r.chord, {
        chord: r.chord,
        best: { score: r.score, level: r.level, grade: recGrade(r), quality: r.quality, attempts: (cur?.best.attempts || 0) + 1 },
      });
    } else {
      cur.best.attempts += 1;
    }
  }
  const chords = [...byChord.values()].map(e => ({
    ...e,
    mastered: (GRADE_RANK[e.best.grade] ?? -1) >= GRADE_RANK[MASTERY_GRADE],
  }));
  chords.sort((a, b) =>
    (GRADE_RANK[b.best.grade] - GRADE_RANK[a.best.grade]) || (b.best.score - a.best.score) || a.chord.localeCompare(b.chord));
  return {
    chords,
    total: chords.length,
    mastered: chords.filter(c => c.mastered).length,
  };
}

/**
 * Progress over a SPECIFIC list of chords (e.g. a Level-Plan step's required
 * chords "C A G E D"): for each, the best recorded grade and whether it's been
 * recorded / mastered. Lets a step show exactly which chords are done vs. left.
 * @returns { items:[{ chord, recorded, mastered, best|null }], done, total }
 *   `done` counts MASTERED chords (best grade ≥ A).
 */
export function chordListProgress(chordNames = []) {
  const items = chordNames.map((chord) => {
    const b = bestForChord(chord);
    if (!b) return { chord, recorded: false, mastered: false, best: null };
    const grade = recGrade(b);
    return {
      chord,
      recorded: true,
      mastered: (GRADE_RANK[grade] ?? -1) >= GRADE_RANK[MASTERY_GRADE],
      best: { score: b.score, level: b.level, grade, quality: b.quality },
    };
  });
  return { items, done: items.filter((i) => i.mastered).length, total: items.length };
}

// ── useChordRecorder — capture one chord and grade it ─────────────────────────
// Usage:
//   const rec = useChordRecorder();
//   rec.record('C').then(result => ...)   // result = { chord, score, level, quality }
//   rec.state  — 'idle' | 'recording' | 'scoring'
//   rec.result — last result (or null)
//   rec.error  — mic/permission error message (or null)

export function useChordRecorder() {
  const mic = useMic();
  const [state, setState] = useState('idle');   // idle | recording | scoring
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // 5..1 during the pre-strum countdown, 0 once the chord window begins, null idle.
  const [countdown, setCountdown] = useState(null);
  const busyRef = useRef(false);
  const cueRef = useRef(null);   // the active count-in tick/go cue (see countdownCue)

  // Ensure the mic is released if the component using the hook unmounts mid-record.
  useEffect(() => () => {
    try { cueRef.current?.cancel(); } catch { /* noop */ }
    try { mic.current.close(); } catch { /* noop */ }
  }, [mic]);

  const record = useCallback(async (chordName) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setError(null);
    setResult(null);
    const cfg = loadConfig();

    try {
      // raw: true — disable browser voice DSP (matches Play-Along) so sustained
      // strings aren't gated as echo.
      await mic.current.open(cfg.smoothing, { raw: true });
    } catch (e) {
      busyRef.current = false;
      setState('idle');
      setError(e && e.name === 'NotAllowedError'
        ? 'Microphone permission denied.'
        : 'Could not access the microphone.');
      return null;
    }

    setState('recording');
    // Clock-tick + spoken "go" for the count-in (shared cue used app-wide).
    const cue = makeCountdownCue();
    cueRef.current = cue;
    const firstCount = Math.ceil(COUNTDOWN_MS / 1000);
    setCountdown(firstCount);       // show "5" immediately
    cue.set(firstCount);            // …and tick on it
    const durSec = RECORD_MS / 1000;
    const scorer = windowScorer(targetWindow(chordName, durSec), cfg, null);

    // A 5s COUNTDOWN runs first (mic live, nothing scored), THEN the fixed chord
    // window is captured. relSec is measured from the end of the count-in so the
    // onset gate is fair. tCapture0 marks when scoring actually starts.
    const started = performance.now();
    const tCapture0 = COUNTDOWN_MS + COUNT_IN_MS;
    await new Promise((resolve) => {
      let lastFFT = 0;
      let lastCountdown = -1;
      const tick = (now) => {
        const elapsed = now - started;
        if (elapsed < COUNTDOWN_MS) {
          const remain = Math.ceil((COUNTDOWN_MS - elapsed) / 1000);
          if (remain !== lastCountdown) { lastCountdown = remain; setCountdown(remain); cue.set(remain); }
        } else if (lastCountdown !== 0) {
          lastCountdown = 0; setCountdown(0); cue.set(0);   // fires the spoken "go"
        }
        if (elapsed >= tCapture0 + RECORD_MS) { resolve(); return; }
        // Only feed the scorer AFTER the countdown — warm-up isn't graded.
        if (elapsed >= COUNTDOWN_MS && elapsed - lastFFT >= FFT_MS) {
          lastFFT = elapsed;
          const rms = mic.current.getRMS();
          const fd = mic.current.getFreqData();
          if (fd) {
            const peaks = detectPeaksConfigured(fd, mic.current.sampleRate, mic.current.analyser.fftSize, cfg);
            const relSec = Math.max(0, (elapsed - tCapture0) / 1000);
            scorer.add(peaks, rms, relSec);
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    setState('scoring');
    setCountdown(null);
    try { mic.current.close(); } catch { /* noop */ }

    const final = scorer.final();
    const points = GRADE_POINTS[final.quality] ?? 0;
    // Blend the discrete grade with the continuous quality q so two "good" takes
    // still rank by how clean they were.
    const score = Math.round(Math.max(0, Math.min(100, 0.6 * points + 0.4 * (final.q * 100))));
    const out = {
      chord: chordName,
      score,
      stars: scoreToStars(score),   // 1-5 — the grade shown + Level-Plan gate
      level: scoreToLevel(score),
      grade: gradeFor(score),   // S|A|B|C|D — same scale as the Play-Along summary
      quality: final.quality,
    };

    saveRecording(out);
    // A strong take (stars > 3) advances the Level Plan by completing the
    // open-chords milestone. Weak takes are a no-op.
    out.advancedMilestone = advanceForRecording({ kind: 'chord', name: chordName, stars: out.stars });
    setResult(out);
    setState('idle');
    busyRef.current = false;
    return out;
  }, [mic]);

  return { record, state, result, error, countdown };
}

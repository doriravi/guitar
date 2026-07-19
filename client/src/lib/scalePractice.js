// Scale practice — record the user PLAYING A SCALE through the mic, grade how
// accurately they hit the scale's notes, and give a score. Unlike chord
// recording (polyphonic FFT-peak matching in chordRecordings.js), a scale is
// MONOPHONIC — one note at a time — so this uses the YIN pitch detector
// (detectPitchYIN on raw time-domain samples), the same detector the tuner uses.
//
// Grading is note-coverage based: over the recording window we collect the
// sequence of STABLE detected pitches (a pitch held for a few frames), reduce it
// to the set of distinct pitch classes played, and score:
//   • coverage — how many of the scale's notes the player actually sounded
//   • cleanliness — how few OUT-OF-SCALE notes crept in
// blended into a 0-100 score → S/A/B/C/D grade (same gradeFor scale as the rest
// of the app). Score-only (no audio saved), local-first, sync-shaped — mirrors
// chordRecordings.js so a later /api sync is a copy-paste.

import { useRef, useState, useCallback, useEffect } from 'react';
import { useMic, loadConfig } from './micDetect';
import { detectPitchYIN, hzToMidi } from './pitchDetect';
import { gradeFor } from './practiceGame';
import { advanceForRecording, RECORDING_PASS_STARS } from './levelPlan';
import { makeCountdownCue } from './countdownCue';

// Exported so the Scale screen can pace its on-fretboard "play this note next"
// target cue in sync with the recording window.
// The practice run is PACED PER NOTE: you get one steady beat per scale note, so
// there's time to find and play each one (the old fixed 6 s window crammed ~15
// notes into 0.4 s each — far too fast). The recording length is derived from the
// number of notes to play × PER_NOTE_MS, plus a lead-in.
export const PER_NOTE_MS = 1200;  // one beat per note — deliberately slow
// A 5-SECOND COUNTDOWN before the notes begin: the mic is already capturing (so
// the user's warm-up isn't lost) but the graded note window doesn't start until
// the count-in elapses, giving time to position the hand. The countdown frames
// are NOT scored — only the note-playing window feeds the grader.
export const COUNTDOWN_MS = 5000;
export const COUNT_IN_MS = COUNTDOWN_MS;   // (kept as the pre-cue lead-in duration)
export const MIN_RECORD_MS = 4000;
// Fallback fixed window when a caller doesn't pass a note count (kept for back-compat).
export const RECORD_MS = 6000;
const FRAME_MS = 55;       // YIN cadence (also the live-indicator refresh rate)
// A detected pitch must hold within ±STABLE_CENTS for STABLE_FRAMES consecutive
// frames before we count it as a deliberately-played note (rejects transients).
const STABLE_CENTS = 45;
const STABLE_FRAMES = 3;
const SILENCE_RMS = 0.01;  // frames quieter than this are ignored

export const GRADE_COLOR = {
  S: 'var(--color-brand)', A: 'var(--color-success)', B: 'var(--color-info)',
  C: 'var(--color-warning)', D: 'var(--color-danger)',
};

export function scoreToLevel(score0to100) {
  return Math.max(1, Math.min(10, Math.round(score0to100 / 10)));
}

// 0-100 score → 1-5 star grade (the grade the user sees and that gates Level-Plan
// advancement). Thresholds: <40→1, <55→2, <70→3, <85→4, else 5. So a clean run
// (70%+, "in-scale and mostly complete") earns 4★ and PASSES (> 3).
export function scoreToStars(score0to100) {
  if (score0to100 >= 85) return 5;
  if (score0to100 >= 70) return 4;
  if (score0to100 >= 55) return 3;
  if (score0to100 >= 40) return 2;
  return 1;
}

// ── Grade a played pitch-class sequence against the target scale ───────────────
// scaleSet: Set<0-11> of the scale's pitch classes. rootPc: the tonic (0-11).
// played:  ordered array of pitch classes the player sounded (may repeat/skip).
// Returns { score, grade, level, coverage, cleanliness, hit:Set, extra:Set }.
export function gradeScaleRun(playedPcs, scaleSet, rootPc) {
  const scalePcs = [...scaleSet];
  const playedSet = new Set(playedPcs);

  // coverage — fraction of scale notes the player actually sounded
  const hit = new Set(scalePcs.filter(pc => playedSet.has(pc)));
  const coverage = scalePcs.length ? hit.size / scalePcs.length : 0;

  // cleanliness — of the notes the player sounded, fraction that were in-scale
  const inScalePlayed = playedPcs.filter(pc => scaleSet.has(pc)).length;
  const cleanliness = playedPcs.length ? inScalePlayed / playedPcs.length : 0;
  const extra = new Set(playedPcs.filter(pc => !scaleSet.has(pc)));

  // Blend: coverage matters most (did you play the scale?), cleanliness guards
  // against spraying random notes. A perfect run = every scale note, no strays.
  const raw = coverage * 0.7 + cleanliness * 0.3;
  // Small bonus for landing the tonic (grounds the scale).
  const rootBonus = playedSet.has(rootPc) ? 0.05 : 0;
  const score = Math.round(Math.max(0, Math.min(100, (raw + rootBonus) * 100)));

  return {
    score,
    grade: gradeFor(score),
    stars: scoreToStars(score),        // 1-5 — the grade shown + Level-Plan gate
    level: scoreToLevel(score),
    coverage: Math.round(coverage * 100),
    cleanliness: Math.round(cleanliness * 100),
    hit,
    extra,
    played: playedPcs.length,
  };
}

// ── Store (guitar_scale_practice_v1) — score-only, sync-shaped ─────────────────

const KEY = 'guitar_scale_practice_v1';
const MAX_TOTAL = 300;

function readStore() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && data.v === 1 && Array.isArray(data.runs)) return data;
  } catch { /* fall through */ }
  return { v: 1, runs: [] };
}
function writeStore(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore quota */ }
}

export function saveScaleRun(run) {
  const data = readStore();
  const record = {
    clientId: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    serverId: null,
    synced: false,
    scale: run.scale,          // e.g. "C Major"
    score: run.score,          // 0..100
    stars: run.stars,          // 1..5
    level: run.level,          // 1..10
    grade: run.grade,          // S|A|B|C|D
    coverage: run.coverage,    // 0..100
    cleanliness: run.cleanliness,
    createdAt: new Date().toISOString(),
  };
  // ── Scale Quest fields (optional, additive) ─────────────────────────────────
  // The game records a richer run: which box, tempo, mode, and the THREE separate
  // goal scores. These are attached only when the caller supplies them, as
  // STRUCTURED fields — never stuffed into the `scale` label string — so the game
  // can key bests on (scale, box, mode) while legacy recorder rows (which omit
  // them) still read and grade exactly as before.
  if (run.box) record.box = { minFret: run.box.minFret, maxFret: run.box.maxFret };
  if (run.bpm != null) record.bpm = run.bpm;
  if (run.mode) record.mode = run.mode;                 // 'run' | 'hunt' | 'boss'
  if (run.accuracy != null) record.accuracy = run.accuracy;   // 0..100
  if (run.speed != null) record.speed = run.speed;            // 0..100
  if (run.memory != null) record.memory = run.memory;         // 0..100
  if (run.labelsOff != null) record.labelsOff = !!run.labelsOff;
  data.runs.unshift(record);
  data.runs = data.runs.slice(0, MAX_TOTAL);
  writeStore(data);
  return record;
}

export function bestForScale(scaleLabel, opts = {}) {
  let runs = readStore().runs.filter(r => r.scale === scaleLabel);
  // Optional narrowing to a specific game context. A run saved WITHOUT these
  // fields (a legacy recorder run) never matches a box/mode filter, so a filtered
  // query returns only real game rows — and an unfiltered query still sees all.
  if (opts.mode) runs = runs.filter(r => r.mode === opts.mode);
  if (opts.box) runs = runs.filter(r => r.box &&
    r.box.minFret === opts.box.minFret && r.box.maxFret === opts.box.maxFret);
  if (!runs.length) return null;
  const best = runs.reduce((a, b) => (b.score > a.score ? b : a));
  // Backfill stars for legacy rows saved before the 1-5 grade existed.
  return { ...best, stars: best.stars ?? scoreToStars(best.score) };
}

/**
 * Per-scale mastery across the game's tracks — what the setup screen's "crown"
 * reads. The crown is the MINIMUM of the run-mode and hunt-mode star bests (you
 * haven't mastered a scale until you can both play it AND find it from memory),
 * so it never overstates. Legacy rows (no `mode`) count toward neither, so they
 * can't inflate the crown.
 *
 * @param {string} scaleLabel e.g. "A Minor pentatonic" (the `scale` label used
 *        when the run was saved)
 * @returns {{crown:number, runStars:number, huntStars:number, clearedBpm:number}}
 */
export function scaleMastery(scaleLabel) {
  const runs = readStore().runs.filter(r => r.scale === scaleLabel);
  const starsFor = (mode) => {
    const m = runs.filter(r => r.mode === mode);
    if (!m.length) return 0;
    return m.reduce((best, r) => Math.max(best, r.stars ?? scoreToStars(r.score)), 0);
  };
  const runStars = starsFor('run');
  const huntStars = starsFor('hunt');
  // Highest tempo tier ever cleared at >=4 stars in run mode.
  const clearedBpm = runs
    .filter(r => r.mode === 'run' && (r.stars ?? scoreToStars(r.score)) >= 4 && r.bpm != null)
    .reduce((max, r) => Math.max(max, r.bpm), 0);
  return {
    crown: (runStars && huntStars) ? Math.min(runStars, huntStars) : 0,
    runStars, huntStars, clearedBpm,
  };
}

// ── useScaleRecorder — capture a scale run and grade it ────────────────────────
// Usage:
//   const rec = useScaleRecorder();
//   rec.record({ scaleSet, rootPc, label }).then(result => ...)
//   rec.state — 'idle' | 'recording' | 'scoring'
//   rec.result / rec.error / rec.elapsed (0..1 progress while recording)

export function useScaleRecorder() {
  const mic = useMic();
  const [state, setState] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  // Live mic indication: what YIN is hearing RIGHT NOW while recording, updated
  // every frame. { pc, hz, cents } or null when silent. The UI shows this so the
  // player sees the app is picking up their playing in real time.
  const [liveNote, setLiveNote] = useState(null);
  // 5..1 during the pre-play countdown, 0 once the notes begin, null when idle.
  const [countdown, setCountdown] = useState(null);
  const busyRef = useRef(false);
  const cueRef = useRef(null);   // the active count-in tick/go cue (see countdownCue)

  useEffect(() => () => { try { mic.current.close(); } catch { /* noop */ } }, [mic]);

  const record = useCallback(async ({ scaleSet, rootPc, label, noteCount }) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setError(null);
    setResult(null);
    setProgress(0);
    setLiveNote(null);
    const cfg = loadConfig();

    // Slow, per-note window: one beat per note the player must sound.
    const recordMs = noteCount && noteCount > 0
      ? Math.max(MIN_RECORD_MS, noteCount * PER_NOTE_MS)
      : RECORD_MS;

    try {
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

    // Collect the sequence of stable pitch classes the player sounds — but ONLY
    // after the countdown. During the count-in the mic is live (so live-indication
    // works and the user can warm up) yet nothing is scored.
    const played = [];
    let candidateMidi = null;   // the note currently stabilizing
    let candidateFrames = 0;
    let lastCommittedPc = -1;   // avoid logging the same held note repeatedly

    const started = performance.now();
    await new Promise((resolve) => {
      let lastFrame = 0;
      let lastCountdown = -1;
      const tick = (now) => {
        const elapsed = now - started;
        const inCountdown = elapsed < COUNTDOWN_MS;
        // Countdown 5..1 during the lead-in, then 0 once the notes begin.
        if (inCountdown) {
          const remain = Math.ceil((COUNTDOWN_MS - elapsed) / 1000);
          if (remain !== lastCountdown) { lastCountdown = remain; setCountdown(remain); cue.set(remain); }
        } else if (lastCountdown !== 0) {
          lastCountdown = 0; setCountdown(0); cue.set(0);   // fires the spoken "go"
        }
        setProgress(Math.min(1, Math.max(0, (elapsed - COUNTDOWN_MS) / recordMs)));
        if (elapsed >= COUNTDOWN_MS + recordMs) { resolve(); return; }
        if (elapsed - lastFrame >= FRAME_MS) {
          lastFrame = elapsed;
          const rms = mic.current.getRMS();
          const td = mic.current.getTimeData();
          if (td && rms >= SILENCE_RMS) {
            const hz = detectPitchYIN(td, mic.current.sampleRate);
            if (hz && hz > 0) {
              const midi = hzToMidi(hz);
              const midiRound = Math.round(midi);
              // ── Live indication: publish what we're hearing (even in countdown) ──
              setLiveNote({
                pc: ((midiRound % 12) + 12) % 12,
                hz,
                cents: Math.round((midi - midiRound) * 100),
              });
              if (candidateMidi != null && Math.abs(midi - candidateMidi) * 100 <= STABLE_CENTS) {
                candidateFrames += 1;
                candidateMidi = (candidateMidi + midi) / 2; // smooth
              } else {
                candidateMidi = midi;
                candidateFrames = 1;
              }
              // Only COMMIT notes to the graded set after the countdown.
              if (!inCountdown && candidateFrames === STABLE_FRAMES) {
                const pc = ((Math.round(candidateMidi) % 12) + 12) % 12;
                if (pc !== lastCommittedPc) {
                  played.push(pc);
                  lastCommittedPc = pc;
                }
              }
            } else {
              // brief gap resets the "same held note" guard so a repeat counts
              candidateFrames = 0; candidateMidi = null; lastCommittedPc = -1;
              setLiveNote(null);
            }
          } else {
            candidateFrames = 0; candidateMidi = null; lastCommittedPc = -1;
            setLiveNote(null);
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    setState('scoring');
    setLiveNote(null);
    setCountdown(null);
    try { mic.current.close(); } catch { /* noop */ }

    const graded = gradeScaleRun(played, scaleSet, rootPc);
    const out = { scale: label, ...graded };
    saveScaleRun(out);
    // A strong take (stars > 3) advances the Level Plan by completing the
    // milestone that trains this scale. Weak takes / unmapped scales are no-ops.
    const advancedMilestone = advanceForRecording({ kind: 'scale', name: label, stars: out.stars });
    out.advancedMilestone = advancedMilestone;   // surfaced in the UI as "Level Plan advanced!"
    setResult(out);
    setProgress(0);
    setState('idle');
    busyRef.current = false;
    return out;
  }, [mic]);

  const cancel = useCallback(() => {
    // best-effort: closing the mic ends the capture; the rAF loop resolves next
    // frame with whatever was collected. (Used if the user leaves the screen.)
    try { cueRef.current?.cancel(); } catch { /* noop */ }
    try { mic.current.close(); } catch { /* noop */ }
  }, [mic]);

  return { record, cancel, state, result, error, progress, liveNote, countdown };
}

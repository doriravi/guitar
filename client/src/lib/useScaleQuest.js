// useScaleQuest — the mic-capture + game-state hook for Scale Quest.
//
// This is the one piece of the game that can't be fully unit-tested: it drives a
// live microphone. So the hard, testable logic lives OUTSIDE it — the ring-over
// note capture (makeNoteCapture), the onset detector (makeOnsetDetector), and all
// scoring (scaleGame.js) are pure and covered by tests. This hook is the thin
// real-time shell that wires them to useMic and the rAF loop.
//
// Why YIN, not the polyphonic peak detector: a scale run is monophonic, and we
// need the OCTAVE (detectPitchYIN → hzToMidi gives it). The Note-Map improv loop
// uses detectPeaksConfigured + livePitchClasses %12, which throws octave away —
// exactly what the fretboard-memory score can't afford. So this models the
// useScaleRecorder YIN loop, not the improv loop.
//
// The make-or-break detail (the #1 risk in the design): a plucked note RINGS
// under the next one, so YIN on the blend is unstable. makeNoteCapture commits a
// note only on a fresh attack (onset) or a stable new pitch — see its tests.

import { useRef, useState, useCallback, useEffect } from 'react';
import { useMic, loadConfig } from './micDetect';
import { detectPitchYIN, hzToMidi } from './pitchDetect';
import { makeOnsetDetector, SCALE_LABELS } from './improvEngine';
import { COUNTDOWN_MS, PER_NOTE_MS, saveScaleRun, scaleMastery } from './scalePractice';
import { advanceForRecording } from './levelPlan';
import { NOTE_NAMES } from './chordAnalyzer';
import { makeCountdownCue } from './countdownCue';
import {
  makeNoteCapture,
  buildTargetSequence,
  scaleSetOf,
  gradeScaleRunOrdered,
  scoreSpeed,
  scoreFretboardMemory,
  scoreScaleTrack,
  detectAdvancement,
  midiMatches,
  fretMidiExact,
} from './scaleGame';

const FRAME_MS = 1000 / 60;    // detection cadence
const SILENCE_RMS = 0.01;

// BPM → notes per second for eighth-note runs (2 notes per beat).
const bpmToNps = (bpm) => (bpm / 60) * 2;

/**
 * Drive a Scale Quest run.
 *
 * phase: 'select' → 'countin' → 'play' → 'score'
 * start(config) config = { root, scaleId, box, mode:'run'|'hunt', bpm, labelsOff }
 *
 * Returns live state the UI renders: countdown, the current target cell, what the
 * mic is hearing right now (liveNote / liveSet), per-target results, running
 * score/combo, and the final result once scored. micOk flags whether the signal
 * check during count-in heard anything (so the UI can warn a too-quiet player).
 */
export function useScaleQuest() {
  const mic = useMic();
  const rafRef = useRef(null);
  const cfgRef = useRef(loadConfig());

  const [phase, setPhase] = useState('select');
  const [countdown, setCountdown] = useState(null);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [liveNote, setLiveNote] = useState(null);   // { pc, midi, hz, cents } | null
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [micOk, setMicOk] = useState(null);         // null until the count-in check

  // Mutable run state kept in refs so the rAF loop reads the latest without
  // re-subscribing every frame — and so the long-lived async run loop never
  // reads a value captured stale when start() was created.
  const runRef = useRef(null);
  const comboRef = useRef(0);
  const micOkRef = useRef(null);
  const cueRef = useRef(null);   // count-in tick/go cue (see countdownCue)

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { cueRef.current?.cancel(); } catch { /* noop */ }
    try { mic.current.close(); } catch { /* noop */ }
  }, [mic]);

  useEffect(() => () => stop(), [stop]);

  const abort = useCallback(() => {
    stop();
    setPhase('select');
    setCountdown(null);
    setCurrentIdx(-1);
    setLiveNote(null);
    setScore(0);
    setCombo(0);
    comboRef.current = 0;
    micOkRef.current = null;
  }, [stop]);

  const start = useCallback(async (config) => {
    setError(null);
    setResult(null);
    setScore(0);
    setCombo(0);
    setMicOk(null);
    comboRef.current = 0;
    micOkRef.current = null;

    const scaleSet = scaleSetOf(config.root, config.scaleId);
    const targets = buildTargetSequence(config.root, config.scaleId, {
      box: config.box, mode: config.mode || 'run',
    });
    if (!scaleSet || !targets.length) {
      setError('That scale/box has no playable targets.');
      return null;
    }

    try {
      await mic.current.open(cfgRef.current.smoothing, { raw: true });
    } catch (e) {
      setError(e && e.name === 'NotAllowedError'
        ? 'Microphone permission denied — allow mic access and try again.'
        : 'Could not access the microphone.');
      setPhase('select');
      return null;
    }

    // Per-run capture state.
    const capture = makeNoteCapture();
    const onset = makeOnsetDetector();
    const perNoteMs = Math.max(PER_NOTE_MS, (60 / (config.bpm || 60)) * 1000);
    const playMs = targets.length * perNoteMs;
    const committed = [];   // { midi, tMs } committed during the SCORED window
    let heardDuringCountIn = false;

    runRef.current = { config, scaleSet, targets, capture, onset, committed, perNoteMs, playMs };

    setPhase('countin');
    const cue = makeCountdownCue();
    cueRef.current = cue;
    const firstCount = Math.ceil(COUNTDOWN_MS / 1000);
    setCountdown(firstCount);
    cue.set(firstCount);
    setCurrentIdx(-1);

    const started = performance.now();
    await new Promise((resolve) => {
      let lastFrame = 0;
      let lastCountdown = -1;
      let lastIdx = -2;

      const tick = (now) => {
        const elapsed = now - started;
        const inCountIn = elapsed < COUNTDOWN_MS;

        // Countdown UI.
        if (inCountIn) {
          const remain = Math.ceil((COUNTDOWN_MS - elapsed) / 1000);
          if (remain !== lastCountdown) { lastCountdown = remain; setCountdown(remain); cue.set(remain); }
        } else if (lastCountdown !== 0) {
          lastCountdown = 0; setCountdown(0); cue.set(0);
          setPhase('play');
        }

        // Which target is active (paced one per perNoteMs after the count-in).
        const playElapsed = elapsed - COUNTDOWN_MS;
        const idx = inCountIn ? -1 : Math.floor(playElapsed / perNoteMs);
        if (idx !== lastIdx) { lastIdx = idx; setCurrentIdx(Math.min(idx, targets.length - 1)); }

        if (elapsed >= COUNTDOWN_MS + playMs) { resolve(); return; }

        // Detection at ~60fps.
        if (elapsed - lastFrame >= FRAME_MS) {
          lastFrame = elapsed;
          const rms = mic.current.getRMS();
          const td = mic.current.getTimeData();
          const isOnset = onset.push(rms);

          let midi = null, hz = null, cents = 0;
          if (td && rms >= SILENCE_RMS) {
            hz = detectPitchYIN(td, mic.current.sampleRate);
            if (hz && hz > 0) {
              const m = hzToMidi(hz);
              midi = m;
              const mr = Math.round(m);
              cents = Math.round((m - mr) * 100);
              setLiveNote({ pc: ((mr % 12) + 12) % 12, midi: mr, hz, cents });
              if (inCountIn) heardDuringCountIn = true;
            } else {
              setLiveNote(null);
            }
          } else {
            setLiveNote(null);
          }

          // Feed the capture state machine every frame.
          const emitted = capture.push({ midi, rms, onset: isOnset, tMs: elapsed });
          if (emitted && !inCountIn) {
            committed.push({ midi: emitted.midi, tMs: emitted.tMs - COUNTDOWN_MS });
            // Live combo/score juice: did this note match the CURRENT target?
            const tIdx = Math.min(Math.floor(playElapsed / perNoteMs), targets.length - 1);
            const target = targets[tIdx];
            if (target && midiMatches(emitted.midi, target.midi)) {
              const nextCombo = comboRef.current + 1;
              comboRef.current = nextCombo;
              const mult = 1 + Math.min(3, Math.floor((nextCombo - 1) / 5));
              setCombo(nextCombo);
              setScore((s) => s + 100 * mult);
            } else {
              comboRef.current = 0;
              setCombo(0);
            }
          }

          // The count-in doubles as the mic signal check (once, at play start).
          if (!inCountIn && micOkRef.current === null) {
            micOkRef.current = heardDuringCountIn;
            setMicOk(heardDuringCountIn);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    });

    // ── Score the run ──────────────────────────────────────────────────────────
    setPhase('score');
    setLiveNote(null);
    setCountdown(null);
    try { mic.current.close(); } catch { /* noop */ }

    const rootPc = ((config.root % 12) + 12) % 12;
    const acc = gradeScaleRunOrdered(committed, targets, { rootPc, scaleSet });

    const onsetTimes = committed.map((n) => n.tMs);
    const spd = scoreSpeed(onsetTimes, {
      targetNps: bpmToNps(config.bpm || 60),
      runDurationMs: playMs,
    });

    // Octave match: fraction of targets answered with the EXACT midi, in order.
    const targetMidi = targets.map((t) => t.midi);
    const playedMidi = committed.map((n) => n.midi);
    let exactHits = 0;
    // Greedy in-order pass: each target consumed by the first matching played note.
    let p = 0;
    for (const tm of targetMidi) {
      while (p < playedMidi.length && !midiMatches(playedMidi[p], tm)) p += 1;
      if (p < playedMidi.length) { exactHits += 1; p += 1; }
    }
    const octaveMatch = targets.length ? exactHits / targets.length : 0;
    const mem = scoreFretboardMemory({
      octaveMatch, orderMatch: acc.orderMatch, tempoStability: spd.tempoStability,
    });

    const tonicRequired = config.mode === 'run';
    const accTrack = scoreScaleTrack(acc.accuracy, {
      purity: acc.purity, orderMatch: acc.orderMatch,
      tonicRequired, tonicLanded: acc.tonicLanded,
    });
    const spdTrack = scoreScaleTrack(spd.speed);
    const memTrack = scoreScaleTrack(mem.memory, { orderMatch: acc.orderMatch });

    // ── Persist the run + detect progression (the celebration trigger) ─────────
    // Scale Quest didn't previously save its runs (unlike scalePractice/chord
    // recordings), so mastery/Level-Plan never advanced from playing the game.
    // Save it as a structured run, keyed the same way scalePractice keys bests
    // (scale label + box + mode), then diff mastery before/after to know what the
    // player just unlocked. `mode` maps hunt→'hunt', else 'run' so the store's
    // run/hunt star tracks stay meaningful. The overall run stars = the accuracy
    // track's stars (the primary graded goal), which is also what the Level-Plan
    // pass-gate reads.
    const scaleLabel = `${NOTE_NAMES[rootPc]} ${SCALE_LABELS[config.scaleId] || config.scaleId}`;
    const storeMode = config.mode === 'hunt' ? 'hunt' : 'run';
    const runStars = accTrack.stars;

    const before = scaleMastery(scaleLabel);
    let milestoneAdvanced = null;
    try {
      saveScaleRun({
        scale: scaleLabel,
        score: accTrack.score,
        stars: runStars,
        level: null,
        grade: accTrack.grade,
        coverage: Math.round((acc.coverage || 0) * 100),
        cleanliness: Math.round((acc.purity || 0) * 100),
        box: config.box,
        bpm: config.bpm,
        mode: storeMode,
        accuracy: accTrack.score,
        speed: spdTrack.score,
        memory: memTrack.score,
        labelsOff: !!config.labelsOff,
      });
      milestoneAdvanced = advanceForRecording({ kind: 'scale', name: scaleLabel, stars: runStars });
    } catch { /* localStorage may be unavailable; never block scoring on it */ }
    const after = scaleMastery(scaleLabel);
    const advancement = detectAdvancement(before, after, {
      mode: storeMode, stars: runStars, bpm: config.bpm, milestoneAdvanced,
    });

    const out = {
      config,
      accuracy: accTrack, speed: spdTrack, memory: memTrack,
      detail: { ...acc, ...spd, octaveMatch, region: mem.region },
      targets, committed,
      scaleLabel, runStars,
      // What the player just unlocked, if anything — drives the celebration.
      advancement,
      mastery: after,
      // Which targets were hit exactly, for the misses-on-neck review.
      targetResults: targets.map((t) => ({
        ...t,
        hit: playedMidi.some((pm) => midiMatches(pm, t.midi)),
      })),
    };
    setResult(out);
    return out;
  }, [mic]);

  const retry = useCallback(() => {
    const cfg = runRef.current?.config;
    if (cfg) return start(cfg);
    return null;
  }, [start]);

  return {
    phase, countdown, currentIdx, liveNote, score, combo, result, error, micOk,
    start, retry, abort,
    // The live target the UI highlights (null in count-in / when done).
    currentTarget: (() => {
      const r = runRef.current;
      if (!r || currentIdx < 0 || currentIdx >= r.targets.length) return null;
      return r.targets[currentIdx];
    })(),
    // Everything the play surface needs to draw the board.
    targets: runRef.current?.targets || [],
    fretMidiExact,
  };
}

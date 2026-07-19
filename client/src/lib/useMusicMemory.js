// useMusicMemory — the mic-capture + session-state hook for the Music Memory
// (ear-training) tab. A direct descendant of useScaleQuest.js: the same
// useMic (pull-based) + rAF loop + detectPitchYIN → hzToMidi → makeNoteCapture
// ring-over commit, gated by a COUNTDOWN_MS (5s) count-in. The difference: the
// target is ONE drilled element (from memoryTrain.js) and the scored window is a
// single generous fixed duration, during which every committed pitch class is
// collected and graded octave-agnostically by accept().
//
// All the grading/adaptive/theory is pure and lives in memoryTrain.js (tested).
// This hook is the thin real-time shell — the one piece that drives a live mic.
//
// The EMDR pacer is a SEPARATE component with its own CSS animation; this hook
// never touches it and vice-versa, so pacing can't steal detection frames.

import { useRef, useState, useCallback, useEffect } from 'react';
import { useMic, loadConfig } from './micDetect';
import { detectPitchYIN, hzToMidi } from './pitchDetect';
import { makeOnsetDetector } from './improvEngine';
import { makeNoteCapture } from './scaleGame';
import { COUNTDOWN_MS } from './scalePractice';
import {
  unlockAudio, playSoftTone, playSoftChord, stopAudio,
  startEmdrBed, stopEmdrBed, startAmbient, stopAmbient,
} from './audio';
import {
  nextElement, adjustLevel, accept,
  saveMemoryRun, memoryMastery, detectMemoryAdvancement, answerLabelFor,
} from './memoryTrain';

const FRAME_MS = 1000 / 60;
const SILENCE_RMS = 0.01;
const ANSWER_MS = 6500;       // generous window to sing/play the answer (calm, no early stop)
const BREATH_MS = 8000;       // MUST equal BilateralPacer's default breathMs
const FEEDBACK_MS = 2600;     // how long the calm feedback shows before auto-advancing
const SESSION_ITEMS = 8;      // items per session

// Open-string Hz (low E → high e) — mirror of audio.js's private fretHz, since
// it isn't exported. Turns a 6-char tab into the sounding frequencies.
const OPEN_HZ = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
function tabToHz(tab) {
  return (tab || '').split('')
    .map((v, s) => (v === 'x' ? null : OPEN_HZ[s] * 2 ** (parseInt(v, 10) / 12)))
    .filter((x) => x != null);
}

// Turn an element's declarative AudioSpec into SOFT sound on the shared ctx (never
// the metallic pluck). Returns a promise that resolves ~when the prompt finishes,
// so the caller opens the mic only AFTER the prompt (no bleed into the window).
function playPrompt(spec) {
  return new Promise((resolve) => {
    if (!spec) { resolve(); return; }
    unlockAudio().then((ctx) => {
      if (!ctx) { resolve(); return; }
      if (spec.kind === 'plucks') {
        const hzs = spec.hz || [];
        if (!hzs.length) { resolve(); return; }
        const gap = (spec.gapMs || 0) / 1000;
        const t0 = ctx.currentTime + 0.08;
        if (gap === 0 && hzs.length > 1) playSoftChord(ctx, hzs, t0);
        else hzs.forEach((hz, i) => playSoftTone(ctx, hz, t0 + i * gap, 1.0));
        setTimeout(resolve, hzs.length * (spec.gapMs || 0) + 1400);
        return;
      }
      // 'progression' → soft chord blocks (warm, not the metallic guitar).
      const voicings = spec.voicings || [];
      if (!voicings.length) { resolve(); return; }
      const chordDur = (60 / (spec.bpm || 90)) * 2;   // 2 beats/chord — calm
      const t0 = ctx.currentTime + 0.08;
      voicings.forEach((v, i) => {
        playSoftChord(ctx, tabToHz(v.tab), t0 + i * chordDur, { dur: chordDur * 0.9, spreadMs: 70 });
      });
      setTimeout(resolve, (voicings.length * chordDur + 0.6) * 1000);
    }).catch(() => resolve());
  });
}

/**
 * Drive a Music Memory session.
 *
 * phase: 'checkin' → 'prompt' → 'answer' → 'feedback' → … → 'checkout'
 * start({ checkInMood }) begins the session; the loop runs SESSION_ITEMS items.
 *
 * Returns live state the UI renders: the current element + prompt, the countdown,
 * the answer-window progress, what the mic hears now (liveNote), the last item's
 * result, the running tally, and the final result (with celebration advancement).
 */
export function useMusicMemory() {
  const mic = useMic();
  const rafRef = useRef(null);
  const cfgRef = useRef(loadConfig());

  const [phase, setPhase] = useState('checkin');
  const [countdown, setCountdown] = useState(null);
  const [element, setElement] = useState(null);
  const [itemNo, setItemNo] = useState(0);        // 1-based item index in the session
  const [liveNote, setLiveNote] = useState(null); // { pc, midi, hz, cents } | null
  const [lastResult, setLastResult] = useState(null); // { correct, detail, element }
  const [tally, setTally] = useState({ correct: 0, total: 0 });
  const [levelState, setLevelState] = useState({ level: 1, streak: 0 });
  const [micOk, setMicOk] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [heardPcs, setHeardPcs] = useState([]);     // committed PCs THIS item (live → chips)
  const [pacerEpoch, setPacerEpoch] = useState(0);  // performance.now() when the EMDR bed started

  // Mutable run state the async loop reads fresh.
  const abortRef = useRef(false);
  const levelRef = useRef({ level: 1, streak: 0 });
  const streakBestRef = useRef(0);
  const perTypeRef = useRef({});
  // Per-item mic state: the note-capture state machine + the mic-ok latch. Reset
  // each item; the rAF tick reads the current instance through these refs.
  const noteCaptureRef = useRef(null);
  const micOkRef = useRef(null);
  const committedPcsRef = useRef(null);  // the Set the tick mutates (surfaced via heardPcs)
  const bedsOnRef = useRef(false);       // are the session EMDR/ambient beds running?

  const stopMic = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { mic.current.close(); } catch { /* noop */ }
  }, [mic]);

  // Stop the session-scoped calm beds (idempotent; guarded so 'Another round'
  // can't double-start and every exit path funnels here).
  const stopBeds = useCallback(() => {
    if (!bedsOnRef.current) return;
    bedsOnRef.current = false;
    stopEmdrBed();
    stopAmbient();
  }, []);

  useEffect(() => () => { abortRef.current = true; stopMic(); stopAudio(); stopBeds(); }, [stopMic, stopBeds]);

  const abort = useCallback(() => {
    abortRef.current = true;
    stopMic();
    stopAudio();
    stopBeds();
    setPhase('checkin');
    setCountdown(null);
    setElement(null);
    setLiveNote(null);
  }, [stopMic, stopBeds]);

  // Replay the current element's prompt audio (the calm "hear it again").
  const replay = useCallback(() => {
    if (element?.prompt?.audio) playPrompt(element.prompt.audio);
  }, [element]);

  // Run ONE item: play prompt → open mic → count-in → answer window → grade.
  // Resolves to { correct, detail }.
  const runItem = useCallback(async (el) => {
    setLiveNote(null);
    // 1) Prompt (mic still closed so it can't bleed into the graded window).
    setPhase('prompt');
    if (el.prompt.mode === 'play') await playPrompt(el.prompt.audio);
    if (abortRef.current) return null;

    // 2) Open the mic and run the count-in + answer window.
    try {
      await mic.current.open(cfgRef.current.smoothing, { raw: true });
    } catch (e) {
      setError(e && e.name === 'NotAllowedError'
        ? 'Microphone permission denied — allow mic access and try again.'
        : 'Could not access the microphone.');
      // Recover the session rather than freezing on 'prompt'/'answer'.
      stopMic();
      stopBeds();
      setPhase('checkin');
      return null;
    }

    const onset = makeOnsetDetector();
    committedPcsRef.current = new Set();
    setHeardPcs([]);              // clear last item's chips
    let heardDuringCountIn = false;
    let captureReset = false;

    setPhase('answer');
    setCountdown(Math.ceil(COUNTDOWN_MS / 1000));

    const started = performance.now();
    await new Promise((resolve) => {
      let lastFrame = 0;
      let lastCountdown = -1;

      const tick = (now) => {
        if (abortRef.current) { resolve(); return; }
        const elapsed = now - started;
        const inCountIn = elapsed < COUNTDOWN_MS;

        if (inCountIn) {
          const remain = Math.ceil((COUNTDOWN_MS - elapsed) / 1000);
          if (remain !== lastCountdown) { lastCountdown = remain; setCountdown(remain); }
        } else if (lastCountdown !== 0) {
          lastCountdown = 0; setCountdown(0);
        }

        // At the count-in→answer boundary, reset the capture machine so a note
        // that stabilized DURING the count-in can't suppress the user's first
        // real answer note (makeNoteCapture carries committedMidi/armed until a
        // silence frame). Without this, "show the answer live" would miss it.
        if (!inCountIn && !captureReset) {
          captureReset = true;
          noteCaptureRef.current.reset();
          onset.reset();
        }

        // End when the answer window (after the count-in) elapses.
        if (elapsed >= COUNTDOWN_MS + ANSWER_MS) { resolve(); return; }

        if (elapsed - lastFrame >= FRAME_MS) {
          lastFrame = elapsed;
          const rms = mic.current.getRMS();
          const td = mic.current.getTimeData();
          const isOnset = onset.push(rms);

          let midi = null;
          if (td && rms >= SILENCE_RMS) {
            const hz = detectPitchYIN(td, mic.current.sampleRate);
            if (hz && hz > 0) {
              const m = hzToMidi(hz);
              midi = m;
              const mr = Math.round(m);
              setLiveNote({ pc: ((mr % 12) + 12) % 12, midi: mr, hz, cents: Math.round((m - mr) * 100) });
              if (inCountIn) heardDuringCountIn = true;
            } else setLiveNote(null);
          } else setLiveNote(null);

          // Commit stable notes (ring-over aware) during the SCORED window only,
          // surfacing each NEW pitch class to render (one re-render per new pc).
          const c = noteCaptureRef.current.push({ midi, rms, onset: isOnset, tMs: elapsed });
          if (c && !inCountIn) {
            const pc = ((Math.round(c.midi) % 12) + 12) % 12;
            const set = committedPcsRef.current;
            if (!set.has(pc)) { set.add(pc); setHeardPcs([...set]); }
          }

          if (!inCountIn && micOkRef.current === null) {
            micOkRef.current = heardDuringCountIn;
            setMicOk(heardDuringCountIn);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    });

    stopMic();
    setLiveNote(null);
    setCountdown(null);
    if (abortRef.current) return null;

    // Leave heardPcs populated — it must persist through the feedback phase.
    return accept(el, committedPcsRef.current);
  }, [mic, stopMic, stopBeds]);

  const start = useCallback(async ({ checkInMood } = {}) => {
    setError(null);
    setResult(null);
    setTally({ correct: 0, total: 0 });
    setLastResult(null);
    setMicOk(null);
    abortRef.current = false;
    levelRef.current = { level: 1, streak: 0 };
    setLevelState(levelRef.current);
    streakBestRef.current = 0;
    perTypeRef.current = {};

    // Prime audio inside the user gesture that called start().
    try { await unlockAudio(); } catch { /* noop */ }

    // Start the session-scoped calm beds ONCE (idempotent). The EMDR bed returns
    // its performance.now() epoch so the CSS pacer can phase-align its sweep.
    if (!bedsOnRef.current) {
      startAmbient();
      const epoch = startEmdrBed({ breathMs: BREATH_MS });
      setPacerEpoch(epoch);
      bedsOnRef.current = true;
    }

    let correct = 0;
    for (let i = 0; i < SESSION_ITEMS; i++) {
      if (abortRef.current) return null;
      const el = nextElement(levelRef.current.level, i);
      setElement(el);
      setItemNo(i + 1);

      // Fresh capture + mic-ok latch per item.
      noteCaptureRef.current = makeNoteCapture();
      micOkRef.current = null;

      const graded = await runItem(el);
      if (abortRef.current || graded == null) return null;

      // Tally + adaptive + per-type stats.
      const pt = perTypeRef.current[el.type] || { correct: 0, total: 0 };
      pt.total += 1; if (graded.correct) pt.correct += 1;
      perTypeRef.current[el.type] = pt;
      if (graded.correct) correct += 1;

      const nextLevel = adjustLevel(levelRef.current, graded.correct);
      levelRef.current = nextLevel;
      setLevelState(nextLevel);
      streakBestRef.current = Math.max(streakBestRef.current, nextLevel.streak);

      setTally({ correct, total: i + 1 });
      setLastResult({ ...graded, element: el });

      // 3) Calm feedback beat (never punitive — the UI shows reassurance).
      setPhase('feedback');
      await new Promise((r) => setTimeout(r, FEEDBACK_MS));
      if (abortRef.current) return null;
    }

    // ── Session done: score, persist, detect advancement, check-out ────────────
    const total = SESSION_ITEMS;
    const score = Math.round((correct / total) * 100);
    const before = memoryMastery();
    let after = before;
    try {
      saveMemoryRun({
        correct, total, score,
        level: levelRef.current.level,
        streakBest: streakBestRef.current,
        perType: perTypeRef.current,
      });
      after = memoryMastery();
    } catch { /* never block on storage */ }
    const advancement = detectMemoryAdvancement(before, after, { correct, total });

    const out = {
      correct, total, score,
      level: levelRef.current.level,
      streakBest: streakBestRef.current,
      perType: perTypeRef.current,
      checkInMood: checkInMood ?? null,
      advancement,
    };
    stopBeds();   // drill over — quiet the beds for the calm check-out
    setResult(out);
    setPhase('checkout');
    return out;
  }, [runItem, stopBeds]);

  return {
    phase, setPhase,
    countdown, element, itemNo, sessionItems: SESSION_ITEMS,
    liveNote, lastResult, tally, levelState, micOk, result, error,
    heardPcs, pacerEpoch,
    expectedAnswerLabel: element ? answerLabelFor(element) : null,
    answerMs: ANSWER_MS, breathMs: BREATH_MS,
    start, abort, replay,
  };
}

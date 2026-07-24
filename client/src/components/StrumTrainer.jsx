// Strum Lab — the practice screen behind "Build calluses & a steady strumming
// hand" (hidden 'strum' route, reached from the Level Plan milestone's Go).
//
// Flow: pick a pattern + tempo → 5-second tick countdown ("go") with the mic
// already recording → one unscored "feel the beat" bar → SESSION_BARS bars of
// the pattern over a metronome, every expected strum judged live on timing →
// results, saved to guitar_strum_trainer_v1. Passing STRUM_PASS_PATTERNS
// different patterns at STRUM_PASS%+ completes the milestone (celebrated).
//
// The mic judges TIMING, not stroke direction — an honest scorer: onsets are
// detected from band-limited loudness (strumBandRms) so the app's own 2.5 kHz
// metronome clicks through the speakers don't register as strums.

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useT } from '../lib/i18n';
import { useHandProfile } from '../App';
import { useMic } from '../lib/micDetect';
import { makeOnsetDetector } from '../lib/improvEngine';
import { makeCountdownCue } from '../lib/countdownCue';
import { unlockAudio, playMetronome, playFanfare } from '../lib/audio';
import ChordTip from './ChordTip';
import Celebration from './Celebration';
import {
  STRUM_PATTERNS, SLOT_LABELS, SESSION_BARS, patternById, patternStrokes,
  expectedStrums, strumTolerance, scoreStrumRun, strumBandRms,
  saveStrumRun, strumMastery, STRUM_PASS, STRUM_PASS_PATTERNS,
} from '../lib/strumTrainer';
import { LEVEL_PLAN, isMilestoneDone, loadManual } from '../lib/levelPlan';

const ARROW = { D: '↓', U: '↑' };

/** One bar of the pattern as arrow cells. */
function ArrowRow({ slots, big = false, activeSlot = -1, results = null }) {
  return (
    <div className={`flex justify-center ${big ? 'gap-1.5' : 'gap-1'}`}>
      {slots.map((stroke, i) => {
        const res = results ? results[i] : null;
        const active = i === activeSlot;
        let style = {};
        if (res === 'hit') style = { borderColor: 'var(--color-success)', background: 'rgba(74,222,128,0.12)' };
        else if (res === 'miss') style = { borderColor: 'var(--color-danger)', background: 'rgba(239,68,68,0.10)' };
        else if (active) style = { borderColor: 'var(--color-brand)', boxShadow: '0 0 0 1px var(--color-brand)' };
        return (
          <div
            key={i}
            className={`flex flex-col items-center rounded-lg border border-surface-650 bg-surface-750 ${big ? 'flex-1 min-w-0 max-w-12 px-1 py-2' : 'px-1.5 py-1 min-w-7'} ${active ? 'animate-pulse' : ''}`}
            style={style}
          >
            <span
              className={`font-black leading-none ${big ? 'text-2xl' : 'text-base'} ${stroke ? '' : 'opacity-40'}`}
              style={{ color: stroke === 'D' ? 'var(--color-brand)' : stroke === 'U' ? 'var(--color-info)' : 'var(--color-ink-faint)' }}
            >
              {stroke ? ARROW[stroke] : '·'}
            </span>
            <span className="text-[9px] font-semibold mt-0.5 text-ink-faint">{SLOT_LABELS[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function StrumTrainer({ lang, onClose = null }) {
  const tr = useT(lang);
  const profile = useHandProfile();
  const mic = useMic();

  const [phase, setPhase] = useState('pick'); // pick | counting | play | done
  const [selectedId, setSelectedId] = useState(STRUM_PATTERNS[0].id);
  const [bpm, setBpm] = useState(STRUM_PATTERNS[0].bpm);
  const [count, setCount] = useState(5);
  const [barNow, setBarNow] = useState(-1);          // -1 = feel-the-beat bar
  const [countBeat, setCountBeat] = useState(4);     // 4..1 inside that bar
  const [slotNow, setSlotNow] = useState(-1);        // active slot in the bar
  const [slotResults, setSlotResults] = useState(Array(8).fill(null));
  const [liveHits, setLiveHits] = useState(0);
  const [result, setResult] = useState(null);        // scoreStrumRun result + plan info
  const [micError, setMicError] = useState(null);    // null | 'denied' | 'unavailable'

  const mastery = useMemo(() => strumMastery(), [phase]);
  const pattern = patternById(selectedId) || STRUM_PATTERNS[0];

  // Refs for the rAF loop (per-frame work never touches React state directly
  // except at coarse boundaries: bar change, slot judged, run end).
  const phaseRef = useRef('pick');
  const rafRef = useRef(null);
  const detectorRef = useRef(null);
  const onsetsRef = useRef([]);
  const runRef = useRef(null);      // { expected, spb, dur, tol }
  const t0Ref = useRef(null);       // mic-clock time of scored bar 0, beat 0
  const judgeFromRef = useRef(0);
  const barRef = useRef(-2);
  const slotRef = useRef(-1);
  const beatRef = useRef(0);
  const hitsRef = useRef(0);
  const stopMetroRef = useRef(null);
  const cueRef = useRef(null);
  const countTimerRef = useRef(null);
  const runningRef = useRef(false);
  const savedRef = useRef(false);
  const levelBarRef = useRef(null);
  const sessionRef = useRef(0);     // bumped by cleanup → kills any start() still awaiting the mic
  const startingRef = useRef(false); // re-entry guard while getUserMedia is pending
  const offsetRef = useRef(0);      // live estimate of the constant device latency
  const diffsRef = useRef([]);      // matched offsets feeding that estimate

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const cleanup = useCallback(() => {
    sessionRef.current += 1; // invalidate any start() paused on the permission prompt
    runningRef.current = false;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (countTimerRef.current) { clearTimeout(countTimerRef.current); countTimerRef.current = null; }
    cueRef.current?.cancel();
    stopMetroRef.current?.();
    stopMetroRef.current = null;
    try { mic.current?.close(); } catch { /* already closed */ }
  }, [mic]);

  useEffect(() => cleanup, [cleanup]); // unmount safety

  const finishRun = useCallback(() => {
    const run = runRef.current;
    cleanup();
    if (!run) { setPhase('pick'); return; }
    const onsets = onsetsRef.current.filter((t) => t >= -run.tol && t <= run.dur + run.tol);
    const r = scoreStrumRun(run.expected, onsets, { tol: run.tol });

    // Save once, diffing the Level Plan around the save so we can celebrate
    // exactly which step this run completed (the advancement rule).
    let planAdvanced = [];
    let patternFirstPass = false;
    if (!savedRef.current) {
      savedRef.current = true;
      const before = strumMastery();
      const planCtx = { handProfile: profile, manual: loadManual() };
      const openBefore = LEVEL_PLAN.filter((m) => !isMilestoneDone(m, planCtx));
      saveStrumRun({
        patternId: run.patternId, bpm: run.bpm, bars: SESSION_BARS,
        hits: r.hits, total: r.total, extras: r.extras, score: r.score,
        steadinessMs: r.steadinessMs,
      });
      planAdvanced = openBefore.filter((m) => isMilestoneDone(m, planCtx));
      patternFirstPass = strumMastery().patternsPassed > before.patternsPassed;
      // A pattern newly passed (but no milestone yet) still deserves a chord
      // of celebration — the big one is reserved for plan advancement.
      if (patternFirstPass && planAdvanced.length === 0) {
        try { playFanfare({ big: false }); } catch { /* no audio */ }
      }
    }
    setResult({ ...r, planAdvanced, patternFirstPass });
    setPhase('done');
  }, [cleanup, profile]);

  // The single per-frame loop: feed the onset detector (during the countdown
  // it only warms its noise baseline), timestamp onsets on the mic clock,
  // advance the bar/slot UI, and judge each expected strum once its window
  // has fully closed.
  const loop = useCallback(() => {
    const api = mic.current;
    if (!runningRef.current || !api || !api.analyser) return;

    const rms = strumBandRms(api.getTimeData(), api.sampleRate);
    if (levelBarRef.current) {
      levelBarRef.current.style.width = `${Math.min(100, Math.round(rms * 600))}%`;
    }
    const onset = detectorRef.current?.push(rms);

    if (phaseRef.current === 'play' && t0Ref.current != null && runRef.current) {
      const { expected, spb, dur, tol } = runRef.current;
      const songSec = api.audioCtx.currentTime - t0Ref.current;
      if (onset) onsetsRef.current.push(songSec);

      if (songSec < 0) {
        // Feel-the-beat bar: count 4..1 with the metronome.
        const beat = Math.max(1, Math.min(4, Math.ceil(-songSec / spb)));
        if (beat !== beatRef.current) { beatRef.current = beat; setCountBeat(beat); }
      } else if (songSec < dur) {
        const bar = Math.floor(songSec / (spb * 4)); // 4 beats per bar
        if (bar !== barRef.current) { barRef.current = bar; setBarNow(bar); }
        const slot = Math.floor(songSec / (spb / 2)) % 8;
        if (slot !== slotRef.current) {
          slotRef.current = slot;
          setSlotNow(slot);
          // Loop-pedal display: entering a cell wipes last bar's mark there
          // (no bulk reset at the bar line — a judgment landing just past it
          // would be silently dropped and every last-slot mark cut short).
          setSlotResults((prev) => (prev[slot] == null ? prev : prev.map((r, i) => (i === slot ? null : r))));
        }
      }

      // Judge expected strums whose window closed (small grace after tol),
      // compensating the same constant device latency the final scorer
      // removes — otherwise a Bluetooth-audio player watches every cell go
      // red mid-run (coaching them to rush) and then gets a passing score.
      while (judgeFromRef.current < expected.length) {
        const e = expected[judgeFromRef.current];
        if (songSec < e.time + tol + 0.05) break;
        judgeFromRef.current += 1;
        let bestDiff = null;
        for (const t of onsetsRef.current) {
          const d = t - e.time;
          if (bestDiff == null || Math.abs(d - offsetRef.current) < Math.abs(bestDiff - offsetRef.current)) bestDiff = d;
        }
        const hit = bestDiff != null && Math.abs(bestDiff - offsetRef.current) <= tol;
        if (hit) {
          hitsRef.current += 1;
          setLiveHits(hitsRef.current);
          // Running median of matched raw offsets → the latency estimate.
          diffsRef.current.push(bestDiff);
          const recent = [...diffsRef.current.slice(-9)].sort((a, b) => a - b);
          offsetRef.current = recent[Math.floor(recent.length / 2)];
        }
        setSlotResults((prev) => {
          const next = [...prev];
          next[e.slot] = hit ? 'hit' : 'miss';
          return next;
        });
      }

      if (songSec > dur + 0.35) { finishRun(); return; }
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [mic, finishRun]);

  // Countdown done → start the metronome and anchor the scored grid on the
  // MIC clock (audio.js runs its own context; playMetronome takes a relative
  // delay for exactly this reason).
  const beginRun = useCallback(() => {
    const api = mic.current;
    if (!api || !api.analyser || !runningRef.current) return;
    const p = patternById(selectedId) || STRUM_PATTERNS[0];
    const spb = 60 / bpm;
    runRef.current = {
      patternId: p.id,
      bpm,
      spb,
      expected: expectedStrums(p, bpm, SESSION_BARS),
      dur: SESSION_BARS * 4 * spb,
      tol: strumTolerance(bpm),
    };
    onsetsRef.current = [];
    judgeFromRef.current = 0;
    barRef.current = -2;
    slotRef.current = -1;
    beatRef.current = 0;
    hitsRef.current = 0;
    offsetRef.current = 0;
    diffsRef.current = [];
    setLiveHits(0);
    setBarNow(-1);
    setSlotNow(-1);
    setCountBeat(4);
    setSlotResults(Array(8).fill(null));
    stopMetroRef.current = playMetronome((1 + SESSION_BARS) * 4, spb, { startInSec: 0.12 });
    t0Ref.current = api.audioCtx.currentTime + 0.12 + 4 * spb; // after the feel-the-beat bar
    setPhase('play');
  }, [mic, selectedId, bpm]);

  const start = async () => {
    // Re-entry guard: the Start/Again button stays mounted while the
    // getUserMedia permission prompt is up — a second tap must not open a
    // second stream (the first would leak, hot, until page reload).
    if (startingRef.current || runningRef.current) return;
    startingRef.current = true;
    setMicError(null);
    unlockAudio(); // must run synchronously in the tap (iOS)
    const session = sessionRef.current;
    try {
      // Raw + snappy: no voice DSP, low analyser smoothing → sharp onsets.
      await mic.current.open(0.25, { raw: true });
    } catch (e) {
      startingRef.current = false;
      if (sessionRef.current === session) {
        setMicError(e?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
      return;
    }
    startingRef.current = false;
    // The session died while the prompt was up (unmount / Stop / tab switch —
    // cleanup bumps sessionRef): close the just-opened stream and walk away,
    // otherwise the mic stays hot with no owner and a ghost session starts.
    if (sessionRef.current !== session) {
      try { mic.current.close(); } catch { /* already closed */ }
      return;
    }
    detectorRef.current = makeOnsetDetector({ riseRatio: 2.0, floor: 0.006, refractoryFrames: 6 });
    runningRef.current = true;
    savedRef.current = false;
    setResult(null);

    // The app-wide practice count-in: 5 seconds, a clock tick per second,
    // spoken "go" — with the mic already recording (it warms the detector's
    // noise baseline during the count).
    setPhase('counting');
    cueRef.current = makeCountdownCue();
    let remaining = 5;
    setCount(remaining);
    cueRef.current.set(remaining);
    const tick = () => {
      if (!runningRef.current) return;
      remaining -= 1;
      setCount(remaining);
      cueRef.current.set(remaining); // fires the spoken "go" at 0
      if (remaining > 0) countTimerRef.current = setTimeout(tick, 1000);
      else beginRun();
    };
    countTimerRef.current = setTimeout(tick, 1000);
    rafRef.current = requestAnimationFrame(loop);
  };

  const stopEarly = () => { cleanup(); setPhase('pick'); };

  const passedIds = useMemo(
    () => new Set(Object.entries(mastery.bestByPattern).filter(([, s]) => s >= STRUM_PASS).map(([id]) => id)),
    [mastery],
  );

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* ── PICK ────────────────────────────────────────────────────────────── */}
      {phase === 'pick' && (
        <>
          <section className="rounded-2xl p-4 sm:p-5 border bg-surface-800 border-surface-700">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1">
              {tr.stEyebrow || 'Calluses & rhythm'}
            </div>
            <h2 className="text-lg font-bold text-ink mb-2">{tr.stTitle || '🎸 Strum Lab'}</h2>
            <p className="text-sm leading-relaxed text-ink-faint mb-3">
              {tr.stIntro || 'Hold a chord, follow the arrows, and strum with the click. The mic listens to every strum and scores your timing — the steadiness a beginner can’t judge alone. (It hears WHEN you strum, not the stroke direction — the arrows teach that part.)'}
            </p>
            <p className="text-sm text-ink mb-1">
              {tr.stChordHint || 'Any easy chord works — '}
              <ChordTip name="Em" className="cursor-help"><span className="font-bold text-brand">Em</span></ChordTip>
              {tr.stChordHint2 || ' is a great one to hold (hover it to see the shape).'}
            </p>
            <p className="text-xs text-ink-faint">
              {(tr.stGoal || 'Score ${pass}%+ on ${n} different patterns to complete your Level Plan step.')
                .replace('${pass}', STRUM_PASS).replace('${n}', STRUM_PASS_PATTERNS)}
              {' '}
              <span className="font-semibold" style={{ color: mastery.patternsPassed >= STRUM_PASS_PATTERNS ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {(tr.stGoalSoFar || '${done}/${n} so far.').replace('${done}', Math.min(mastery.patternsPassed, STRUM_PASS_PATTERNS)).replace('${n}', STRUM_PASS_PATTERNS)}
              </span>
            </p>
          </section>

          <section className="space-y-2">
            {STRUM_PATTERNS.map((p) => {
              const best = mastery.bestByPattern[p.id] || 0;
              const passed = passedIds.has(p.id);
              const selected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { setSelectedId(p.id); setBpm(p.bpm); }}
                  className="w-full text-left rounded-2xl p-3 sm:p-4 border bg-surface-800 transition-colors"
                  style={selected
                    ? { borderColor: 'var(--color-brand)', boxShadow: '0 0 0 1px var(--color-brand)' }
                    : { borderColor: 'var(--color-surface-700)' }}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-bold text-ink truncate">{p.name}</span>
                      <span className="text-[10px] font-mono font-semibold text-ink-faint shrink-0">{p.count}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {best > 0 && (
                        <span className="text-[10px] font-semibold text-ink-faint">
                          {(tr.stBest || 'best ${score}%').replace('${score}', best)}
                        </span>
                      )}
                      {passed && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: 'var(--color-success)', background: 'rgba(74,222,128,0.12)' }}>
                          ✓ {tr.stPassed || 'Passed'}
                        </span>
                      )}
                      <span className="text-[10px] text-ink-faint">♩{p.bpm}</span>
                    </div>
                  </div>
                  <ArrowRow slots={p.slots} />
                  <p className="text-xs text-ink-faint mt-2">{p.blurb}</p>
                </button>
              );
            })}
          </section>

          <section className="rounded-2xl p-4 border bg-surface-800 border-surface-700">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-ink shrink-0">♩ {bpm} BPM</span>
              <input
                type="range" min="50" max="120" step="2" value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="flex-1"
                aria-label={tr.stTempo || 'Tempo'}
              />
              <button
                type="button"
                onClick={start}
                className="text-xs px-3.5 py-1.5 rounded-lg font-semibold bg-brand text-surface-base shrink-0"
              >
                ▶ {tr.stStart || 'Start'}
              </button>
            </div>
            <p className="text-[11px] text-ink-faint mt-2">
              {(tr.stSessionShape || 'One count-in bar to feel the beat, then ${bars} bars of the pattern — about ${strums} strums.')
                .replace('${bars}', SESSION_BARS)
                .replace('${strums}', patternStrokes(pattern) * SESSION_BARS)}
            </p>
            {micError && (
              <p className="text-xs mt-2 font-semibold" style={{ color: 'var(--color-danger)' }}>
                {micError === 'denied'
                  ? (tr.stMicDenied || 'Microphone blocked — allow mic access to have your strumming scored.')
                  : (tr.stMicUnavailable || 'Could not access the microphone — check one is connected and not in use by another app.')}
              </p>
            )}
          </section>

          <section className="rounded-2xl p-4 border bg-surface-800 border-surface-700">
            <h3 className="text-sm font-bold text-ink mb-2">{tr.stCallusTitle || '🖐️ Callus care'}</h3>
            <ul className="text-xs text-ink-faint space-y-1.5 list-disc list-inside">
              <li>{tr.stCallus1 || 'A few minutes EVERY day beats one long session — skin hardens between sessions, not during them.'}</li>
              <li>{tr.stCallus2 || 'Mild fingertip tingling is normal for the first 2–3 weeks; sharp pain or blisters mean stop for the day.'}</li>
              <li>{tr.stCallus3 || 'Press just hard enough for a clean sound — extra squeeze is wasted effort and slows your changes.'}</li>
              <li>{tr.stCallus4 || 'Keep the strumming wrist loose and let the elbow swing — the click will tell you if you tense up.'}</li>
            </ul>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="mt-3 text-xs px-3 py-1.5 rounded-lg font-semibold bg-surface-600 text-brand"
              >
                {tr.tqBackToPlan || '🗺️ Back to Level Plan'}
              </button>
            )}
          </section>
        </>
      )}

      {/* ── COUNTDOWN ───────────────────────────────────────────────────────── */}
      {phase === 'counting' && (
        <section className="rounded-2xl p-8 border bg-surface-800 border-surface-700 text-center">
          <p className="text-sm font-semibold text-ink mb-1">
            {tr.stCountMsg || 'Grab your chord — strumming hand loose.'}
          </p>
          <p className="text-xs text-ink-faint mb-4">
            {tr.stCountMsg2 || 'The mic is already listening. Strumming starts after the count.'}
          </p>
          <div className="text-6xl font-black" style={{ color: 'var(--color-brand)' }}>{count}</div>
          <div className="mt-4 mx-auto max-w-xs h-1.5 rounded-full bg-surface-700 overflow-hidden">
            <div ref={levelBarRef} className="h-full rounded-full" style={{ width: '0%', background: 'var(--color-brand)', transition: 'width 80ms linear' }} />
          </div>
          <button
            type="button"
            onClick={stopEarly}
            className="mt-5 text-xs font-semibold px-3 py-2 rounded-lg"
            style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)' }}
          >
            ✕ {tr.stStop || 'Stop'}
          </button>
        </section>
      )}

      {/* ── PLAY ────────────────────────────────────────────────────────────── */}
      {phase === 'play' && (
        <section className="rounded-2xl p-4 sm:p-6 border bg-surface-800 border-surface-700">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold text-ink-faint">
              {pattern.name} · ♩{bpm}
            </span>
            <span className="text-xs font-semibold text-ink-faint">✦ {liveHits}</span>
            <button
              type="button"
              onClick={stopEarly}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)' }}
            >
              ✕ {tr.stStop || 'Stop'}
            </button>
          </div>

          {barNow < 0 ? (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-ink mb-2">{tr.stFeelBeat || 'Feel the beat…'}</p>
              <div className="text-5xl font-black animate-pulse" style={{ color: 'var(--color-info)' }}>{countBeat}</div>
            </div>
          ) : (
            <div className="text-center mb-2">
              <span className="text-xs font-semibold text-ink-faint">
                {(tr.stBarOf || 'Bar ${n} of ${total}').replace('${n}', barNow + 1).replace('${total}', SESSION_BARS)}
              </span>
            </div>
          )}

          <ArrowRow
            slots={pattern.slots}
            big
            activeSlot={barNow >= 0 ? slotNow : -1}
            results={barNow >= 0 ? slotResults : null}
          />

          {/* Mic level — proof the app hears the guitar. */}
          <div className="mt-4 h-1.5 rounded-full bg-surface-700 overflow-hidden">
            <div ref={levelBarRef} className="h-full rounded-full" style={{ width: '0%', background: 'var(--color-brand)', transition: 'width 80ms linear' }} />
          </div>
          <p className="text-[10px] text-ink-faint mt-1 text-center">{tr.stMicLevel || 'mic level'}</p>
        </section>
      )}

      {/* ── DONE ────────────────────────────────────────────────────────────── */}
      {phase === 'done' && result && (
        <section className="rounded-2xl p-6 border bg-surface-800 border-surface-700 text-center">
          {result.planAdvanced.length > 0 && (
            <Celebration
              advancement={{
                advanced: true, big: true,
                top: { type: 'milestone', detail: { title: result.planAdvanced.map((m) => m.title).join(' · ') } },
              }}
              tr={tr}
            />
          )}
          {result.patternFirstPass && result.planAdvanced.length === 0 && (
            <p className="text-sm font-bold mb-2" style={{ color: 'var(--color-success)' }}>
              {(tr.stPatternPassed || '✓ “${name}” passed!').replace('${name}', pattern.name)}
            </p>
          )}
          <div
            className="text-5xl font-black mb-1"
            style={{ color: result.score >= STRUM_PASS ? 'var(--color-success)' : 'var(--color-warning)' }}
          >
            {result.score}%
          </div>
          <p className="text-sm text-ink-faint mb-1">
            {(tr.stHitsLine || '${hits} of ${total} strums on time')
              .replace('${hits}', result.hits).replace('${total}', result.total)}
          </p>
          <p className="text-xs text-ink-faint mb-3">
            {(tr.stSteadiness || 'Steadiness: ±${ms} ms').replace('${ms}', result.steadinessMs)}
            {result.extras > 0 && (
              <> · {(tr.stExtras || '${n} extra strums').replace('${n}', result.extras)}</>
            )}
          </p>

          {/* Per-bar hit map — where the run held together and where it drifted. */}
          <div className="inline-flex flex-col gap-1 mb-4">
            {Array.from({ length: SESSION_BARS }, (_, bar) => (
              <div key={bar} className="flex gap-1 justify-center">
                {result.perSlot.filter((s) => s.bar === bar).map((s, i) => (
                  <span
                    key={i}
                    className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center"
                    style={s.hit
                      ? { background: 'rgba(74,222,128,0.18)', color: 'var(--color-success)' }
                      : { background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)' }}
                  >
                    {ARROW[s.stroke]}
                  </span>
                ))}
              </div>
            ))}
          </div>

          <p className="text-sm text-ink mb-4">
            {result.score >= STRUM_PASS
              ? (tr.stPassMsg || 'Steady! That’s a passing run.')
              : (tr.stFailMsg || 'Keep the arm swinging — even misses count as callus time. Try a slower tempo.')}
          </p>
          <div className="flex justify-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={start}
              className="text-xs px-3.5 py-1.5 rounded-lg font-semibold bg-brand text-surface-base"
            >
              ▶ {tr.stAgain || 'Again'}
            </button>
            <button
              type="button"
              onClick={() => setPhase('pick')}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-surface-600 text-brand"
            >
              {tr.stPatterns || 'Patterns'}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-surface-600 text-brand"
              >
                {tr.tqBackToPlan || '🗺️ Back to Level Plan'}
              </button>
            )}
          </div>
          {micError && (
            <p className="text-xs mt-3 font-semibold" style={{ color: 'var(--color-danger)' }}>
              {micError === 'denied'
                ? (tr.stMicDenied || 'Microphone blocked — allow mic access to have your strumming scored.')
                : (tr.stMicUnavailable || 'Could not access the microphone — check one is connected and not in use by another app.')}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

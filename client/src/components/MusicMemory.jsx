// MusicMemory — the ear-training / music-memory tab, as a cinematic full-screen
// experience.
//
// The app plays a soft, warm prompt (a note, interval, chord, scale degree, or the
// next chord of a progression); the user SAYS the answer aloud (sing/hum or play)
// and sees it recognized live on screen; the correct answer is shown at round end.
// The whole loop sits inside a calming EMDR-style stage: a bilateral glowing pacer
// (with a synced left↔right stereo tone), a breathing cue, a plain-language
// explanation of why the motion helps, a session check-in/out, and never-punitive
// feedback.
//
// The stage is portalled to document.body as a fixed overlay so it can go truly
// full-bleed (it would otherwise be clipped by the tab panel's transformed,
// overflow-hidden ancestor). Presentation + flow only — the mic loop is in
// useMusicMemory; grading/adaptive/theory is pure in memoryTrain.js.

import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n';
import { useMusicMemory } from '../lib/useMusicMemory';
import { pcName, memoryMastery, answerLabelFor, promptSpeech, answerSpeech, LEVELS } from '../lib/memoryTrain';
import { say, stopSinging, vocalsSupported } from '../lib/vocals';
import BilateralPacer from './BilateralPacer';
import Celebration from './Celebration';
import ChordTip from './ChordTip';
import './MusicMemory.css';

const NARRATE_KEY = 'guitar_mm_narrate';

// The plan/roadmap: the 5 difficulty stages and this session's 8 rounds. Shows
// the whole journey and where the user is right now.
const STAGE_LABELS = ['Notes', 'Intervals', 'Chords', 'Scale degrees', 'Progressions'];

function PlanRoadmap({ level, itemNo, sessionItems, tr, compact }) {
  const curLevel = Math.max(1, Math.min(LEVELS.length, level || 1));
  return (
    <div className={`mm-plan${compact ? ' is-compact' : ''}`}>
      {!compact && (
        <div className="mm-plan-title">{tr.mmPlanStages || 'Your path — 5 stages'}</div>
      )}
      <ol className="mm-plan-stages">
        {STAGE_LABELS.map((label, i) => {
          const n = i + 1;
          const state = n < curLevel ? 'done' : n === curLevel ? 'now' : 'todo';
          const key = ['mmStageNotes', 'mmStageIntervals', 'mmStageChords', 'mmStageDegrees', 'mmStageProgressions'][i];
          return (
            <li key={label} className={`mm-pstage is-${state}`}>
              <span className="mm-pstage-num">{n}</span>
              <span className="mm-pstage-label">{tr[key] || label}</span>
            </li>
          );
        })}
      </ol>
      {itemNo != null && (
        <div className="mm-plan-rounds" aria-label="Rounds this session">
          {Array.from({ length: sessionItems }, (_, i) => (
            <span key={i} className={`mm-round-dot${i + 1 < itemNo ? ' is-done' : i + 1 === itemNo ? ' is-now' : ''}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function moodWord(v, tr) {
  if (v <= 3) return tr.mmMoodTense || 'Tense';
  if (v <= 6) return tr.mmMoodOk || 'Settling';
  return tr.mmMoodCalm || 'Calm';
}

function centsLabel(c, tr) {
  if (c > 8) return `♯ ${c}¢`;
  if (c < -8) return `♭ ${-c}¢`;
  return tr.mmInTune || 'in tune';
}

// A glass 0–10 wellbeing slider with a live feeling word.
function MoodSlider({ value, onChange, lowLabel, highLabel, tr }) {
  return (
    <div className="mm-mood">
      <input type="range" min={0} max={10} step={1} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))} />
      <div className="mm-mood-row">
        <span>{lowLabel}</span>
        <span className="mm-mood-word">{moodWord(value, tr)}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

// The prompt name + ask line. Chord/progression names show their shape on hover.
function Prompt({ element, tr, dim }) {
  if (!element) return null;
  const { type, meta, label } = element;
  const ask =
    type === 'note' ? (tr.mmPlayNote || 'Sing or play the note you heard')
    : type === 'interval' ? (tr.mmPlayInterval || 'Sing or play both notes')
    : type === 'chord' ? (tr.mmPlayChord || 'Sing or play the chord tones')
    : type === 'degree' ? ((tr.mmNameDegree || 'Sing or play the ${degree} of ${key}')
        .replace('${degree}', meta.degName).replace('${key}', pcName(meta.keyPc)))
    : (tr.mmNextChord || 'What chord comes next? Sing or play its notes');
  const word = type === 'progression' ? label : (type === 'chord' ? meta.name : label);
  const chordName = type === 'chord' ? meta.name : (type === 'progression' ? meta.nextName : null);

  return (
    <div>
      <div className={`mm-prompt-word${dim ? ' is-dim' : ''}`}>
        {chordName ? (
          <ChordTip name={chordName} className="cursor-help" style={{ color: 'inherit' }}>
            <span>{word}</span>
          </ChordTip>
        ) : word}
      </div>
      {!dim && <div className="mm-prompt-ask">{ask}</div>}
    </div>
  );
}

// Committed pitch-class chips ("what you've said so far").
function Chips({ pcs, tr }) {
  if (!pcs || !pcs.length) return <div className="mm-chips-empty">{tr.mmNothingYet || '—'}</div>;
  return (
    <div className="mm-chips">
      {pcs.map((pc) => <span key={pc} className="mm-chip">{pcName(pc)}</span>)}
    </div>
  );
}

export default function MusicMemory({ lang }) {
  const tr = useT(lang);
  const game = useMusicMemory();
  const [checkIn, setCheckIn] = useState(5);
  const [checkOut, setCheckOut] = useState(5);
  // How the user answers: 'sing' (sing/hum/play the pitch) | 'say' (speak the name).
  // 'say' only offered where speech recognition is supported (Chrome/Edge/Android).
  const [answerMode, setAnswerMode] = useState('sing');

  const mastery = useMemo(() => memoryMastery(), [game.result]);

  // Spoken narration (TTS): the app reads the prompt and feedback aloud. On by
  // default where speech synthesis exists; muteable + persisted.
  const ttsOk = vocalsSupported();
  const [narrate, setNarrate] = useState(() => {
    try { return localStorage.getItem(NARRATE_KEY) !== '0'; } catch { return true; }
  });
  const toggleNarrate = () => setNarrate((v) => {
    const next = !v;
    try { localStorage.setItem(NARRATE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    if (!next) stopSinging();
    return next;
  });

  // Narrate the PROMPT when a new item's prompt phase begins.
  const spokeForItem = useRef(-1);
  useEffect(() => {
    if (!narrate || !ttsOk) return;
    if (game.phase === 'prompt' && game.element && spokeForItem.current !== game.itemNo) {
      spokeForItem.current = game.itemNo;
      // Let the soft audio prompt lead; speak the instruction shortly after.
      const t = setTimeout(() => say(promptSpeech(game.element), { rate: 1, pitch: 1, volume: 0.9 }), 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [game.phase, game.itemNo, game.element, narrate, ttsOk]);

  // Narrate FEEDBACK (correct / not quite + the answer) once per verdict.
  const spokeFeedbackFor = useRef(-1);
  useEffect(() => {
    if (!narrate || !ttsOk) return;
    if (game.phase === 'feedback' && game.lastResult && spokeFeedbackFor.current !== game.itemNo) {
      spokeFeedbackFor.current = game.itemNo;
      const lead = game.lastResult.correct
        ? (tr.mmSpokenNice || 'Correct.')
        : (tr.mmSpokenClose || 'Not quite.');
      say(`${lead} ${answerSpeech(game.lastResult.element)}.`, { rate: 1, pitch: 1, volume: 0.9 });
    }
    return undefined;
  }, [game.phase, game.itemNo, game.lastResult, narrate, ttsOk, tr]);

  // Stop any narration when leaving the tab.
  useEffect(() => () => stopSinging(), []);

  // Hold the last non-null live note ~180ms so the hero doesn't strobe to "·"
  // every frame YIN momentarily drops (calmer to read).
  const [heldNote, setHeldNote] = useState(null);
  const holdRef = useRef(null);
  useEffect(() => {
    if (game.liveNote) {
      if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
      setHeldNote(game.liveNote);
    } else if (!holdRef.current) {
      holdRef.current = setTimeout(() => { setHeldNote(null); holdRef.current = null; }, 180);
    }
    return undefined;
  }, [game.liveNote]);
  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current); }, []);

  const phase = game.phase;
  const inSession = phase === 'prompt' || phase === 'answer' || phase === 'feedback';

  return (
    <Stage phase={phase} onExit={game.abort}>
      {/* Narration mute (top-left, mirrors the close button) */}
      {ttsOk && (
        <button className="mm-mute" onClick={toggleNarrate}
          aria-label={narrate ? 'Mute narration' : 'Unmute narration'}
          title={narrate ? (tr.mmVoiceOn || 'Voice on — tap to mute') : (tr.mmVoiceOff || 'Voice off — tap to unmute')}>
          {narrate ? '🔊' : '🔇'}
        </button>
      )}

      {/* HUD + compact plan during the session */}
      {inSession && (
        <>
          <div className="mm-hud">
            <span>{(tr.mmItemOf || 'Round ${n} of ${total}').replace('${n}', game.itemNo).replace('${total}', game.sessionItems)}</span>
            <span>{(tr.mmLevel || 'Level ${n}').replace('${n}', game.levelState.level)} · ✦{game.tally.correct}</span>
          </div>
          <PlanRoadmap level={game.levelState.level} itemNo={game.itemNo} sessionItems={game.sessionItems} tr={tr} compact />
        </>
      )}

      {/* ── CHECK-IN ─────────────────────────────────────────────────────────── */}
      {phase === 'checkin' && (
        <>
          <div className="mm-eyebrow">{tr.tabMemory || 'Music Memory'}</div>
          <h1 className="mm-title">{tr.mmIntroTitle || 'Follow the light. Trust your ear.'}</h1>
          <p className="mm-sub">{tr.mmIntro || 'A calm way to train your ear. You’ll hear something, then sing or play it back while a soft light drifts side to side. There’s no failing here, only noticing.'}</p>

          <details className="mm-why">
            <summary>{tr.mmWhyLight || 'Why the moving light?'}</summary>
            <p>{tr.mmWhatIsThis || 'This side-to-side motion is borrowed from EMDR, a calming technique. The steady bilateral rhythm lowers tension and gives your memory a quiet, even backdrop to work against — so recalling a note feels easy, not tested.'}</p>
          </details>

          <div style={{ height: 14 }} />
          {/* How to answer — sing the pitch, or say the name aloud. */}
          <div className="mm-sub" style={{ marginBottom: 6 }}>{tr.mmHowAnswer || 'How would you like to answer?'}</div>
          <div className="mm-segbar" role="group" aria-label="Answer mode">
            <button
              className={`mm-seg${answerMode === 'sing' ? ' is-on' : ''}`}
              onClick={() => setAnswerMode('sing')}>
              🎤 {tr.mmModeSing || 'Sing / play it'}
            </button>
            {game.speechSupported && (
              <button
                className={`mm-seg${answerMode === 'say' ? ' is-on' : ''}`}
                onClick={() => setAnswerMode('say')}>
                🗣️ {tr.mmModeSay || 'Say the name'}
              </button>
            )}
          </div>
          <div className="mm-sub" style={{ fontSize: '0.8rem', marginBottom: 12, opacity: 0.85 }}>
            {answerMode === 'say'
              ? (tr.mmSayHint || 'Speak the answer out loud — e.g. “C sharp”, “G minor”, “perfect fifth”.')
              : (tr.mmSingHint || 'Sing, hum, or play the answer into the mic.')}
          </div>

          <div className="mm-sub" style={{ marginBottom: 8 }}>{tr.mmCheckInPrompt || 'How are you feeling right now?'}</div>
          <MoodSlider value={checkIn} onChange={setCheckIn} tr={tr}
            lowLabel={tr.mmMoodTense || 'Tense'} highLabel={tr.mmMoodCalm || 'Calm'} />

          {mastery.sessions > 0 && (
            <div className="mm-sub" style={{ fontSize: '0.8rem', marginTop: 10 }}>
              {(tr.mmYourBest || 'Your best: ${score}% · level ${level}')
                .replace('${score}', mastery.bestScore).replace('${level}', mastery.level || 1)}
            </div>
          )}
          {game.error && <div style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginTop: 8 }}>{game.error}</div>}

          {/* The full plan — 5 stages you climb through. */}
          <div style={{ height: 18 }} />
          <PlanRoadmap level={mastery.level || 1} tr={tr} />

          <div style={{ height: 18 }} />
          <button className="mm-cta" onClick={() => game.start({ checkInMood: checkIn, inputMode: answerMode })}>
            {tr.mmCheckInStart || 'Begin'}
          </button>
        </>
      )}

      {/* ── PROMPT (listening to the cue) ────────────────────────────────────── */}
      {phase === 'prompt' && (
        <>
          <div className="mm-eyebrow">{tr.mmListen || 'Listen…'}</div>
          <div className="mm-listen-rings" aria-hidden="true" />
          <Prompt element={game.element} tr={tr} dim />
        </>
      )}

      {/* ── ANSWER (count-in, then say it) ───────────────────────────────────── */}
      {phase === 'answer' && (
        <>
          {game.countdown > 0 ? (
            <>
              <div className="mm-eyebrow">{tr.mmGetReady || 'Settle in'}</div>
              <Prompt element={game.element} tr={tr} />
              <div style={{ height: 10 }} />
              <div className="mm-countdown">{game.countdown}</div>
              <div className="mm-sub" style={{ fontSize: '0.85rem' }}>{tr.mmCountInHint || 'Answer out loud when the count reaches zero. Sing it, hum it, or play it.'}</div>
            </>
          ) : game.inputMode === 'say' ? (
            <>
              <div className="mm-eyebrow is-listening">{tr.mmListening || 'Listening… take your time'}</div>
              <Prompt element={game.element} tr={tr} />
              <div style={{ height: 12 }} />
              <div className="mm-live" data-active={!!game.liveTranscript}>
                <span className="mm-transcript">{game.liveTranscript || (tr.mmSayNow || 'Say the answer…')}</span>
              </div>
            </>
          ) : (
            <>
              <div className="mm-eyebrow is-listening">{tr.mmListening || 'Listening… take your time'}</div>
              <Prompt element={game.element} tr={tr} />
              <div style={{ height: 12 }} />
              <div className="mm-live" data-active={!!heldNote} data-intune={!!(heldNote && Math.abs(heldNote.cents) <= 20)}>
                <span className="mm-live-note">{heldNote ? pcName(heldNote.pc) : '·'}</span>
                {heldNote && <span className="mm-live-cents">{centsLabel(heldNote.cents, tr)}</span>}
              </div>
              <Chips pcs={game.heardPcs} tr={tr} />
            </>
          )}
        </>
      )}

      {/* ── FEEDBACK (verdict + say-vs-answer, persists) ─────────────────────── */}
      {phase === 'feedback' && game.lastResult && (
        <div className="mm-verdict" data-correct={game.lastResult.correct}>
          <div className="mm-verdict-mark">{game.lastResult.correct ? '✨' : '🌱'}</div>
          <div className="mm-verdict-head">
            {game.lastResult.correct ? (tr.mmNice || 'Beautiful — that was it.') : (tr.mmClose || 'Not quite — here it is again. No rush.')}
          </div>
          <div className="mm-compare">
            <span>
              {game.lastResult.detail.spoken != null ? (tr.mmYouSaid || 'You said') : (tr.mmYouSang || 'You sang')}{' '}
              <span className="mm-key" style={{ color: 'var(--color-success)' }}>
                {game.lastResult.detail.spoken != null
                  ? (game.lastResult.detail.said || (tr.mmNothingYet || '—'))
                  : ((game.lastResult.detail.got || []).map((pc) => pcName(pc)).join(' ') || (tr.mmNothingYet || '—'))}
              </span>
            </span>
            <span>
              {tr.mmTheAnswer || 'The answer was'}{' '}
              {(() => {
                const el = game.lastResult.element;
                const chordName = el.type === 'chord' ? el.meta.name : (el.type === 'progression' ? el.meta.nextName : null);
                const text = answerLabelFor(el);
                return chordName
                  ? <ChordTip name={chordName} className="cursor-help"><span className="mm-key">{text}</span></ChordTip>
                  : <span className="mm-key">{text}</span>;
              })()}
            </span>
          </div>
          {!game.lastResult.correct && (
            <button className="mm-replay" onClick={game.replay}>{tr.mmReplay || '↻ Hear it again'}</button>
          )}
        </div>
      )}

      {/* The pacer — present through prompt + answer, with its caption. */}
      {(phase === 'prompt' || phase === 'answer') && (
        <div style={{ marginTop: 22, width: '100%' }}>
          <BilateralPacer active breathMs={game.breathMs} pacerEpoch={game.pacerEpoch}
            inLabel={tr.mmBreatheIn || 'Breathe in'} outLabel={tr.mmBreatheOut || 'Breathe out'}
            caption={tr.mmPacerCaption || 'Breathe with the light — in as it rises, out as it falls. The gentle rhythm settles the mind and helps new sounds stick.'} />
          {game.micOk === false && (
            <div style={{ color: 'var(--color-warning)', fontSize: '0.8rem', marginTop: 10, textAlign: 'center' }}>
              {tr.mmMicQuiet || 'I couldn’t hear you — a little louder, or move closer.'}
            </div>
          )}
        </div>
      )}

      {/* ── CHECK-OUT / RESULTS ──────────────────────────────────────────────── */}
      {phase === 'checkout' && game.result && (
        <>
          {game.result.advancement?.advanced && <Celebration advancement={game.result.advancement} tr={tr} />}
          <div className="mm-eyebrow">{tr.mmSessionDone || 'Session complete'}</div>
          <h1 className="mm-title" style={{ fontSize: 'clamp(1.6rem,4.4vw,2.4rem)' }}>
            {(tr.mmYouHeard || 'You heard ${n} of ${total}')
              .replace('${n}', game.result.correct).replace('${total}', game.result.total)}
          </h1>
          <div className="mm-sub" style={{ fontSize: '0.85rem' }}>
            {(tr.mmReachedLevel || 'Reached level ${level} · best streak ${streak}')
              .replace('${level}', game.result.level).replace('${streak}', game.result.streakBest)}
          </div>

          <div style={{ height: 16 }} />
          <div className="mm-sub" style={{ marginBottom: 8 }}>{tr.mmCheckOutTitle || 'How do you feel now?'}</div>
          <MoodSlider value={checkOut} onChange={setCheckOut} tr={tr}
            lowLabel={tr.mmMoodTense || 'Tense'} highLabel={tr.mmMoodCalm || 'Calm'} />
          {game.result.checkInMood != null && checkOut !== game.result.checkInMood && (
            <div className="mm-sub" style={{ color: 'var(--color-success)', fontSize: '0.82rem', marginTop: 8 }}>
              {(tr.mmMoodShift || 'You arrived at ${a}, you’re leaving at ${b}. That’s the whole point — well done showing up for yourself.')
                .replace('${a}', game.result.checkInMood).replace('${b}', checkOut)}
            </div>
          )}

          <div style={{ height: 20, display: 'flex' }} />
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="mm-cta" onClick={() => game.start({ checkInMood: checkOut, inputMode: game.inputMode })}>{tr.mmAgain || 'Another round'}</button>
            <button className="mm-ghost" onClick={game.abort}>{tr.mmCheckOutDone || 'Finish'}</button>
          </div>
        </>
      )}
    </Stage>
  );
}

// The full-screen aurora stage, portalled to document.body so it escapes the tab
// panel's transformed/overflow-hidden ancestor. `key={phase}` replays the content
// fade/scale on each phase change.
function Stage({ phase, onExit, children }) {
  return createPortal(
    <div className="mm-stage" role="dialog" aria-modal="true" aria-label="Music Memory">
      <div className="mm-aurora" aria-hidden="true">
        <span className="mm-aurora-a" /><span className="mm-aurora-b" /><span className="mm-aurora-c" />
      </div>
      <div className="mm-vignette" aria-hidden="true" />
      <button className="mm-exit" onClick={onExit} aria-label="Close">✕</button>
      <div className="mm-content" key={phase}>{children}</div>
    </div>,
    document.body,
  );
}

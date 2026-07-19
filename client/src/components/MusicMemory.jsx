// MusicMemory — the ear-training / music-memory tab.
//
// The app plays or names a music element (note, interval, chord, scale degree, or
// the next chord of a progression); the user answers by singing/humming OR playing
// into the mic; it grades the answer octave-agnostically and gives feedback. The
// whole loop is wrapped in a guided EMDR-style calming layer: a session check-in,
// a bilateral breathing pacer during the answer window, never-punitive feedback,
// a warm celebration on advancement, and a check-out.
//
// This file is presentation + flow. The mic loop lives in useMusicMemory; all the
// element/grading/adaptive logic is pure and unit-tested in memoryTrain.js.

import { useState, useMemo } from 'react';
import { useT } from '../lib/i18n';
import { useMusicMemory } from '../lib/useMusicMemory';
import { pcName, memoryMastery } from '../lib/memoryTrain';
import BilateralPacer from './BilateralPacer';
import Celebration from './Celebration';
import ChordTip from './ChordTip';

// A calm 0–10 wellbeing slider used at check-in and check-out.
function MoodSlider({ value, onChange, lowLabel, highLabel }) {
  return (
    <div className="w-full max-w-sm mx-auto">
      <input
        type="range" min={0} max={10} step={1} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full"
        style={{ accentColor: 'var(--color-brand)' }}
      />
      <div className="flex justify-between text-[11px] mt-1" style={{ color: 'var(--color-ink-faint)' }}>
        <span>{lowLabel}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>{value}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

// The prompt card — what the user is being asked to recall. Chord/progression
// element names show their fretboard shape on hover (the app-wide rule).
function PromptCard({ element, tr }) {
  if (!element) return null;
  const { type, meta, label } = element;
  const title =
    type === 'note' ? (tr.mmPlayNote || 'Sing or play the note you heard')
    : type === 'interval' ? (tr.mmPlayInterval || 'Sing or play both notes')
    : type === 'chord' ? (tr.mmPlayChord || 'Sing or play the chord tones')
    : type === 'degree' ? ((tr.mmNameDegree || 'Sing or play the ${degree} of ${key}')
        .replace('${degree}', meta.degName).replace('${key}', pcName(meta.keyPc)))
    : (tr.mmNextChord || 'What chord comes next? Sing or play its notes');

  return (
    <div className="text-center">
      <div className="text-[11px] uppercase tracking-[0.3em] font-semibold mb-3" style={{ color: 'var(--color-info)' }}>
        {tr.mmYourTurn || 'Your turn'}
      </div>
      <div className="text-2xl sm:text-3xl font-black mb-2" style={{ color: 'var(--color-ink)' }}>
        {type === 'chord' || type === 'progression' ? (
          <ChordTip name={type === 'chord' ? meta.name : meta.nextName}
            className="cursor-help" style={{ color: 'var(--color-brand)' }}>
            <span>{type === 'progression' ? label : meta.name}</span>
          </ChordTip>
        ) : (
          <span style={{ color: 'var(--color-brand)' }}>{label}</span>
        )}
      </div>
      <div className="text-sm" style={{ color: 'var(--color-ink-subtle)' }}>{title}</div>
    </div>
  );
}

export default function MusicMemory({ lang }) {
  const tr = useT(lang);
  const game = useMusicMemory();
  const [checkIn, setCheckIn] = useState(5);
  const [checkOut, setCheckOut] = useState(5);

  const mastery = useMemo(() => memoryMastery(), [game.result]);

  // ── Check-in ────────────────────────────────────────────────────────────────
  if (game.phase === 'checkin') {
    return (
      <Shell>
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🧠</div>
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--color-ink)' }}>
            {tr.tabMemory || 'Music Memory'}
          </h2>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--color-ink-subtle)' }}>
            {tr.mmIntro || 'A calm ear-training drill. Hear an element, then sing, hum, or play your answer into the mic. There is no failing here — just noticing and remembering.'}
          </p>
        </div>

        <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
          <div className="text-sm font-semibold mb-3 text-center" style={{ color: 'var(--color-ink-muted)' }}>
            {tr.mmCheckInPrompt || 'How are you feeling right now?'}
          </div>
          <MoodSlider value={checkIn} onChange={setCheckIn}
            lowLabel={tr.mmScaleLow || 'Tense'} highLabel={tr.mmScaleHigh || 'Calm'} />
        </div>

        {mastery.sessions > 0 && (
          <div className="text-center text-[11px] mb-4" style={{ color: 'var(--color-ink-faint)' }}>
            {(tr.mmYourBest || 'Your best: ${score}% · level ${level}')
              .replace('${score}', mastery.bestScore).replace('${level}', mastery.level || 1)}
          </div>
        )}

        {game.error && (
          <div className="text-center text-xs mb-3" style={{ color: 'var(--color-danger)' }}>{game.error}</div>
        )}

        <div className="flex justify-center">
          <button onClick={() => game.start({ checkInMood: checkIn })}
            className="ui-press px-6 py-3 rounded-xl font-bold"
            style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
            {tr.mmCheckInStart || 'Begin'}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Check-out / results ───────────────────────────────────────────────────────
  if (game.phase === 'checkout' && game.result) {
    const r = game.result;
    return (
      <Shell>
        {r.advancement?.advanced && <Celebration advancement={r.advancement} tr={tr} />}
        <div className="text-center mb-5">
          <div className="text-2xl mb-1">🎧</div>
          <h2 className="text-xl font-black" style={{ color: 'var(--color-ink)' }}>
            {tr.mmSessionDone || 'Session complete'}
          </h2>
          <p className="text-lg font-bold mt-1" style={{ color: 'var(--color-brand)' }}>
            {(tr.mmYouHeard || 'You heard ${n} of ${total}')
              .replace('${n}', r.correct).replace('${total}', r.total)}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-ink-faint)' }}>
            {(tr.mmReachedLevel || 'Reached level ${level} · best streak ${streak}')
              .replace('${level}', r.level).replace('${streak}', r.streakBest)}
          </p>
        </div>

        <div className="rounded-2xl p-5 mb-5" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
          <div className="text-sm font-semibold mb-3 text-center" style={{ color: 'var(--color-ink-muted)' }}>
            {tr.mmCheckOutTitle || 'How do you feel now?'}
          </div>
          <MoodSlider value={checkOut} onChange={setCheckOut}
            lowLabel={tr.mmScaleLow || 'Tense'} highLabel={tr.mmScaleHigh || 'Calm'} />
          {r.checkInMood != null && checkOut !== r.checkInMood && (
            <div className="text-center text-[11px] mt-2" style={{ color: 'var(--color-success)' }}>
              {(tr.mmMoodShift || 'You went from ${a} to ${b} — well done showing up for yourself.')
                .replace('${a}', r.checkInMood).replace('${b}', checkOut)}
            </div>
          )}
        </div>

        <div className="flex justify-center gap-3">
          <button onClick={() => game.start({ checkInMood: checkOut })}
            className="ui-press px-5 py-2.5 rounded-xl font-bold"
            style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
            {tr.mmAgain || 'Another round'}
          </button>
          <button onClick={game.abort}
            className="ui-press px-5 py-2.5 rounded-xl font-semibold"
            style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-subtle)' }}>
            {tr.mmCheckOutDone || 'Finish'}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Active session: prompt / answer / feedback ────────────────────────────────
  const inFeedback = game.phase === 'feedback' && game.lastResult;
  const correct = inFeedback && game.lastResult.correct;

  return (
    <Shell>
      {/* Progress + running tally */}
      <div className="flex items-center justify-between mb-4 text-xs" style={{ color: 'var(--color-ink-faint)' }}>
        <span>{(tr.mmItemOf || 'Round ${n} of ${total}').replace('${n}', game.itemNo).replace('${total}', game.sessionItems)}</span>
        <span className="flex items-center gap-2">
          <span style={{ color: 'var(--color-success)' }}>✓ {game.tally.correct}</span>
          <span style={{ color: 'var(--color-ink-ghost)' }}>·</span>
          <span>{(tr.mmLevel || 'Level ${n}').replace('${n}', game.levelState.level)}</span>
        </span>
      </div>

      <div className="rounded-2xl p-6 mb-5 min-h-[168px] flex flex-col items-center justify-center"
        style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
        {game.phase === 'prompt' && (
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-[0.3em] font-semibold mb-2" style={{ color: 'var(--color-ink-faint)' }}>
              {tr.mmListen || 'Listen…'}
            </div>
            <div className="text-3xl">🎵</div>
          </div>
        )}

        {game.phase === 'answer' && (
          <div className="w-full text-center">
            <PromptCard element={game.element} tr={tr} />
            {game.countdown > 0 ? (
              <div className="mt-4">
                <div className="text-4xl font-black tabular-nums" style={{ color: 'var(--color-brand)' }}>{game.countdown}</div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--color-ink-ghost)' }}>
                  {tr.mmGetReady || 'Settle in — answer when the count reaches zero'}
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <div className="text-xs mb-1" style={{ color: 'var(--color-info)' }}>
                  {tr.mmListening || 'Listening… take your time'}
                </div>
                <div className="text-2xl font-bold tabular-nums h-8" style={{ color: game.liveNote ? 'var(--color-success)' : 'var(--color-ink-ghost)' }}>
                  {game.liveNote ? pcName(game.liveNote.pc) : '…'}
                </div>
              </div>
            )}
          </div>
        )}

        {inFeedback && (
          <div className="text-center">
            <div className="text-4xl mb-2">{correct ? '✨' : '🌱'}</div>
            <div className="text-lg font-bold mb-1" style={{ color: correct ? 'var(--color-success)' : 'var(--color-brand)' }}>
              {correct ? (tr.mmNice || 'Beautiful — that was it.') : (tr.mmClose || 'Not quite — here it is again. No rush.')}
            </div>
            <div className="text-xs" style={{ color: 'var(--color-ink-subtle)' }}>
              {(tr.mmWas || 'It was ${label}.').replace('${label}', answerLabel(game.lastResult.element))}
            </div>
            {!correct && (
              <button onClick={game.replay}
                className="ui-press mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'var(--color-surface-700)', color: 'var(--color-info)' }}>
                {tr.mmReplay || '↻ Hear it again'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* The EMDR breathing pacer — a calm regulator present throughout the loop. */}
      <BilateralPacer active={game.phase === 'answer' || game.phase === 'prompt'}
        inLabel={tr.mmBreatheIn || 'Breathe in'} outLabel={tr.mmBreatheOut || 'Breathe out'} />

      {game.micOk === false && (
        <div className="text-center text-[11px] mt-3" style={{ color: 'var(--color-warning)' }}>
          {tr.mmMicQuiet || 'I couldn’t hear you — a little louder, or move closer.'}
        </div>
      )}

      <div className="flex justify-center mt-4">
        <button onClick={game.abort}
          className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'var(--color-ink-faint)' }}>
          {tr.mmStop || 'End session'}
        </button>
      </div>
    </Shell>
  );
}

// A human answer label for feedback.
function answerLabel(element) {
  if (!element) return '';
  switch (element.type) {
    case 'note': return pcName(element.meta.pc);
    case 'interval': return `${element.label}`;
    case 'chord': return element.meta.name;
    case 'degree': return `${element.meta.degName} of ${pcName(element.meta.keyPc)} = ${pcName(element.meta.targetPc)}`;
    case 'progression': return element.meta.nextName;
    default: return element.label || '';
  }
}

function Shell({ children }) {
  return (
    <div className="max-w-xl mx-auto px-3 sm:px-4 py-6">
      {children}
    </div>
  );
}

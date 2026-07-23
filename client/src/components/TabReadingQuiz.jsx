// TabReadingQuiz — the "Read basic tab" Level Plan step as a 2-minute lesson +
// 8-round quiz. Explainer first (one real chord decoded character-by-character),
// then rounds that read tab in all three directions (tab→shape, shape→tab,
// one-character meaning). Scoring ≥80% saves a run to guitar_tab_quiz_v1, which
// the plan's `tabQuizMastered` check reads — so finishing here completes the
// roadmap step and fires the shared Celebration, same as every measured step.
//
// Quiz rounds deliberately show NO chord names while a question is open — a
// hover-shape tooltip on the name would literally reveal the answer. The name
// appears (as a ChordTip, per the hover rule) only in the post-answer feedback.

import { useState, useMemo, useRef } from 'react';
import { useT } from '../lib/i18n';
import { useHandProfile } from '../App';
import FretboardDiagram from './FretboardDiagram';
import ChordTip from './ChordTip';
import Celebration from './Celebration';
import {
  buildQuizRounds, quizPool, saveTabQuizRun, tabQuizMastery,
  TAB_QUIZ_PASS, TAB_STRING_NAMES,
} from '../lib/tabQuiz';
import { LEVEL_PLAN, isMilestoneDone, loadManual } from '../lib/levelPlan';

// The 6 tab characters with their string names beneath — the core visual of
// both the lesson and the quiz. `highlight` marks one column (readString).
function TabChars({ tab, highlight = null, meanings = false, tr }) {
  const chars = (tab || '').split('');
  const meaning = (ch) =>
    ch === 'x' ? (tr.tqSkip || 'skip')
    : ch === '0' ? (tr.tqOpen || 'open')
    : (tr.tqFretN || 'fret ${n}').replace('${n}', ch);
  return (
    <div className="flex justify-center gap-1.5 select-none" aria-label={`Tab ${tab}`}>
      {chars.map((ch, i) => (
        <div key={i}
          className={`flex flex-col items-center rounded-lg px-2 py-1.5 border ${
            highlight === i ? 'border-brand bg-surface-600' : 'border-surface-700 bg-surface-800'}`}>
          <span className={`font-mono font-black text-2xl leading-none ${
            highlight === i ? 'text-brand' : ch === 'x' ? 'text-ink-faint' : 'text-ink'}`}>
            {ch}
          </span>
          <span className="text-[10px] font-semibold mt-1 text-ink-faint">{TAB_STRING_NAMES[i]}</span>
          {meanings && <span className="text-[9px] text-ink-faint">{meaning(ch)}</span>}
        </div>
      ))}
    </div>
  );
}

function meaningLabel(m, tr) {
  if (m.kind === 'mute') return tr.tqMeanMute || '✕ Don’t play that string (muted)';
  if (m.kind === 'open') return tr.tqMeanOpen || '◯ Play it open — no finger';
  return (tr.tqMeanFret || 'Press fret ${n}').replace('${n}', m.fret);
}

// Option-button border per answer state.
const optStyle = (i, chosen, answer) => {
  if (chosen == null) return {};
  if (i === answer) return { borderColor: 'var(--color-success)', boxShadow: '0 0 0 1px var(--color-success)' };
  if (i === chosen) return { borderColor: 'var(--color-danger)', opacity: 0.7 };
  return { opacity: 0.45 };
};

export default function TabReadingQuiz({ lang, onClose = null }) {
  const tr = useT(lang);
  const profile = useHandProfile();
  const [phase, setPhase] = useState('intro'); // intro | quiz | done
  const [rounds, setRounds] = useState([]);
  const [idx, setIdx] = useState(0);
  const [chosen, setChosen] = useState(null);  // picked option index this round
  const [correct, setCorrect] = useState(0);
  const [result, setResult] = useState(null);  // { score, correct, total, planAdvanced }
  const savedRef = useRef(false);

  const mastery = useMemo(() => tabQuizMastery(), [phase]);

  const startQuiz = () => {
    setRounds(buildQuizRounds({}));
    setIdx(0); setChosen(null); setCorrect(0); setResult(null);
    savedRef.current = false;
    setPhase('quiz');
  };

  const round = rounds[idx] || null;
  const isRight = round && chosen != null && chosen === round.answer;

  const next = () => {
    if (idx + 1 < rounds.length) {
      setIdx(idx + 1); setChosen(null);
      return;
    }
    // Finish: save once, then diff the plan (before/after) so we can celebrate
    // exactly which roadmap step this quiz completed — the advancement rule.
    // `correct` already includes this round (counted at pick time).
    const total = rounds.length;
    const finalCorrect = correct;
    const score = total ? Math.round((finalCorrect / total) * 100) : 0;
    let planAdvanced = [];
    if (!savedRef.current) {
      savedRef.current = true;
      const planCtx = { handProfile: profile, manual: loadManual() };
      const openBefore = LEVEL_PLAN.filter((m) => !isMilestoneDone(m, planCtx));
      saveTabQuizRun({ correct: finalCorrect, total, score });
      planAdvanced = openBefore.filter((m) => isMilestoneDone(m, planCtx));
    }
    setResult({ score, correct: finalCorrect, total, planAdvanced });
    setPhase('done');
  };

  const pickOption = (i) => {
    if (chosen != null) return;
    setChosen(i);
    if (i === round.answer) setCorrect((c) => c + 1);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* ── INTRO — the 2-minute lesson ─────────────────────────────────────── */}
      {phase === 'intro' && (
        <IntroLesson tr={tr} mastery={mastery} onStart={startQuiz} onClose={onClose} />
      )}

      {/* ── QUIZ ────────────────────────────────────────────────────────────── */}
      {phase === 'quiz' && round && (
        <section className="rounded-2xl p-4 sm:p-5 border bg-surface-800 border-surface-700">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-ink-faint">
              {(tr.tqRoundOf || 'Round ${n} of ${total}').replace('${n}', idx + 1).replace('${total}', rounds.length)}
            </span>
            <div className="flex gap-1" aria-label="Progress">
              {rounds.map((_, i) => (
                <span key={i} className={`w-2 h-2 rounded-full ${
                  i < idx ? 'bg-brand' : i === idx ? 'bg-brand animate-pulse' : 'bg-surface-600'}`} />
              ))}
            </div>
            <span className="text-xs font-semibold text-ink-faint">✦ {correct}</span>
          </div>

          {round.type === 'pickDiagram' && (
            <>
              <h3 className="text-sm font-bold text-ink mb-3 text-center">
                {tr.tqAskDiagram || 'Read this tab — which shape is it?'}
              </h3>
              <TabChars tab={round.voicing.tab} tr={tr} />
              <div className="grid grid-cols-2 gap-2 mt-4">
                {round.options.map((o, i) => (
                  <button key={i} onClick={() => pickOption(i)}
                    className="rounded-xl border bg-surface-750 border-surface-650 p-2 flex justify-center transition-colors"
                    style={optStyle(i, chosen, round.answer)}>
                    <FretboardDiagram chord={o.voicing} />
                  </button>
                ))}
              </div>
            </>
          )}

          {round.type === 'pickTab' && (
            <>
              <h3 className="text-sm font-bold text-ink mb-3 text-center">
                {tr.tqAskTab || 'Which tab writes this shape?'}
              </h3>
              <div className="flex justify-center"><FretboardDiagram chord={round.voicing} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                {round.options.map((o, i) => (
                  <button key={i} onClick={() => pickOption(i)}
                    className="rounded-xl border bg-surface-750 border-surface-650 px-3 py-2.5 font-mono font-bold text-lg tracking-[0.35em] text-ink text-center transition-colors"
                    style={optStyle(i, chosen, round.answer)}>
                    {o.tab}
                  </button>
                ))}
              </div>
            </>
          )}

          {round.type === 'readString' && (
            <>
              <h3 className="text-sm font-bold text-ink mb-3 text-center">
                {(tr.tqAskString || 'On the ${s} string, what does the highlighted character tell your hand?')
                  .replace('${s}', TAB_STRING_NAMES[round.stringIndex])}
              </h3>
              <TabChars tab={round.voicing.tab} highlight={round.stringIndex} tr={tr} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                {round.options.map((o, i) => (
                  <button key={i} onClick={() => pickOption(i)}
                    className="rounded-xl border bg-surface-750 border-surface-650 px-3 py-2.5 text-sm font-semibold text-ink text-left transition-colors"
                    style={optStyle(i, chosen, round.answer)}>
                    {meaningLabel(o, tr)}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Post-answer feedback: verdict + the chord's name (hover = shape). */}
          {chosen != null && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl px-3 py-2 bg-surface-750 border border-surface-650">
              <span className="text-sm text-ink">
                {isRight ? '✓ ' : '✗ '}
                {isRight
                  ? (tr.tqRight || 'Right — that tab is')
                  : (tr.tqWrong || 'Not quite — the green one is right. That tab is')}{' '}
                <ChordTip name={round.name} className="cursor-help">
                  <span className="font-bold text-brand">{round.name}</span>
                </ChordTip>.
              </span>
              <button onClick={next}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-brand text-surface-base shrink-0">
                {idx + 1 < rounds.length ? (tr.tqNext || 'Next →') : (tr.tqResults || 'See results →')}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── RESULTS ─────────────────────────────────────────────────────────── */}
      {phase === 'done' && result && (
        <section className="rounded-2xl p-6 border bg-surface-800 border-surface-700 text-center">
          {result.planAdvanced.length > 0 && (
            <Celebration advancement={{
              advanced: true, big: true,
              top: { type: 'milestone', detail: { title: result.planAdvanced.map((m) => m.title).join(' · ') } },
            }} tr={tr} />
          )}
          <div className="text-5xl font-black mb-1"
            style={{ color: result.score >= TAB_QUIZ_PASS ? 'var(--color-success)' : 'var(--color-warning)' }}>
            {result.score}%
          </div>
          <div className="text-sm text-ink-faint mb-3">
            {(tr.tqScoreLine || '${c} of ${t} read correctly').replace('${c}', result.correct).replace('${t}', result.total)}
          </div>
          <p className="text-sm text-ink mb-4">
            {result.score >= TAB_QUIZ_PASS
              ? (tr.tqPassed || 'You read tab now. Every diagram, drill and song sheet in the app uses exactly this notation.')
              : (tr.tqFailed || `Almost — ${TAB_QUIZ_PASS}% finishes the Level Plan step. One more pass and it’s yours.`)}
          </p>
          <div className="flex justify-center gap-2">
            <button onClick={startQuiz} className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-brand text-surface-base">
              {result.score >= TAB_QUIZ_PASS ? (tr.tqAgain || 'Play again') : (tr.tqRetry || 'Try again →')}
            </button>
            {onClose && (
              <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-surface-600 text-brand">
                {tr.tqBackToPlan || '🗺️ Back to Level Plan'}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// The lesson: one real chord decoded character-by-character. Generic over
// whatever shape the library returns for C, so lesson and library never drift.
function IntroLesson({ tr, mastery, onStart, onClose }) {
  const example = useMemo(() => {
    const pool = quizPool();
    return pool.find((p) => p.name === 'C') || pool[0];
  }, []);
  if (!example) return null;
  return (
    <>
      <section className="rounded-2xl p-4 sm:p-5 border bg-surface-800 border-surface-700">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint mb-1">
          {tr.tqEyebrow || '2-minute lesson'}
        </div>
        <h2 className="text-lg font-bold text-ink mb-2">{tr.tqTitle || 'Read basic tab'}</h2>
        <p className="text-sm leading-relaxed text-ink-faint mb-4">
          {tr.tqIntro1 || 'A tab is six characters — one per string, in EADGBe order: the thick low E string is the FIRST character (left), the thin high e is the last.'}
        </p>

        {/* The one worked example: C decoded. Name hover shows the shape (rule). */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 rounded-xl p-3 bg-surface-750 border border-surface-650">
          <div>
            <div className="text-xs text-ink-faint text-center mb-2">
              {(tr.tqThisIs || 'This is')}{' '}
              <ChordTip name={example.name} className="cursor-help">
                <span className="font-bold text-brand">{example.name}</span>
              </ChordTip>:
            </div>
            <TabChars tab={example.voicing.tab} meanings tr={tr} />
          </div>
          <FretboardDiagram chord={example.voicing} showFingers />
        </div>

        <ul className="text-sm leading-relaxed text-ink-faint mt-4 space-y-1">
          <li><span className="font-mono font-bold text-ink">x</span> — {tr.tqLegendX || 'don’t play that string (muted)'}</li>
          <li><span className="font-mono font-bold text-ink">0</span> — {tr.tqLegendO || 'play it open, no finger down'}</li>
          <li><span className="font-mono font-bold text-ink">3</span> — {tr.tqLegendN || 'press that string at fret 3'}</li>
        </ul>
        <p className="text-xs text-ink-faint mt-3">
          {tr.tqIntro2 || 'That’s the whole system — the Chords tab, the drills and Audio → Tab all write shapes this way.'}
        </p>
      </section>

      <section className="rounded-2xl p-4 border bg-surface-800 border-surface-700 flex items-center justify-between gap-3">
        <div className="text-xs text-ink-faint">
          {(tr.tqPassHint || 'Score ${p}%+ in the 8-round quiz to finish this Level Plan step.').replace('${p}', TAB_QUIZ_PASS)}
          {mastery.sessions > 0 && (
            <span className="block mt-0.5">
              {(tr.tqBest || 'Your best so far: ${s}%').replace('${s}', mastery.bestScore)}
            </span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onStart} className="text-xs px-3.5 py-1.5 rounded-lg font-semibold bg-brand text-surface-base">
            {tr.tqStart || 'Start the quiz →'}
          </button>
          {onClose && (
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-surface-600 text-brand">
              {tr.tqBackToPlan2 || '🗺️ Plan'}
            </button>
          )}
        </div>
      </section>
    </>
  );
}

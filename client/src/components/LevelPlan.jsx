import { useMemo, useState, useCallback } from 'react';
import { useHandProfile } from '../App';
import { useT } from '../lib/i18n';
import {
  TIERS,
  milestonesForTier,
  isMilestoneDone,
  isAutoComplete,
  tierStatus,
  loadManual,
  setManualDone,
  tierSteps,
} from '../lib/levelPlan';
import { recordedChordSummary, chordListProgress, GRADE_COLOR, qualityLabel } from '../lib/chordRecordings';
import ChordTip from './ChordTip';

// One roadmap the user climbs Beginner → Master. Every milestone is honestly
// typed (AUTO / ROUTE / OFF-APP); AUTO rows are read-only ✓/○ derived from the
// real practice record, ROUTE/OFF-APP rows carry a manual check-off. ROUTE (and
// AUTO items with a natural home) get a "Go →" that navigates to the right tab.

const TIER_META = {
  Beginner:     { emoji: '🌱', tint: 'rgba(74,222,128,0.10)',  edge: 'rgba(74,222,128,0.30)' },
  Intermediate: { emoji: '🎯', tint: 'rgba(96,165,250,0.10)',  edge: 'rgba(96,165,250,0.30)' },
  Advanced:     { emoji: '🔥', tint: 'rgba(251,146,60,0.10)',  edge: 'rgba(251,146,60,0.30)' },
  Master:       { emoji: '👑', tint: 'rgba(201,169,110,0.12)', edge: 'rgba(201,169,110,0.35)' },
};

const TYPE_BADGE = {
  auto:   { label: 'Auto-tracked', cls: 'bg-surface-600 text-brand' },
  route:  { label: 'In-app',       cls: 'bg-surface-600 text-ink-subtle' },
  offapp: { label: 'Off-app',      cls: 'bg-surface-700 text-ink-faint' },
};

function TypeChip({ type }) {
  const b = TYPE_BADGE[type] || TYPE_BADGE.offapp;
  return (
    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${b.cls}`}>
      {b.label}
    </span>
  );
}

function MilestoneRow({ m, done, ctx, onNavigate, onToggleManual }) {
  const auto = m.type === 'auto';
  const autoDone = auto && isAutoComplete(m, ctx);
  // AUTO rows are read-only when their signal has fired; if not yet earned, the
  // user still can't tick them (they must actually do it in-app) — so AUTO stays
  // read-only. ROUTE/OFF-APP rows are manually checkable.
  const checkable = !auto;

  return (
    <div
      className="flex items-start gap-3 rounded-lg px-3 py-2.5 bg-surface-800 border border-surface-700"
      style={done ? { borderColor: 'rgba(74,222,128,0.35)' } : undefined}
    >
      {/* Status control */}
      {checkable ? (
        <button
          onClick={() => onToggleManual(m.id, !done)}
          aria-pressed={done}
          aria-label={done ? 'Mark not done' : 'Mark done'}
          className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 text-xs font-bold border"
          style={done
            ? { background: 'rgba(74,222,128,0.20)', borderColor: 'rgba(74,222,128,0.5)', color: '#4ade80' }
            : { background: 'transparent', borderColor: 'var(--color-surface-600)', color: 'var(--color-ink-faint)' }}
        >
          {done ? '✓' : ''}
        </button>
      ) : (
        <span
          className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 text-xs font-bold"
          title={autoDone ? 'Completed — detected from your practice record' : 'Auto-tracked — do it in the app to complete'}
          style={autoDone
            ? { background: 'rgba(74,222,128,0.20)', color: '#4ade80' }
            : { background: 'var(--color-surface-700)', color: 'var(--color-ink-ghost)' }}
        >
          {autoDone ? '✓' : '○'}
        </span>
      )}

      {/* Text */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${done ? 'text-ink-subtle line-through' : 'text-ink'}`}>
            {m.title}
          </span>
          <TypeChip type={m.type} />
        </div>
        <p className="text-xs mt-0.5 leading-relaxed text-ink-faint">{m.detail}</p>
        {m.tip && (
          <p className="text-xs mt-1 leading-relaxed italic text-ink-ghost">💡 {m.tip}</p>
        )}
      </div>

      {/* Go → for any milestone with a home tab */}
      {m.tab && onNavigate && (
        <button
          onClick={() => onNavigate(m.tab)}
          className="mt-0.5 text-xs px-2.5 py-1 rounded-lg font-semibold shrink-0 bg-surface-600 text-brand"
        >
          Go →
        </button>
      )}
    </div>
  );
}

function TierCard({ tier, ctx, onNavigate, onToggleManual }) {
  const meta = TIER_META[tier] || {};
  const ms = milestonesForTier(tier);
  const st = tierStatus(tier, ctx);

  return (
    <section className="rounded-2xl p-4 border" style={{ background: meta.tint, borderColor: meta.edge }}>
      <header className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-base font-bold flex items-center gap-2 text-ink">
          <span>{meta.emoji}</span>{tier}
        </h3>
        <span className="text-xs font-semibold text-ink-subtle">{st.done}/{st.total}</span>
      </header>

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full overflow-hidden mb-4 bg-surface-700">
        <div className="h-full rounded-full" style={{ width: `${st.pct}%`, background: '#4ade80' }} />
      </div>

      <div className="flex flex-col gap-2">
        {ms.map((m) => (
          <MilestoneRow
            key={m.id}
            m={m}
            done={isMilestoneDone(m, ctx)}
            ctx={ctx}
            onNavigate={onNavigate}
            onToggleManual={onToggleManual}
          />
        ))}
      </div>
    </section>
  );
}

// Your recorded chords — the mic-recording grades collected across the app,
// surfaced here as skill progress. Each chip shows the chord's best letter grade
// (S/A/B/C/D) and lights its shape on hover (ChordTip / CLAUDE.md rule). A chord
// is "mastered" once its best attempt is grade A+.
function RecordedChords({ tr, onNavigate }) {
  const summary = useMemo(() => recordedChordSummary(), []);
  if (!summary.total) {
    return (
      <section className="rounded-2xl p-4 border bg-surface-800 border-surface-700">
        <h3 className="text-base font-bold flex items-center gap-2 text-ink mb-1">🎙️ {tr.recordedChordsTitle || 'Your recorded chords'}</h3>
        <p className="text-xs leading-relaxed text-ink-faint">
          {tr.recordedChordsEmpty || 'Record yourself playing a chord (the “Record it” button on the Start tab) and your best grade for each chord shows up here.'}
          {onNavigate && (
            <button onClick={() => onNavigate('start')} className="ml-2 font-semibold text-brand">Go to Start →</button>
          )}
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-2xl p-4 border bg-surface-800 border-surface-700">
      <header className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-base font-bold flex items-center gap-2 text-ink">🎙️ {tr.recordedChordsTitle || 'Your recorded chords'}</h3>
        <span className="text-xs font-semibold text-ink-subtle">
          {summary.mastered}/{summary.total} {tr.mastered || 'mastered'}
        </span>
      </header>
      <div className="flex flex-wrap gap-2">
        {summary.chords.map(({ chord, best, mastered }) => (
          <ChordTip key={chord} name={chord}>
            <span
              className="inline-flex items-center gap-1.5 rounded-lg pl-1.5 pr-2 py-1 cursor-help"
              style={{
                background: 'var(--color-surface-700)',
                border: mastered ? '1px solid rgba(74,222,128,0.5)' : '1px solid var(--color-surface-600)',
              }}
              title={`${chord}: best ${best.grade} · ${qualityLabel(best.quality)} · Lvl ${best.level}/10 · ${best.attempts} take${best.attempts === 1 ? '' : 's'}`}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0"
                style={{ color: GRADE_COLOR[best.grade] || 'var(--color-ink)', border: `1.5px solid ${GRADE_COLOR[best.grade] || 'var(--color-ink)'}` }}
              >
                {best.grade}
              </span>
              <span className="text-sm font-semibold text-ink">{chord}</span>
            </span>
          </ChordTip>
        ))}
      </div>
    </section>
  );
}

// Per-chord breakdown INSIDE a step whose goal is a specific set of chords
// (e.g. "Learn C A G E D"). Shows which chords you've achieved (recorded/mastered)
// and which are left, from your recording grades. Each chip hover-shows its shape.
function ChordChecklist({ chords, onNavigate }) {
  const prog = useMemo(() => chordListProgress(chords), [chords]);
  if (!prog.total) return null;
  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-ink-faint">
        {prog.done}/{prog.total} chords done — record each to check it off
      </div>
      <div className="flex flex-wrap gap-1.5">
        {prog.items.map(({ chord, recorded, mastered, best }) => (
          <ChordTip key={chord} name={chord}>
            <span
              className="inline-flex items-center gap-1 rounded-md pl-1 pr-1.5 py-0.5 text-xs cursor-help"
              style={{
                background: 'var(--color-surface-700)',
                border: mastered ? '1px solid rgba(74,222,128,0.5)'
                  : recorded ? '1px solid rgba(234,179,8,0.5)'
                  : '1px solid var(--color-surface-600)',
              }}
              title={mastered ? `${chord}: mastered (best ${best.grade})`
                : recorded ? `${chord}: recorded ${best.grade} — reach A to master`
                : `${chord}: not recorded yet`}
            >
              <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0"
                style={{ color: mastered ? '#4ade80' : recorded ? '#eab308' : 'var(--color-ink-ghost)' }}>
                {mastered ? '✓' : recorded ? '◐' : '○'}
              </span>
              <span className={`font-semibold ${mastered ? 'text-ink' : recorded ? 'text-ink' : 'text-ink-subtle'}`}>{chord}</span>
            </span>
          </ChordTip>
        ))}
      </div>
      {prog.done < prog.total && onNavigate && (
        <button onClick={() => onNavigate('start')} className="mt-2 text-xs px-2.5 py-1 rounded-lg font-semibold bg-surface-600 text-brand">
          Record chords →
        </button>
      )}
    </div>
  );
}

// Steps to the next level — the ordered milestones of the current tier as a
// numbered stepper, so the player sees "step N of TOTAL" and exactly what to do
// to move from one step to the next (e.g. 1 → 2 in Beginner). The CURRENT step
// (first unfinished) is expanded with its how-to detail and a Go → button.
function TierStepper({ ctx, onNavigate, tr }) {
  const info = useMemo(() => tierSteps(ctx), [ctx]);
  const allDone = info.stepDone >= info.total;
  const pct = info.total ? Math.round((info.stepDone / info.total) * 100) : 0;

  return (
    <section
      className="rounded-2xl p-4 border"
      style={{ background: 'rgba(96,165,250,0.08)', borderColor: 'rgba(96,165,250,0.30)' }}
    >
      <header className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-base font-bold flex items-center gap-2 text-ink">
          🚩 {info.nextTier ? `Steps to ${info.nextTier}` : `Finishing ${info.tier}`}
        </h3>
        <span className="text-xs font-semibold text-ink-subtle">
          {allDone ? `Done` : `Step ${info.currentStep} of ${info.total}`}
        </span>
      </header>
      <p className="text-xs text-ink-faint mb-3">
        {allDone
          ? (info.nextTier ? `All ${info.tier} steps complete — you’ve reached ${info.nextTier}.` : 'Whole plan complete 👑')
          : <>You’re on step <b className="text-brand">{info.currentStep}</b> of <b className="text-brand">{info.total}</b> in <b className="text-brand">{info.tier}</b>.</>}
      </p>

      {/* progress bar */}
      <div className="h-1.5 w-full rounded-full overflow-hidden mb-3 bg-surface-700">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#60a5fa' }} />
      </div>

      {/* numbered steps */}
      <ol className="flex flex-col gap-1.5">
        {info.steps.map((s, i) => {
          const state = s.done ? 'done' : s.current ? 'current' : 'todo';
          const dot = state === 'done'
            ? { bg: 'rgba(74,222,128,0.20)', color: '#4ade80', ring: 'rgba(74,222,128,0.5)', mark: '✓' }
            : state === 'current'
              ? { bg: 'rgba(96,165,250,0.20)', color: '#60a5fa', ring: 'rgba(96,165,250,0.6)', mark: i + 1 }
              : { bg: 'var(--color-surface-700)', color: 'var(--color-ink-ghost)', ring: 'var(--color-surface-600)', mark: i + 1 };
          return (
            <li key={s.id} className="flex items-start gap-2.5">
              <span
                className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 border"
                style={{ background: dot.bg, color: dot.color, borderColor: dot.ring }}
              >
                {dot.mark}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${state === 'done' ? 'text-ink-faint line-through' : state === 'current' ? 'font-semibold text-ink' : 'text-ink-subtle'}`}>
                  {s.title}
                </div>
                {state === 'current' && (
                  <div className="mt-0.5">
                    <p className="text-xs leading-relaxed text-ink-faint">{s.detail}</p>
                    {/* Per-chord breakdown when the step targets specific chords */}
                    {s.chords && s.chords.length > 0 && (
                      <ChordChecklist chords={s.chords} onNavigate={onNavigate} />
                    )}
                    {s.tab && onNavigate && !(s.chords && s.chords.length) && (
                      <button
                        onClick={() => onNavigate(s.tab)}
                        className="mt-1.5 text-xs px-2.5 py-1 rounded-lg font-semibold bg-surface-600 text-brand"
                      >
                        {tr?.doThisStep || 'Do this step'} →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function LevelPlan({ lang, onNavigate }) {
  const tr = useT(lang);
  const handProfile = useHandProfile();
  // Manual check-offs are read once and bumped via a tick so toggling re-renders.
  const [tick, setTick] = useState(0);
  const manual = useMemo(() => loadManual(), [tick]);
  const ctx = useMemo(() => ({ handProfile, manual }), [handProfile, manual]);

  const onToggleManual = useCallback((id, done) => {
    setManualDone(id, done);
    setTick((t) => t + 1);
  }, []);

  const overall = useMemo(() => {
    const totals = TIERS.map((t) => tierStatus(t, ctx));
    const done = totals.reduce((n, s) => n + s.done, 0);
    const total = totals.reduce((n, s) => n + s.total, 0);
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [ctx]);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg sm:text-xl font-bold mb-1 text-ink">
          {tr.levelPlanTitle || 'Your Level Plan 🗺️'}
        </h2>
        <p className="text-sm leading-relaxed text-ink-subtle">
          {tr.levelPlanIntro ||
            'A path from Beginner to Master. The app tracks what it can measure and points you to the exact tab for the rest.'}
        </p>
      </div>

      {/* Overall progress */}
      <div className="rounded-xl px-4 py-3 mb-4 bg-surface-800 border border-surface-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-ink-subtle">{tr.levelPlanOverall || 'Overall progress'}</span>
          <span className="text-xs font-semibold text-brand">{overall.done}/{overall.total}</span>
        </div>
        <div className="h-2 w-full rounded-full overflow-hidden bg-surface-700">
          <div className="h-full rounded-full" style={{ width: `${overall.pct}%`, background: '#c9a96e' }} />
        </div>
      </div>

      {/* Your recorded chords + the steps to your next level, side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5 items-start">
        <RecordedChords tr={tr} onNavigate={onNavigate} />
        <TierStepper ctx={ctx} onNavigate={onNavigate} tr={tr} />
      </div>

      {/* Legend — honest about how each milestone is tracked */}
      <div className="rounded-xl px-4 py-3 mb-5 text-xs leading-relaxed bg-surface-800 border border-surface-700 text-ink-faint">
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          <span><span className="inline-block w-4 text-center text-[#4ade80]">✓</span> <TypeChip type="auto" /> — the app detects this from your practice record.</span>
          <span><span className="inline-block w-4 text-center">☑</span> <TypeChip type="route" /> — a real app feature; tap <b className="text-brand">Go →</b>, then tick it yourself.</span>
          <span><span className="inline-block w-4 text-center">☑</span> <TypeChip type="offapp" /> — practice away from the app; tick when you’ve got it.</span>
        </div>
      </div>

      {/* Tiers */}
      <div className="flex flex-col gap-4">
        {TIERS.map((tier) => (
          <TierCard
            key={tier}
            tier={tier}
            ctx={ctx}
            onNavigate={onNavigate}
            onToggleManual={onToggleManual}
          />
        ))}
      </div>
    </div>
  );
}

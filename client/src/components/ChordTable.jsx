import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react';
import { CHORDS, findEasierVoicings } from '../lib/chords';
import { calcDifficulty, fingerGapUsage, GAP_REF_MAX, optimalFingering } from '../lib/fretboard';
import { personalDifficulty, gapStrain } from '../lib/handProfile';
import { useHandProfile, useLevelLimit, useAuth } from '../App';
import { currentLevelCeiling, loadManual } from '../lib/levelPlan';
import { useChordRecorder, bestForChord, GRADE_COLOR, qualityLabel } from '../lib/chordRecordings';
import { gradeFor } from '../lib/practiceGame';
import { recordings as recordingsApi } from '../lib/api';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';
import FullFretboard from './FullFretboard';
import { useT } from '../lib/i18n';

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

const FINGER_PAIRS = [
  { label: 'T→I', key: 'thumbToIndex',  color: '#a78bfa' },
  { label: 'I→M', key: 'indexToMiddle', color: '#60a5fa' },
  { label: 'M→R', key: 'middleToRing',  color: '#34d399' },
  { label: 'R→P', key: 'ringToLittle',  color: '#f97316' },
];


const GapBar = memo(function GapBar({ label, color, rawFraction, userFraction, requiredCm, userCm, refMax }) {
  const userPct = Math.min(1, userFraction);
  const overUser = userFraction > 1;
  const barColor = overUser ? '#ef4444' : userFraction > 0.9 ? '#f97316' : userFraction > 0.7 ? '#eab308' : '#22c55e';
  const tooltip = `${label}: needs ~${requiredCm.toFixed(1)} cm — your span ${userCm.toFixed(1)} cm (${Math.round(userFraction * 100)}% of capacity)`;

  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <span className="text-[9px] w-6 shrink-0" style={{ color }}>{label}</span>
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ width: 44, background: 'var(--color-surface-550)' }}>
        <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${userPct * 100}%`, background: barColor }} />
      </div>
      <span className="text-[9px] tabular-nums" style={{ color: overUser ? 'var(--color-danger)' : 'var(--color-ink-subtle)' }}>
        {requiredCm.toFixed(1)}<span style={{ color: 'var(--color-ink-ghost)' }}>/{userCm.toFixed(1)}</span>cm
      </span>
    </div>
  );
});

const FingerGapDisplay = memo(function FingerGapDisplay({ notes, profile }) {
  const usage = useMemo(() => fingerGapUsage(notes), [notes]);
  const fingering = useMemo(() => optimalFingering(notes), [notes]);
  if (!usage) return null;

  const pairs = FINGER_PAIRS.map(p => {
    const rawFraction = usage[p.key];
    const refMax = GAP_REF_MAX[p.key];
    const requiredCm = rawFraction * refMax;
    const userCm = profile[p.key];
    // Strain now models on-neck reach (a 1-fret gap is comfortable), not a raw
    // ratio of fret-gap to flat-hand splay — see gapStrain in handProfile.js.
    const userFraction = gapStrain(requiredCm, userCm, p.key);
    return { ...p, rawFraction, userFraction, requiredCm, userCm, refMax };
  }).filter(p => p.rawFraction > 0.05);

  // A barre with no finger splay above it has no gap bars to show — say so
  // explicitly instead of rendering nothing (which reads as "missing data").
  if (pairs.length === 0) {
    if (fingering?.barreFret != null) {
      return (
        <div className="mt-1 text-[9px]" style={{ color: 'var(--color-ink-faint)' }}>
          Barre (fret {fingering.barreFret}) — no finger stretch
        </div>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5 mt-1">
      {fingering?.barreFret != null && (
        <div className="text-[9px] mb-0.5" style={{ color: 'var(--color-ink-faint)' }}>
          Barre (fret {fingering.barreFret})
        </div>
      )}
      {pairs.map(p => <GapBar key={p.key} {...p} />)}
    </div>
  );
});

// Threshold above which a chord is considered "hard" and worth suggesting
// an easier substitution for.
const HARD_THRESHOLD = 7;

const EasierVersion = memo(function EasierVersion({ suggestions, tr, onHover, onLeave }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="text-[10px] text-ink-faint">↳ {tr.easierVersion || 'Easier for your hand:'}</span>
      {suggestions.map(s => (
        <span
          key={s.chord.name}
          className="text-[10px] font-semibold cursor-default px-1.5 py-0.5 rounded"
          style={{ color: '#22c55e', background: 'rgba(34,197,94,0.08)' }}
          title={`${s.chord.tab} · ${s.score.toFixed(1)} · ${s.exact ? (tr.easierExact || 'easier voicing') : (tr.easierSub || 'simpler substitute')}`}
          onMouseEnter={e => onHover(e, s.chord)}
          onMouseLeave={onLeave}
        >
          {s.chord.name} <span className="tabular-nums" style={{ color: '#15803d' }}>{s.score.toFixed(1)}</span>
        </span>
      ))}
    </div>
  );
});

// The table renders one row per chord in the library (~200 and growing), each
// with gap bars / easier-version chips in personal mode — mounting all of them
// at once measured as the single biggest DOM-size contributor to app slowness
// (~5,000 nodes for this tab alone). Windowing keeps only the rows near the
// viewport mounted; off-screen rows are represented by two spacer <tr>s so
// scrollbar size/position stay correct.
const OVERSCAN_PX = 400;
// Estimated row height per mode — personal rows are taller (gap bars + easier
// suggestions). An estimate (not a measurement) is enough for spacer sizing;
// actual rows still lay out normally once mounted.
const ROW_HEIGHT_ESTIMATE = { standard: 41, personal: 92 };

function useRowWindow(containerRef, rowCount, rowHeight) {
  const [range, setRange] = useState({ start: 0, end: Math.min(rowCount, 40) });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const top = Math.max(0, el.scrollTop - OVERSCAN_PX);
      const bottom = el.scrollTop + el.clientHeight + OVERSCAN_PX;
      const start = Math.floor(top / rowHeight);
      const end = Math.ceil(bottom / rowHeight);
      setRange({ start: Math.max(0, start), end: Math.min(rowCount, end) });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [containerRef, rowCount, rowHeight]);

  return range;
}

const ChordRow = memo(function ChordRow({
  r, isPersonal, handProfile, tr, showTooltip, hideTooltip,
  onRecord, recording, recState, recError, result, recordDisabled,
}) {
  return (
    <tr
      className="transition-colors border-b border-surface-750"
      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-750)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <td
        className="px-4 py-2 font-bold cursor-default select-none text-brand"
        style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'var(--color-ink-ghost)', textUnderlineOffset: '3px' }}
        onMouseEnter={e => showTooltip(e, r)}
        onMouseLeave={hideTooltip}
      >
        {r.name}
      </td>
      <td className="px-4 py-2 text-xs text-ink-ghost">{r.type}</td>
      <td className="px-4 py-2 font-mono text-xs tracking-widest text-ink-subtle">{r.tab}</td>
      <td className="px-4 py-2 text-xs text-ink-ghost">{r.fingeringStr}</td>
      <td className="px-4 py-2">
        {isPersonal ? (
          <div>
            <span className="flex items-center gap-2">
              <DifficultyBadge score={r.personalScore} />
              <span className="text-xs tabular-nums text-ink-ghost">{r.score.toFixed(1)}</span>
            </span>
            <FingerGapDisplay notes={r.notes} profile={handProfile} />
            <EasierVersion suggestions={r.easier} tr={tr} onHover={showTooltip} onLeave={hideTooltip} />
          </div>
        ) : (
          <DifficultyBadge score={r.score} />
        )}
      </td>
      {/* Practice: record this chord via mic → accuracy grade (feeds the Level Plan) */}
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRecord(r.name)}
            disabled={recordDisabled}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg shrink-0 transition-all ${recording ? 'text-danger' : 'bg-surface-600 text-brand'} ${recordDisabled ? 'opacity-40' : ''}`}
            style={recording ? { background: 'rgba(239,68,68,0.15)' } : undefined}
            title={tr.practiceHint || 'Record yourself playing this chord'}
          >
            {recording
              ? `● ${recState === 'scoring' ? (tr.scoring || 'Scoring…') : (tr.listening || 'Listening…')}`
              : `● ${tr.practice || 'Practice'}`}
          </button>
          {result && !recording && (
            <span
              className="inline-flex items-center gap-1 text-xs"
              title={`${qualityLabel(result.quality)} · Lvl ${result.level}/10 · ${result.score}%`}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0"
                style={{ color: GRADE_COLOR[result.grade] || 'var(--color-ink)', border: `1.5px solid ${GRADE_COLOR[result.grade] || 'var(--color-ink)'}` }}
              >
                {result.grade}
              </span>
              <span className="tabular-nums text-ink-faint">{result.score}%</span>
            </span>
          )}
          {recording && recError && <span className="text-xs text-danger">{recError}</span>}
        </div>
      </td>
    </tr>
  );
});

export default function ChordTable({ lang }) {
  const tr = useT(lang);
  const handProfile = useHandProfile();
  const limitToLevel = useLevelLimit();
  const levelCeil = currentLevelCeiling({ handProfile, manual: loadManual() });
  const [tooltip, setTooltip] = useState(null);
  const [hovered, setHovered] = useState(null);   // chord lit on the full neck
  const [mode, setMode] = useState('personal');
  const [search, setSearch] = useState('');
  const scrollRef = useRef(null);

  // ── Practice: record a chord via mic → grade → save (feeds the Level Plan).
  // The recorder is single-instance (one mic at a time), so record state lives
  // here and is passed to each row. Mirrors the Start-tab recorder.
  const recorder = useChordRecorder();
  const loggedIn = !!useAuth();
  const [recChord, setRecChord] = useState(null);          // chord name recording now
  const [recResults, setRecResults] = useState({});        // { [name]: result }
  const recordChord = useCallback(async (name) => {
    if (recChord) return;                 // one mic at a time
    setRecChord(name);
    const out = await recorder.record(name);
    setRecChord(null);
    if (out) {
      setRecResults(prev => ({ ...prev, [name]: out }));
      if (loggedIn) {
        recordingsApi.save({ chord: out.chord, score: out.score, level: out.level, quality: out.quality })
          .catch(() => { /* stays local, synced later */ });
      }
    }
  }, [recChord, recorder, loggedIn]);
  // Seed each row's badge with its best prior recording so results persist.
  // Backfill a grade for legacy records saved before grading existed.
  const resultFor = useCallback((name) => {
    if (recResults[name]) return recResults[name];
    const b = bestForChord(name);
    return b ? { ...b, grade: b.grade || gradeFor(b.score) } : null;
  }, [recResults]);

  const rows = useMemo(() => {
    const scoreFn = notes => personalDifficulty(calcDifficulty(notes), handProfile);
    // "Limit by my level": hide voicings harder than the current tier's ceiling.
    let source = (limitToLevel && levelCeil < 10)
      ? CHORDS.filter(c => calcDifficulty(c.notes) <= levelCeil)
      : CHORDS;
    // Search: match the chord name or type (e.g. "am", "maj7", "sus").
    const q = search.trim().toLowerCase();
    if (q) source = source.filter(c =>
      c.name.toLowerCase().includes(q) || (c.type || '').toLowerCase().includes(q));
    const mapped = source.map(chord => {
      const raw = calcDifficulty(chord.notes);
      const personal = personalDifficulty(raw, handProfile);
      // Only look for easier substitutes when the chord is hard for this hand.
      const easier = personal >= HARD_THRESHOLD ? findEasierVoicings(chord, scoreFn) : [];
      return {
        ...chord,
        score: raw,
        personalScore: personal,
        easier,
        fingeringStr: chord.notes.map(n => `${STRING_NAMES[n.string]}${n.fret}`).join(' '),
      };
    });

    // Keep every voicing, but present the easiest (open before barre) FIRST
    // within each chord, and order the chords by their easiest voicing. So C's
    // open x32010 always leads its barre x35553, never the other way around.
    const sortKey = r => (mode === 'personal' ? r.personalScore : r.score);
    const byName = new Map();
    for (const r of mapped) {
      if (!byName.has(r.name)) byName.set(r.name, []);
      byName.get(r.name).push(r);
    }
    const groups = [...byName.values()].map(vs => {
      vs.sort((a, b) => sortKey(a) - sortKey(b));   // easiest/open voicing first
      return { vs, lead: sortKey(vs[0]) };
    });
    groups.sort((a, b) => a.lead - b.lead);          // chords ordered by their easiest shape
    return groups.flatMap(g => g.vs);
  }, [handProfile, mode, limitToLevel, levelCeil, search]);

  const showTooltip = useCallback((e, chord) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ chord, x: rect.right + 12, y: rect.top - 8 });
    setHovered(chord);   // light up the full neck with this chord's notes
  }, []);
  // The tooltip follows the cursor (clears on mouse-out); the full-neck panel
  // KEEPS the last-hovered chord lit so you can study it after moving the mouse.
  const hideTooltip = useCallback(() => setTooltip(null), []);

  const isPersonal = mode === 'personal';
  const rowHeight = ROW_HEIGHT_ESTIMATE[mode];
  const { start, end } = useRowWindow(scrollRef, rows.length, rowHeight);
  const visibleRows = rows.slice(start, end);

  return (
    <div className="p-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <p className="text-sm text-ink-faint">{tr.hoverChord}</p>
        <div className="relative flex-1 min-w-[140px] max-w-xs order-last sm:order-none w-full sm:w-auto">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tr.searchChord || 'Search chords…'}
            className="w-full text-sm rounded-lg pl-8 pr-7 py-1.5 bg-surface-750 border border-surface-650 text-ink placeholder:text-ink-ghost focus:outline-none focus:border-brand"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-ghost text-sm pointer-events-none">🔎</span>
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-sm"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-750">
          {['standard', 'personal'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all"
              style={mode === m ? {
                background: 'var(--color-surface-600)',
                color: 'var(--color-brand)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              } : { color: 'var(--color-ink-faint)' }}
            >
              {m === 'personal' ? tr.myHand : tr.standard}
            </button>
          ))}
        </div>
      </div>

      {isPersonal && (
        <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 mb-4 text-xs text-brand" style={{ background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.15)' }}>
          <span className="shrink-0 mt-0.5">✋</span>
          <span>{tr.myHandDesc}</span>
        </div>
      )}

      {/* Full neck — lights up every position of the hovered chord's notes.
          Defaults to the easiest chord until the user hovers a row. */}
      <div className="mb-4">
        <FullFretboard chord={hovered || rows[0] || null} />
      </div>

      <div ref={scrollRef} className="overflow-auto max-h-[68vh] rounded-xl border border-surface-700">
        <table className="text-sm w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {[tr.chord, tr.type, tr.tab, tr.notes, isPersonal ? tr.myDifficulty : tr.difficulty, tr.practice || 'Practice'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left border-b border-surface-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-faint">
                {(tr.noChordsFound || 'No chords match')}{search ? ` “${search}”.` : '.'}
              </td></tr>
            )}
            {start > 0 && (
              <tr aria-hidden="true"><td colSpan={6} style={{ height: start * rowHeight, padding: 0, border: 0 }} /></tr>
            )}
            {visibleRows.map((r, i) => (
              <ChordRow
                key={start + i}
                r={r}
                isPersonal={isPersonal}
                handProfile={handProfile}
                tr={tr}
                showTooltip={showTooltip}
                hideTooltip={hideTooltip}
                onRecord={recordChord}
                recording={recChord === r.name}
                recState={recChord === r.name ? recorder.state : null}
                recError={recChord === r.name ? recorder.error : null}
                result={resultFor(r.name)}
                recordDisabled={!!recChord && recChord !== r.name}
              />
            ))}
            {end < rows.length && (
              <tr aria-hidden="true"><td colSpan={6} style={{ height: (rows.length - end) * rowHeight, padding: 0, border: 0 }} /></tr>
            )}
          </tbody>
        </table>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 rounded-2xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <FretboardDiagram chord={tooltip.chord} />
        </div>
      )}
    </div>
  );
}

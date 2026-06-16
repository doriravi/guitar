import { useState, useCallback, useMemo } from 'react';
import { CHORDS, findEasierVoicings } from '../lib/chords';
import { calcDifficulty, fingerGapUsage, GAP_REF_MAX } from '../lib/fretboard';
import { personalDifficulty } from '../lib/handProfile';
import { useHandProfile } from '../App';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';
import { useT } from '../lib/i18n';

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

const FINGER_PAIRS = [
  { label: 'T→I', key: 'thumbToIndex',  color: '#a78bfa' },
  { label: 'I→M', key: 'indexToMiddle', color: '#60a5fa' },
  { label: 'M→R', key: 'middleToRing',  color: '#34d399' },
  { label: 'R→P', key: 'ringToLittle',  color: '#f97316' },
];


function GapBar({ label, color, rawFraction, userFraction, requiredCm, userCm, refMax }) {
  const userPct = Math.min(1, userFraction);
  const overUser = userFraction > 1;
  const barColor = overUser ? '#ef4444' : userFraction > 0.9 ? '#f97316' : userFraction > 0.7 ? '#eab308' : '#22c55e';
  const tooltip = `${label}: needs ~${requiredCm.toFixed(1)} cm — your span ${userCm.toFixed(1)} cm (${Math.round(userFraction * 100)}% of capacity)`;

  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <span className="text-[9px] w-6 shrink-0" style={{ color }}>{label}</span>
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ width: 44, background: '#2a2a2a' }}>
        <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${userPct * 100}%`, background: barColor }} />
      </div>
      <span className="text-[9px] tabular-nums" style={{ color: overUser ? '#ef4444' : '#666' }}>
        {requiredCm.toFixed(1)}<span style={{ color: '#3a3a3a' }}>/{userCm.toFixed(1)}</span>cm
      </span>
    </div>
  );
}

function FingerGapDisplay({ notes, profile }) {
  const usage = useMemo(() => fingerGapUsage(notes), [notes]);
  if (!usage) return null;

  const pairs = FINGER_PAIRS.map(p => {
    const rawFraction = usage[p.key];
    const refMax = GAP_REF_MAX[p.key];
    const requiredCm = rawFraction * refMax;
    const userCm = profile[p.key];
    const userFraction = userCm > 0 ? requiredCm / userCm : requiredCm > 0 ? 2 : 0;
    return { ...p, rawFraction, userFraction, requiredCm, userCm, refMax };
  }).filter(p => p.rawFraction > 0.05);

  if (pairs.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 mt-1">
      {pairs.map(p => <GapBar key={p.key} {...p} />)}
    </div>
  );
}

// Threshold above which a chord is considered "hard" and worth suggesting
// an easier substitution for.
const HARD_THRESHOLD = 7;

function EasierVersion({ suggestions, tr, onHover, onLeave }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="text-[10px]" style={{ color: '#5a5a5a' }}>↳ {tr.easierVersion || 'Easier for your hand:'}</span>
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
}

export default function ChordTable({ lang }) {
  const tr = useT(lang);
  const handProfile = useHandProfile();
  const [tooltip, setTooltip] = useState(null);
  const [mode, setMode] = useState('personal');

  const rows = useMemo(() => {
    const scoreFn = notes => personalDifficulty(calcDifficulty(notes), handProfile);
    return CHORDS.map(chord => {
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
    }).sort((a, b) =>
      mode === 'personal' ? a.personalScore - b.personalScore : a.score - b.score
    );
  }, [handProfile, mode]);

  const showTooltip = useCallback((e, chord) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ chord, x: rect.right + 12, y: rect.top - 8 });
  }, []);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  const isPersonal = mode === 'personal';

  return (
    <div className="p-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <p className="text-sm" style={{ color: '#5a5a5a' }}>{tr.hoverChord}</p>
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: '#1a1a1a' }}>
          {['standard', 'personal'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all"
              style={mode === m ? {
                background: '#252525',
                color: '#c9a96e',
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              } : { color: '#5a5a5a' }}
            >
              {m === 'personal' ? tr.myHand : tr.standard}
            </button>
          ))}
        </div>
      </div>

      {isPersonal && (
        <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 mb-4 text-xs" style={{ background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.15)', color: '#c9a96e' }}>
          <span className="shrink-0 mt-0.5">✋</span>
          <span>{tr.myHandDesc}</span>
        </div>
      )}

      <div className="overflow-auto max-h-[68vh] rounded-xl" style={{ border: '1px solid #1e1e1e' }}>
        <table className="text-sm w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {[tr.chord, tr.type, tr.tab, tr.notes, isPersonal ? tr.myDifficulty : tr.difficulty].map(h => (
                <th key={h} className="px-4 py-2.5 text-left" style={{ borderBottom: '1px solid #1e1e1e' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className="transition-colors"
                style={{ borderBottom: '1px solid #1a1a1a' }}
                onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <td
                  className="px-4 py-2 font-bold cursor-default select-none"
                  style={{ color: '#c9a96e', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: '#3a3a3a', textUnderlineOffset: '3px' }}
                  onMouseEnter={e => showTooltip(e, r)}
                  onMouseLeave={hideTooltip}
                >
                  {r.name}
                </td>
                <td className="px-4 py-2 text-xs" style={{ color: '#4a4a4a' }}>{r.type}</td>
                <td className="px-4 py-2 font-mono text-xs tracking-widest" style={{ color: '#6a6a6a' }}>{r.tab}</td>
                <td className="px-4 py-2 text-xs" style={{ color: '#4a4a4a' }}>{r.fingeringStr}</td>
                <td className="px-4 py-2">
                  {isPersonal ? (
                    <div>
                      <span className="flex items-center gap-2">
                        <DifficultyBadge score={r.personalScore} />
                        <span className="text-xs tabular-nums" style={{ color: '#333' }}>{r.score.toFixed(1)}</span>
                      </span>
                      <FingerGapDisplay notes={r.notes} profile={handProfile} />
                      <EasierVersion suggestions={r.easier} tr={tr} onHover={showTooltip} onLeave={hideTooltip} />
                    </div>
                  ) : (
                    <DifficultyBadge score={r.score} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 rounded-2xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, background: '#1e1e1e', border: '1px solid #2a2a2a', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <FretboardDiagram chord={tooltip.chord} />
        </div>
      )}
    </div>
  );
}

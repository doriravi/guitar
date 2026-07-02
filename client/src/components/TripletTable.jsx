import { buildTripletTable } from '../lib/fretboard';
import DifficultyBadge from './DifficultyBadge';
import { useState, useMemo } from 'react';
import { useT } from '../lib/i18n';

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

export default function TripletTable({ lang }) {
  const tr = useT(lang);
  const [maxFret, setMaxFret] = useState(5);
  const [sortBy, setSortBy] = useState('score');

  const rows = useMemo(() => {
    const data = buildTripletTable(maxFret);
    return [...data].sort((a, b) =>
      sortBy === 'score' ? a.score - b.score : b.score - a.score
    );
  }, [maxFret, sortBy]);

  const pct = ((maxFret - 2) / 8) * 100;

  return (
    <div className="p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3 sm:gap-5 mb-4 sm:mb-5 px-3 sm:px-4 py-3 rounded-xl bg-surface-750 border border-surface-700">
        <div className="flex items-center gap-3 flex-1 min-w-[140px]">
          <label className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap text-ink-faint">{tr.maxFret}</label>
          <input
            type="range" min={2} max={10} value={maxFret}
            onChange={e => setMaxFret(Number(e.target.value))}
            className="flex-1"
            style={{ background: `linear-gradient(to right, var(--color-brand) ${pct}%, var(--color-surface-550) ${pct}%)` }}
          />
          <span className="text-sm font-bold w-5 text-right tabular-nums text-brand">{maxFret}</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{tr.sort}</label>
          <div className="flex gap-1 p-0.5 rounded-lg bg-surface-900">
            {[['score', tr.easiest], ['score_desc', tr.hardest]].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setSortBy(val)}
                className="px-3 py-1.5 text-xs font-semibold rounded-md transition-all"
                style={sortBy === val ? {
                  background: 'var(--color-surface-600)',
                  color: 'var(--color-brand)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                } : { color: 'var(--color-ink-faint)' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <span className="text-xs tabular-nums ml-auto text-ink-ghost">
          {rows.length.toLocaleString()} {tr.strings && ''}{/* count */}
        </span>
      </div>

      <div className="overflow-auto max-h-[65vh] rounded-xl border border-surface-700">
        <table className="text-sm w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {[tr.strings, tr.frets, tr.fretSpan, tr.stringSpan, tr.difficulty].map(h => (
                <th key={h} className="px-4 py-2.5 text-left border-b border-surface-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className="transition-colors border-b border-surface-750"
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-750)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <td className="px-4 py-2 font-mono text-xs font-semibold text-brand">
                  {r.strings.map(s => STRING_NAMES[s]).join(' – ')}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-ink-subtle">{r.frets.join(' – ')}</td>
                <td className="px-4 py-2 text-xs text-ink-ghost">{r.fretSpan}</td>
                <td className="px-4 py-2 text-xs text-ink-ghost">{r.stringSpan}</td>
                <td className="px-4 py-2"><DifficultyBadge score={r.score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

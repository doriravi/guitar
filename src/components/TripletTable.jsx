import { buildTripletTable } from '../lib/fretboard';
import DifficultyBadge from './DifficultyBadge';
import { useState, useMemo } from 'react';

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

export default function TripletTable() {
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
      <div className="flex flex-wrap items-center gap-3 sm:gap-5 mb-4 sm:mb-5 px-3 sm:px-4 py-3 rounded-xl" style={{ background: '#1a1a1a', border: '1px solid #1e1e1e' }}>
        <div className="flex items-center gap-3 flex-1 min-w-[140px]">
          <label className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: '#5a5a5a' }}>Max fret</label>
          <input
            type="range" min={2} max={10} value={maxFret}
            onChange={e => setMaxFret(Number(e.target.value))}
            className="flex-1"
            style={{ background: `linear-gradient(to right, #c9a96e ${pct}%, #2a2a2a ${pct}%)` }}
          />
          <span className="text-sm font-bold w-5 text-right tabular-nums" style={{ color: '#c9a96e' }}>{maxFret}</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5a5a5a' }}>Sort</label>
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: '#111' }}>
            {[['score', 'Easiest'], ['score_desc', 'Hardest']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setSortBy(val)}
                className="px-3 py-1.5 text-xs font-semibold rounded-md transition-all"
                style={sortBy === val ? {
                  background: '#252525',
                  color: '#c9a96e',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                } : { color: '#5a5a5a' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <span className="text-xs tabular-nums ml-auto" style={{ color: '#3a3a3a' }}>
          {rows.length.toLocaleString()} combinations
        </span>
      </div>

      <div className="overflow-auto max-h-[65vh] rounded-xl" style={{ border: '1px solid #1e1e1e' }}>
        <table className="text-sm w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {['Strings', 'Frets', 'Fret span', 'String span', 'Difficulty'].map(h => (
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
                <td className="px-4 py-2 font-mono text-xs font-semibold" style={{ color: '#c9a96e' }}>
                  {r.strings.map(s => STRING_NAMES[s]).join(' – ')}
                </td>
                <td className="px-4 py-2 font-mono text-xs" style={{ color: '#6a6a6a' }}>{r.frets.join(' – ')}</td>
                <td className="px-4 py-2 text-xs" style={{ color: '#4a4a4a' }}>{r.fretSpan}</td>
                <td className="px-4 py-2 text-xs" style={{ color: '#4a4a4a' }}>{r.stringSpan}</td>
                <td className="px-4 py-2"><DifficultyBadge score={r.score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="font-medium text-gray-700">Max fret:</label>
          <input
            type="range" min={2} max={10} value={maxFret}
            onChange={e => setMaxFret(Number(e.target.value))}
            className="w-32"
          />
          <span className="text-gray-600">{maxFret}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="font-medium text-gray-700">Sort:</label>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="score">Easiest first</option>
            <option value="score_desc">Hardest first</option>
          </select>
        </div>
        <span className="text-sm text-gray-400">{rows.length} combinations</span>
      </div>
      <div className="overflow-auto max-h-[65vh]">
        <table className="text-sm border-collapse w-full">
          <thead className="sticky top-0 bg-white shadow-sm">
            <tr>
              <th className="border px-3 py-2 text-left">Strings</th>
              <th className="border px-3 py-2 text-left">Frets</th>
              <th className="border px-3 py-2 text-left">Fret span</th>
              <th className="border px-3 py-2 text-left">String span</th>
              <th className="border px-3 py-2 text-left">Difficulty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="border px-3 py-1 font-mono">
                  {r.strings.map(s => STRING_NAMES[s]).join('-')}
                </td>
                <td className="border px-3 py-1 font-mono">
                  {r.frets.join('-')}
                </td>
                <td className="border px-3 py-1">{r.fretSpan}</td>
                <td className="border px-3 py-1">{r.stringSpan}</td>
                <td className="border px-3 py-1"><DifficultyBadge score={r.score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

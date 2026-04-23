import { buildDifficultyTable } from '../lib/fretboard';
import DifficultyBadge from './DifficultyBadge';
import { useState } from 'react';

export default function DifficultyTable() {
  const [maxFret, setMaxFret] = useState(7);
  const rows = buildDifficultyTable(maxFret);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <label className="font-medium text-gray-700">Max fret:</label>
        <input
          type="range" min={2} max={15} value={maxFret}
          onChange={e => setMaxFret(Number(e.target.value))}
          className="w-32"
        />
        <span className="text-gray-600">{maxFret}</span>
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="text-sm border-collapse w-full">
          <thead className="sticky top-0 bg-white shadow-sm">
            <tr>
              <th className="border px-3 py-2 text-left">Fret 1</th>
              <th className="border px-3 py-2 text-left">Fret 2</th>
              <th className="border px-3 py-2 text-left">Fret span</th>
              <th className="border px-3 py-2 text-left">String span</th>
              <th className="border px-3 py-2 text-left">Difficulty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="border px-3 py-1">{r.fret1}</td>
                <td className="border px-3 py-1">{r.fret2}</td>
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

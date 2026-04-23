import { useState, useCallback } from 'react';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

export default function ChordTable() {
  const [tooltip, setTooltip] = useState(null); // { chord, x, y }

  const rows = CHORDS.map(chord => ({
    ...chord,
    score: calcDifficulty(chord.notes),
    fingeringStr: chord.notes
      .map(n => `${STRING_NAMES[n.string]}${n.fret}`)
      .join(' '),
  })).sort((a, b) => a.score - b.score);

  const showTooltip = useCallback((e, chord) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      chord,
      x: rect.right + 10,
      y: rect.top - 10,
    });
  }, []);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  return (
    <div className="p-4">
      <p className="text-sm text-gray-500 mb-4">
        Hover over a chord name to see the fretboard diagram.
        Difficulty is based on fretted notes only (open and muted strings excluded).
      </p>

      <div className="overflow-auto max-h-[70vh]">
        <table className="text-sm border-collapse w-full">
          <thead className="sticky top-0 bg-white shadow-sm">
            <tr>
              <th className="border px-3 py-2 text-left">Chord</th>
              <th className="border px-3 py-2 text-left">Type</th>
              <th className="border px-3 py-2 text-left">Tab</th>
              <th className="border px-3 py-2 text-left">Fretted Notes</th>
              <th className="border px-3 py-2 text-left">Difficulty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td
                  className="border px-3 py-1 font-bold cursor-default select-none underline decoration-dotted text-gray-800"
                  onMouseEnter={e => showTooltip(e, r)}
                  onMouseLeave={hideTooltip}
                >
                  {r.name}
                </td>
                <td className="border px-3 py-1 text-gray-600">{r.type}</td>
                <td className="border px-3 py-1 font-mono text-xs tracking-widest">{r.tab}</td>
                <td className="border px-3 py-1 text-gray-600">{r.fingeringStr}</td>
                <td className="border px-3 py-1"><DifficultyBadge score={r.score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Fixed-position tooltip — renders outside table overflow context */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white border border-gray-300 rounded-lg shadow-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <FretboardDiagram chord={tooltip.chord} />
        </div>
      )}
    </div>
  );
}

import { useState, useCallback, useMemo } from 'react';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import { personalDifficulty } from '../lib/handProfile';
import { useHandProfile } from '../App';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

export default function ChordTable() {
  const handProfile = useHandProfile();
  const [tooltip, setTooltip] = useState(null);
  const [mode, setMode] = useState('personal');

  const rows = useMemo(() => CHORDS.map(chord => {
    const raw = calcDifficulty(chord.notes);
    const personal = personalDifficulty(raw, handProfile);
    return {
      ...chord,
      score: raw,
      personalScore: personal,
      fingeringStr: chord.notes.map(n => `${STRING_NAMES[n.string]}${n.fret}`).join(' '),
    };
  }).sort((a, b) =>
    mode === 'personal' ? a.personalScore - b.personalScore : a.score - b.score
  ), [handProfile, mode]);

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
        <p className="text-sm" style={{ color: '#5a5a5a' }}>Hover a chord name to preview its shape.</p>
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
              {m === 'personal' ? '✋ My Hand' : 'Standard'}
            </button>
          ))}
        </div>
      </div>

      {isPersonal && (
        <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 mb-4 text-xs" style={{ background: 'rgba(201,169,110,0.08)', border: '1px solid rgba(201,169,110,0.15)', color: '#c9a96e' }}>
          <span className="shrink-0 mt-0.5">✋</span>
          <span>Scores adjusted for your hand measurements, re-sorted by feel. Grey number = standard score.</span>
        </div>
      )}

      <div className="overflow-auto max-h-[68vh] rounded-xl" style={{ border: '1px solid #1e1e1e' }}>
        <table className="text-sm w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {['Chord', 'Type', 'Tab', 'Notes', isPersonal ? 'My Difficulty' : 'Difficulty'].map(h => (
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
                    <span className="flex items-center gap-2">
                      <DifficultyBadge score={r.personalScore} />
                      <span className="text-xs tabular-nums" style={{ color: '#333' }}>{r.score.toFixed(1)}</span>
                    </span>
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

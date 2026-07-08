// A treble-clef music staff that renders a sequence of guitar chords as stacked
// noteheads — a "note sheet" for the song's chords. Each chord is one beat-column;
// its notes are the actual sounding pitches of that voicing (from the tab), placed
// at their real staff positions with ledger lines and ♯ accidentals as needed.
//
// Pure presentational SVG built from lib/notation.js. Sized to scroll horizontally
// inside its own container when a song has many chords.

import { useState } from 'react';
import { tabToPitches, diatonicStep, isSharp, TREBLE_BOTTOM_STEP } from '../lib/notation';
import FretboardDiagram from './FretboardDiagram';

const STEP_H = 5;            // px per diatonic step (half a staff space)
const LINE_GAP = STEP_H * 2; // px between staff lines
const NOTE_RX = STEP_H * 1.15;
const NOTE_RY = STEP_H * 0.95;
const COL_W = 34;            // px per chord column
const PAD_TOP = 46;          // room above the top staff line (high ledger notes)
const PAD_BOTTOM = 78;       // room below for the low guitar notes (many ledgers)
const LABEL_H = 16;          // chord-name row height
const LEFT = 34;             // room for the clef

// The 5 treble lines are steps E4,G4,B4,D5,F5 → offsets 0,2,4,6,8 above the
// bottom line. We measure every note's step relative to E4 (TREBLE_BOTTOM_STEP)
// and convert to a y where the bottom line sits at yBottom.
export default function NoteStaff({ chords, activeIndex = null }) {
  // Hover chord map: the chord-name label shows the fretted SHAPE on hover, like
  // everywhere else in the app. Keeps the source chord (tab/notes) for the diagram.
  const [tip, setTip] = useState(null); // { chord, x, y }
  const showTip = (e, chord) => {
    if (!chord?.tab) return;
    const r = e.currentTarget.getBoundingClientRect();
    const tipW = 150;
    setTip({
      chord,
      x: r.right + 8 + tipW > window.innerWidth ? r.left - tipW - 6 : r.right + 8,
      y: Math.max(8, r.top - 10),
    });
  };
  const hideTip = () => setTip(null);

  const cols = (chords || [])
    .map((c, i) => ({ i, name: c.name || c.chordName || '', tab: c.tab || '', notes: tabToPitches(c.tab || ''), src: c }))
    .filter(c => c.notes.length);

  if (!cols.length) {
    return (
      <div className="text-xs italic px-2 py-3" style={{ color: 'var(--color-ink-ghost)' }}>
        No chord shapes to notate yet.
      </div>
    );
  }

  // Vertical anchor: y of the bottom staff line (E4, offset 0).
  const yBottom = PAD_TOP + 8 * STEP_H;   // 8 steps of staff above it
  const stepY = (relStep) => yBottom - relStep * STEP_H; // higher step = higher (smaller y)

  const width = LEFT + cols.length * COL_W + 12;
  const height = LABEL_H + PAD_TOP + 8 * STEP_H + PAD_BOTTOM;

  // Staff line offsets above the bottom line: 0,2,4,6,8 (E G B D F).
  const staffOffsets = [0, 2, 4, 6, 8];

  return (
    <>
    <svg width={width} height={height} style={{ display: 'block' }} role="img"
      aria-label="Note sheet of the song chords">
      {/* Staff lines */}
      {staffOffsets.map(off => (
        <line key={off} x1={LEFT} y1={stepY(off)} x2={width - 6} y2={stepY(off)}
          stroke="var(--color-surface-500, #9a9a9a)" strokeWidth="1" />
      ))}

      {/* Treble clef glyph (unicode 𝄞) sat on the G line (2nd from bottom = off 2) */}
      <text x={LEFT - 26} y={stepY(2) + 12} fontSize="34"
        fill="var(--color-ink-muted, #cbb892)">{'𝄞'}</text>

      {cols.map((col) => {
        const x = LEFT + col.i * COL_W + COL_W / 2;
        const active = activeIndex === col.i;
        // Steps relative to E4 for each note in this chord.
        const relSteps = col.notes.map(n => diatonicStep(n.midi) - TREBLE_BOTTOM_STEP);
        const minRel = Math.min(...relSteps);
        const maxRel = Math.max(...relSteps);

        return (
          <g key={col.i}>
            {/* Active-column highlight bar */}
            {active && (
              <rect x={LEFT + col.i * COL_W} y={LABEL_H} width={COL_W} height={height - LABEL_H}
                fill="rgba(129,140,248,0.16)" />
            )}

            {/* Chord name above the staff — hover shows the fretted shape */}
            <text x={x} y={LABEL_H - 3} textAnchor="middle" fontSize="11" fontWeight="bold"
              style={{ cursor: 'help' }}
              onMouseEnter={(e) => showTip(e, col.src)}
              onMouseLeave={hideTip}
              fill={active ? 'var(--color-accent, #818cf8)' : 'var(--color-brand, #c9a96e)'}>
              {col.name}
            </text>

            {/* Ledger lines: every EVEN offset outside the 0..8 staff range needs a
                short line through the note. Below the staff (off < 0) and above (off > 8). */}
            {ledgerOffsets(minRel, maxRel).map(off => (
              <line key={off} x1={x - NOTE_RX - 3} y1={stepY(off)} x2={x + NOTE_RX + 3} y2={stepY(off)}
                stroke="var(--color-surface-500, #9a9a9a)" strokeWidth="1" />
            ))}

            {/* Noteheads (+ accidentals) */}
            {col.notes.map((n, k) => {
              const rel = relSteps[k];
              const cy = stepY(rel);
              return (
                <g key={k}>
                  {isSharp(n.midi) && (
                    <text x={x - NOTE_RX - 5} y={cy + 4} textAnchor="end" fontSize="12"
                      fill={active ? 'var(--color-accent, #818cf8)' : 'var(--color-ink, #e6dcc8)'}>♯</text>
                  )}
                  <ellipse cx={x} cy={cy} rx={NOTE_RX} ry={NOTE_RY}
                    transform={`rotate(-20 ${x} ${cy})`}
                    fill={active ? 'var(--color-accent, #818cf8)' : 'var(--color-ink, #e6dcc8)'} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
    {tip && (
      <div className="fixed z-50 rounded-xl p-3 pointer-events-none"
        style={{ left: tip.x, top: tip.y, background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <FretboardDiagram chord={{ name: tip.chord.name || tip.chord.chordName || '', tab: tip.chord.tab, notes: tip.chord.notes }} />
      </div>
    )}
    </>
  );
}

// The even staff-offsets (relative to E4) that need a ledger line for a chord
// spanning [minRel, maxRel]. Staff lines live at 0,2,4,6,8; anything on an even
// offset below 0 or above 8 needs its own ledger.
function ledgerOffsets(minRel, maxRel) {
  const out = [];
  for (let off = -2; off >= minRel - 1; off -= 2) out.push(off); // below the staff
  for (let off = 10; off <= maxRel + 1; off += 2) out.push(off); // above the staff
  return out;
}

// Renders a song's solo/riff tab blocks — the ASCII tab passages that the
// chord-sheet parser pulls out of imported sheets (see tabBlockParser.js).
//
// Each block is shown as a real 6-line EADGBe tab staff (high e on top), with
// every fretted note hoverable for its single-note fretboard shape (the app-wide
// "no bare chord/note text" rule), plus a Play button that sounds the riff on
// the beat through the shared audio engine.

import { useState, useCallback, useRef } from 'react';
import { playSoloGuitar, stopAudio, unlockAudio } from '../lib/audio';
import { calcDifficulty } from '../lib/fretboard';
import { personalDifficulty } from '../lib/handProfile';
import FretboardDiagram from './FretboardDiagram';
import DifficultyBadge from './DifficultyBadge';

const LABELS = ['e', 'B', 'G', 'D', 'A', 'E']; // top→bottom (app string 5→0)
const STRING_ABBR = ['E', 'A', 'D', 'G', 'B', 'e'];

// Group a block's flat events by column (a column = one pick; may hold a
// double-stop). Returns [{ col, notes:[{string,fret}] }] sorted by column.
function columnsOf(block) {
  const byCol = new Map();
  for (const e of block.events || []) {
    if (e.string < 0 || e.string > 5 || e.fret < 0) continue;
    if (!byCol.has(e.col)) byCol.set(e.col, []);
    byCol.get(e.col).push({ string: e.string, fret: e.fret });
  }
  return [...byCol.keys()].sort((a, b) => a - b).map(col => ({ col, notes: byCol.get(col) }));
}

// A single column's chord-diagram descriptor (for the hover tooltip): a 6-char
// EADGBe tab + the fretted notes only.
function columnDiagram(notes) {
  const byString = {};
  for (const n of notes) byString[n.string] = n.fret;
  let tab = '';
  for (let s = 0; s < 6; s++) {
    const f = byString[s];
    tab += f == null ? 'x' : (f > 9 ? String.fromCharCode(97 + f - 10) : String(f));
  }
  return { name: notes.map(n => `${STRING_ABBR[n.string]}${n.fret}`).join('+'), tab, notes: notes.filter(n => n.fret > 0) };
}

// One tab staff. `activeCol` (index into columns) lights the note currently
// sounding during playback.
function TabBlock({ block, bpm, profile, index }) {
  const cols = columnsOf(block);
  const [playing, setPlaying] = useState(false);
  const [activeCol, setActiveCol] = useState(-1);
  const [tip, setTip] = useState(null); // { diagram, x, y }
  const timers = useRef([]);

  const spb = 60 / Math.min(200, Math.max(40, bpm || 100));

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    stopAudio();
    setPlaying(false);
    setActiveCol(-1);
  }, []);

  const play = useCallback(() => {
    if (playing) { stop(); return; }
    unlockAudio();
    setPlaying(true);
    // One column per beat, matching the game's SOLO_BEATS=1 pacing.
    const notes = [];
    cols.forEach((c, i) => {
      for (const n of c.notes) notes.push({ string: n.string, fret: n.fret, atSec: 0.12 + i * spb, durSec: spb * 0.95 });
    });
    playSoloGuitar(notes);
    // Light each column as it sounds; auto-stop at the end.
    cols.forEach((_, i) => {
      timers.current.push(setTimeout(() => setActiveCol(i), (0.12 + i * spb) * 1000));
    });
    timers.current.push(setTimeout(stop, (0.12 + cols.length * spb + 0.4) * 1000));
  }, [playing, cols, spb, stop]);

  // Difficulty of the hardest column (a double-stop can stretch) for a quick badge.
  const hardest = cols.reduce((mx, c) => {
    const notes = c.notes.filter(n => n.fret > 0);
    return notes.length > 1 ? Math.max(mx, calcDifficulty(notes)) : mx;
  }, 0);

  const showTip = (e, notes) => {
    const r = e.currentTarget.getBoundingClientRect();
    const tipW = 150;
    setTip({
      diagram: columnDiagram(notes),
      x: r.right + 8 + tipW > window.innerWidth ? r.left - tipW - 6 : r.right + 8,
      y: Math.max(8, r.top - 10),
    });
  };

  // Render each string row as spans so individual fret numbers are hoverable.
  // rows[r] corresponds to app string (5 - r): row 0 = high e.
  return (
    <div className="rounded-lg p-2.5 mb-2" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--color-info)' }}>
          ♪ Solo {index + 1}
        </span>
        <div className="flex items-center gap-2">
          {hardest > 0 && <DifficultyBadge score={personalDifficulty(hardest, profile)} />}
          <button onClick={play}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold"
            style={playing
              ? { background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)' }
              : { background: 'var(--color-info)', color: 'var(--color-surface-base)' }}>
            <span className="leading-none">{playing ? '■' : '▶'}</span>
            {playing ? 'Stop' : 'Play riff'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block font-mono text-[13px] leading-snug whitespace-pre">
          {LABELS.map((label, r) => {
            const stringIdx = 5 - r;
            return (
              <div key={r} className="flex items-center">
                <span style={{ color: 'var(--color-ink-ghost)' }}>{label}|</span>
                {cols.map((c, ci) => {
                  // Each column is as wide as its widest fret so all six rows line
                  // up whether or not this string plays here (10/12 → 2 chars).
                  const width = Math.max(1, ...c.notes.map(n => String(n.fret).length));
                  const note = c.notes.find(n => n.string === stringIdx);
                  const lit = ci === activeCol;
                  return (
                    <span key={ci} className="flex items-center">
                      <span style={{ color: 'var(--color-ink-ghost)' }}>-</span>
                      {note ? (
                        <span
                          tabIndex={0}
                          onMouseEnter={(e) => showTip(e, c.notes)}
                          onMouseLeave={() => setTip(null)}
                          onFocus={(e) => showTip(e, c.notes)}
                          onBlur={() => setTip(null)}
                          className="font-bold rounded cursor-help outline-none"
                          style={{
                            color: lit ? 'var(--color-surface-base)' : 'var(--color-info)',
                            background: lit ? 'var(--color-info)' : 'transparent',
                          }}
                        >{String(note.fret).padStart(width, ' ')}</span>
                      ) : (
                        <span style={{ color: 'var(--color-ink-ghost)' }}>{'-'.repeat(width)}</span>
                      )}
                    </span>
                  );
                })}
                <span style={{ color: 'var(--color-ink-ghost)' }}>-|</span>
              </div>
            );
          })}
        </div>
      </div>

      {tip && (
        <span className="fixed z-50 block rounded-xl p-3 pointer-events-none"
          style={{ left: tip.x, top: tip.y, background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          <span className="block text-xs mb-1 text-center" style={{ color: 'var(--color-ink-faint)' }}>{tip.diagram.name}</span>
          <FretboardDiagram chord={tip.diagram} />
        </span>
      )}
    </div>
  );
}

/**
 * Render every solo tab block on a song. Returns null when the song has none.
 * @param {{ tabBlocks?: Array }} song
 * @param {number} bpm
 * @param {object} profile  hand profile for the difficulty badge
 */
export default function SoloTabView({ song, bpm, profile }) {
  const blocks = song?.tabBlocks || [];
  if (!blocks.length) return null;
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>
        Solo passages
      </div>
      {blocks.map((b, i) => (
        <TabBlock key={i} block={b} bpm={bpm} profile={profile} index={i} />
      ))}
    </div>
  );
}

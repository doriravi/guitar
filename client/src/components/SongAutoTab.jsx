// Auto-tab for a whole song — a real 6-line EADGBe tab staff generated from the
// song's own chords (via lib/autoTab.js), shown for EVERY song in the
// Progressions tab, not just imported ones that carry parsed ASCII tab.
//
// It also powers "Simplify the whole song": one click swaps every chord for the
// lowest-reach shape your hand can play and lays the simplified staff RIGHT NEXT
// TO the original so you can read the two versions together. Each staff has its
// own Play (strums the columns through the shared audio engine) and every fret
// number is hoverable for its single-note fretboard shape (the app-wide
// no-bare-text rule).

import { useState, useMemo, useCallback, useRef } from 'react';
import { buildAutoTab, buildSimplifiedAutoTab } from '../lib/autoTab';
import { playSoloGuitar, stopAudio, unlockAudio } from '../lib/audio';
import { personalDifficulty } from '../lib/handProfile';
import { useHandProfile } from '../App';
import FretboardDiagram from './FretboardDiagram';
import DifficultyBadge from './DifficultyBadge';

const LABELS = ['e', 'B', 'G', 'D', 'A', 'E']; // top→bottom (app string 5→0)
const STRING_ABBR = ['E', 'A', 'D', 'G', 'B', 'e'];

// One column's chord-diagram descriptor for the hover tooltip.
function columnDiagram(col) {
  return { name: col.chordName, tab: col.tab, notes: col.notes };
}

// A strummed tab staff. `columns` = [{ chordName, tab, notes, score, lyric }].
// Renders high-e on top; every column is one chord strike. Playing walks the
// columns one-per-beat and lights the sounding column.
function TabStaff({ title, columns, hardest, profile, accent, note }) {
  const [playing, setPlaying] = useState(false);
  const [activeCol, setActiveCol] = useState(-1);
  const [tip, setTip] = useState(null); // { diagram, x, y }
  const timers = useRef([]);

  const spb = 0.5; // one chord per half-second — a walkable practice tempo

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
    // Strum each column low→high (a small per-string delay) once per beat.
    const notes = [];
    columns.forEach((c, i) => {
      const strung = [];
      c.tab.split('').forEach((ch, s) => {
        if (ch === 'x') return;
        const fret = parseInt(ch, 10);
        if (Number.isNaN(fret)) return;
        strung.push(s);
      });
      strung.forEach((s, ni) => {
        const fret = parseInt(c.tab[s], 10);
        notes.push({ string: s, fret, atSec: 0.12 + i * spb + ni * 0.02, durSec: spb * 0.95 });
      });
    });
    playSoloGuitar(notes);
    columns.forEach((_, i) => {
      timers.current.push(setTimeout(() => setActiveCol(i), (0.12 + i * spb) * 1000));
    });
    timers.current.push(setTimeout(stop, (0.12 + columns.length * spb + 0.4) * 1000));
  }, [playing, columns, spb, stop]);

  const showTip = (e, col) => {
    const r = e.currentTarget.getBoundingClientRect();
    const tipW = 150;
    setTip({
      diagram: columnDiagram(col),
      x: r.right + 8 + tipW > window.innerWidth ? r.left - tipW - 6 : r.right + 8,
      y: Math.max(8, r.top - 10),
    });
  };

  if (!columns.length) return null;

  return (
    <div className="rounded-xl p-3 flex-1 min-w-0"
      style={{ background: 'var(--color-surface-900)', border: `1px solid ${accent}33` }}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-[11px] uppercase tracking-widest font-bold" style={{ color: accent }}>
          {title}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {hardest > 0 && <DifficultyBadge score={personalDifficulty(hardest, profile)} />}
          <button onClick={play}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
            style={playing
              ? { background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)' }
              : { background: accent, color: 'var(--color-surface-base)' }}>
            <span className="leading-none">{playing ? '■' : '▶'}</span>
            {playing ? 'Stop' : 'Play'}
          </button>
        </div>
      </div>

      {note && <div className="text-[10px] mb-2" style={{ color: 'var(--color-ink-ghost)' }}>{note}</div>}

      {/* Chord-name header row above the staff, aligned to each column. */}
      <div className="overflow-x-auto">
        <div className="inline-block font-mono text-[13px] leading-snug whitespace-pre">
          <div className="flex items-center mb-0.5">
            <span style={{ color: 'transparent' }}>e|</span>
            {columns.map((c, ci) => {
              const width = Math.max(1, ...c.tab.split('').filter(ch => ch !== 'x').map(ch => String(parseInt(ch, 10)).length));
              return (
                <span key={ci} className="flex items-center">
                  <span style={{ color: 'transparent' }}>-</span>
                  <span className="text-[10px] font-bold"
                    style={{ color: ci === activeCol ? 'var(--color-brand)' : accent, minWidth: `${width + 1}ch`, display: 'inline-block' }}>
                    {c.chordName}
                  </span>
                </span>
              );
            })}
          </div>
          {LABELS.map((label, r) => {
            const stringIdx = 5 - r;
            return (
              <div key={r} className="flex items-center">
                <span style={{ color: 'var(--color-ink-ghost)' }}>{label}|</span>
                {columns.map((c, ci) => {
                  const frets = c.tab.split('').map(ch => (ch === 'x' ? null : parseInt(ch, 10)));
                  const nameW = c.chordName.length;
                  const fretW = Math.max(1, ...frets.filter(f => f != null).map(f => String(f).length));
                  const width = Math.max(fretW, nameW - 1); // keep columns as wide as their chord name
                  const f = frets[stringIdx];
                  const lit = ci === activeCol;
                  return (
                    <span key={ci} className="flex items-center">
                      <span style={{ color: 'var(--color-ink-ghost)' }}>-</span>
                      {f != null ? (
                        <span
                          tabIndex={0}
                          onMouseEnter={(e) => showTip(e, c)}
                          onMouseLeave={() => setTip(null)}
                          onFocus={(e) => showTip(e, c)}
                          onBlur={() => setTip(null)}
                          className="font-bold rounded cursor-help outline-none"
                          style={{
                            color: lit ? 'var(--color-surface-base)' : accent,
                            background: lit ? accent : 'transparent',
                          }}
                        >{String(f).padStart(width, ' ')}</span>
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
 * The song's auto-generated tab, with a "Simplify the whole song" toggle that
 * reveals the simplified version beside the original.
 * @param {{ song:object, bpm?:number }} props
 */
export default function SongAutoTab({ song }) {
  const profile = useHandProfile();
  const [simplified, setSimplified] = useState(false);

  const original = useMemo(() => buildAutoTab(song), [song]);
  const simple = useMemo(
    () => (simplified ? buildSimplifiedAutoTab(song, profile) : null),
    [song, profile, simplified],
  );

  if (!original.columns.length) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--color-ink-faint)' }}>
          ♪ Auto tab — the whole song
        </span>
        <button
          onClick={() => setSimplified(v => !v)}
          className="text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all"
          style={simplified
            ? { background: 'rgba(74,222,128,0.15)', color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.35)' }
            : { background: 'var(--color-surface-700)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}
          title="Rewrite every chord as the easiest shape for your hand and show it beside the original"
        >
          {simplified ? '✓ Simplified — hide' : '✨ Simplify all'}
        </button>
      </div>

      <div className={`flex gap-3 ${simplified ? 'flex-col lg:flex-row' : ''}`}>
        <TabStaff
          title="Original"
          columns={original.columns}
          hardest={original.hardest}
          profile={profile}
          accent="var(--color-info)"
        />
        {simplified && simple && (
          <TabStaff
            title={simple.changedCount ? `Simplified — ${simple.changedCount} chord${simple.changedCount > 1 ? 's' : ''} eased` : 'Simplified — already easy'}
            columns={simple.columns}
            hardest={simple.hardest}
            profile={profile}
            accent="var(--color-success)"
            note={simple.changedCount
              ? simple.changes.slice(0, 8).map(c => `${c.from}→${c.to}`).join('  ')
              : 'Every chord was already a low-reach shape for your hand.'}
          />
        )}
      </div>
    </div>
  );
}

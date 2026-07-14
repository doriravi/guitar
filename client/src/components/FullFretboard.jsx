import { useCallback, useMemo } from 'react';
import {
  Fretboard, OPEN_MIDI, OPEN_HZ, NOTE_NAMES, STRING_COLORS, pluck,
} from './GuitarStrings';

// A full guitar neck that lights up EVERY position of a chord's notes across all
// strings and frets (all octaves) — the "where else can I play these notes" view.
// Reuses the rich <Fretboard> neck from GuitarStrings via its dotStyle(s,f) API;
// we just decide which cells are lit and how, from the hovered chord's pitch
// classes. Click any lit dot to hear that note.

const NAME_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

// The root pitch class from a chord name ("Cmaj7" → C, "Bb7" → Bb). Null if the
// name doesn't start with a note letter (then no dot is treated as the root).
function rootPcOf(name) {
  const m = (name || '').match(/^([A-G][#b]?)/);
  return m ? (NAME_TO_PC[m[1]] ?? null) : null;
}

export default function FullFretboard({ chord }) {
  // Target pitch classes: every note the chord's fretted shape plays, reduced to
  // pitch classes so all octaves across the neck light up (not just the shape).
  const { pcs, rootPc, name, noteNames } = useMemo(() => {
    const notes = chord?.notes || [];
    const set = new Set(notes.map(n => (OPEN_MIDI[n.string] + n.fret) % 12));
    const rpc = rootPcOf(chord?.name);
    // Order the note names root-first for the legend.
    const ordered = [...set].sort((a, b) => a - b);
    if (rpc != null && set.has(rpc)) ordered.sort((a, b) => ((a - rpc + 12) % 12) - ((b - rpc + 12) % 12));
    return { pcs: set, rootPc: rpc, name: chord?.name || '', noteNames: ordered.map(pc => NOTE_NAMES[pc]) };
  }, [chord]);

  const dotStyle = useCallback((s, f) => {
    const pc = (OPEN_MIDI[s] + f) % 12;
    if (!pcs.has(pc)) return null;
    const isRoot = pc === rootPc;
    return {
      bg: isRoot ? '#c9a96e' : `${STRING_COLORS[s]}33`,
      color: isRoot ? '#0f0f0f' : STRING_COLORS[s],
      glow: isRoot ? '0 0 14px #c9a96e88' : 'none',
      label: NOTE_NAMES[pc],
    };
  }, [pcs, rootPc]);

  const handleFret = useCallback((s, f) => {
    const pc = (OPEN_MIDI[s] + f) % 12;
    if (pcs.has(pc)) pluck(OPEN_HZ[s] * 2 ** (f / 12));
  }, [pcs]);

  const handleOpen = useCallback((s) => {
    const pc = OPEN_MIDI[s] % 12;
    if (pcs.has(pc)) pluck(OPEN_HZ[s], 2.6);
  }, [pcs]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs font-bold text-brand">
          {name ? `${name} — everywhere on the neck` : 'Hover a chord to see all its notes'}
          {name && noteNames.length > 0 && (
            <span className="ml-2 font-mono font-normal text-ink-faint">{noteNames.join(' · ')}</span>
          )}
        </p>
        <span className="text-[11px] flex items-center gap-1.5 text-ink-ghost">
          <span className="w-3 h-3 rounded-full inline-block bg-brand" /> root
        </span>
      </div>
      <Fretboard dotStyle={dotStyle} onFretClick={handleFret} onOpenClick={handleOpen} />
    </div>
  );
}

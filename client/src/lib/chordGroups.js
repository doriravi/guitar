// chordGroups.js
// ==============
// The target-chord grouping used by the mic Practice mode (ChordListener) and
// the camera×mic Verified Practice view, lifted here so both render the IDENTICAL
// difficulty-filtered chord list from one source (pure data + helper, no React).
//
// CHORDS_WITH_SCORE decorates every library chord with its population-average
// reach difficulty (calcDifficulty), so the maxDiff slider can gate the picker.

import { CHORDS } from './chords';
import { calcDifficulty } from './fretboard';

export const CHORD_GROUPS = [
  { label: 'Open Major',  types: ['Major', 'Major (easy)'] },
  { label: 'Open Minor',  types: ['Minor'] },
  { label: 'Dom 7',       types: ['Dom 7'] },
  { label: 'Minor 7',     types: ['Minor 7', 'Minor 7 (barre)'] },
  { label: 'Major 7',     types: ['Maj 7'] },
  { label: 'Barre',       types: ['Major (barre)', 'Minor (barre)'] },
  { label: 'Power',       types: ['Power'] },
  { label: 'Other',       types: [] },
];

export const CHORDS_WITH_SCORE = CHORDS.map((c) => ({ ...c, score: calcDifficulty(c.notes) }));

// Group the scored chords by family, keeping only those at or below `maxDiff`.
// The "Other" bucket collects any chord whose type isn't in a named group.
export function groupedChords(maxDiff) {
  const known = new Set(CHORD_GROUPS.flatMap((g) => g.types));
  return CHORD_GROUPS.map((g) => ({
    ...g,
    chords: (g.label === 'Other'
      ? CHORDS_WITH_SCORE.filter((c) => !known.has(c.type))
      : CHORDS_WITH_SCORE.filter((c) => g.types.includes(c.type))
    ).filter((c) => c.score <= maxDiff),
  })).filter((g) => g.chords.length > 0);
}

// Shared per-cell chord timeline resolution — the single source of truth for
// "which chords does this song play, in order".
//
// Extracted verbatim from SongEditor's buildTimeline so the Song Editor and the
// Play-Along practice game resolve EXACTLY the same chord sequence for a song
// (custom/catalog lyricLines first; built-in degree songs with the full
// chords/qualities/lineChords/enrichment fallback chain).

import { getDiatonicChords } from './scales';
import { enrichChords } from './lyricChords';
import { lookupVoicings } from './voicingLookup';

// Build the flat per-cell chord timeline for a song (one entry per chord beat-
// cell, NOT deduplicated). Mirrors ProgressionExplorer's chord resolution so
// every consumer sees the same chords the song shows.
export function resolveChordCells(song) {
  // Custom (saved) song: source of truth is its lyricLines, in order.
  if (song.lyricLines && song.lyricLines.length) {
    const seq = [];
    for (const ln of song.lyricLines) {
      for (const name of (ln.chordNames || [])) {
        const voicings = lookupVoicings(name).slice().sort((a, b) => a.score - b.score);
        seq.push({ chordName: name, voicings, degree: null, roman: null });
      }
    }
    if (seq.length) return seq;
  }

  if (!song.degrees || !song.degrees.length) return [];
  const diatonic = getDiatonicChords(song.key, song.scaleType);
  const baseNames = song.degrees.map(d => diatonic[d].chordName);

  let finalNames;
  if (song.chords && song.chords.length) {
    finalNames = song.degrees.map((_, i) => song.chords[i] || baseNames[i]);
  } else if (song.qualities) {
    finalNames = baseNames.map((base, i) => {
      const quality = song.qualities[i] || '';
      if (!quality) return base;
      const m = base.match(/^([A-G][#b]?)(.*)$/);
      const root = m ? m[1] : base;
      const triadSuffix = m ? m[2] : '';
      return /^(m|dim|aug|sus|maj|add|°)/.test(quality) ? root + quality : root + triadSuffix + quality;
    });
  } else if (song.lineChords || song.exact) {
    finalNames = baseNames;
  } else {
    finalNames = enrichChords(song.degrees, baseNames, song.scaleType);
  }

  return song.degrees.map((d, i) => {
    const chordName = finalNames[i];
    const voicings = lookupVoicings(chordName).slice().sort((a, b) => a.score - b.score);
    const dia = diatonic[d];
    return { chordName, voicings, degree: d, roman: dia?.roman ?? null };
  });
}

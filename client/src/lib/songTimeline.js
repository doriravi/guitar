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

/**
 * Split a lyric line into `count` fragments, one per chord change on the line,
 * so each chord can display the words sung while it sounds.
 *  • With `positions` (character offsets of each chord in the text — from the
 *    catalog/ChordPro inline markers), slice the text at those offsets: fragment
 *    k is text[positions[k] .. positions[k+1]).
 *  • Without positions, distribute the line's words as evenly as possible across
 *    the chords.
 * Returns an array of `count` strings (trimmed); empty strings are fine.
 */
export function lyricFragments(text, count, positions) {
  if (count <= 0) return [];
  const t = (text || '').trim();
  if (!t) return Array(count).fill('');
  if (count === 1) return [t];

  if (Array.isArray(positions) && positions.length === count) {
    const frags = [];
    for (let k = 0; k < count; k++) {
      const start = Math.max(0, Math.min(text.length, positions[k]));
      const end = k + 1 < count ? Math.max(start, Math.min(text.length, positions[k + 1])) : text.length;
      frags.push(text.slice(start, end).trim());
    }
    // If the first chord starts after some lead-in words, glue them onto it so
    // no lyric is dropped.
    const leadEnd = Math.max(0, Math.min(text.length, positions[0]));
    if (leadEnd > 0) {
      const lead = text.slice(0, leadEnd).trim();
      if (lead) frags[0] = (lead + ' ' + frags[0]).trim();
    }
    return frags;
  }

  // Even word split.
  const words = t.split(/\s+/);
  const frags = Array(count).fill('');
  const per = words.length / count;
  for (let i = 0; i < words.length; i++) {
    const k = Math.min(count - 1, Math.floor(i / per));
    frags[k] = frags[k] ? `${frags[k]} ${words[i]}` : words[i];
  }
  return frags;
}

// Build the flat per-cell chord timeline for a song (one entry per chord beat-
// cell, NOT deduplicated). Mirrors ProgressionExplorer's chord resolution so
// every consumer sees the same chords the song shows.
export function resolveChordCells(song) {
  // Custom (saved) song: source of truth is its lyricLines, in order.
  if (song.lyricLines && song.lyricLines.length) {
    const seq = [];
    for (const ln of song.lyricLines) {
      const names = ln.chordNames || [];
      // Split the line's lyric across its chords so each chord cell carries the
      // words sung under it (for the Play-Along synced-lyrics display). Prefer
      // exact chord character positions when the source has them (catalog/
      // ChordPro); otherwise fall back to an even word split.
      const frags = lyricFragments(ln.text || '', names.length, ln.chordPositions);
      names.forEach((name, k) => {
        const voicings = lookupVoicings(name).slice().sort((a, b) => a.score - b.score);
        seq.push({ chordName: name, voicings, degree: null, roman: null, lyric: frags[k] || '' });
      });
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

  // The full per-cell sequence. `lineChords` is the song's REAL structure —
  // indices into `degrees` giving the actual chord order across every line — so
  // expand it when present; otherwise fall back to one cell per unique degree.
  // (Mirrors composerLibrary's songChordNames; without this, consumers that walk
  // cells — the Song Editor, the Play-Along game, the Progression Play button —
  // only see each unique chord once instead of the whole song.)
  const cellFor = (d, i) => {
    const chordName = finalNames[i];
    const voicings = lookupVoicings(chordName).slice().sort((a, b) => a.score - b.score);
    const dia = diatonic[d];
    return { chordName, voicings, degree: d, roman: dia?.roman ?? null };
  };
  if (song.lineChords && song.lineChords.length) {
    return song.lineChords
      .map(i => (i >= 0 && i < song.degrees.length ? cellFor(song.degrees[i], i) : null))
      .filter(Boolean);
  }
  return song.degrees.map((d, i) => cellFor(d, i));
}

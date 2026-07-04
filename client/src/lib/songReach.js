// Whole-song reach filtering.
//
// When the user turns on "limit to my reach & flexibility" (Account settings),
// a song should only appear anywhere in the app if they can comfortably play
// EVERY chord in it — not just the headline progression. A single unreachable
// chord anywhere in the song hides the whole song.
//
// This is the single source of truth for that decision so the Progressions list,
// its counts, and any other song lists all agree.

import { getDiatonicChords } from './scales';
import { enrichChords } from './lyricChords';
import { lookupVoicings } from './voicingLookup';
import { isWithinReach } from './handProfile';

// Every distinct chord NAME a song uses, across its entire content — not just the
// matched progression. Mirrors how SongRow resolves a song's chords so the reach
// check sees exactly what will be shown/played:
//   • custom / catalog songs: the real per-line chord names (lyricLines) plus the
//     unique `chords` list.
//   • built-in degree songs: the diatonic chords for the key, with the same
//     quality / chords / enrichment resolution the view uses.
export function songAllChordNames(song) {
  const names = new Set();

  // Real chord names carried on the song (custom + catalog, and any built-in that
  // has them). lyricLines hold the true per-occurrence chords.
  if (Array.isArray(song.lyricLines)) {
    for (const ln of song.lyricLines) {
      for (const n of (ln.chordNames || [])) if (n) names.add(n);
    }
  }
  if (Array.isArray(song.chords)) {
    for (const n of song.chords) if (n) names.add(n);
  }
  if (names.size) return [...names];

  // Built-in degree song → resolve degrees to chord names in the song's key,
  // applying the same quality / enrichment rules the SongRow view applies.
  if (Array.isArray(song.degrees) && song.degrees.length) {
    const diatonic = getDiatonicChords(song.key, song.scaleType);
    const baseNames = song.degrees.map(d => diatonic[d]?.chordName).filter(Boolean);
    let finalNames;
    if (song.qualities) {
      finalNames = baseNames.map((base, i) => {
        const quality = song.qualities[i] || '';
        if (!quality) return base;
        const m = base.match(/^([A-G][#b]?)(.*)$/);
        const root = m ? m[1] : base;
        const triadSuffix = m ? m[2] : '';
        return /^(m|dim|aug|sus|maj|add|°)/.test(quality) ? root + quality : root + triadSuffix + quality;
      });
    } else if (song.lineChords || song.exact) {
      finalNames = baseNames;                       // plain triads, as given
    } else {
      finalNames = enrichChords(song.degrees, baseNames, song.scaleType);
    }
    for (const n of finalNames) if (n) names.add(n);
  }

  return [...names];
}

// Is a single chord name playable within this hand's comfortable reach? True when
// the chord has at least ONE catalogued voicing that is in reach. A chord with no
// shape on file (lookupVoicings → []) is treated as reachable so an unrelated
// data gap never hides a song (the CLAUDE.md "every chord stays playable" spirit).
export function chordWithinReach(chordName, profile) {
  const voicings = lookupVoicings(chordName);
  if (!voicings.length) return true;
  return voicings.some(v => isWithinReach(v.score, profile));
}

// Can the WHOLE song be comfortably played by this hand? Every chord it uses must
// have an in-reach voicing.
export function songWithinReach(song, profile) {
  return songAllChordNames(song).every(name => chordWithinReach(name, profile));
}

// Filter a song list to only those fully within reach when `limitToReach` is on;
// otherwise return the list unchanged.
export function filterSongsByReach(songs, profile, limitToReach) {
  if (!limitToReach || !profile) return songs;
  return songs.filter(song => songWithinReach(song, profile));
}

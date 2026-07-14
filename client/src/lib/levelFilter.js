// Whole-app "limit by my level" filtering.
//
// When the user turns on "Limit everything by my level" (Account settings), any
// chord — and any song containing such a chord — that is HARDER than the player's
// current Level-Plan tier allows is hidden across the app. A single above-level
// chord anywhere in a song hides the whole song (same all-or-nothing rule as the
// reach filter in songReach.js).
//
// This mirrors songReach.js but gates on the tier difficulty CEILING
// (levelPlan.js LEVEL_CEILINGS) instead of the hand's physical reach — so a
// Beginner sees only easy chords regardless of hand size, matching the Level Plan.

import { lookupVoicings } from './voicingLookup';
import { songAllChordNames } from './songReach';

// Is a single chord playable at or below the level ceiling? True when the chord
// has at least ONE catalogued voicing whose raw difficulty (voicing.score, the
// population-average calcDifficulty) is within the ceiling. A chord with no shape
// on file (lookupVoicings → []) is treated as allowed, so a data gap never hides
// content (the CLAUDE.md "every chord stays playable" spirit).
export function chordWithinLevel(chordName, ceiling) {
  const voicings = lookupVoicings(chordName);
  if (!voicings.length) return true;
  return voicings.some(v => v.score <= ceiling);
}

// Can the WHOLE song be played at this level? Every chord it uses must have a
// voicing at or below the ceiling.
export function songWithinLevel(song, ceiling) {
  return songAllChordNames(song).every(name => chordWithinLevel(name, ceiling));
}

// Filter a song list to only those fully within level when the limit is on;
// otherwise return the list unchanged. `ceiling` is the tier's max difficulty
// (from levelPlan.currentLevelCeiling); pass a falsy `limitToLevel` to no-op.
export function filterSongsByLevel(songs, ceiling, limitToLevel) {
  if (!limitToLevel || !(ceiling < 10)) return songs;   // ceiling 10 = no limit
  return songs.filter(song => songWithinLevel(song, ceiling));
}

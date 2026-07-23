// Stage → song matching. Given a Level Plan stage's chord set (e.g. the
// open-chord milestone's C A G E D), decide which songs a player who knows ONLY
// those chords can already play. Pure data logic (no React) so the Play-Along
// song list, the Level Plan and any future song list agree on the same rule.
//
// A song FITS a stage when every distinct chord it uses is in the stage set —
// i.e. the song needs part or all of the stage's chords and nothing else.
// A song is an ALMOST-fit when exactly one of its chords falls outside the set:
// worth surfacing to a beginner as "this song + 1 new chord", but never silently
// mixed in with the true fits (callers label it with the missing chord).

import { songAllChordNames } from './songReach';

/**
 * How a chord list relates to a stage chord set. Names match exactly (the app
 * resolves enharmonics at voicing-lookup time, not here).
 * @param {string[]} chordNames distinct chords a song uses (songAllChordNames)
 * @param {string[]} stageChords the stage's chord set
 * @returns {{ missing: string[], playable: boolean, almost: boolean }}
 *   missing = the song's chords NOT covered by the stage set.
 */
export function stageFit(chordNames, stageChords) {
  const set = new Set(stageChords || []);
  const missing = (chordNames || []).filter((n) => !set.has(n));
  return { missing, playable: missing.length === 0, almost: missing.length === 1 };
}

/** stageFit for a whole song object (resolves its chord names first). */
export function songStageFit(song, stageChords) {
  return stageFit(songAllChordNames(song), stageChords);
}

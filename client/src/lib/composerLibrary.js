// Bridge from the song library (the Progression tab's built-in songs plus the
// user's custom songs) to the Composer's beat format, so every song in the
// system can be loaded into the step editor.
//
// A composer song is { name, bpm, loop, capo, beats:[{ frets, chordLabel }] }
// where frets is the 6-slot [lowE..highE] array (null = muted string) — the
// same shape SongManager saves to localStorage.

import { SONGS_BY_PROGRESSION, songBpm } from './songs';
import { loadCustomSongs } from './customSongs';
import { getDiatonicChords } from './scales';
import { enrichChords } from './lyricChords';
import { easiestVoicing, lookupVoicings } from './voicingLookup';
import { CHORDS } from './chords';

function tabToFrets(tab) {
  return tab.split('').map(c => (c === 'x' ? null : parseInt(c, 10)));
}

// Final chord-name sequence for a song, resolved the same way the Progression
// tab does (see ProgressionExplorer's songChordsWithVoicings): explicit
// `chords` win, then `qualities` on diatonic triads, then plain triads when
// the song carries its own sequence (`lineChords`/`exact`), else idiomatic
// enrichment. Custom songs use their lyricLines verbatim.
function songChordNames(song) {
  if (song.lyricLines?.length) {
    const names = song.lyricLines.flatMap(ln => ln.chordNames || []);
    if (names.length) return names;
  }
  if (!song.degrees?.length || !song.key) return [];

  const diatonic = getDiatonicChords(song.key, song.scaleType);
  const baseNames = song.degrees.map(d => diatonic[d]?.chordName).filter(Boolean);
  if (baseNames.length !== song.degrees.length) return baseNames;

  let finalNames;
  if (song.chords?.length) {
    finalNames = song.degrees.map((_, i) => song.chords[i] || baseNames[i]);
  } else if (song.qualities) {
    finalNames = baseNames.map((base, i) => {
      const quality = song.qualities[i] || '';
      if (!quality) return base;
      const m = base.match(/^([A-G][#b]?)(.*)$/);
      const root = m ? m[1] : base;
      const triadSuffix = m ? m[2] : '';
      return /^(m|dim|aug|sus|maj|add|°)/.test(quality)
        ? root + quality
        : root + triadSuffix + quality;
    });
  } else if (song.lineChords || song.exact) {
    finalNames = baseNames;
  } else {
    finalNames = enrichChords(song.degrees, baseNames, song.scaleType);
  }

  // lineChords is the actual per-line sequence (indices into degrees) — expand
  // it so the composer plays the song's real structure, not just the loop.
  return song.lineChords
    ? song.lineChords.map(i => finalNames[i]).filter(Boolean)
    : finalNames;
}

/**
 * Convert a library song into a loadable composer song: one beat per chord,
 * using the easiest catalogued voicing of each. Returns null when none of the
 * song's chords are in the voicing library.
 */
export function songToComposerSong(song) {
  const beats = [];
  for (const name of songChordNames(song)) {
    const v = easiestVoicing(name);
    if (!v) continue;
    beats.push({ frets: tabToFrets(v.tab), chordLabel: `${v.name} ${v.type}` });
  }
  if (!beats.length) return null;
  return {
    name: song.artist ? `${song.title} — ${song.artist}` : song.title,
    bpm: song.bpm ?? songBpm(song.title) ?? 90,
    loop: false,
    capo: 0,
    key: song.key ?? null,               // ASCII root, e.g. 'Bb'
    scaleType: song.scaleType ?? 'major',
    progression: song.progression ?? null, // progression-tab name, e.g. 'I – IV – V'
    beats,
  };
}

// ── Composer → Play-Along bridge ─────────────────────────────────────────────
// The Composer tab's SongManager saves the user's own step-editor compositions
// under this key as { name, bpm, loop, capo, key?, beats:[{ frets, chordLabel }] }.
const COMPOSER_SONGS_KEY = 'guitar_songs';

/** Raw composer songs saved from the Composer tab. */
export function loadComposerSongs() {
  try { return JSON.parse(localStorage.getItem(COMPOSER_SONGS_KEY)) || []; } catch { return []; }
}

// Reverse index: exact tab string → chord name, for identifying hand-placed
// beats that carry frets but no chordLabel. Built lazily from the library.
let _tabToName = null;
function nameForTab(tab) {
  if (!_tabToName) {
    _tabToName = new Map();
    for (const c of CHORDS) if (!_tabToName.has(c.tab)) _tabToName.set(c.tab, c.name);
  }
  return _tabToName.get(tab) || null;
}

function fretsToTab(frets) {
  if (!Array.isArray(frets) || frets.length !== 6) return null;
  if (frets.some(f => typeof f === 'number' && f > 9)) return null; // beyond 1-char tab convention
  return frets.map(f => (f == null ? 'x' : String(f))).join('');
}

/**
 * Convert a composer song to the lyric-song shape the Play-Along game (and
 * anything else that walks lyricLines) understands. Beats keep their order;
 * a beat becomes a chord when its chordLabel's name resolves in the voicing
 * library (labels look like "Am minor" — the name is the first token), or —
 * for hand-placed beats with no label — when its exact frets match a library
 * voicing. Returns null when fewer than 4 beats resolve — not enough to
 * score a run.
 */
export function composerSongToLyricSong(cs) {
  const names = [];
  for (const b of cs.beats || []) {
    const labeled = (b.chordLabel || '').split(' ')[0];
    if (labeled && lookupVoicings(labeled).length) { names.push(labeled); continue; }
    const matched = nameForTab(fretsToTab(b.frets));
    if (matched) names.push(matched);
  }
  if (names.length < 4) return null;
  return {
    title: cs.name || 'Untitled',
    artist: 'Composer',
    bpm: cs.bpm ?? 90,
    key: cs.key ?? null,
    lyricLines: [{ text: '', chordNames: names }],
    composer: true,
  };
}

/**
 * Every song in the system: the user's custom songs first, then the built-in
 * progression-tab songs (deduped — a song listed under several progressions
 * keeps the entry that knows its real per-line sequence).
 */
export function allLibrarySongs() {
  const seen = new Map();
  for (const [progName, list] of Object.entries(SONGS_BY_PROGRESSION)) {
    for (const s of list) {
      const key = `${s.title}|${s.artist}`.toLowerCase();
      const prev = seen.get(key);
      if (!prev || (s.lineChords && !prev.lineChords)) seen.set(key, { ...s, progression: progName });
    }
  }
  const builtIn = [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
  const custom = loadCustomSongs().map(s => ({ ...s, custom: true }));
  return [...custom, ...builtIn];
}

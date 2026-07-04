// The DB-backed song catalog (catalog_songs table) — every built-in song
// regenerated from a REAL chord sheet by the generate-music-data pipeline:
// actual arranger's chords + full lyrics as ChordPro, plus key/bpm/style.
//
// This module fetches the catalog once, converts each row's ChordPro into the
// app's song shape (the same shape parseChordSheet produces, so SongRow /
// LyricsSection render it exactly like a pasted song), and caches the result
// in localStorage so the catalog still shows offline. When the backend is
// unreachable and no cache exists, callers fall back to the static songs.js.

import { catalog as catalogApi } from './api';
import { looksLikeChordName } from './voicingLookup';

const CACHE_KEY = 'guitar_catalog_songs_v1';

const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

// "Em" / "E Minor" / "Bb" → { key: 'E', scaleType: 'minor' }
function parseKey(str) {
  const m = (str || '').trim().match(/^([A-G][#b]?)\s*(minor|min|m)?\b/i);
  if (!m) return { key: 'C', scaleType: 'major' };
  return { key: m[1], scaleType: m[2] ? 'minor' : 'major' };
}

function degreeOf(chordName, keyRoot, scaleType) {
  const r = (chordName || '').match(/^([A-G][#b]?)/)?.[1];
  if (r == null || NOTE_TO_PC[r] == null || NOTE_TO_PC[keyRoot] == null) return null;
  const interval = (NOTE_TO_PC[r] - NOTE_TO_PC[keyRoot] + 12) % 12;
  const idx = (scaleType === 'minor' ? MINOR_STEPS : MAJOR_STEPS).indexOf(interval);
  return idx === -1 ? null : idx;
}

// Convert one catalog row's ChordPro sheet into the app's song shape.
export function chordproToSong(row) {
  const lines = (row.chordpro || '').replace(/\r/g, '').split('\n');
  let key = row.songKey || 'C';
  let bpm = row.bpm ?? undefined;
  const lyricLines = [];

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      if (lyricLines.length && !(lyricLines[lyricLines.length - 1].blankish)) {
        lyricLines.push({ text: '', chordNames: [], blankish: true });
      }
      continue;
    }
    const dir = t.match(/^\{\s*([a-z_]+)\s*:\s*(.+?)\s*\}$/i);
    if (dir) {
      const [, name, value] = dir;
      if (/^key$/i.test(name)) key = value;
      else if (/^tempo$/i.test(name)) bpm = parseInt(value, 10) || bpm;
      else if (/^comment$/i.test(name) && !/^Fetched via/i.test(value)) {
        // Section label ({comment: Verse 1}) → a blank separator keeps the
        // sections visually apart without leaking labels into the lyrics.
        if (lyricLines.length) lyricLines.push({ text: '', chordNames: [], blankish: true });
      }
      continue; // all other directives (title/artist/…) come from the DB row
    }
    const chordNames = [];
    const text = raw
      .replace(/\[([^\]]+)\]/g, (_, c) => {
        // Only chord-shaped tokens count; leaked section markers ("[Intro]",
        // "[Final]", "[Chorus]") are sheet noise — removed from the text and
        // never treated as chords (looksLikeChordName rejects them).
        const tok = c.trim();
        if (looksLikeChordName(tok)) chordNames.push(tok);
        return '';
      })
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!text && !chordNames.length) continue;
    lyricLines.push({ text, chordNames });
  }
  // Strip helper flags + trailing blank
  while (lyricLines.length && lyricLines[lyricLines.length - 1].blankish) lyricLines.pop();
  const cleaned = lyricLines.map(({ text, chordNames }) => ({ text, chordNames }));

  const { key: root, scaleType } = parseKey(key);
  const chords = [...new Set(cleaned.flatMap(ln => ln.chordNames))];
  const degrees = [];
  const seen = new Set();
  for (const c of chords) {
    const d = degreeOf(c, root, scaleType);
    if (d != null && !seen.has(d)) { seen.add(d); degrees.push(d); }
  }

  return {
    title: row.title,
    artist: row.artist,
    key: root,
    scaleType,
    bpm,
    style: row.style || undefined,
    chords,
    degrees,
    lyricLines: cleaned,
    sourceUrl: row.sourceUrl || undefined,
    catalog: true,   // marks "real sheet from the DB catalog" (not user-saved)
  };
}

// Fetch + convert the whole catalog. Resolves to [] when the backend is down
// and nothing is cached — callers then fall back to the static songs.js list.
export async function loadCatalogSongs() {
  try {
    const rows = await catalogApi.list();
    const songs = (rows || []).filter(r => r.chordpro).map(chordproToSong);
    if (songs.length) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(songs)); } catch { /* quota — cache is best-effort */ }
      return songs;
    }
  } catch { /* backend down → try the cache below */ }
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch { return []; }
}

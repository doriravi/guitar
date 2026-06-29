// Persistence for user-pasted ("custom") songs, stored in the browser only
// (localStorage) — no backend. Each saved song is the structured object the
// chord-sheet parser produces (see chordSheetParser.js).

const KEY = 'guitar_custom_songs';

// Normalize a title for duplicate detection (case-insensitive, trimmed).
function titleKey(title) {
  return (title || '').trim().toLowerCase();
}

// Remove older songs that share a title, keeping the last occurrence (the most
// recently added/edited). Used to enforce unique song names.
function dedupeByTitle(songs) {
  const lastIndex = new Map();
  songs.forEach((s, i) => lastIndex.set(titleKey(s.title), i));
  return songs.filter((s, i) => lastIndex.get(titleKey(s.title)) === i);
}

export function loadCustomSongs() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const deduped = dedupeByTitle(arr);
    if (deduped.length !== arr.length) persist(deduped);
    return deduped;
  } catch { return []; }
}

function persist(songs) {
  try { localStorage.setItem(KEY, JSON.stringify(songs)); } catch {}
}

// Add a song; returns the new list. Each song gets a stable id.
export function addCustomSong(song) {
  const songs = loadCustomSongs();
  const withId = { ...song, id: song.id || `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
  // Drop any existing song with the same name; the new one replaces the older.
  const kept = songs.filter(s => titleKey(s.title) !== titleKey(withId.title));
  kept.push(withId);
  persist(kept);
  return kept;
}

// Replace an existing song (matched by id) with an edited version.
export function updateCustomSong(id, song) {
  const updated = loadCustomSongs().map(s => (s.id === id ? { ...song, id } : s));
  // If the edit renamed this song onto another's title, drop the older clashing
  // entries and keep the one just edited.
  const k = titleKey(song.title);
  const kept = updated.filter(s => s.id === id || titleKey(s.title) !== k);
  persist(kept);
  return kept;
}

export function deleteCustomSong(id) {
  const songs = loadCustomSongs().filter(s => s.id !== id);
  persist(songs);
  return songs;
}

// Rebuild an editable chord-sheet text from a stored song's lyric lines, so a
// saved song can be re-pasted/edited as text (chord line above each lyric line).
// Shared by the Import tab and the Progressions tab's inline editor.
export function songToText(song) {
  const head = `${song.title} Chords by ${song.artist}\nKey: ${song.key}${song.scaleType === 'minor' ? 'm' : ''}` +
    `${song.capo ? `\nCapo: ${song.capo}` : ''}${song.bpm ? `\n${song.bpm} bpm` : ''}\n\n`;
  const body = (song.lyricLines || []).map(ln => {
    const chord = (ln.chordNames || []).join('  ');
    return (chord ? chord + '\n' : '') + (ln.text || '');
  }).join('\n');
  return head + body;
}

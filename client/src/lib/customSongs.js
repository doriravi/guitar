// Persistence for user-pasted / editor-saved ("custom") songs.
//
// Storage model (offline-first, mirrors the hand-profile sync):
//   - localStorage is always the working cache, so saving works logged out.
//   - When logged in, saves are ALSO pushed to the DB (per-user, keyed by the
//     song's localStorage id = `clientId`), and on login the server's songs are
//     merged back into localStorage. See syncSongsOnLogin / saveCustomSong.
// Each saved song is the structured object the chord-sheet parser / editor
// produces (see chordSheetParser.js).

import { songs as songsApi } from './api';

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

// ─── DB-backed save + sync (per user) ────────────────────────────────────────

// Save a song to localStorage AND, when logged in, to the DB. `loggedIn` lets the
// caller (which knows the auth state) decide whether to push remotely. Returns the
// updated local list. The DB row is keyed by the song's id (clientId), so re-saving
// the same song updates the same row instead of duplicating.
export async function saveCustomSong(song, loggedIn) {
  const withId = { ...song, id: song.id || `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
  // Local upsert by id (fall back to title match for older entries without ids).
  const songs = loadCustomSongs();
  const kept = songs.filter(s =>
    s.id !== withId.id && titleKey(s.title) !== titleKey(withId.title));
  kept.push(withId);
  persist(kept);

  if (loggedIn) {
    try {
      const res = await songsApi.save({
        clientId: withId.id,
        title: withId.title || 'Untitled',
        artist: withId.artist || '',
        body: JSON.stringify(withId),
      });
      // Remember the server id so we can delete it later.
      if (res?.id != null) {
        const list = loadCustomSongs().map(s =>
          s.id === withId.id ? { ...s, serverId: res.id } : s);
        persist(list);
        return list;
      }
    } catch { /* offline / not authed → localStorage copy stands, syncs next login */ }
  }
  return loadCustomSongs();
}

// Delete locally and (when logged in) from the DB.
export async function removeCustomSong(id, loggedIn) {
  const song = loadCustomSongs().find(s => s.id === id);
  const remaining = deleteCustomSong(id);
  if (loggedIn && song?.serverId != null) {
    try { await songsApi.remove(song.serverId); } catch { /* best effort */ }
  }
  return remaining;
}

// On login: pull the user's DB songs and merge into localStorage, then push any
// local-only songs (saved while logged out) up to the DB. Server is the source of
// truth on conflicts (matched by clientId). Returns the merged local list.
export async function syncSongsOnLogin() {
  let remote;
  try { remote = await songsApi.list(); }
  catch { return loadCustomSongs(); } // server unreachable → keep local as-is

  const local = loadCustomSongs();
  const byId = new Map(local.map(s => [s.id, s]));

  // Adopt every server song into the local cache (server wins on conflict).
  for (const r of (remote || [])) {
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { /* skip corrupt body */ }
    if (!parsed) continue;
    byId.set(r.clientId, { ...parsed, id: r.clientId, serverId: r.id, custom: true });
  }
  let merged = dedupeByTitle([...byId.values()]);
  persist(merged);

  // Push local-only songs (no serverId, not present on the server) up.
  const remoteIds = new Set((remote || []).map(r => r.clientId));
  for (const s of merged) {
    if (s.serverId == null && !remoteIds.has(s.id)) {
      try {
        const res = await songsApi.save({
          clientId: s.id,
          title: s.title || 'Untitled',
          artist: s.artist || '',
          body: JSON.stringify(s),
        });
        if (res?.id != null) s.serverId = res.id;
      } catch { /* best effort; will retry next login */ }
    }
  }
  persist(merged);
  return merged;
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

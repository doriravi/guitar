// Focused tests for level persistence: reachedLevelForSong derives the highest
// level a song was played at from saved sessions, so the game can resume there.

import { describe, it, expect, beforeEach } from 'vitest';
import { saveSession, reachedLevelForSong } from './practiceGame';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
});

describe('reachedLevelForSong', () => {
  it('is 0 for a song never played', () => {
    expect(reachedLevelForSong('never')).toBe(0);
  });

  it('returns the highest level across a song’s saved sessions', () => {
    saveSession({ songKey: 'song-a', level: 3, completed: false });
    saveSession({ songKey: 'song-a', level: 7, completed: true });
    saveSession({ songKey: 'song-a', level: 5, completed: false });
    saveSession({ songKey: 'song-b', level: 12, completed: true });   // different song
    expect(reachedLevelForSong('song-a')).toBe(7);
    expect(reachedLevelForSong('song-b')).toBe(12);
  });

  it('ignores other songs’ levels', () => {
    saveSession({ songKey: 'x', level: 9, completed: true });
    expect(reachedLevelForSong('y')).toBe(0);
  });
});

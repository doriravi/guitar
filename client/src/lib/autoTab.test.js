import { describe, it, expect } from 'vitest';
import { buildAutoTab, buildSimplifiedAutoTab } from './autoTab';
import { DEFAULT_PROFILE } from './handProfile';

// A minimal custom (lyricLines) song: G - C - D over two lines.
const SONG = {
  title: 'Test', artist: 'X', key: 'G', scaleType: 'major', bpm: 100,
  lyricLines: [
    { text: 'line one', chordNames: ['G', 'C'] },
    { text: 'line two', chordNames: ['D', 'G'] },
  ],
};

describe('buildAutoTab', () => {
  it('emits one column per chord cell, in play order', () => {
    const { columns } = buildAutoTab(SONG);
    expect(columns.map(c => c.chordName)).toEqual(['G', 'C', 'D', 'G']);
  });

  it('each column has a 6-char EADGBe tab and fretted notes only', () => {
    const { columns } = buildAutoTab(SONG);
    for (const c of columns) {
      expect(c.tab).toHaveLength(6);
      expect(c.notes.every(n => n.fret > 0)).toBe(true);
    }
  });

  it('reports the hardest column score', () => {
    const { hardest } = buildAutoTab(SONG);
    expect(hardest).toBeGreaterThan(0);
  });
});

describe('buildSimplifiedAutoTab', () => {
  // A song with a chord a short hand finds hard (F barre) should simplify.
  const HARD = {
    title: 'Hard', artist: 'X', key: 'C', scaleType: 'major', bpm: 100,
    lyricLines: [{ text: 'x', chordNames: ['F', 'Bb'] }],
  };

  it('keeps the same number of chord columns', () => {
    const { columns } = buildSimplifiedAutoTab(SONG, DEFAULT_PROFILE);
    expect(columns).toHaveLength(4);
  });

  it('never scores harder than the original', () => {
    const orig = buildAutoTab(HARD);
    const simple = buildSimplifiedAutoTab(HARD, DEFAULT_PROFILE);
    expect(simple.hardest).toBeLessThanOrEqual(orig.hardest + 0.01);
  });

  it('lists the chords it changed', () => {
    const simple = buildSimplifiedAutoTab(HARD, DEFAULT_PROFILE);
    expect(Array.isArray(simple.changes)).toBe(true);
    expect(simple.changedCount).toBe(simple.changes.length);
  });
});

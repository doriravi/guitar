// Auto-tab — turn ANY song into a playable 6-line EADGBe tab, generated from the
// song's own chord timeline (no imported ASCII tab required).
//
// Every song in the Progressions tab resolves to an ordered run of chord cells
// via resolveChordCells(); this module renders each cell's easiest catalogued
// voicing as one strummed tab column, so the whole song reads as a real tab
// staff (high-e on top elsewhere; here we emit low→high app strings and let the
// view flip). It also produces a SIMPLIFIED variant — every chord swapped for
// the lowest-reach shape/substitute your hand can play — so the two can sit side
// by side.
//
// Pure JS: no React, no audio, no network. `buildSimplifiedAutoTab` powers the
// "Simplify all" toggle in the Progressions lyrics view (swaps each chord to its
// easiest shape in place); `buildAutoTab` is retained as the plain generator.

import { resolveChordCells } from './songTimeline';
import { easiestVoicing } from './voicingLookup';
import { buildMarkedSection, transformEasierVoicings } from './editorTransforms';
import { calcDifficulty } from './fretboard';

// A tab column = one struck chord: its name, its 6-char EADGBe tab, the fretted
// notes (for a hover diagram + reach score), and the lyric fragment sung under
// it (so the tab can align to the words when we want it to).
//   { chordName, tab, notes:[{string,fret}], score, lyric, kind:'chord'|'solo' }

// A solo cell already carries its own tab/notes; a chord cell resolves to its
// easiest voicing. Returns null when a chord has no shape on file (the caller
// skips it rather than drawing an empty column).
function cellToColumn(cell) {
  if (cell.kind === 'solo') {
    return {
      chordName: cell.chordName,
      tab: cell.tab,
      notes: (cell.notes || []).filter(n => n.fret > 0),
      score: cell.notes?.length > 1 ? calcDifficulty(cell.notes.filter(n => n.fret > 0)) : 0,
      lyric: '',
      kind: 'solo',
    };
  }
  const v = cell.voicings?.[0] || easiestVoicing(cell.chordName);
  if (!v) return null;
  return {
    chordName: cell.chordName,
    tab: v.tab,
    notes: (v.notes || []).filter(n => n.fret > 0),
    score: typeof v.score === 'number' ? v.score : calcDifficulty(v.notes || []),
    lyric: cell.lyric || '',
    kind: 'chord',
  };
}

/**
 * Build the auto-tab for a song: one column per chord cell, in play order.
 * @param {object} song  a song object (custom lyricLines, catalog, or built-in degrees)
 * @returns {{ columns:Array, hardest:number }}
 */
export function buildAutoTab(song) {
  const cells = resolveChordCells(song);
  const columns = cells.map(cellToColumn).filter(Boolean);
  const hardest = columns.reduce((m, c) => Math.max(m, c.score || 0), 0);
  return { columns, hardest };
}

/**
 * Build the SIMPLIFIED auto-tab: the same song with every chord reduced to the
 * lowest-reach voicing/substitute for the given hand profile. Reuses the Song
 * Editor's transformEasierVoicings so the simplification is identical to the
 * editor's "reduce reach" (same-root easier voicing first, then triad/power
 * substitute). Returns the simplified columns AND the per-chord change list so
 * the UI can show "Bmaj7 → Bm7", "F → Fmaj7", etc.
 *
 * @param {object} song
 * @param {object} profile  the active hand profile (personalizes what counts as easier)
 * @returns {{ columns:Array, hardest:number, changes:Array, changedCount:number }}
 */
export function buildSimplifiedAutoTab(song, profile) {
  const cells = resolveChordCells(song);
  // Only chord cells go through the reach transform; solo cells pass straight
  // through (a lead line isn't "simplified" as a chord).
  const timeline = cells.map(c => ({
    chordName: c.chordName,
    voicings: c.voicings || (easiestVoicing(c.chordName) ? [easiestVoicing(c.chordName)] : []),
    kind: c.kind,
    notes: c.notes,
    tab: c.tab,
    lyric: c.lyric || '',
  }));

  const columns = [];
  const changes = [];
  let hardest = 0;
  let changedCount = 0;

  for (let i = 0; i < timeline.length; i++) {
    const cell = cells[i];
    if (cell.kind === 'solo') {
      const col = cellToColumn(cell);
      if (col) { columns.push(col); hardest = Math.max(hardest, col.score || 0); }
      continue;
    }
    // Mark just this one chord and ask the editor for its easier version.
    const section = buildMarkedSection(timeline, i, i, {
      bpm: song.bpm || 100, key: song.key || 'C', scaleType: song.scaleType || 'major',
    });
    const result = transformEasierVoicings(section, profile, { allowQualityChange: true, minGain: 0.6 });
    const r = result.chords[0];
    const useVoicing = r?.changed && r.toVoicing ? r.toVoicing : (timeline[i].voicings[0] || null);
    if (!useVoicing) continue;
    const notes = (useVoicing.notes || []).filter(n => n.fret > 0);
    const score = typeof useVoicing.score === 'number' ? useVoicing.score : calcDifficulty(useVoicing.notes || []);
    const toName = r?.changed && r.toName ? r.toName : cell.chordName;
    columns.push({ chordName: toName, tab: useVoicing.tab, notes, score, lyric: cell.lyric || '', kind: 'chord' });
    hardest = Math.max(hardest, score || 0);
    if (r?.changed && toName !== cell.chordName) {
      changedCount++;
      changes.push({ from: cell.chordName, to: toName, saved: r.delta ?? 0 });
    }
  }

  return { columns, hardest, changes, changedCount };
}

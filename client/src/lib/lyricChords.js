// Chord-over-lyric alignment + capo suggestion.
//
// Replaces the naive "one chord per lyric line, cycling" placement with a model
// closer to how real chord sheets work (researched against ChordPro/OnSong/Ultimate
// Guitar conventions and music-theory phrasing):
//
//   • A lyric line is split into SUB-PHRASES at punctuation (, ; : . ! ? … —).
//     Each sub-phrase is a harmonic unit that gets a chord at its first word.
//   • Chords come from the song's progression, cycled across sub-phrases (not
//     reset every line) — so a 3-chord blues holds its I chord across several
//     short phrases instead of flipping chord every line.
//   • Cadence: a sub-phrase ending in . ! ? (or the last line) resolves to the
//     tonic (the progression's first/degree-0 chord) when one is available.
//   • Very short lines (few words, no punctuation) may carry the SAME chord as
//     the previous phrase, modelling a chord that spans multiple lyric lines.
//
// And, because hard keys (B♭/E♭/F…) produce barre chords a short-fingered player
// can't play, `suggestCapo` recommends a capo + open-shape restatement (e.g.
// "Capo 1 → play A/D/E" for a B♭/E♭/F song), the cleanest "easier" presentation.
// The capo choice itself now lives in ./capo.js (bestCapo) — a REACH-driven
// optimizer that minimises total calcDifficulty across the transposed shapes
// instead of the old root-counting heuristic. suggestCapo delegates to it and
// keeps its original {fret,map} return shape so existing callers don't break.

import { bestCapo, NOTE_TO_PC, PC_TO_SHARP, parseRoot, transposeDown } from './capo';

// Re-export the pitch-class helpers for back-compat: they used to be defined here
// and other modules may import them from lyricChords. There is now exactly ONE
// copy (in ./capo) — this just forwards it.
export { NOTE_TO_PC, PC_TO_SHARP, parseRoot, transposeDown };

/**
 * Suggest a capo so a hard-key song becomes easy open shapes.
 *
 * Delegates to the reach-driven optimizer (bestCapo): it tries capo frets 1–7,
 * transposes every chord DOWN by the capo amount (the shape you actually fret),
 * and picks the fret that minimises TOTAL reach difficulty across all shapes,
 * favouring open shapes; ties break to the lowest fret. Returns null when the
 * song has no barre-forcing chord or no capo actually helps.
 *
 * The return shape is unchanged — { fret, map } — so every existing caller
 * (ProgressionExplorer's banner + playback, editorTransforms, practiceReport…)
 * keeps working; the richer bestCapo result is available to callers that want it.
 *
 * @param {string[]} chordNames unique chord names used in the song
 * @param {object}   [profile]  the active hand profile; omit for population avg
 * @returns {null | { fret:number, map: Record<string,string> }}
 *          null when the song is already easy open (no capo benefit).
 */
export function suggestCapo(chordNames, profile) {
  const result = bestCapo(chordNames, profile);
  if (!result) return null;
  return { fret: result.fret, map: result.map };
}

// ─── Idiomatic chord enrichment ───────────────────────────────────────────────
// Turns the plain diatonic triads into the kinds of chords real arrangements
// commonly use, from GENERAL music-theory patterns (not any specific copyrighted
// arrangement): dominant 7ths on the V, all-7ths for a 3-chord blues, and a
// descending-bass slash chord on a I → V → vi move (the "G/B" walkdown).
//
// `degrees` are 0-based scale degrees (0=I … 6=vii). `names` are the matching
// diatonic chord names. Returns a new array of chord names, same length.

function rootOf(name) {
  const m = (name || '').match(/^([A-G][#b]?)/);
  return m ? m[1] : name;
}
// Note a given number of semitones above a root (sharp-spelled).
function noteAbove(root, semitones) {
  const pc = NOTE_TO_PC[root];
  if (pc == null) return null;
  return PC_TO_SHARP[(pc + semitones) % 12];
}

export function enrichChords(degrees, names, scaleType = 'major') {
  if (!degrees?.length) return names;
  const uniqueDeg = new Set(degrees);
  // A 3-chord major song using only I, IV, V → treat as a blues: all dominant 7ths.
  const isBluesTrio = scaleType === 'major'
    && [...uniqueDeg].every(d => d === 0 || d === 3 || d === 4)
    && uniqueDeg.has(0) && uniqueDeg.has(4);

  return names.map((name, i) => {
    const deg = degrees[i];
    const prev = degrees[i - 1];
    const next = degrees[i + 1];

    if (isBluesTrio) return rootOf(name) + '7'; // I7 / IV7 / V7

    // Descending bass: I → V → vi is classically voiced V/<third> (e.g. C → G/B → Am),
    // putting the 3rd of the V in the bass to walk down to vi.
    if (scaleType === 'major' && deg === 4 && prev === 0 && next === 5) {
      const bass = noteAbove(rootOf(name), 4); // major 3rd of the V chord
      if (bass) return `${name}/${bass}`;
    }

    // Dominant 7th on the V in general (very common cadential colour).
    if (scaleType === 'major' && deg === 4) return rootOf(name) + '7';

    return name; // leave everything else as the plain diatonic chord
  });
}

// Split a lyric line into sub-phrases at punctuation, keeping the terminal mark
// of each piece so we can read its cadence. Returns [{ text, endMark }].
function splitSubPhrases(line) {
  const parts = [];
  const re = /[^,;:.!?…—-]+([,;:.!?…—-]+)?/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const text = m[0].replace(/[,;:.!?…—-]+$/, '').trim();
    if (!text) continue;
    const marks = m[1] || '';
    const endMark = /[.!?]/.test(marks) ? 'resolve'   // authentic cadence → tonic
      : /…/.test(marks) ? 'open'                       // anticipation → no resolve
      : marks ? 'continue'                             // , ; : — → keep moving
      : 'none';
    parts.push({ text, endMark });
  }
  if (!parts.length && line.trim()) parts.push({ text: line.trim(), endMark: 'none' });
  return parts;
}

/**
 * Align a song's chords over its lyric lines.
 *
 * @param {string[]} rawLines  lyric lines (may contain blanks)
 * @param {Array<{chordName:string}>} chords  progression chords, in order;
 *        index 0 is treated as the tonic for cadence resolution.
 * @param {number[]} [lineChords]  optional per-line chord indices (into `chords`),
 *        applied cyclically to each NON-BLANK line. When provided, this overrides
 *        the inference so the song follows a known per-line chord pattern (one
 *        chord at the start of each line) instead of guessing.
 * @returns {Array<{ blank:true } | { blank:false, segments:Array<{ chordIndex:number, text:string }> }>}
 *          one entry per input line; non-blank lines carry 1+ chord segments.
 */
export function alignChordsToLyrics(rawLines, chords, lineChords) {
  const n = chords.length;
  if (!n) return rawLines.map(l => (l.trim() ? { blank: false, segments: [{ chordIndex: 0, text: l.trim() }] } : { blank: true }));

  // Per-line override: one chord per non-blank line, cycling the given pattern.
  if (lineChords && lineChords.length) {
    let k = 0;
    return rawLines.map(raw => {
      if (!raw.trim()) return { blank: true };
      const chordIndex = lineChords[k % lineChords.length] % n;
      k++;
      return { blank: false, segments: [{ chordIndex, text: raw.trim() }] };
    });
  }

  const lines = rawLines;
  const lastTextIdx = (() => { for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return i; return -1; })();

  const out = [];
  let cursor = 0; // walks through the progression, advancing ~once per line

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) { out.push({ blank: true }); continue; }

    const subs = splitSubPhrases(raw);
    const segments = [];
    const isLastLine = i === lastTextIdx;

    // Real chord sheets mostly change chord ONCE per line (≈ one bar), not at
    // every comma. So: place one chord at the line start (advancing the
    // progression), and only add a SECOND chord mid-line when the line is long
    // enough to plausibly span two bars AND has an internal phrase boundary.
    const firstChord = cursor % n;
    cursor++;
    segments.push({ chordIndex: firstChord, text: subs[0].text });

    // Merge the remaining sub-phrases of this line. Add at most one extra chord,
    // at the first internal boundary, if the line is long (multi-bar feel).
    const rest = subs.slice(1);
    if (rest.length) {
      const restText = rest.map(s => s.text).join(', ');
      const lineWords = raw.trim().split(/\s+/).length;
      if (lineWords >= 8) {
        // long line → a second chord change partway through
        segments.push({ chordIndex: cursor % n, text: restText });
        cursor++;
      } else {
        // short line → the line stays on its one chord; append the words to it
        segments[0] = { chordIndex: firstChord, text: subs.map(s => s.text).join(', ') };
        segments.length = 1;
      }
    }

    // Cadence: the final line of the section resolves to the tonic, and realign
    // the cycle so the next section starts cleanly.
    if (isLastLine) {
      segments[segments.length - 1] = {
        ...segments[segments.length - 1], chordIndex: 0,
      };
      cursor = 1 % n;
    }

    out.push({ blank: false, segments });
  }

  return out;
}

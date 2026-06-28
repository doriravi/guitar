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

// Pitch classes for roots, sharp-spelled.
const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const PC_TO_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Roots whose common open chords are EASY (no barre needed) in standard tuning.
// A song made only of these needs no capo help.
const EASY_OPEN_ROOTS = new Set(['C', 'A', 'G', 'E', 'D']);

// Roots that force a barre in any common voicing — these are what make a song
// "hard" and worth a capo suggestion. F is intentionally NOT here: it has a
// widely-used easy partial shape, so an F in an otherwise-open song shouldn't
// trigger a whole-song capo.
const HARD_ROOTS = new Set(['Bb', 'A#', 'Eb', 'D#', 'Ab', 'G#', 'Db', 'C#', 'Gb', 'F#', 'B']);

function hasHardChord(names) {
  return names.some(n => {
    const p = parseRoot(n);
    return p && HARD_ROOTS.has(p.root);
  });
}

function parseRoot(chordName) {
  const m = (chordName || '').match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  return { root: m[1], suffix: m[2] };
}

// Transpose a chord name DOWN by `semitones` (for capo math), keeping its suffix.
function transposeDown(chordName, semitones) {
  const p = parseRoot(chordName);
  if (!p) return chordName;
  const pc = NOTE_TO_PC[p.root];
  if (pc == null) return chordName;
  const shaped = ((pc - semitones) % 12 + 12) % 12;
  return PC_TO_SHARP[shaped] + p.suffix;
}

/**
 * Suggest a capo so a hard-key song becomes easy open shapes.
 *
 * Tries capo frets 1–5; for each, transposes every chord DOWN by the capo
 * amount (the shape you actually fret) and counts how many land on an easy open
 * root. Picks the lowest capo that makes ALL chords easy; if none does, the one
 * that maximizes easy chords (when it beats playing open with no capo).
 *
 * @param {string[]} chordNames unique chord names used in the song
 * @returns {null | { fret:number, map: Record<string,string> }}
 *          null when the song is already easy open (no capo benefit).
 */
export function suggestCapo(chordNames) {
  const names = [...new Set((chordNames || []).filter(Boolean))];
  if (!names.length) return null;

  // Only offer a capo when the song actually contains a barre-forcing chord.
  // Otherwise an all-open song (e.g. C/G/Am/F) would get a pointless suggestion.
  if (!hasHardChord(names)) return null;

  const easyCount = (transposeFn) =>
    names.reduce((acc, n) => {
      const p = parseRoot(transposeFn(n));
      return acc + (p && EASY_OPEN_ROOTS.has(p.root) ? 1 : 0);
    }, 0);

  const baseEasy = easyCount(n => n); // how many are already easy with no capo
  if (baseEasy === names.length) return null; // already all-easy → no capo needed

  let best = null;
  for (let fret = 1; fret <= 5; fret++) {
    const cnt = easyCount(n => transposeDown(n, fret));
    if (!best || cnt > best.cnt) best = { fret, cnt };
    if (cnt === names.length) break; // perfect — lowest such fret wins
  }
  if (!best || best.cnt <= baseEasy) return null; // capo doesn't actually help

  const map = {};
  for (const n of names) map[n] = transposeDown(n, best.fret);
  return { fret: best.fret, map };
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
 * @returns {Array<{ blank:true } | { blank:false, segments:Array<{ chordIndex:number, text:string }> }>}
 *          one entry per input line; non-blank lines carry 1+ chord segments.
 */
export function alignChordsToLyrics(rawLines, chords) {
  const n = chords.length;
  if (!n) return rawLines.map(l => (l.trim() ? { blank: false, segments: [{ chordIndex: 0, text: l.trim() }] } : { blank: true }));

  const lines = rawLines;
  const lastTextIdx = (() => { for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return i; return -1; })();

  const out = [];
  let cursor = 0; // walks through the progression, advancing per sub-phrase

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) { out.push({ blank: true }); continue; }

    const subs = splitSubPhrases(raw);
    const segments = [];

    subs.forEach((sub, si) => {
      let chordIndex;
      const isLastPhraseOfSong = i === lastTextIdx && si === subs.length - 1;

      if (sub.endMark === 'resolve' || isLastPhraseOfSong) {
        // Cadence: land on the tonic (degree 0) and realign the cycle after it.
        chordIndex = 0;
        cursor = 1 % n;
      } else {
        chordIndex = cursor % n;
        cursor++;
      }
      segments.push({ chordIndex, text: sub.text });
    });

    out.push({ blank: false, segments });
  }

  return out;
}

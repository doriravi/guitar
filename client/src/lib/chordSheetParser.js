// Parse a pasted chord sheet (the "chords above lyrics" format used by Ultimate
// Guitar / e-chords style sheets) into the app's structured song shape.
//
// Output shape (a superset of the built-in song entries in songs.js):
//   {
//     title, artist,
//     key,            // root note, e.g. 'A'  (inferred from chords if absent)
//     scaleType,      // 'major' | 'minor'
//     capo,           // integer fret, 0 if none
//     bpm,            // number | undefined
//     degrees,        // unique chord degrees used (for progression matching)
//     chords,         // unique chord names used, parallel to degrees
//     lyricLines,     // [{ text, chordNames:[...] }]  the pasted lyrics + chords
//     custom: true,   // marks this as a user-pasted song
//   }
//
// Everything here is pure string/music-theory work — no copyrighted data is
// fetched; we only structure exactly what the user pasted.

const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const PC_TO_NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

// A chord token: root (A–G + #/b) then a suffix (m, 7, sus4, maj7, /B, add9…).
const CHORD_RE = /^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|°|\d|\(|\)|\/|[A-G#b])*$/;

function isChordToken(tok) {
  if (!tok) return false;
  // Strip surrounding parens used for "optional" fills like (G A G).
  const t = tok.replace(/[()]/g, '');
  if (!t) return false;
  if (!/^[A-G]/.test(t)) return false;
  return CHORD_RE.test(t);
}

// A repeat/count marker that sits on a chord line but isn't a chord — written
// either way round: "2x"/"3x" or "x8"/"x2", optionally parenthesized "(x8)".
const REPEAT_RE = /^\(?(?:\d+x|x\d+)\)?$/i;

// A line is a "chord line" if every whitespace-separated token looks like a chord
// (and there's at least one). e.g. "A   D E", "A D E D 2x", or "C F G F   x8"
// (the repeat marker is dropped).
function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(t => !REPEAT_RE.test(t));
  if (!toks.length) return false;
  return toks.every(isChordToken);
}

function chordsInLine(line) {
  return line.trim().split(/\s+/)
    .filter(t => !REPEAT_RE.test(t))
    .map(t => t.replace(/[()]/g, ''))
    .filter(Boolean);
}

function rootOf(chord) {
  const m = chord.match(/^([A-G][#b]?)/);
  return m ? m[1] : null;
}

// Infer the key (root + major/minor) from the set of chords used. Heuristic:
// the most common root that fits a major or minor scale containing the others;
// fall back to the first chord. Minor if the first chord is a minor triad.
function inferKey(chordNames) {
  if (!chordNames.length) return { key: 'C', scaleType: 'major' };
  const first = chordNames[0];
  const root = rootOf(first) || 'C';
  const minor = /m(?!aj)/.test(first.slice((rootOf(first) || '').length));
  return { key: root, scaleType: minor ? 'minor' : 'major' };
}

// Degree (0–6) of a chord within key+scaleType, or null if it's outside the scale.
function degreeOf(chord, keyRoot, scaleType) {
  const r = rootOf(chord);
  if (r == null || NOTE_TO_PC[r] == null || NOTE_TO_PC[keyRoot] == null) return null;
  const interval = (NOTE_TO_PC[r] - NOTE_TO_PC[keyRoot] + 12) % 12;
  const scale = scaleType === 'minor' ? MINOR_INTERVALS : MAJOR_INTERVALS;
  const idx = scale.indexOf(interval);
  return idx === -1 ? null : idx;
}

function parseHeaderValue(lines, label) {
  const re = new RegExp(`^\\s*${label}\\s*[:\\-]\\s*(.+)$`, 'i');
  for (const l of lines) { const m = l.match(re); if (m) return m[1].trim(); }
  return null;
}

// Recognize a "TITLE Chords by ARTIST" header line (common in pasted sheets).
function candidateTitleLine(lines) {
  for (const raw of lines) {
    const m = raw.trim().match(/^(.+?)\s+chords?\s+by\s+(.+)$/i);
    if (m) return { title: m[1].trim(), artist: m[2].trim() };
  }
  return null;
}

/**
 * Parse a pasted chord sheet into a structured song object.
 * @param {string} text  the pasted sheet
 * @returns {{ song: object, warnings: string[] }}
 */
export function parseChordSheet(text) {
  const warnings = [];
  const rawLines = text.replace(/\r/g, '').split('\n');

  // ── Header fields ──
  let key = parseHeaderValue(rawLines, 'key');
  const capoRaw = parseHeaderValue(rawLines, 'capo');
  const capo = capoRaw ? (parseInt(capoRaw.match(/\d+/)?.[0] || '0', 10) || 0) : 0;
  const bpmRaw = rawLines.find(l => /\b\d{2,3}\s*bpm\b/i.test(l));
  const bpm = bpmRaw ? parseInt(bpmRaw.match(/(\d{2,3})\s*bpm/i)[1], 10) : undefined;

  // Lines that are metadata, not lyrics/chords — skipped in the body and when
  // hunting for title/artist. Includes a BPM line (with or without leading text
  // like "Whole Song 83 bpm") and the numeric strumming-count rows ("1 & 2 &").
  const headerSkip = /^(difficulty|tuning|key|capo|chords?|strumming|https?:|page\s*\d|\[|[\d\s&]+$|.*\b\d{2,3}\s*bpm\s*$|.+\s+chords?\s+by\s+)/i;

  // A standalone non-lyric marker that some sheets sprinkle in:
  //   • a lone "X" (muted-string indicator) or "N.C." (no chord)
  //   • a section/structure word like "Set8", "Set 8", "Verse 2", "Chorus",
  //     "Intro", "Outro", "Bridge", "Solo", "Interlude" (with optional number)
  // Not a chord, not a lyric — dropped so it never leaks into the displayed
  // lyrics. Kept tight so real one-word lyric lines aren't swallowed.
  const isNoiseLine = (l) => {
    const t = l.trim();
    return /^(x|n\.?c\.?)$/i.test(t) ||
      /^(set|verse|chorus|intro|outro|bridge|solo|interlude|pre[- ]?chorus|refrain)\s*\d*$/i.test(t);
  };

  // Title/artist. Prefer an explicit "TITLE Chords by ARTIST" line; otherwise
  // take the first two non-metadata, non-chord lines. User can edit after.
  let title = '', artist = '';
  const byLine = candidateTitleLine(rawLines);
  if (byLine) { title = byLine.title; artist = byLine.artist; }
  if (!title || !artist) {
    for (const raw of rawLines) {
      const l = raw.trim();
      if (!l || headerSkip.test(l) || isChordLine(l) || /^\[.*\]$/.test(l)) continue;
      const cleaned = l.replace(/\s+chords?$/i, '').trim();
      if (!title) { title = cleaned; continue; }
      if (!artist) { artist = cleaned.replace(/\s*\(.*\)\s*$/, '').replace(/\s+\d{4}.*$/, '').trim(); break; }
    }
  }

  // ── Body: pair chord lines with the lyric line beneath them ──
  const lyricLines = [];
  const allChords = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (headerSkip.test(trimmed)) continue;          // header / section / url
    if (/^\[.*\]$/.test(trimmed)) continue;          // [Verse] / [Chorus] markers
    if (isNoiseLine(trimmed)) continue;              // lone "X" / "N.C." marker

    if (isChordLine(trimmed)) {
      const chords = chordsInLine(trimmed);
      // Find the next non-empty NON-chord line = the lyric this chord sits over.
      let j = i + 1;
      while (j < rawLines.length && !rawLines[j].trim()) j++;
      const next = j < rawLines.length ? rawLines[j].trim() : '';
      if (next && !isChordLine(next) && !/^\[.*\]$/.test(next) && !headerSkip.test(next) && !isNoiseLine(next)) {
        lyricLines.push({ text: next, chordNames: chords });
        allChords.push(...chords);
        i = j; // consume the lyric line
      } else {
        // chord line with no lyric under it (an intro/instrumental line)
        lyricLines.push({ text: '', chordNames: chords });
        allChords.push(...chords);
      }
    } else {
      // a lyric line with no chord above it → carries no new chord
      lyricLines.push({ text: trimmed, chordNames: [] });
    }
  }

  if (!allChords.length) warnings.push('No chords detected — check the sheet format (chords on their own line above each lyric).');

  // ── Key ──
  const uniqueChordNames = [...new Set(allChords)];
  if (!key) {
    const inferred = inferKey(uniqueChordNames);
    key = inferred.key;
    var scaleType = inferred.scaleType;
    warnings.push(`Key not stated — inferred ${key} ${scaleType}. Edit if wrong.`);
  } else {
    // normalize "A major"/"Am" style key strings to a root + scale
    const km = key.match(/^([A-G][#b]?)\s*(m|min|minor)?/i);
    key = km ? km[1] : key;
    var scaleType = km && km[2] ? 'minor' : (inferKey(uniqueChordNames).scaleType);
  }

  // ── Degrees (for progression matching). Chords outside the scale are kept in
  // the chord list but skipped for degrees (they won't break matching). ──
  const degreeByChord = {};
  const degrees = [];
  const chords = [];
  for (const c of uniqueChordNames) {
    const d = degreeOf(c, key, scaleType);
    if (d != null && !(d in degreeByChord)) {
      degreeByChord[d] = c;
      degrees.push(d);
      chords.push(c);
    }
  }
  if (!degrees.length) warnings.push('No chords fit the chosen key — the key may be wrong.');

  const song = {
    title: title || 'Untitled', artist: artist || 'Unknown',
    key, scaleType, capo, bpm,
    degrees, chords,
    lyricLines,
    custom: true,
  };
  return { song, warnings };
}

// Pretty key label, e.g. "A major" / "Am".
export function keyLabel(song) {
  return song.scaleType === 'minor' ? `${song.key}m` : `${song.key} major`;
}

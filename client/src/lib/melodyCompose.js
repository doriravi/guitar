// Melody → song composer.
//
// Turns a captured sequence of hummed notes (from the Recorder's pitch tracker)
// into a saveable song object: an inferred key, a diatonic chord progression,
// and a guitar-tab solo built from the melody — biased by the user's "style"
// profile (styleProfile.js). This is the in-browser equivalent of the
// guitar-composer Claude Code skill, so it runs on phones with no Python.
//
// Output shape matches chordSheetParser.js so it drops straight into save,
// the Progressions view, and Play-Along:
//   { title, artist, key, scaleType, bpm, lyricLines, tabBlocks }

import { getDiatonicChords } from './scales';

const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const PC_TO_NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Major & natural-minor scale degrees (semitones from tonic).
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// Open-string MIDI (string 0 = low E … 5 = high e), standard tuning.
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

// ── Key inference ─────────────────────────────────────────────────────────────

// Score how well a set of pitch classes fits a given tonic+scale. Tonic and
// dominant presence are weighted; notes outside the scale cost points.
function scaleFit(pcs, tonic, scale) {
  const set = new Set(scale.map(iv => (tonic + iv) % 12));
  let score = 0;
  for (const pc of pcs) {
    if (set.has(pc)) score += 1;
    else score -= 1;
    if (pc === tonic) score += 1.5;               // resolves home
    if (pc === (tonic + 7) % 12) score += 0.5;    // dominant
  }
  return score;
}

// Infer { root, scaleType } from the melody pitch classes, biased by style.
// `styleFlavor` may pin major/minor; otherwise we pick the best-fitting key,
// preferring the first & last melody notes as tonic candidates.
export function inferKey(notePCs, styleFlavor = 'auto') {
  if (!notePCs.length) return { root: 'C', scaleType: 'major' };
  const candidates = [notePCs[0], notePCs[notePCs.length - 1], ...notePCs];
  const forceMinor = styleFlavor === 'minor' || styleFlavor === 'blues' || styleFlavor === 'dorian';
  const forceMajor = styleFlavor === 'major';

  let best = null, bestScore = -Infinity;
  for (const tonic of new Set(candidates)) {
    const modes = forceMinor ? ['minor'] : forceMajor ? ['major'] : ['major', 'minor'];
    for (const mode of modes) {
      const scale = mode === 'major' ? MAJOR : MINOR;
      // Small bonus for tonic being an actual melody note (esp. first/last).
      let s = scaleFit(notePCs, tonic, scale);
      if (tonic === notePCs[0]) s += 1;
      if (tonic === notePCs[notePCs.length - 1]) s += 1.5;
      if (s > bestScore) { bestScore = s; best = { root: PC_TO_NOTE[tonic], scaleType: mode }; }
    }
  }
  return best;
}

// ── Chord progression ─────────────────────────────────────────────────────────

// Common progressions by degree index (0-based) for major and minor.
const MAJOR_PROGS = [
  [0, 4, 5, 3], // I  V  vi IV
  [0, 5, 3, 4], // I  vi IV V
  [0, 3, 4, 0], // I  IV V  I
];
const MINOR_PROGS = [
  [0, 5, 2, 6], // i  VI III VII
  [0, 3, 5, 4], // i  iv VI  v
  [0, 6, 5, 3], // i  VII VI iv
];

// Apply the style's chord color to a plain diatonic chord name.
function colorize(chordName, chordColor, isTonicMinor) {
  if (chordColor === 'clean') return chordName;
  const isMinor = /m(?!aj)/.test(chordName.replace(/^[A-G][#b]?/, ''));
  if (chordColor === '7ths') return chordName + '7';
  if (chordColor === 'sus')  return isMinor ? chordName : chordName + 'sus4';
  if (chordColor === 'add9') return chordName + 'add9';
  if (chordColor === 'jazzy') return isMinor ? chordName + '7' : chordName + 'maj7';
  return chordName;
}

// Build a 4-chord progression for the key, chosen by style + a light hash of
// the melody so different hums vary.
export function buildProgression(key, style) {
  const diatonic = getDiatonicChords(key.root, key.scaleType);
  const progs = key.scaleType === 'minor' ? MINOR_PROGS : MAJOR_PROGS;
  const pick = progs[0]; // deterministic, musical default
  return pick.map(deg => {
    const base = diatonic[deg]?.chordName || key.root;
    return colorize(base, style.chordColor, key.scaleType === 'minor');
  });
}

// ── Melody → solo tab ─────────────────────────────────────────────────────────

// Place a MIDI pitch on a playable string/fret: prefer frets 0–12, on a string
// whose open pitch is at or below the target, favoring the higher strings so the
// melody sits in a soloing range.
function midiToFret(midi) {
  let best = null;
  for (let s = 5; s >= 0; s--) {           // prefer high strings (nicer melody register)
    const fret = midi - OPEN_MIDI[s];
    if (fret >= 0 && fret <= 15) {
      if (!best || fret < best.fret) best = { string: s, fret };
      // A low fret on a high string is ideal — take the first good one.
      if (fret <= 5) return { string: s, fret };
    }
  }
  return best; // may be null if out of range
}

// Snap a melody pitch class to the nearest in-scale pitch class, so the solo
// stays diatonic even if the hum was slightly off.
function snapToScale(midi, key) {
  const scale = key.scaleType === 'major' ? MAJOR : MINOR;
  const tonic = NOTE_TO_PC[key.root] ?? 0;
  const inScale = new Set(scale.map(iv => (tonic + iv) % 12));
  const pc = ((midi % 12) + 12) % 12;
  if (inScale.has(pc)) return midi;
  // nudge to the closest scale tone (±1, ±2 semitones)
  for (const d of [1, -1, 2, -2]) if (inScale.has(((pc + d) % 12 + 12) % 12)) return midi + d;
  return midi;
}

// Turn the melody notes (names like 'A','C#') into a solo tabBlock: one event
// per note, laid out left→right by column. octave is chosen to sit in a comfy
// guitar range around the middle of the neck.
export function melodyToSolo(noteNames, key) {
  const events = [];
  let col = 0;
  for (const name of noteNames) {
    const pc = NOTE_TO_PC[name];
    if (pc == null) continue;
    // Choose an octave that lands the note roughly in the G3–G5 solo range.
    let midi = 55 + ((pc - 55 % 12 + 12) % 12); // seed near G3
    while (midi < 57) midi += 12;                // keep it above ~A3
    while (midi > 76) midi -= 12;                // and below ~E5
    midi = snapToScale(midi, key);
    const placed = midiToFret(midi);
    if (!placed) continue;
    events.push({ string: placed.string, fret: placed.fret, col: col * 2 });
    col++;
  }
  return events;
}

// ── Full compose ──────────────────────────────────────────────────────────────

// Compose a complete song object from a captured melody (array of note names)
// and the active style profile.
export function composeSong(noteNames, style, { title = 'My melody', artist = 'You' } = {}) {
  const clean = (noteNames || []).filter(Boolean);
  const pcs = clean.map(n => NOTE_TO_PC[n]).filter(pc => pc != null);
  const key = inferKey(pcs, style.scaleFlavor);
  const chords = buildProgression(key, style);
  const soloEvents = melodyToSolo(clean, key);

  // One lyric line per progression chord (placeholder lyric = the melody).
  const lyricLines = chords.map((c, i) => ({
    text: i === 0 ? clean.join(' ') : '',
    chordNames: [c],
  }));

  return {
    title,
    artist,
    key: key.root,
    scaleType: key.scaleType,
    bpm: style.tempo || 90,
    lyricLines,
    ...(soloEvents.length ? { tabBlocks: [{ afterLine: lyricLines.length, events: soloEvents }] } : {}),
    custom: true,
    fromMelody: true,
  };
}

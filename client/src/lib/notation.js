// Turn a guitar chord voicing (a 6-char EADGBe tab) into the data a music staff
// needs: the actual sounding pitches, and each pitch's vertical position + any
// accidental on a treble clef. Pure music-theory/geometry — no React, no audio.
//
// String/tab convention matches the rest of the app: the tab is 6 chars in
// EADGBe order (index 0 = low E), 'x' = muted, '0' = open, digit = fret.

// Open-string MIDI note numbers for standard tuning: E2 A2 D3 G3 B3 E4.
// (MIDI 40 = E2 … 64 = E4.)
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

// Sharp-spelled note names by pitch class.
const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Which pitch classes need a sharp when spelled from the natural below, and the
// "diatonic letter index" (C=0 … B=6) each pitch class sits on. A sharp note
// (e.g. C#) sits on the SAME staff line as its natural (C) with a ♯ glyph.
const PC_TO_LETTER = { 0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6 };
const PC_IS_SHARP = { 1: true, 3: true, 6: true, 8: true, 10: true };
const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Parse a tab into sounding notes, low string → high string.
 * @param {string} tab  6-char EADGBe tab (e.g. "x32010")
 * @returns {Array<{ string:number, fret:number, midi:number, name:string }>}
 *          name is like "C4" (scientific pitch), sharp-spelled.
 */
export function tabToPitches(tab) {
  if (!tab || tab.length < 6) return [];
  const out = [];
  for (let s = 0; s < 6; s++) {
    const ch = tab[s];
    if (ch === 'x' || ch === 'X') continue;
    const fret = parseInt(ch, 10);
    if (Number.isNaN(fret)) continue;
    const midi = OPEN_MIDI[s] + fret;
    const pc = midi % 12;
    const octave = Math.floor(midi / 12) - 1; // MIDI 60 = C4
    out.push({ string: s, fret, midi, name: `${PC_SHARP[pc]}${octave}` });
  }
  return out;
}

/**
 * A note's "diatonic step" — an integer counting letter-names from C0 upward
 * (C0=0, D0=1, … B0=6, C1=7, …). This is what sets a notehead's VERTICAL place
 * on a staff (each step = half a staff-line). Sharps share their natural's step.
 */
export function diatonicStep(midi) {
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return octave * 7 + PC_TO_LETTER[pc];
}

// Does this pitch carry a sharp when sharp-spelled?
export function isSharp(midi) {
  return !!PC_IS_SHARP[midi % 12];
}

// Letter name (no octave/accidental) for a pitch, e.g. C# → "C".
export function letterName(midi) {
  return LETTER_NAMES[PC_TO_LETTER[midi % 12]];
}

/**
 * The unique note-NAMES of a chord's notes, in pitch-class order from the root
 * if a root is given, else low→high. Used for the "C = C·E·G" style label.
 * De-dupes octaves so a chord shows each distinct pitch class once.
 * @param {string} tab
 * @returns {string[]} sharp-spelled pitch-class names (e.g. ['C','E','G'])
 */
export function chordToneNames(tab) {
  const seen = new Set();
  const names = [];
  for (const p of tabToPitches(tab)) {
    const pcName = PC_SHARP[p.midi % 12];
    if (!seen.has(pcName)) { seen.add(pcName); names.push(pcName); }
  }
  return names;
}

// The diatonic step of the treble-clef bottom line (E4, MIDI 64) — the reference
// the staff renderer measures every note against.
export const TREBLE_BOTTOM_STEP = diatonicStep(64); // E4
// Middle C (C4) sits one ledger line below the treble staff.
export const MIDDLE_C_STEP = diatonicStep(60);

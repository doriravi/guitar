// Display-friendly root note names (flats for conventional keys)
export const ROOT_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const NOTE_TO_SEMITONE = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'];
export const MAJOR_ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];

const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];
const MINOR_QUALITIES = ['m', 'dim', '', 'm', 'm', '', ''];
export const MINOR_ROMAN = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

function semitoneToNote(semitone) {
  return ROOT_NOTES[((semitone % 12) + 12) % 12];
}

/**
 * Returns the 7 diatonic chords for a given root + scale type.
 * Each entry: { degree, roman, chordName }
 */
export function getDiatonicChords(root, scaleType) {
  const rootSemitone = NOTE_TO_SEMITONE[root] ?? 0;
  const intervals = scaleType === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const qualities = scaleType === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES;
  const romans    = scaleType === 'major' ? MAJOR_ROMAN    : MINOR_ROMAN;

  return intervals.map((interval, i) => {
    const note = semitoneToNote(rootSemitone + interval);
    return { degree: i, roman: romans[i], chordName: note + qualities[i] };
  });
}

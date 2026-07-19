// memoryTrain.js
// ==============
// The PURE core of the Music Memory (ear-training) tab. No React, no DOM, no mic,
// no audio, and — in the element/grading/adaptive logic — no Math.random / Date.now
// (so it is deterministic and unit-testable, mirroring scaleGame.js). The one
// impure corner is the localStorage store at the bottom, which follows
// scalePractice.js verbatim (Date.now/Math.random for a client id are fine there;
// that runtime code is never unit-tested for determinism).
//
// A "music element" is one thing to recall: a note, an interval, a chord (by
// quality), a scale degree, or the next chord of a progression. The system PLAYS
// or NAMES it, the user answers by singing/humming OR playing into the mic, and
// `accept()` grades the answer OCTAVE-AGNOSTICALLY by pitch class — so voice and
// guitar are the same input and a singer an octave off still scores.
//
// Theory is reused, not reinvented: chordTones/parseChordName/SCALE_FORMULAS from
// improvEngine.js, getDiatonicChords from scales.js, MAJOR/MINOR_PROGRESSIONS from
// progressions.js, the CHORDS catalog from chords.js. Diatonic/progression chords
// can be `dim` (vii°/ii°), which chordTones() rejects (it only knows ''/m/7), so
// progression pc-sets are computed from the triad quality directly here.

import { chordTones, parseChordName, SCALE_FORMULAS } from './improvEngine';
import { getDiatonicChords, ROOT_NOTES } from './scales';
import { MAJOR_PROGRESSIONS, MINOR_PROGRESSIONS } from './progressions';
import { CHORDS } from './chords';

// Sharp-spelled pitch-class names (match NOTE_NAMES in chordAnalyzer.js).
export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Interval names by semitone (INTERVAL_NAMES in improvEngine.js isn't exported).
export const INTERVAL_LABELS = {
  0: 'Unison', 1: 'minor 2nd', 2: 'Major 2nd', 3: 'minor 3rd', 4: 'Major 3rd',
  5: 'Perfect 4th', 6: 'Tritone', 7: 'Perfect 5th', 8: 'minor 6th', 9: 'Major 6th',
  10: 'minor 7th', 11: 'Major 7th',
};
// Short interval symbols (R b2 2 …), for compact display.
export const INTERVAL_SHORT = {
  0: 'R', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4',
  6: 'b5', 7: '5', 8: 'b6', 9: '6', 10: 'b7', 11: '7',
};

const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

// Semitone offsets of a diatonic-triad quality's tones (for progression chords,
// where `dim` must be supported and chordTones() would return null).
const TRIAD_INTERVALS = {
  '': [0, 4, 7],      // major
  m: [0, 3, 7],       // minor
  dim: [0, 3, 6],     // diminished
};

export const pcName = (pc) => PC_NAMES[((pc % 12) + 12) % 12];
const normPc = (pc) => ((Math.round(pc) % 12) + 12) % 12;

// A short spoken instruction for an element, read aloud (TTS) when the prompt
// plays. Kept plain and speakable ("Name the chord you hear").
export function promptSpeech(element) {
  if (!element) return '';
  switch (element.type) {
    case 'note':        return 'Name the note you hear.';
    case 'interval':    return 'Name the interval you hear.';
    case 'chord':       return 'Name the chord you hear.';
    case 'degree':      return `Which note is the ${element.meta.degName} of ${pcName(element.meta.keyPc)}?`;
    case 'progression': return 'Which chord comes next?';
    default:            return 'Give your answer.';
  }
}

// A spoken form of the answer for TTS feedback — spells accidentals so a synth
// voice says "C sharp" not "C hash". ("Gm" → "G minor", "C#" → "C sharp".)
export function answerSpeech(element) {
  const label = answerLabelFor(element);
  return label
    .replace(/([A-G])#/g, '$1 sharp')
    .replace(/([A-G])b/g, '$1 flat')
    .replace(/m7\b/g, ' minor seven')
    .replace(/maj7\b/g, ' major seven')
    .replace(/([A-G](?: sharp| flat)?)m\b/g, '$1 minor')
    .replace(/7\b/g, ' seven');
}

// A human-readable label for an element's correct answer — shared by the hook
// (feedback state) and the component (feedback display) so there's one source.
export function answerLabelFor(element) {
  if (!element) return '';
  switch (element.type) {
    case 'note':        return pcName(element.meta.pc);
    case 'interval':    return `${element.label}`;
    case 'chord':       return element.meta.name;
    case 'degree':      return `${element.meta.degName} of ${pcName(element.meta.keyPc)} = ${pcName(element.meta.targetPc)}`;
    case 'progression': return element.meta.nextName;
    default:            return element.label || '';
  }
}

// The pitch classes of a diatonic/progression chord NAME, honouring dim. Returns
// { rootPc, pcs:Set }. Falls back to chordTones() for names it knows (''/m/7).
function chordNamePcs(name) {
  // Split root + quality (accepts sharps and flats).
  const m = (name || '').match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const rootPc = NOTE_TO_PC[m[1]];
  if (rootPc == null) return null;
  const suffix = m[2];
  if (suffix in TRIAD_INTERVALS) {
    return { rootPc, pcs: new Set(TRIAD_INTERVALS[suffix].map((i) => (rootPc + i) % 12)) };
  }
  // '7' and other CHORD_QUALITIES the engine knows.
  const tones = chordTones(name);
  if (tones) return { rootPc, pcs: new Set(tones.map((t) => t.pc)) };
  return null;
}

// ─── Reference Hz per pitch class (a fixed comfortable octave for prompts) ──────
// A prompt plucks a single note; we sound it in a fixed reference octave so
// prompts are consistent. MIDI 60 = C4 = 261.63 Hz. Grading is octave-agnostic,
// so the exact octave of the PROMPT doesn't affect scoring — this is presentation.
const A4_HZ = 440;
const A4_MIDI = 69;
export const midiToHz = (midi) => A4_HZ * 2 ** ((midi - A4_MIDI) / 12);
// A pitch class rendered in the octave starting at C4 (midi 60).
export const pcToPromptHz = (pc, octaveBaseMidi = 60) => midiToHz(octaveBaseMidi + normPc(pc));

// ─── Element builders ──────────────────────────────────────────────────────────
// Every builder returns the normalized element shape:
//   { type, label, prompt:{ mode:'play'|'say', audio:AudioSpec|null },
//     targetPcs:Set<0-11>, meta:{...} }

export function noteElement(pc) {
  const p = normPc(pc);
  return {
    type: 'note',
    label: pcName(p),
    prompt: { mode: 'play', audio: elementToAudioSpec({ type: 'note', meta: { pc: p } }) },
    targetPcs: new Set([p]),
    meta: { pc: p },
  };
}

export function intervalElement(rootPc, semitones) {
  const root = normPc(rootPc);
  const top = normPc(root + semitones);
  return {
    type: 'interval',
    label: `${INTERVAL_LABELS[((semitones % 12) + 12) % 12]} from ${pcName(root)}`,
    prompt: { mode: 'play', audio: elementToAudioSpec({ type: 'interval', meta: { rootPc: root, semitones } }) },
    targetPcs: new Set([root, top]),
    meta: { rootPc: root, semitones: ((semitones % 12) + 12) % 12, topPc: top },
  };
}

export function chordElement(name) {
  const info = chordNamePcs(name);
  if (!info) return null;
  return {
    type: 'chord',
    label: name,
    prompt: { mode: 'play', audio: elementToAudioSpec({ type: 'chord', meta: { name } }) },
    targetPcs: info.pcs,
    meta: { name, rootPc: info.rootPc },
  };
}

export function degreeElement(keyPc, scaleId, degreeIndex) {
  const formula = SCALE_FORMULAS[scaleId];
  if (!formula || degreeIndex < 0 || degreeIndex >= formula.length) return null;
  const key = normPc(keyPc);
  const pc = normPc(key + formula[degreeIndex]);
  const degName = INTERVAL_SHORT[formula[degreeIndex]] || String(degreeIndex + 1);
  return {
    type: 'degree',
    label: `${degName} of ${pcName(key)}`,
    // A degree is a NAMED recall (say it, no giveaway audio) OR a played prompt of
    // the key note; default 'say' so it's a real recall of the interval.
    prompt: { mode: 'say', audio: null },
    targetPcs: new Set([pc]),
    meta: { keyPc: key, scaleId, degreeIndex, degName, targetPc: pc },
  };
}

// A short progression, prompting the user to recall the NEXT chord. `progIndex`
// indexes MAJOR/MINOR_PROGRESSIONS; `upToStep` (>=1) is how many chords are
// played as the prompt — the target is the chord at index `upToStep`.
export function progressionElement(keyName, scaleType, progIndex, upToStep) {
  const list = scaleType === 'minor' ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS;
  const prog = list[progIndex];
  if (!prog || upToStep < 1 || upToStep >= prog.degrees.length) return null;
  const diatonic = getDiatonicChords(keyName, scaleType);
  const names = prog.degrees.map((d) => diatonic[d].chordName);
  const nextName = names[upToStep];
  const info = chordNamePcs(nextName);
  if (!info) return null;
  return {
    type: 'progression',
    label: `${names.slice(0, upToStep).join(' – ')} → ?`,
    prompt: {
      mode: 'play',
      audio: elementToAudioSpec({
        type: 'progression',
        meta: { names: names.slice(0, upToStep) },
      }),
    },
    targetPcs: info.pcs,
    meta: { keyName, scaleType, progName: prog.name, nextName, lead: names.slice(0, upToStep) },
  };
}

// ─── Audio spec (declarative — the hook turns this into real sound) ─────────────
// A pure module can't import audio.js, so it emits a spec the hook renders:
//   { kind:'plucks', hz:number[], gapMs }            note / interval
//   { kind:'progression', voicings:[{tab}], bpm }     chord / progression
export function elementToAudioSpec(el) {
  switch (el.type) {
    case 'note':
      return { kind: 'plucks', hz: [pcToPromptHz(el.meta.pc)], gapMs: 0 };
    case 'interval': {
      const root = normPc(el.meta.rootPc);
      const top = normPc(root + el.meta.semitones);
      // Melodic: root then the interval, a beat apart.
      return { kind: 'plucks', hz: [pcToPromptHz(root), pcToPromptHz(top)], gapMs: 600 };
    }
    case 'chord': {
      const v = CHORDS.find((c) => c.name === el.meta.name);
      if (v) return { kind: 'progression', voicings: [{ tab: v.tab }], bpm: 90 };
      // No catalogued voicing → arpeggiate the tones as plucks.
      const info = chordNamePcs(el.meta.name);
      const hz = info ? [...info.pcs].map((pc) => pcToPromptHz(pc)) : [];
      return { kind: 'plucks', hz, gapMs: 320 };
    }
    case 'progression': {
      const voicings = (el.meta.names || [])
        .map((n) => CHORDS.find((c) => c.name === n))
        .filter(Boolean)
        .map((c) => ({ tab: c.tab }));
      return { kind: 'progression', voicings, bpm: 90 };
    }
    default:
      return { kind: 'plucks', hz: [], gapMs: 0 };
  }
}

// ─── Grading (octave-agnostic, by pitch class) ──────────────────────────────────
// Thresholds are tunable constants (the honesty knob for sung answers).
const CHORD_COVERAGE_MIN = 0.66; // root + 3rd of a triad passes a chord

/**
 * Grade a committed pitch-class set against an element.
 * @param {object} element  a normalized element
 * @param {Set<number>|number[]} committed  pitch classes the user committed
 * @returns {{correct:boolean, detail:{expected,got,hit,missed,extra,coverage,purity,rootPresent}}}
 */
export function accept(element, committed) {
  const got = committed instanceof Set ? new Set(committed) : new Set((committed || []).map(normPc));
  const expected = [...element.targetPcs];
  const hit = expected.filter((pc) => got.has(pc));
  const missed = expected.filter((pc) => !got.has(pc));
  const extra = [...got].filter((pc) => !element.targetPcs.has(pc));
  const coverage = expected.length ? hit.length / expected.length : 0;
  const purity = got.size ? hit.length / got.size : 0;
  const rootPc = element.meta?.rootPc;
  const rootPresent = rootPc == null ? true : got.has(rootPc);

  let correct;
  switch (element.type) {
    case 'note':
    case 'degree':
      // Single target: hearing it anywhere in the answer passes (generous —
      // a wobbling voice adds extras that shouldn't fail a right answer).
      correct = coverage >= 1;
      break;
    case 'interval':
      // Both pitch classes must appear (order/octave irrelevant).
      correct = coverage >= 1;
      break;
    case 'chord':
    case 'progression':
      // Root + at least the quality-defining coverage (a hummed arpeggio rarely
      // lands every tone of a 7th chord).
      correct = rootPresent && coverage >= CHORD_COVERAGE_MIN;
      break;
    default:
      correct = coverage >= 1;
  }

  return {
    correct,
    detail: {
      expected, got: [...got], hit, missed, extra,
      coverage: Math.round(coverage * 100),
      purity: Math.round(purity * 100),
      rootPresent,
    },
  };
}

// ─── Spoken-answer grading (the "Say it" mode) ──────────────────────────────────
// The user says the answer in words ("C sharp", "G minor", "perfect fifth",
// "the third") instead of singing the pitch. We parse the transcript to the
// SPECIFIC answer and compare it directly to the element — more accurate than
// routing speech through pitch detection. Pure + deterministic (unit-testable).

// Spoken words → pitch class. Accepts letter names, "sharp"/"flat", and the MANY
// ways browser speech mis-hears a single spoken letter (a note name is one of the
// hardest things to recognize). Longest-first so "c sharp" beats "c".
const SPOKEN_PC = [
  // Accidentals first (longest phrases win).
  ['c sharp', 1], ['see sharp', 1], ['c#', 1], ['d flat', 1], ['dee flat', 1], ['db', 1], ['c natural', 0],
  ['d sharp', 3], ['dee sharp', 3], ['d#', 3], ['e flat', 3], ['ee flat', 3], ['eb', 3],
  ['f sharp', 6], ['eff sharp', 6], ['f#', 6], ['g flat', 6], ['gee flat', 6], ['gb', 6],
  ['g sharp', 8], ['gee sharp', 8], ['g#', 8], ['a flat', 8], ['ay flat', 8], ['ab', 8],
  ['a sharp', 10], ['ay sharp', 10], ['a#', 10], ['b flat', 10], ['bee flat', 10], ['bb', 10],
  // Common mis-hears for each spoken letter (browser ASR).
  ['sea', 0], ['see', 0], ['si', 0], ['cee', 0], ['ce', 0], ['c.', 0], ['do', 0], ['doh', 0],
  ['dee', 2], ['de', 2], ['d.', 2], ['di', 2], ['re', 2], ['ray', 2],
  ['ee', 4], ['eee', 4], ['he', 4], ['e.', 4], ['mi', 4], ['me', 4],
  ['eff', 5], ['ef', 5], ['f.', 5], ['fa', 5], ['fah', 5],
  ['gee', 7], ['jee', 7], ['ji', 7], ['g.', 7], ['sol', 7], ['so', 7], ['soh', 7],
  ['ay', 9], ['hey', 9], ['eh', 9], ['a.', 9], ['la', 9], ['lah', 9],
  ['be', 11], ['bee', 11], ['bi', 11], ['b.', 11], ['ti', 11], ['te', 11],
  // Single letters last (shortest).
  ['c', 0], ['d', 2], ['e', 4], ['f', 5], ['g', 7], ['a', 9], ['b', 11],
];

// Spoken quality → the chord-name suffix the library uses ('', 'm', '7').
const SPOKEN_QUALITY = [
  ['minor seven', 'm7'], ['min seven', 'm7'], ['minor', 'm'], ['min', 'm'], ['moll', 'm'],
  ['major seven', 'maj7'], ['dominant seven', '7'], ['seventh', '7'], ['seven', '7'],
  ['major', ''], ['maj', ''], ['dur', ''],
];

// Spoken interval name → semitones. Longest-first.
const SPOKEN_INTERVAL = [
  ['minor second', 1], ['major second', 2], ['minor third', 3], ['major third', 4],
  ['perfect fourth', 5], ['augmented fourth', 6], ['diminished fifth', 6], ['tritone', 6],
  ['perfect fifth', 7], ['minor sixth', 8], ['major sixth', 9],
  ['minor seventh', 10], ['major seventh', 11], ['octave', 12], ['unison', 0],
  ['flat two', 1], ['flat three', 3], ['flat five', 6], ['flat six', 8], ['flat seven', 10],
  ['second', 2], ['third', 4], ['fourth', 5], ['fifth', 7], ['sixth', 9], ['seventh', 11],
];

// Spoken ordinal → a scale-degree number (1-based). "the third" → 3.
const SPOKEN_ORDINAL = [
  ['first', 1], ['second', 2], ['third', 3], ['fourth', 4], ['fifth', 5],
  ['sixth', 6], ['seventh', 7], ['root', 1], ['tonic', 1], ['one', 1],
  ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7],
];

const norm = (s) => (s || '').toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
function firstMatch(text, table) {
  for (const [phrase, val] of table) {
    const re = new RegExp(`(^|\\s)${phrase.replace(/[#]/g, '\\#')}(\\s|$)`);
    if (re.test(text)) return val;
  }
  return null;
}

/**
 * Parse a spoken transcript to a structured answer:
 *   { pc, quality, semitones, ordinal, chordName } — any of which may be null.
 * @param {string} transcript
 */
export function parseSpokenAnswer(transcript) {
  const t = norm(transcript);
  const pc = firstMatch(t, SPOKEN_PC);
  const quality = firstMatch(t, SPOKEN_QUALITY);          // '', 'm', '7', 'm7', 'maj7' | null
  const semitones = firstMatch(t, SPOKEN_INTERVAL);
  const ordinal = firstMatch(t, SPOKEN_ORDINAL);
  const chordName = pc != null ? pcName(pc) + (quality || '') : null;
  return { pc, quality, semitones, ordinal, chordName, text: t };
}

// Same-note comparison by pitch class (so a spelled answer like Bb == A#).
const chordRootQuality = (name) => {
  const m = (name || '').match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const rootPc = NOTE_TO_PC[m[1]];
  return rootPc == null ? null : { rootPc, suffix: m[2] };
};

/**
 * Grade a SPOKEN answer against an element.
 * @param {object} element
 * @param {string} transcript
 * @returns {{correct:boolean, detail:{ spoken, parsed, said }}}
 */
export function acceptSpoken(element, transcript) {
  const parsed = parseSpokenAnswer(transcript);
  let correct = false;
  let said = parsed.text;

  switch (element.type) {
    case 'note':
      correct = parsed.pc != null && parsed.pc === normPc(element.meta.pc);
      said = parsed.pc != null ? pcName(parsed.pc) : parsed.text;
      break;
    case 'interval':
      // Accept the interval NAME (semitones) — the most natural spoken answer.
      correct = parsed.semitones != null && (parsed.semitones % 12) === element.meta.semitones;
      said = parsed.semitones != null ? (INTERVAL_LABELS[parsed.semitones % 12] || parsed.text) : parsed.text;
      break;
    case 'degree': {
      // Either the ordinal ("the third") or the resulting note name.
      const byNote = parsed.pc != null && parsed.pc === normPc(element.meta.targetPc);
      // Ordinal → degreeIndex is ordinal-1; compare to the element's degreeIndex.
      const byOrdinal = parsed.ordinal != null && (parsed.ordinal - 1) === element.meta.degreeIndex;
      correct = byNote || byOrdinal;
      said = parsed.pc != null ? pcName(parsed.pc) : (parsed.ordinal != null ? `degree ${parsed.ordinal}` : parsed.text);
      break;
    }
    case 'chord':
    case 'progression': {
      const target = element.type === 'chord' ? element.meta.name : element.meta.nextName;
      const tgt = chordRootQuality(target);
      // Need the right root; quality must match, but a bare root spoken for a
      // major chord ("G" for "G") is accepted (major is the unmarked default).
      if (tgt && parsed.pc != null && parsed.pc === tgt.rootPc) {
        const saidSuffix = parsed.quality == null ? '' : (parsed.quality === 'maj7' ? '' : parsed.quality);
        const tgtSuffix = tgt.suffix === 'dim' ? 'dim' : tgt.suffix; // dim spoken rarely; require exact
        correct = saidSuffix === tgtSuffix || (tgtSuffix === '' && parsed.quality == null);
      }
      said = parsed.chordName || parsed.text;
      break;
    }
    default:
      correct = false;
  }

  return { correct, detail: { spoken: transcript, parsed, said } };
}

/**
 * Grade a SPOKEN answer against MANY candidate phrases (the browser's alternatives
 * + interim guesses). A single spoken letter is ambiguous, so the right answer is
 * often not the top guess — accept if ANY candidate parses correctly. Returns the
 * correct candidate's result when one matches, else the best (first) candidate's.
 *
 * @param {object} element
 * @param {string[]} candidates
 * @returns {{correct:boolean, detail:{ spoken, parsed, said, candidates }}}
 */
export function acceptSpokenAny(element, candidates) {
  const list = (candidates || []).filter(Boolean);
  let firstResult = null;
  for (const c of list) {
    const r = acceptSpoken(element, c);
    if (!firstResult) firstResult = r;
    if (r.correct) {
      return { correct: true, detail: { ...r.detail, candidates: list } };
    }
  }
  const base = firstResult || acceptSpoken(element, '');
  return { correct: false, detail: { ...base.detail, candidates: list } };
}

// ─── Adaptive difficulty (streak-driven; NOT spaced repetition) ─────────────────
// Each level widens the pool of element TYPES. Correct answers build a streak that
// promotes the level; a miss eases it. Deterministic: nextElement(level, index)
// uses an index-seeded LCG (like scaleGame's shuffle), never Math.random.

export const MAX_LEVEL = 5;
export const UP_THRESHOLD = 3; // this many in a row promotes a level

// Which element types are in play at each level (cumulative difficulty).
export const LEVELS = [
  { level: 1, types: ['note'] },
  { level: 2, types: ['note', 'interval'] },
  { level: 3, types: ['note', 'interval', 'chord'] },
  { level: 4, types: ['note', 'interval', 'chord', 'degree'] },
  { level: 5, types: ['note', 'interval', 'chord', 'degree', 'progression'] },
];

// Deterministic 0..1 from an integer seed (mulberry32-ish), plus helpers.
function rand01(seed) {
  let a = (seed >>> 0) || 1;
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr, seed) => arr[Math.floor(rand01(seed) * arr.length) % arr.length];

// Common intervals to drill (skip the unison; the useful melodic ones).
const INTERVAL_POOL = [2, 3, 4, 5, 7, 9, 11];
const TRIAD_NAMES = ROOT_NOTES.flatMap((r) => [r, `${r}m`]);
const DEGREE_KEYS = [0, 2, 4, 5, 7, 9]; // C D E F G A as tonics
const DEGREE_SCALES = ['major', 'naturalMinor'];

/**
 * Deterministically pick the next element for a level. `index` is the running
 * item counter (so a session is reproducible and testable).
 */
export function nextElement(level, index) {
  const lv = LEVELS.find((l) => l.level === Math.max(1, Math.min(MAX_LEVEL, level))) || LEVELS[0];
  const types = lv.types;
  const type = pick(types, index * 2654435761);
  const s = (index + 1) * 40503;

  switch (type) {
    case 'note':
      return noteElement(Math.floor(rand01(s) * 12));
    case 'interval':
      return intervalElement(
        Math.floor(rand01(s + 1) * 12),
        pick(INTERVAL_POOL, s + 2),
      );
    case 'chord': {
      const el = chordElement(pick(TRIAD_NAMES, s + 3));
      return el || noteElement(Math.floor(rand01(s) * 12));
    }
    case 'degree': {
      const keyPc = pick(DEGREE_KEYS, s + 4);
      const scaleId = pick(DEGREE_SCALES, s + 5);
      const formulaLen = (SCALE_FORMULAS[scaleId] || []).length;
      const deg = 1 + Math.floor(rand01(s + 6) * Math.max(1, formulaLen - 1)); // skip the tonic (deg 0)
      const el = degreeElement(keyPc, scaleId, deg);
      return el || noteElement(Math.floor(rand01(s) * 12));
    }
    case 'progression': {
      const scaleType = pick(['major', 'minor'], s + 7);
      const list = scaleType === 'minor' ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS;
      const progIndex = Math.floor(rand01(s + 8) * list.length);
      const keyName = pick(ROOT_NOTES, s + 9);
      // Prompt the first 1..(len-1) chords; ask for the next.
      const len = list[progIndex]?.degrees.length || 3;
      const upTo = 1 + Math.floor(rand01(s + 10) * Math.max(1, len - 1));
      const el = progressionElement(keyName, scaleType, progIndex, Math.min(upTo, len - 1));
      return el || chordElement(pick(TRIAD_NAMES, s + 3)) || noteElement(0);
    }
    default:
      return noteElement(Math.floor(rand01(s) * 12));
  }
}

/**
 * Advance the {level, streak} state after an answer.
 * Correct → streak+1; at UP_THRESHOLD promote a level and reset the streak.
 * Miss → streak 0 and ease one level (never below 1).
 */
export function adjustLevel(state, correct) {
  const level = Math.max(1, Math.min(MAX_LEVEL, state?.level || 1));
  const streak = Math.max(0, state?.streak || 0);
  if (correct) {
    const nextStreak = streak + 1;
    if (nextStreak >= UP_THRESHOLD && level < MAX_LEVEL) {
      return { level: level + 1, streak: 0 };
    }
    return { level, streak: nextStreak };
  }
  return { level: Math.max(1, level - 1), streak: 0 };
}

// ─── Store (guitar_memory_train_v1) — score-only, sync-shaped ───────────────────
// Mirrors scalePractice.js. Runtime code (Date.now/Math.random for the client id
// is fine — this isn't unit-tested for determinism).

const KEY = 'guitar_memory_train_v1';
const MAX_TOTAL = 300;

function readStore() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const data = raw ? JSON.parse(raw) : null;
    if (data && data.v === 1 && Array.isArray(data.runs)) return data;
  } catch { /* fall through */ }
  return { v: 1, runs: [] };
}
function writeStore(data) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { /* ignore quota */ }
}

/**
 * Save a completed session.
 * @param {object} run { correct, total, score(0..100), level, streakBest, perType }
 */
export function saveMemoryRun(run) {
  const data = readStore();
  const record = {
    clientId: `mm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    serverId: null,
    synced: false,
    correct: run.correct,
    total: run.total,
    score: run.score,            // 0..100 (correct/total)
    level: run.level,            // reached level 1..5
    streakBest: run.streakBest,  // longest correct streak
    perType: run.perType || {},  // { note:{correct,total}, interval:{...}, ... }
    createdAt: new Date().toISOString(),
  };
  data.runs.unshift(record);
  data.runs = data.runs.slice(0, MAX_TOTAL);
  writeStore(data);
  return record;
}

/**
 * Mastery snapshot across all saved sessions.
 *
 * `bestScoreAtLevel(minLevel)` is the completion signal the Level Plan gates on:
 * the best score (0..100) among sessions that actually REACHED at least `minLevel`.
 * A 100% run that only got to Level 1 must not satisfy a Level-3/5 milestone, so we
 * scope "best score" to runs that climbed high enough — mastery = accuracy AT the
 * required difficulty, not merely having touched it once.
 *
 * @returns {{sessions, bestScore, streakBest, level, bestScoreAtLevel}}
 */
export function memoryMastery() {
  const runs = readStore().runs;
  const bestScore = runs.reduce((m, r) => Math.max(m, r.score || 0), 0);
  const streakBest = runs.reduce((m, r) => Math.max(m, r.streakBest || 0), 0);
  const level = runs.reduce((m, r) => Math.max(m, r.level || 0), 0);
  const bestScoreAtLevel = (minLevel = 1) =>
    runs.reduce((m, r) => ((r.level || 0) >= minLevel ? Math.max(m, r.score || 0) : m), 0);
  return { sessions: runs.length, bestScore, streakBest, level, bestScoreAtLevel };
}

/**
 * Diff two mastery snapshots into an advancement (same shape as scaleGame's
 * detectAdvancement, so Celebration.jsx renders it unchanged). Achievement types
 * (mm*) fall through Celebration.describe()'s switch — we add matching cases there.
 */
export function detectMemoryAdvancement(before = {}, after = {}, run = {}) {
  const b = { bestScore: 0, streakBest: 0, level: 0, ...before };
  const a = { bestScore: 0, streakBest: 0, level: 0, ...after };
  const achievements = [];

  if (a.level > b.level) {
    achievements.push({ type: 'mmLevelUp', detail: { level: a.level, prev: b.level } });
  }
  if (run.total && run.correct === run.total && run.total >= 6) {
    achievements.push({ type: 'mmPerfect', detail: { total: run.total } });
  }
  if (a.bestScore > b.bestScore) {
    achievements.push({ type: 'mmBestScore', detail: { score: run.correct, total: run.total, pct: a.bestScore } });
  }

  const RANK = { mmPerfect: 0, mmLevelUp: 1, mmBestScore: 2 };
  achievements.sort((x, y) => (RANK[x.type] ?? 99) - (RANK[y.type] ?? 99));
  const top = achievements[0] || null;
  const big = !!top && (top.type === 'mmPerfect' || top.type === 'mmLevelUp');
  return { advanced: achievements.length > 0, big, achievements, top };
}

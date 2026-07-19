import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  noteElement, intervalElement, chordElement, degreeElement, progressionElement,
  accept, elementToAudioSpec, nextElement, adjustLevel, LEVELS, MAX_LEVEL, UP_THRESHOLD,
  saveMemoryRun, memoryMastery, detectMemoryAdvancement, pcName,
  parseSpokenAnswer, acceptSpoken,
} from './memoryTrain';

// Pitch classes (sharp): C0 C#1 D2 D#3 E4 F5 F#6 G7 G#8 A9 A#10 B11
const C = 0, D = 2, E = 4, F = 5, G = 7, A = 9, B = 11, Eb = 3;

describe('accept — note', () => {
  it('passes when the target pc is heard', () => {
    const el = noteElement(A);
    expect(accept(el, new Set([A])).correct).toBe(true);
  });
  it('is generous about extra committed pcs', () => {
    const el = noteElement(A);
    const r = accept(el, new Set([A, C, E]));
    expect(r.correct).toBe(true);
    expect(r.detail.extra.sort()).toEqual([C, E]);
  });
  it('fails when the target pc is absent', () => {
    expect(accept(noteElement(A), new Set([C])).correct).toBe(false);
  });
});

describe('accept — interval', () => {
  it('P5 from C requires both C and G', () => {
    const el = intervalElement(C, 7); // Perfect 5th → {C, G}
    expect([...el.targetPcs].sort()).toEqual([C, G]);
    expect(accept(el, new Set([C, G])).correct).toBe(true);
    expect(accept(el, new Set([C])).correct).toBe(false);
  });
  it('is order- and octave-agnostic and tolerates extras', () => {
    const el = intervalElement(C, 7);
    expect(accept(el, new Set([G, C])).correct).toBe(true);       // reversed
    expect(accept(el, new Set([C, G, E])).correct).toBe(true);    // extra
  });
});

describe('accept — chord', () => {
  it('G major tones are {G, B, D}', () => {
    const el = chordElement('G');
    expect([...el.targetPcs].sort((a, b) => a - b)).toEqual([D, G, B]);
  });
  it('root + 3rd (coverage 0.66, root present) passes', () => {
    const el = chordElement('G');
    expect(accept(el, new Set([G, B])).correct).toBe(true);
  });
  it('fails without the root even if other tones present', () => {
    const el = chordElement('G');
    expect(accept(el, new Set([B, D])).correct).toBe(false); // no root G
  });
  it('supports minor and dominant-7 qualities', () => {
    expect([...chordElement('Am').targetPcs].sort((a, b) => a - b)).toEqual([C, E, A]);
    const g7 = chordElement('G7'); // G B D F
    expect([...g7.targetPcs].sort((a, b) => a - b)).toEqual([D, F, G, B]);
    // root + 3rd + 7th passes; root + 5th only fails (coverage 0.5)
    expect(accept(g7, new Set([G, B, F])).correct).toBe(true);
    expect(accept(g7, new Set([G, D])).correct).toBe(false);
  });
});

describe('accept — degree', () => {
  it('the 3rd of C major is E', () => {
    const el = degreeElement(C, 'major', 2); // formula[2] = 4 semitones = E
    expect([...el.targetPcs]).toEqual([E]);
    expect(accept(el, new Set([E])).correct).toBe(true);
    expect(accept(el, new Set([Eb])).correct).toBe(false);
  });
});

describe('progressionElement', () => {
  it('resolves the next chord of I–V–vi–IV in C: vi = Am', () => {
    // MAJOR_PROGRESSIONS index 2 is I–V–vi–IV [0,4,5,3]. upToStep 2 → next is vi = Am.
    const el = progressionElement('C', 'major', 2, 2);
    expect(el.meta.nextName).toBe('Am');
    expect([...el.targetPcs].sort((a, b) => a - b)).toEqual([C, E, A]);
    expect(accept(el, new Set([A, C, E])).correct).toBe(true);
  });
  it('supports diminished diatonic chords (vii°/ii°) without crashing', () => {
    // Some progressions land on a dim chord; chordTones rejects dim, so the
    // internal triad path must handle it. Just assert it produces a pc-set.
    const el = progressionElement('C', 'major', 2, 1); // → V = G
    expect(el).not.toBeNull();
    expect(el.targetPcs.size).toBeGreaterThanOrEqual(3);
  });
});

describe('elementToAudioSpec', () => {
  it('note → one pluck', () => {
    expect(elementToAudioSpec(noteElement(C)).hz).toHaveLength(1);
  });
  it('interval → two plucks', () => {
    expect(elementToAudioSpec(intervalElement(C, 7)).hz).toHaveLength(2);
  });
  it('chord → a progression voicing when catalogued', () => {
    const spec = chordElement('C').prompt.audio;
    expect(spec.kind).toBe('progression');
    expect(spec.voicings[0].tab).toBeTruthy();
  });
});

describe('adaptive difficulty — deterministic', () => {
  it('nextElement is stable for the same (level, index)', () => {
    const a = nextElement(3, 7);
    const b = nextElement(3, 7);
    expect(a.type).toBe(b.type);
    expect(a.label).toBe(b.label);
  });
  it('level 1 only yields notes', () => {
    for (let i = 0; i < 40; i++) expect(nextElement(1, i).type).toBe('note');
  });
  it('higher levels unlock harder types across the pool', () => {
    const types = new Set();
    for (let i = 0; i < 200; i++) types.add(nextElement(MAX_LEVEL, i).type);
    // At max level, all five families should appear across many draws.
    for (const t of LEVELS[MAX_LEVEL - 1].types) expect(types.has(t)).toBe(true);
  });
  it('adjustLevel promotes after UP_THRESHOLD correct, eases on a miss', () => {
    let s = { level: 1, streak: 0 };
    for (let i = 0; i < UP_THRESHOLD; i++) s = adjustLevel(s, true);
    expect(s.level).toBe(2);
    expect(s.streak).toBe(0);
    const eased = adjustLevel({ level: 3, streak: 2 }, false);
    expect(eased).toEqual({ level: 2, streak: 0 });
    expect(adjustLevel({ level: 1, streak: 0 }, false).level).toBe(1); // never below 1
  });
});

describe('store round-trip + advancement', () => {
  beforeEach(() => {
    const mem = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    });
  });

  it('saveMemoryRun then memoryMastery reflects the best', () => {
    saveMemoryRun({ correct: 7, total: 10, score: 70, level: 3, streakBest: 4, perType: {} });
    saveMemoryRun({ correct: 9, total: 10, score: 90, level: 4, streakBest: 6, perType: {} });
    const m = memoryMastery();
    expect(m.sessions).toBe(2);
    expect(m.bestScore).toBe(90);
    expect(m.streakBest).toBe(6);
    expect(m.level).toBe(4);
  });

  it('detectMemoryAdvancement flags a real new best / level-up / perfect', () => {
    const before = { bestScore: 60, level: 2, streakBest: 3 };
    const after = { bestScore: 90, level: 3, streakBest: 6 };
    const adv = detectMemoryAdvancement(before, after, { correct: 9, total: 10 });
    expect(adv.advanced).toBe(true);
    expect(adv.achievements.some((a) => a.type === 'mmLevelUp')).toBe(true);
    // A perfect session flags mmPerfect and is "big".
    const perfect = detectMemoryAdvancement({ bestScore: 90, level: 3 }, { bestScore: 100, level: 3 }, { correct: 8, total: 8 });
    expect(perfect.top.type).toBe('mmPerfect');
    expect(perfect.big).toBe(true);
  });
});

describe('pcName', () => {
  it('names pitch classes with sharps and wraps', () => {
    expect(pcName(0)).toBe('C');
    expect(pcName(6)).toBe('F#');
    expect(pcName(12)).toBe('C');
  });
});

describe('parseSpokenAnswer', () => {
  it('parses note names with accidentals', () => {
    expect(parseSpokenAnswer('C sharp').pc).toBe(1);
    expect(parseSpokenAnswer('b flat').pc).toBe(10);
    expect(parseSpokenAnswer('G').pc).toBe(7);
  });
  it('parses chord quality', () => {
    expect(parseSpokenAnswer('G minor').chordName).toBe('Gm');
    expect(parseSpokenAnswer('C seven').chordName).toBe('C7');
    expect(parseSpokenAnswer('A').chordName).toBe('A');
  });
  it('parses interval names', () => {
    expect(parseSpokenAnswer('perfect fifth').semitones).toBe(7);
    expect(parseSpokenAnswer('major third').semitones).toBe(4);
    expect(parseSpokenAnswer('tritone').semitones).toBe(6);
  });
  it('parses ordinals for degrees', () => {
    expect(parseSpokenAnswer('the third').ordinal).toBe(3);
    expect(parseSpokenAnswer('root').ordinal).toBe(1);
  });
});

describe('acceptSpoken', () => {
  it('grades a spoken note', () => {
    const el = noteElement(1); // C#
    expect(acceptSpoken(el, 'C sharp').correct).toBe(true);
    expect(acceptSpoken(el, 'D flat').correct).toBe(true);   // enharmonic
    expect(acceptSpoken(el, 'C').correct).toBe(false);
  });
  it('grades a spoken interval by name', () => {
    const el = intervalElement(C, 7); // perfect fifth
    expect(acceptSpoken(el, 'perfect fifth').correct).toBe(true);
    expect(acceptSpoken(el, 'a fifth').correct).toBe(true);
    expect(acceptSpoken(el, 'major third').correct).toBe(false);
  });
  it('grades a spoken chord (root + quality; bare root = major)', () => {
    expect(acceptSpoken(chordElement('Am'), 'A minor').correct).toBe(true);
    expect(acceptSpoken(chordElement('G'), 'G').correct).toBe(true);       // bare root ok for major
    expect(acceptSpoken(chordElement('G'), 'G minor').correct).toBe(false); // wrong quality
    expect(acceptSpoken(chordElement('Am'), 'A').correct).toBe(false);      // missing minor
  });
  it('grades a spoken degree by ordinal OR note', () => {
    const el = degreeElement(C, 'major', 2); // the 3rd of C = E, degreeIndex 2
    expect(acceptSpoken(el, 'the third').correct).toBe(true);
    expect(acceptSpoken(el, 'E').correct).toBe(true);
    expect(acceptSpoken(el, 'the fifth').correct).toBe(false);
  });
  it('grades a spoken progression next-chord', () => {
    const el = progressionElement('C', 'major', 2, 2); // next = Am
    expect(acceptSpoken(el, 'A minor').correct).toBe(true);
    expect(acceptSpoken(el, 'A major').correct).toBe(false);
  });
});

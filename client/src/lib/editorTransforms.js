// Song Editor transforms — the six pure transforms applied to a marked section.
//
// This module reconciles the two design specs (fretboard-spec.md +
// musical-spec.md) into ONE shared input shape and ONE transform contract. It is
// PURE: no React, no network. Every transform is null-safe — it returns warnings
// instead of throwing, so a bad chord name never crashes the editor.
//
// It REUSES the existing engines verbatim (no physics/audio is reimplemented):
//   - upperVoicings.js   → move-up-frets (barre/CAGED)
//   - triadVoicings.js   → move-up-frets (no-barre triad grips)
//   - chords.js          → findEasierVoicings (same-root easier voicings)
//   - substitutions.js   → easierSubstitute / suggestEasierProgression
//   - lyricChords.js     → suggestCapo
//   - fretboard.js       → calcDifficulty / transitionDifficulty
//   - handProfile.js     → personalDifficulty (the personalScore everything reports)
//   - voicingLookup.js   → lookupVoicings / easiestVoicing (shared library lookup)
//
// ─── The UNIFIED marked-section shape ────────────────────────────────────────
// The fretboard spec marked a per-chord array (MarkedChord{chordName,current,index});
// the musical spec marked a section envelope (MarkedSection{start,end,bpm,key,
// scaleType,chords:[{degree,roman,...}]}). We keep the rich MUSICAL envelope as
// the single shape and make each cell ALSO carry everything the reach transforms
// need (chordName + current voicing). So one MarkedSection feeds BOTH families:
//
//   MarkedSection = {
//     start, end,                 // inclusive indices into the song's chord timeline
//     bpm,                        // beats per minute for audio timing
//     key, scaleType,             // 'C' / 'major'|'minor' — for melody/scale work
//     chords: [ MarkedCell ]      // the highlighted cells, in order
//   }
//   MarkedCell = {
//     index,                      // stable id = position in the song timeline
//     degree, roman,              // diatonic info (may be null for slash/borrowed)
//     chordName,                  // e.g. "Bb", "F#m7", "G/B"
//     current: voicing,           // the voicing currently shown (= reach spec's MarkedChord.current)
//     tab, notes,                 // mirror current.tab / current.notes (musical spec convenience)
//     beats,                      // beats this cell occupies (default 4 — playProgression's grid)
//   }
//   voicing = { name, type, notes:[{string,fret}], tab:"EADGBe", score }  (score = raw calcDifficulty)
//
// Reach transforms read `cell.chordName` + `cell.current`; musical transforms read
// `cell.tab`/`cell.notes`/`cell.degree`. Both share `index` to map results back.

import { calcDifficulty, transitionDifficulty } from './fretboard';
import { personalDifficulty } from './handProfile';
import { suggestUpperProgression } from './upperVoicings';
import { suggestTriadProgression } from './triadVoicings';
import { easierSubstitute } from './substitutions';
import { findEasierVoicings } from './chords';
import { suggestCapo } from './lyricChords';
import { lookupVoicings, easiestVoicing } from './voicingLookup';

// ─── Scoring helpers ──────────────────────────────────────────────────────────

// Build the personal scorer once from a profile. Every "reach number" the editor
// shows goes through this — never the raw calcDifficulty.
export function makeScoreFn(profile) {
  return (notes) => personalDifficulty(calcDifficulty(notes), profile);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ─── Marked-section builder (used by the component) ────────────────────────────

/**
 * Build the unified MarkedSection from a song's resolved chord timeline.
 *
 * @param {Array<{ chordName, voicings, degree?, roman? }>} timeline
 *        one entry per chord cell (e.g. ProgressionExplorer's songChordsWithVoicings,
 *        but per-cell not deduped). `voicings` are sorted easiest-first.
 * @param {number} start  inclusive start index
 * @param {number} end    inclusive end index
 * @param {object} meta   { bpm, key, scaleType }
 * @returns {MarkedSection}
 */
export function buildMarkedSection(timeline, start, end, meta = {}) {
  const lo = Math.max(0, Math.min(start, end));
  const hi = Math.min(timeline.length - 1, Math.max(start, end));
  const chords = [];
  for (let i = lo; i <= hi; i++) {
    const cell = timeline[i];
    if (!cell) continue;
    const current = cell.voicings?.[0] || easiestVoicing(cell.chordName) || null;
    chords.push({
      index: i,
      degree: cell.degree ?? null,
      roman: cell.roman ?? null,
      chordName: cell.chordName,
      current,
      tab: current?.tab || 'xxxxxx',
      notes: current?.notes || [],
      beats: cell.beats || 4,
    });
  }
  return {
    start: lo,
    end: hi,
    bpm: meta.bpm || 100,
    key: meta.key || 'C',
    scaleType: meta.scaleType || 'major',
    chords,
  };
}

// A MarkedChord (reach spec) view of a cell — what the reach engines consume.
function asMarkedChord(cell) {
  return { chordName: cell.chordName, current: cell.current, index: cell.index };
}

// ─── Result envelope helpers ───────────────────────────────────────────────────

function blankResult(cell, scoreFn, warning) {
  const fromScore = cell.current ? scoreFn(cell.current.notes) : null;
  return {
    index: cell.index,
    fromName: cell.chordName,
    fromVoicing: cell.current,
    fromScore: fromScore == null ? null : round1(fromScore),
    toName: cell.chordName,
    toVoicing: null,
    toScore: null,
    delta: 0,
    changed: false,
    warnings: warning ? [warning] : [],
  };
}

function madeResult(cell, scoreFn, toName, toVoicing, toScore, warnings = []) {
  const fromScore = cell.current ? round1(scoreFn(cell.current.notes)) : null;
  const ts = round1(toScore);
  const delta = fromScore == null ? 0 : round1(fromScore - ts);
  return {
    index: cell.index,
    fromName: cell.chordName,
    fromVoicing: cell.current,
    fromScore,
    toName,
    toVoicing,
    toScore: ts,
    delta,
    changed: true,
    warnings,
  };
}

// Roll a per-chord array up into a TransformResult, including transition cost.
function rollUp(chords, section, warnings = []) {
  const fromScores = chords.map(c => c.fromScore).filter(s => s != null);
  const toScores = chords.map(c => (c.toScore != null ? c.toScore : c.fromScore)).filter(s => s != null);
  const beforeMax = fromScores.length ? Math.max(...fromScores) : 0;
  const afterMax = toScores.length ? Math.max(...toScores) : 0;
  const changedCount = chords.filter(c => c.changed).length;

  // Transition cost over adjacent pairs — before uses originals, after uses the
  // new voicing where one was produced, falling back to the original notes.
  const cells = section.chords;
  let transitionBefore = null;
  let transitionAfter = null;
  if (cells.length >= 2) {
    transitionBefore = 0;
    transitionAfter = 0;
    for (let i = 0; i < cells.length - 1; i++) {
      const aFrom = cells[i].current?.notes || [];
      const bFrom = cells[i + 1].current?.notes || [];
      transitionBefore += transitionDifficulty(aFrom, bFrom);
      const aTo = chords[i].toVoicing?.notes || aFrom;
      const bTo = chords[i + 1].toVoicing?.notes || bFrom;
      transitionAfter += transitionDifficulty(aTo, bTo);
    }
    transitionBefore = round1(transitionBefore);
    transitionAfter = round1(transitionAfter);
  }

  const allWarnings = [...warnings];
  if (transitionBefore != null && transitionAfter != null && transitionAfter > transitionBefore + 0.5) {
    allWarnings.push('New voicings reduce per-chord reach but make the changes between them harder.');
  }

  return {
    chords,
    beforeMax: round1(beforeMax),
    afterMax: round1(afterMax),
    changedCount,
    transitionBefore,
    transitionAfter,
    warnings: allWarnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFORM 1 — Move to upper frets
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transpose the marked chords' voicings up the neck (barre/CAGED), or compact
 * no-barre triad grips when opts.style === 'triad'. Reuses the upperVoicings /
 * triadVoicings engines verbatim.
 *
 * @returns {TransformResult}
 */
export function transformMoveUpFrets(section, profile, opts = {}) {
  const { minFret = 1, style = 'barre' } = opts;
  const scoreFn = makeScoreFn(profile);
  const marked = section.chords.map(asMarkedChord);

  const barre = suggestUpperProgression(marked, { minFret });
  // Pre-compute the triad fallback for every cell so a dim/aug with no barre can
  // still move up the neck via a triad grip.
  const triad = suggestTriadProgression(marked, { minFret });

  const chords = section.chords.map((cell, i) => {
    if (!cell.current) return blankResult(cell, scoreFn, `Couldn't find a voicing for ${cell.chordName}.`);

    const primary = style === 'triad' ? triad.perChord[i] : barre.perChord[i];
    const fallback = style === 'triad' ? barre.perChord[i] : triad.perChord[i];
    const hit = primary || fallback;

    if (!hit) {
      return blankResult(
        cell, scoreFn,
        `No movable shape for ${cell.chordName} below fret 9 — left unchanged.`,
      );
    }

    const v = hit.voicing;
    const toScore = scoreFn(v.notes);
    const res = madeResult(cell, scoreFn, cell.chordName, v, toScore);
    if (res.fromScore != null && res.delta < 0) {
      res.warnings.push(`Moving ${cell.chordName} up the neck increases reach for your hand.`);
    }
    if (!primary && fallback) {
      res.warnings.push(`No clean barre for ${cell.chordName}; used a triad grip instead.`);
    }
    return res;
  });

  return rollUp(chords, section);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFORM 2 — Easier voicings / reduce reach
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find lower-reach alternatives. Tries same-name easier voicings first
 * (findEasierVoicings), then an easier substitute (easierSubstitute) when
 * opts.allowQualityChange. Reuses both engines verbatim.
 *
 * @returns {TransformResult}
 */
export function transformEasierVoicings(section, profile, opts = {}) {
  const { allowQualityChange = true, minGain = 1 } = opts;
  const scoreFn = makeScoreFn(profile);

  const chords = section.chords.map((cell) => {
    if (!cell.current) return blankResult(cell, scoreFn, `Couldn't parse chord ${cell.chordName}.`);

    // 1. Same-root, harmony-preserving easier voicing.
    const easier = findEasierVoicings(
      { name: cell.chordName, notes: cell.current.notes },
      scoreFn,
      { minGain, limit: 1 },
    );
    if (easier.length) {
      const hit = easier[0];
      const toVoicing = {
        name: hit.chord.name,
        type: hit.chord.type || 'easier voicing',
        notes: hit.chord.notes,
        tab: hit.chord.tab,
        score: calcDifficulty(hit.chord.notes),
      };
      return madeResult(cell, scoreFn, hit.chord.name, toVoicing, hit.score);
    }

    // 2. Aggressive substitution (triad / power chord) — changes the harmony.
    if (allowQualityChange) {
      const sub = easierSubstitute(cell.chordName, profile, {});
      if (sub) {
        const v = sub.substitute.voicing;
        const toVoicing = {
          name: sub.substitute.name,
          type: v.type || 'substitute',
          notes: v.notes,
          tab: v.tab,
          score: v.score,
        };
        const warn = sub.substitute.kind === 'power'
          ? `Simplified ${cell.chordName} to power chord ${sub.substitute.name} — drops the 3rd.`
          : `Substituted ${cell.chordName} → ${sub.substitute.name}.`;
        return madeResult(cell, scoreFn, sub.substitute.name, toVoicing, sub.substitute.personalScore, [warn]);
      }
    }

    return blankResult(
      cell, scoreFn,
      `${cell.chordName} is already easy for your hand — no simpler voicing found.`,
    );
  });

  return rollUp(chords, section);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFORM 3 — Capo suggestion (selection-wide)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Restate hard-key chords as easy open shapes behind ONE capo for the whole
 * section. Reuses suggestCapo verbatim.
 *
 * @returns {CapoResult} { fret, chords, map, beforeMax, afterMax, warnings }
 */
export function transformCapoSuggestion(section, profile) {
  const scoreFn = makeScoreFn(profile);
  const names = section.chords.map(c => c.chordName);
  const capo = suggestCapo(names);

  if (!capo) {
    return {
      fret: null,
      chords: [],
      map: {},
      beforeMax: round1(Math.max(0, ...section.chords
        .filter(c => c.current)
        .map(c => scoreFn(c.current.notes)))),
      afterMax: 0,
      warnings: ['No capo improves this section — the chords are already open-friendly.'],
    };
  }

  const warnings = [];
  const chords = section.chords.map((cell) => {
    const shapeName = capo.map[cell.chordName] || cell.chordName;
    const shape = easiestVoicing(shapeName);
    if (!shape) {
      const r = blankResult(cell, scoreFn, `With capo ${capo.fret}, no open shape on file for ${shapeName}.`);
      r.toName = shapeName;
      return r;
    }
    // Reach is the OPEN shape under the fingers — not the transposed pitch.
    const toScore = scoreFn(shape.notes);
    const res = madeResult(cell, scoreFn, shapeName, shape, toScore);
    res.changed = shapeName !== cell.chordName;
    if (res.changed) {
      res.warnings.push(`Fret the ${shapeName} shape (sounds as ${cell.chordName}).`);
    }
    return res;
  });

  const fromScores = chords.map(c => c.fromScore).filter(s => s != null);
  const toScores = chords.map(c => (c.toScore != null ? c.toScore : c.fromScore)).filter(s => s != null);

  return {
    fret: capo.fret,
    chords,
    map: capo.map,
    beforeMax: fromScores.length ? round1(Math.max(...fromScores)) : 0,
    afterMax: toScores.length ? round1(Math.max(...toScores)) : 0,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFORM — Cadence (rewrite the end of the selection as a classic cadence)
// ═══════════════════════════════════════════════════════════════════════════════

// Each cadence is a chord pattern relative to the tonic: [semitones-from-root,
// quality suffix]. Separate major/minor spellings so a minor-key song gets the
// harmonically correct chords (e.g. V stays MAJOR in minor — harmonic minor).
export const CADENCES = {
  perfect:    { label: 'Perfect (V → I)',
                major: [[7, ''], [0, '']],            minor: [[7, ''], [0, 'm']] },
  plagal:     { label: 'Plagal (IV → I)',
                major: [[5, ''], [0, '']],            minor: [[5, 'm'], [0, 'm']] },
  half:       { label: 'Half (ends on V)',
                major: [[0, ''], [7, '']],            minor: [[0, 'm'], [7, '']] },
  deceptive:  { label: 'Deceptive (V → vi)',
                major: [[7, ''], [9, 'm']],           minor: [[7, ''], [8, '']] },
  jazz251:    { label: 'Jazz ii–V–I',
                major: [[2, 'm7'], [7, '7'], [0, 'maj7']], minor: [[2, 'dim'], [7, '7'], [0, 'm']] },
  andalusian: { label: 'Andalusian (i–♭VII–♭VI–V)',
                major: [[9, 'm'], [7, ''], [5, ''], [4, '']], minor: [[0, 'm'], [10, ''], [8, ''], [7, '']] },
};

// Sharp-leaning pitch-class spelling (matches the chord library's names).
const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// When the exact cadence chord has no shape on file, retry a simpler quality
// (Dm7 → Dm, G7 → G, Bdim → Bm) so the cadence still lands, with a warning.
const CADENCE_FALLBACK_SUFFIX = { maj7: '', m7: 'm', 7: '', dim: 'm' };

// Resolve one cadence step to a concrete chord name + shape (with the quality
// fallback). Returns { name, voicing, warnings } — voicing null when nothing
// playable exists even after the fallback.
function resolveCadenceStep(keyPc, interval, suffix) {
  const root = PC_NAMES[(keyPc + interval) % 12];
  let name = root + suffix;
  let voicing = easiestVoicing(name);
  const warnings = [];
  if (!voicing && suffix in CADENCE_FALLBACK_SUFFIX) {
    const simpler = root + CADENCE_FALLBACK_SUFFIX[suffix];
    voicing = easiestVoicing(simpler);
    if (voicing) {
      warnings.push(`No ${name} shape on file — using ${simpler}.`);
      name = simpler;
    }
  }
  return { name, voicing, warnings };
}

/**
 * Apply the chosen cadence, in the song's key.
 *
 * mode 'replace' (default): rewrite the TAIL of the marked section — cadences
 * are endings, so the last N chords of the selection become the cadence's N
 * chords; anything before them is left untouched. A selection shorter than the
 * cadence gets the cadence's final chords.
 *
 * mode 'add': APPEND the full cadence as NEW chords after the selection — the
 * caller inserts the returned `added` chords into the song (nothing existing
 * changes).
 *
 * @returns {TransformResult & { kind:'cadence', meta }} for 'replace',
 *          { kind:'cadenceAdd', added, warnings, meta } for 'add'.
 */
export function transformCadence(section, profile, opts = {}) {
  const scoreFn = makeScoreFn(profile);
  const def = CADENCES[opts.cadenceId] || CADENCES.perfect;
  const pattern = section.scaleType === 'minor' ? def.minor : def.major;
  const keyPc = NOTE_TO_SEMITONE[section.key] ?? 0;

  if (opts.mode === 'add') {
    const warnings = [];
    const added = [];
    for (const [interval, suffix] of pattern) {
      const step = resolveCadenceStep(keyPc, interval, suffix);
      warnings.push(...step.warnings);
      if (!step.voicing) { warnings.push(`No playable shape for ${step.name} — skipped.`); continue; }
      added.push({ name: step.name, tab: step.voicing.tab, notes: step.voicing.notes, score: round1(scoreFn(step.voicing.notes)) });
    }
    return {
      kind: 'cadenceAdd',
      added,
      warnings,
      meta: {
        label: `${def.label} added after the selection: ${added.map(a => a.name).join(' – ') || '(nothing playable)'}`,
        source: 'music theory',
      },
    };
  }

  const n = Math.min(pattern.length, section.chords.length);
  const steps = pattern.slice(pattern.length - n);
  const tailStart = section.chords.length - n;
  const warnings = [];
  if (section.chords.length < pattern.length) {
    warnings.push(`Selection is shorter than the full ${def.label} — applied its last ${n} chord${n > 1 ? 's' : ''}.`);
  }

  const chords = section.chords.map((cell, i) => {
    if (i < tailStart) return blankResult(cell, scoreFn);   // untouched lead-in
    const [interval, suffix] = steps[i - tailStart];
    const step = resolveCadenceStep(keyPc, interval, suffix);
    if (!step.voicing) return blankResult(cell, scoreFn, `No playable shape for ${step.name} — kept ${cell.chordName}.`);
    if (step.name === cell.chordName) return blankResult(cell, scoreFn);   // already that chord
    return madeResult(cell, scoreFn, step.name, step.voicing, scoreFn(step.voicing.notes), step.warnings);
  });

  const res = rollUp(chords, section, warnings);
  return {
    kind: 'cadence',
    ...res,
    meta: {
      label: `${def.label} in ${section.key}${section.scaleType === 'minor' ? 'm' : ''}`,
      source: 'music theory',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Musical transforms — shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

const NOTE_TO_SEMITONE = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];
// Open-string pitch class per string (0=low E … 5=high e).
const OPEN_PC = [4, 9, 2, 7, 11, 4];

// playEvents clamps duration to [0.25, 2.5]; mirror that so output is honest.
function clampDur(d) {
  return Math.min(2.5, Math.max(0.25, d));
}

// Deterministic seeded PRNG (mulberry32) — same seed reproduces the line; the UI
// "Reroll" just bumps the seed.
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Map a target pitch class to the nearest {string,fret} within a range. Returns
// null when nothing fits.
function pcToNote(pc, { lowString = 1, highString = 5, lowFret = 0, highFret = 12 } = {}) {
  let best = null;
  for (let s = lowString; s <= highString; s++) {
    for (let f = lowFret; f <= highFret; f++) {
      if ((OPEN_PC[s] + f) % 12 === pc) {
        const cost = f + (highString - s) * 0.1; // prefer lower frets, higher strings
        if (!best || cost < best.cost) best = { string: s, fret: f, cost };
      }
    }
  }
  return best ? { string: best.string, fret: best.fret } : null;
}

// Scale pitch classes for a key + scale type.
function scalePcs(key, scaleType) {
  const root = NOTE_TO_SEMITONE[key] ?? 0;
  const intervals = scaleType === 'minor' ? MINOR_INTERVALS : MAJOR_INTERVALS;
  return intervals.map(i => (root + i) % 12);
}

// Chord tones (root/3rd/5th pitch classes) of a chord cell, by parsing its name.
function chordTonePcs(chordName) {
  const m = (chordName || '').split('/')[0].match(/^([A-G][#b]?)(.*)$/);
  if (!m) return [];
  const rootPc = NOTE_TO_SEMITONE[m[1]];
  if (rootPc == null) return [];
  const q = m[2];
  let third = 4, fifth = 7;
  if (/^m(?!aj)/.test(q) || q === 'min') third = 3;
  if (q.startsWith('dim')) { third = 3; fifth = 6; }
  if (q.startsWith('aug')) fifth = 8;
  if (q.startsWith('sus2')) third = 2;
  if (q.startsWith('sus4') || q.startsWith('sus')) third = 5;
  return [rootPc, (rootPc + third) % 12, (rootPc + fifth) % 12];
}

// Convert a tab string + onset into block chord events (the "bed" under a melody,
// and the chord-only re-skin preview). Mirrors audio.js tabToNotes.
export function tabToEvents(tab, time, dur) {
  const events = [];
  (tab || '').split('').forEach((ch, s) => {
    if (ch === 'x') return;
    const fret = parseInt(ch, 10);
    if (Number.isNaN(fret)) return;
    events.push({ string: s, fret, time, duration: clampDur(dur) });
  });
  return events;
}

// Beats before cell i in a section (each cell is `beats` long).
function offsetBeats(cells, i) {
  let b = 0;
  for (let k = 0; k < i; k++) b += cells[k].beats || 4;
  return b;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFORM 4 — New melody / lead line
// ═══════════════════════════════════════════════════════════════════════════════

const DENSITY_FACTOR = { sparse: 0.5, medium: 1, busy: 2 };

/**
 * Generate a singable, in-key lead line over the marked chords. Deterministic
 * (seeded). Local-only by default; pass opts.aiHint (degrees from /api/compose)
 * to render an AI-suggested line through this same validated engine.
 *
 * @returns {TransformResult} { kind:'melody', events, meta }
 */
export function transformAddMelody(section, opts = {}) {
  const {
    density = 'medium',
    contour = 'arch',
    range = { lowString: 2, highFret: 12 },
    restProb = 0.15,
    seed = 1,
    aiHint = null,
  } = opts;

  const rng = makeRng(seed);
  const secPerBeat = 60 / (section.bpm || 100);
  const scl = scalePcs(section.key, section.scaleType);
  const noteRange = { lowString: range.lowString ?? 2, highString: 5, lowFret: 0, highFret: range.highFret ?? 12 };
  const cells = section.chords;
  if (!cells.length) {
    return { kind: 'melody', events: [], meta: { label: 'No section marked', source: 'local' } };
  }

  const totalBeats = cells.reduce((b, c) => b + (c.beats || 4), 0);
  const densityFactor = DENSITY_FACTOR[density] || 1;
  const slotCount = Math.max(1, Math.round(totalBeats * densityFactor));
  const slotBeats = totalBeats / slotCount;

  // Which cell is sounding at a given beat offset.
  const cellAtBeat = (beat) => {
    let acc = 0;
    for (let i = 0; i < cells.length; i++) {
      acc += cells[i].beats || 4;
      if (beat < acc) return i;
    }
    return cells.length - 1;
  };

  // Contour envelope target (0..1) across the section.
  const envelope = (t) => {
    switch (contour) {
      case 'ascending': return t;
      case 'descending': return 1 - t;
      case 'wave': return 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      case 'static': return 0.5;
      case 'arch':
      default: return 1 - Math.abs(t * 2 - 1);
    }
  };

  // AI path: aiHint.degrees = [{ beat, degree, octave?, accent? }] — render each
  // through the local scale→note map so output is always playable/in-range.
  const events = [];
  if (aiHint && Array.isArray(aiHint.degrees) && aiHint.degrees.length) {
    for (const d of aiHint.degrees) {
      const pc = scl[((d.degree % 7) + 7) % 7];
      if (pc == null) continue;
      const note = pcToNote(pc, noteRange);
      if (!note) continue;
      const time = (d.beat || 0) * secPerBeat;
      events.push({ ...note, time, duration: clampDur(slotBeats * secPerBeat * 0.9) });
    }
    if (events.length) {
      return { kind: 'melody', events, meta: { label: `AI melody, ${events.length} notes`, source: 'ai', seed } };
    }
  }

  // Local rule engine.
  let prevPc = null;
  for (let s = 0; s < slotCount; s++) {
    const beat = s * slotBeats;
    const t = slotCount > 1 ? s / (slotCount - 1) : 0;
    const ci = cellAtBeat(beat);
    const isLast = s === slotCount - 1;
    const strongBeat = Math.round(beat) % 2 === 0;

    // Rests (never on the final resolving note).
    if (!isLast && rng() < restProb) continue;

    let pool;
    if (isLast || strongBeat) {
      pool = chordTonePcs(cells[ci].chordName);     // strong landing notes
      if (!pool.length) pool = scl;
    } else {
      pool = scl;                                    // weak beats: scale tones
    }

    // Target pitch from the contour envelope, mapped across the scale span.
    const env = envelope(t);
    const targetFret = noteRange.lowFret + env * (noteRange.highFret - noteRange.lowFret);

    // Choose the candidate whose note is nearest the envelope target, biased
    // toward stepwise motion from the previous pitch class on weak beats.
    let best = null;
    for (const pc of pool) {
      const note = pcToNote(pc, noteRange);
      if (!note) continue;
      let cost = Math.abs(note.fret - targetFret);
      if (prevPc != null && !strongBeat) {
        const step = Math.min((pc - prevPc + 12) % 12, (prevPc - pc + 12) % 12);
        cost += step * 0.6; // discourage big leaps on weak beats
      }
      cost += rng() * 0.5;  // small seeded jitter for variety
      if (!best || cost < best.cost) best = { ...note, pc, cost };
    }
    if (!best) continue;

    // Final note resolves to a chord tone of the last chord (root/3rd preferred).
    if (isLast) {
      const tones = chordTonePcs(cells[cells.length - 1].chordName);
      if (tones.length) {
        const note = pcToNote(tones[0], noteRange) || pcToNote(tones[1], noteRange);
        if (note) best = { ...note, pc: tones[0] };
      }
    }

    events.push({
      string: best.string,
      fret: best.fret,
      time: beat * secPerBeat,
      duration: clampDur(slotBeats * secPerBeat * 0.9),
    });
    prevPc = best.pc;
  }

  return {
    kind: 'melody',
    events,
    meta: { label: `${density} ${contour} melody, ${events.length} notes`, source: 'local', seed },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFORM 5 — Rhythm / strumming change
// ═══════════════════════════════════════════════════════════════════════════════

// Built-in rhythm patterns. Each step strikes the CURRENT cell's voicing.
//   { type:'strum', dir:'D'|'U' } | { type:'pick', strings:[int] } | { type:'rest' }
export const RHYTHM_PATTERNS = {
  straight: {
    id: 'straight', label: 'Straight 8ths', subdiv: 8,
    steps: Array.from({ length: 8 }, () => ({ type: 'strum', dir: 'D' })),
  },
  syncopated: {
    id: 'syncopated', label: 'Syncopated (D-DU-UDU)', subdiv: 8,
    steps: [
      { type: 'strum', dir: 'D' }, { type: 'rest' },
      { type: 'strum', dir: 'D' }, { type: 'strum', dir: 'U' },
      { type: 'rest' }, { type: 'strum', dir: 'U' },
      { type: 'strum', dir: 'D' }, { type: 'strum', dir: 'U' },
    ],
  },
  arpeggio: {
    id: 'arpeggio', label: 'Arpeggio', subdiv: 8,
    steps: [
      { type: 'pick', strings: [0] }, { type: 'pick', strings: [2] },
      { type: 'pick', strings: [3] }, { type: 'pick', strings: [4] },
      { type: 'pick', strings: [5] }, { type: 'pick', strings: [4] },
      { type: 'pick', strings: [3] }, { type: 'pick', strings: [2] },
    ],
  },
  fingerstyle: {
    id: 'fingerstyle', label: 'Travis fingerstyle', subdiv: 8,
    steps: [
      { type: 'pick', strings: [0] }, { type: 'pick', strings: [3] },
      { type: 'pick', strings: [1] }, { type: 'pick', strings: [4] },
      { type: 'pick', strings: [0] }, { type: 'pick', strings: [3] },
      { type: 'pick', strings: [2] }, { type: 'pick', strings: [4] },
    ],
  },
  skank: {
    id: 'skank', label: 'Reggae offbeat', subdiv: 8,
    steps: [
      { type: 'rest' }, { type: 'strum', dir: 'U' },
      { type: 'rest' }, { type: 'strum', dir: 'U' },
      { type: 'rest' }, { type: 'strum', dir: 'U' },
      { type: 'rest' }, { type: 'strum', dir: 'U' },
    ],
  },
};

// Non-muted string indices of a tab, low→high.
function tabStrings(tab) {
  const out = [];
  (tab || '').split('').forEach((ch, s) => {
    if (ch !== 'x' && !Number.isNaN(parseInt(ch, 10))) out.push(s);
  });
  return out;
}

/**
 * Re-pattern the marked section's chords with a new strum/pick feel. Chords are
 * unchanged — only when/which strings are struck. Returns events for playEvents.
 *
 * @returns {TransformResult} { kind:'rhythm', events, meta }
 */
export function transformRhythm(section, opts = {}) {
  const { patternId = 'straight', feel = 'straight', intensity = 1 } = opts;
  const pattern = RHYTHM_PATTERNS[patternId] || RHYTHM_PATTERNS.straight;
  const secPerBeat = 60 / (section.bpm || 100);
  const cells = section.chords;
  const events = [];
  const swing = feel === 'swing';

  cells.forEach((cell, i) => {
    const cellStartBeats = offsetBeats(cells, i);
    const beats = cell.beats || 4;
    const stepsPerBeat = pattern.subdiv / 4;            // assume 4/4
    const stepSeconds = secPerBeat / stepsPerBeat;
    const stepCount = Math.round(beats * stepsPerBeat);
    const strings = tabStrings(cell.tab);

    for (let s = 0; s < stepCount; s++) {
      const step = pattern.steps[s % pattern.steps.length];
      if (!step || step.type === 'rest') continue;
      let stepTime = cellStartBeats * secPerBeat + s * stepSeconds;
      if (swing && s % 2 === 1) stepTime += stepSeconds * 0.33; // delay offbeats
      const dur = clampDur(stepSeconds * intensity);

      if (step.type === 'strum') {
        const order = step.dir === 'U' ? [...strings].reverse() : strings;
        order.forEach((str, ni) => {
          const fret = parseInt(cell.tab[str], 10);
          if (Number.isNaN(fret)) return;
          events.push({ string: str, fret, time: stepTime + ni * 0.014, duration: dur });
        });
      } else if (step.type === 'pick') {
        for (const str of step.strings) {
          if (!strings.includes(str)) continue;          // skip muted strings
          const fret = parseInt(cell.tab[str], 10);
          if (Number.isNaN(fret)) continue;
          events.push({ string: str, fret, time: stepTime, duration: dur });
        }
      }
    }
  });

  return {
    kind: 'rhythm',
    events,
    meta: { label: `${pattern.label}${swing ? ' · swing' : ''}`, source: 'local', patternId },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSFORM 6 — Style / genre re-skin
// ═══════════════════════════════════════════════════════════════════════════════

// A style preset = voicing recipe + rhythm pattern + feel/tempo nudges.
export const STYLE_PRESETS = {
  reggae: {
    id: 'reggae', label: 'Reggae', rhythm: 'skank', bpmScale: 1.0, feel: 'straight',
    voicing: { extension: 'triad', omitStrings: [0, 1] },
  },
  ballad: {
    id: 'ballad', label: 'Ballad', rhythm: 'arpeggio', bpmScale: 0.7, feel: 'straight',
    voicing: { extension: 'add9', omitStrings: [] },
  },
  funk: {
    id: 'funk', label: 'Funk', rhythm: 'syncopated', bpmScale: 1.0, feel: 'straight',
    voicing: { extension: '7th', omitStrings: [0] },
  },
  bossa: {
    id: 'bossa', label: 'Bossa', rhythm: 'fingerstyle', bpmScale: 0.85, feel: 'swing',
    voicing: { extension: '7th', omitStrings: [] },
  },
  folk: {
    id: 'folk', label: 'Folk', rhythm: 'fingerstyle', bpmScale: 1.0, feel: 'straight',
    voicing: { extension: 'triad', omitStrings: [] },
  },
};

// Map an extension flavour to a chord-name suffix to look up an alternate voicing.
function extensionName(chordName, extension) {
  const m = (chordName || '').match(/^([A-G][#b]?)(.*)$/);
  if (!m) return chordName;
  const root = m[1];
  const isMinor = /^m(?!aj)/.test(m[2]) || m[2] === 'min';
  switch (extension) {
    case '7th': return isMinor ? `${root}m7` : `${root}7`;
    case '9th': return isMinor ? `${root}m9` : `${root}9`;
    case 'add9': return isMinor ? `${root}m` : `${root}add9`;
    case 'sus': return `${root}sus4`;
    case 'triad':
    default: return isMinor ? `${root}m` : root;
  }
}

// Re-voice a cell for a genre: pick an extension voicing if catalogued (else keep
// the original), then blank the omitted strings in the tab.
function reVoiceCell(cell, recipe) {
  const altName = extensionName(cell.chordName, recipe.extension);
  const alt = easiestVoicing(altName) || cell.current;
  let tab = (alt?.tab || cell.tab || 'xxxxxx').split('');
  for (const s of (recipe.omitStrings || [])) {
    if (s >= 0 && s < 6) tab[s] = 'x';
  }
  return { chordName: altName, tab: tab.join('') };
}

/**
 * Reinterpret the section in a genre: re-voice each chord then re-rhythm through
 * the same transformRhythm expansion. Returns both events (preview) and voicings
 * (chord-only A/B + persistence). Pass opts.aiHint (a StylePreset from
 * /api/compose) to use AI-chosen params, still rendered through this local engine.
 *
 * @returns {TransformResult} { kind:'style', events, voicings, meta }
 */
export function transformStyle(section, opts = {}) {
  const { presetId = 'folk', intensity = 1, aiHint = null } = opts;
  const preset = (aiHint && aiHint.preset) || STYLE_PRESETS[presetId] || STYLE_PRESETS.folk;
  const recipe = preset.voicing || { extension: 'triad', omitStrings: [] };

  // 1. Re-voice every cell.
  const reVoiced = section.chords.map(cell => reVoiceCell(cell, recipe));

  // 2. Re-rhythm: build a section whose cells carry the new tabs, at bpm*bpmScale.
  const styledSection = {
    ...section,
    bpm: Math.round((section.bpm || 100) * (preset.bpmScale || 1)),
    chords: section.chords.map((cell, i) => ({ ...cell, tab: reVoiced[i].tab })),
  };
  const rhythm = transformRhythm(styledSection, {
    patternId: preset.rhythm,
    feel: preset.feel,
    intensity,
  });

  return {
    kind: 'style',
    events: rhythm.events,
    voicings: reVoiced.map(v => ({ chordName: v.chordName, tab: v.tab })),
    meta: {
      label: `${preset.label} · ${RHYTHM_PATTERNS[preset.rhythm]?.label || preset.rhythm}`,
      source: aiHint ? 'ai' : 'local',
      presetId: preset.id || presetId,
    },
  };
}

// ─── AI boundary (hybrid) ───────────────────────────────────────────────────────
//
// TODO(backend): build POST /api/compose, mirroring HandAnalysisController —
// a fixed server-side Gemini prompt that returns STRICT JSON and 503 when
// GEMINI_API_KEY is unset. Contract (musical-spec §5):
//   body: { transform:'melody'|'style', key, scaleType, chords:[{roman,chordName}], bars, vibe? }
//   200 melody: { degrees:[{beat,degree:0-6,octave?,accent?}], notes_about_phrasing? }
//   200 style : { preset:StylePreset, rationale? }
//   503 when no key.
// The frontend helper `compose.get(ctx)` (client/src/lib/api.js) already returns
// null on ANY failure, so until the endpoint exists this falls back to local.
//
// composeWithAI is the function boundary: it calls the AI helper, and on null
// renders LOCALLY. AI never returns raw fret events — it returns scale degrees /
// preset params that the local transforms above validate into playable events.

/**
 * Run a melody/style transform with optional AI enrichment, falling back to the
 * pure local engine when AI is unavailable. Keeps the transforms themselves pure
 * (the network call happens here, then re-invokes the pure fn with aiHint).
 *
 * @param {'melody'|'style'} kind
 * @param {MarkedSection} section
 * @param {object} profile  (unused by musical transforms, kept for a uniform signature)
 * @param {object} opts     transform opts; opts.useAI toggles the AI path
 * @param {{ get: (ctx) => Promise<object|null> }} composeApi  the api.compose helper
 * @returns {Promise<TransformResult>}
 */
export async function composeWithAI(kind, section, profile, opts = {}, composeApi = null) {
  // Local-only path (default, and the fallback when AI returns null).
  const local = () =>
    kind === 'style'
      ? transformStyle(section, { ...opts, aiHint: null })
      : transformAddMelody(section, { ...opts, aiHint: null });

  if (!opts.useAI || !composeApi || typeof composeApi.get !== 'function') {
    return local();
  }

  const ctx = {
    transform: kind,
    key: section.key,
    scaleType: section.scaleType,
    chords: section.chords.map(c => ({ roman: c.roman, chordName: c.chordName })),
    bars: section.chords.length,
    vibe: opts.vibe || undefined,
  };

  let aiHint = null;
  try {
    aiHint = await composeApi.get(ctx);     // null on 503 / error / malformed
  } catch {
    aiHint = null;
  }
  if (!aiHint) return local();              // graceful fallback — always playable

  return kind === 'style'
    ? transformStyle(section, { ...opts, aiHint })
    : transformAddMelody(section, { ...opts, aiHint });
}

// Easier-chord substitution engine.
//
// Given a chord (by name) that is hard for the user's hand, propose a substitute
// that preserves the harmonic function of the chord within its progression but is
// easier to fret. We only ever suggest a *real* shape that exists in the chord
// library, scored against the user's personal hand profile so the suggestion is
// genuinely easier for THEM, not just on the population-average scale.
//
// Strategies, in order of musical safety:
//   1. Simplify an extension to its plain triad        (Cmaj7 → C, Am7 → Am, G9 → G)
//   2. Reduce a 9th/13th/maj7 etc. to the dominant/triad core
//   3. Fall back to a power chord (root-5) — works in rock/folk/pop contexts
//      and keeps the root, so it never clashes harmonically.
// In every case we only surface the substitute if it is meaningfully easier
// (lower personal difficulty) than the easiest voicing of the original chord.

import { CHORDS } from './chords';
import { calcDifficulty } from './fretboard';
import { personalDifficulty } from './handProfile';

// Build name → easiest-voicing lookup once.
const VOICINGS_BY_NAME = (() => {
  const map = new Map();
  for (const chord of CHORDS) {
    const score = calcDifficulty(chord.notes);
    if (!map.has(chord.name)) map.set(chord.name, []);
    map.get(chord.name).push({ ...chord, score });
  }
  for (const list of map.values()) list.sort((a, b) => a.score - b.score);
  return map;
})();

function voicingsFor(name) {
  return VOICINGS_BY_NAME.get(name) || [];
}

// Split a chord name like "Cmaj7" / "F#m7b5" / "Bb" into { root, quality }.
function parseChord(name) {
  const m = name.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  return { root: m[1], quality: m[2] };
}

// Ordered list of simpler-quality candidates for a given quality.
// We strip extensions toward the underlying triad while keeping major/minor flavor.
function simplerQualities(quality) {
  const q = quality;
  // Minor family → minor triad
  if (/^m(?!aj)/.test(q) || q === 'min') {
    // m7, m9, m6, m7b5, m(maj7)… → m
    return ['m'];
  }
  // Diminished / half-dim → minor triad is a reasonable easy stand-in
  if (q.startsWith('dim') || q.includes('m7b5')) {
    return ['m', ''];
  }
  // Suspended → plain major triad
  if (q.startsWith('sus') || q.startsWith('7sus')) {
    return [''];
  }
  // Augmented → major triad
  if (q.startsWith('aug')) {
    return [''];
  }
  // Dominant / major extensions (7, 9, 11, 13, maj7, maj9, 6, add9, slash…) → major triad
  // (covers '', '7', '9', '13', 'maj7', 'maj9', '6', 'add9', and slash like '/B')
  return [''];
}

const POWER_QUALITY = '5';

/**
 * Find an easier substitute for `chordName` scored against `profile`.
 *
 * Returns null when no substitute is meaningfully easier (i.e. the original is
 * already easy for this hand, or no easier shape exists in the library).
 *
 * Shape of result:
 *   {
 *     original:   { name, personalScore },
 *     substitute: { name, voicing, personalScore, kind },
 *     saved:      number   // how much easier on the 1–10 personal scale
 *   }
 * `kind` ∈ 'simplified' | 'power' — used to label/explain the suggestion.
 */
export function easierSubstitute(chordName, profile, {
  minSaving = 0.6,        // minimum 1–10 improvement for a quality-simplification
  powerMinSaving = 2.0,   // power chords change the sound, so demand a bigger win
  powerHardFloor = 6.5,   // …and only when the original is genuinely hard
} = {}) {
  const origVoicings = voicingsFor(chordName);
  if (!origVoicings.length) return null;

  const origScore = personalDifficulty(origVoicings[0].score, profile);

  const parsed = parseChord(chordName);
  if (!parsed) return null;
  const { root, quality } = parsed;

  // 1–2. Prefer a quality simplification toward the triad — it preserves the
  // chord's flavor far better than a power chord, so try these first.
  let best = null;
  for (const sq of simplerQualities(quality)) {
    if (sq === quality) continue;                 // not a real change
    const candName = root + sq;
    if (candName === chordName) continue;
    const cv = voicingsFor(candName)[0];
    if (!cv) continue;
    const ps = personalDifficulty(cv.score, profile);
    if (origScore - ps < minSaving) continue;
    if (!best || ps < best.personalScore) {
      best = { name: candName, voicing: cv, personalScore: ps, kind: 'simplified' };
    }
  }

  // 3. Power-chord fallback (root-5). Only when no triad simplification helped
  // AND the chord is genuinely hard for this hand — power chords drop the
  // 3rd (major/minor flavor), so they're a last resort, not a default.
  if (!best && origScore >= powerHardFloor) {
    const powerName = root + POWER_QUALITY;
    const pv = powerName !== chordName ? voicingsFor(powerName)[0] : null;
    if (pv) {
      const ps = personalDifficulty(pv.score, profile);
      if (origScore - ps >= powerMinSaving) {
        best = { name: powerName, voicing: pv, personalScore: ps, kind: 'power' };
      }
    }
  }

  if (!best) return null;

  return {
    original:   { name: chordName, personalScore: origScore },
    substitute: best,
    saved:      Math.round((origScore - best.personalScore) * 10) / 10,
  };
}

/**
 * Compute easier substitutes for a whole progression.
 * `chords` is the progression's chord list ({ chordName, voicings }).
 * Returns an array aligned by index; entries are either a substitution result
 * or null (chord already easy / no better option). `count` is how many were found.
 */
export function suggestEasierProgression(chords, profile, opts) {
  const perChord = chords.map(c => easierSubstitute(c.chordName, profile, opts));
  const count = perChord.filter(Boolean).length;
  return { perChord, count };
}

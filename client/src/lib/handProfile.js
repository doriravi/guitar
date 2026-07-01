// Hand profile — personal measurements that calibrate difficulty scores.
// All gaps are in centimeters (measured with hand splayed flat on a surface).

export const DEFAULT_PROFILE = {
  thumbToIndex:   13.5,   // cm  (population avg ~12–15)
  indexToMiddle:   7.5,   // cm  (population avg ~6–9)
  middleToRing:    6.0,   // cm  (population avg ~5–7)
  ringToLittle:    9.5,   // cm  (population avg ~8–11)
};

// Population reference maxima (comfortable stretch, 95th percentile).
// Scores above these values are clamped to difficulty 10.
const REF_MAX = {
  thumbToIndex:   15,
  indexToMiddle:   9,
  middleToRing:    7,
  ringToLittle:   11,
};

/**
 * Derive a personal reach-capacity multiplier from the user's measurements.
 * Returns a value ~1.0 for average hands, <1 for smaller hands (harder), >1 for larger.
 *
 * We weight the four gaps by how much each contributes to chord reach:
 *   - index-to-middle & middle-to-ring drive fret spread (most important)
 *   - ring-to-little adds pinky reach
 *   - thumb-to-index rarely matters for fretting but contributes slightly
 */
export function reachMultiplier(profile) {
  const p = { ...DEFAULT_PROFILE, ...profile };

  const weighted =
    p.thumbToIndex   * 0.10 / REF_MAX.thumbToIndex +
    p.indexToMiddle  * 0.35 / REF_MAX.indexToMiddle +
    p.middleToRing   * 0.35 / REF_MAX.middleToRing +
    p.ringToLittle   * 0.20 / REF_MAX.ringToLittle;

  // weighted is 0..1 where 1 = reference (large) hand
  // multiplier: reference hand → 1.0, smallest plausible hand (~70% of ref) → ~0.7
  return weighted; // already in [0,1] range, use directly
}

/**
 * Re-calibrate a raw difficulty score (1-10, computed for default hand) to the
 * user's personal hand size.  A smaller hand finds the same chord harder.
 *
 * Formula: effectiveDifficulty = rawScore / multiplier, clamped 1-10.
 */
export function personalDifficulty(rawScore, profile) {
  const m = reachMultiplier(profile);
  if (m <= 0) return 10;
  const adjusted = rawScore / m;
  return Math.min(10, Math.max(1, Math.round(adjusted * 10) / 10));
}

/**
 * Recommended "comfortable" max-difficulty ceiling for this hand (1-10).
 *
 * A chord that feels like a mild-to-moderate stretch (displayed ≈ 7/10) is a
 * good upper limit for comfortable play. personalDifficulty maps raw→displayed
 * by dividing by the hand multiplier, so the RAW difficulty that lands at 7 for
 * this hand is `7 * multiplier`. A smaller hand (small multiplier) can only
 * comfortably reach lower raw-difficulty shapes, so it gets a LOWER ceiling; a
 * larger hand gets a higher one. Clamped to 1-10.
 */
export function recommendedMaxDifficulty(profile) {
  const COMFORTABLE_DISPLAYED = 7;
  const m = reachMultiplier(profile);
  const ceiling = COMFORTABLE_DISPLAYED * m;
  return Math.min(10, Math.max(1, Math.round(ceiling)));
}

/**
 * Map a multiplier value to a human-readable ability label.
 */
export function abilityLabel(profile) {
  const m = reachMultiplier(profile);
  if (m >= 0.95) return { label: 'Large hands',   color: 'text-green-600',  desc: 'Above-average reach — most chords will feel comfortable.' };
  if (m >= 0.82) return { label: 'Average hands',  color: 'text-blue-600',   desc: 'Typical adult reach — standard chord shapes are accessible.' };
  if (m >= 0.70) return { label: 'Small hands',    color: 'text-yellow-600', desc: 'Below-average reach — some stretches will feel challenging.' };
  return              { label: 'Very small hands', color: 'text-red-600',    desc: 'Limited reach — many standard chords will require adaptation.' };
}

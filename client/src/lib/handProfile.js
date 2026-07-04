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
 * Is a raw difficulty score within this hand's comfortable reach?
 *
 * Compares the DISPLAYED (personalized) difficulty of a shape against the hand's
 * recommended ceiling. Used app-wide when the user turns on "limit to my reach"
 * so any shape that plays harder than they can comfortably manage is flagged /
 * filtered out. Equal-to-ceiling counts as within reach.
 */
export function isWithinReach(rawScore, profile) {
  return personalDifficulty(rawScore, profile) <= recommendedMaxDifficulty(profile);
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

// reachMultiplier scores a hand as a fraction of the 95th-percentile (large)
// reference, so even a perfectly average hand sits well below 1.0. Grade the
// ability label RELATIVE TO THE AVERAGE HAND (not the max) so normal variation
// isn't over-penalized — otherwise a slightly-small-but-normal hand wrongly
// reads as "Very small". `AVG_MULTIPLIER` is what DEFAULT_PROFILE scores.
const AVG_MULTIPLIER = reachMultiplier(DEFAULT_PROFILE); // ≈ 0.854

/**
 * Map a hand profile to a human-readable ability label. Bands are expressed as
 * a percentage of the average hand's reach: ≥108% large, ≥92% average,
 * ≥78% small, below that very small.
 */
export function abilityLabel(profile) {
  const ratio = reachMultiplier(profile) / AVG_MULTIPLIER; // 1.0 = average hand
  if (ratio >= 1.08) return { label: 'Large hands',   color: 'text-green-600',  desc: 'Above-average reach — most chords will feel comfortable.' };
  if (ratio >= 0.92) return { label: 'Average hands',  color: 'text-blue-600',   desc: 'Typical adult reach — standard chord shapes are accessible.' };
  if (ratio >= 0.78) return { label: 'Small hands',    color: 'text-yellow-600', desc: 'Below-average reach — some stretches will feel challenging.' };
  return                { label: 'Very small hands', color: 'text-red-600',    desc: 'Limited reach — many standard chords will require adaptation.' };
}

// ── Flexibility ───────────────────────────────────────────────────────────────
// Reach (above) measures how BIG the hand's spans are. Flexibility measures a
// different quality: how well the fingers SPREAD APART relative to their own
// span — i.e. suppleness independent of hand size. A small hand can be very
// flexible; a big hand can be stiff. We combine two scale-independent signals:
//
//   1. Spread ratio — the three inter-finger splay gaps (index-middle,
//      middle-ring, ring-little) as a fraction of the whole-hand span
//      (thumb-to-little). Fingers that open wide *for their size* score high.
//   2. Evenness — how close the gap proportions are to the population's typical
//      shape. One tight joint dragging a gap down (a stiff finger) lowers this.

// Reference thumb-to-little span and per-gap shares, from DEFAULT_PROFILE.
const AVG_TOTAL_SPAN =
  DEFAULT_PROFILE.thumbToIndex + DEFAULT_PROFILE.indexToMiddle +
  DEFAULT_PROFILE.middleToRing + DEFAULT_PROFILE.ringToLittle;
// Fraction of the total span carried by the three finger-splay gaps (excludes
// the thumb gap, which is a different joint and dominated by thumb mobility).
const SPLAY_KEYS = ['indexToMiddle', 'middleToRing', 'ringToLittle'];
const AVG_SPLAY_RATIO =
  (DEFAULT_PROFILE.indexToMiddle + DEFAULT_PROFILE.middleToRing + DEFAULT_PROFILE.ringToLittle) / AVG_TOTAL_SPAN;
// Typical proportion of each splay gap within the splay total (its "shape").
const AVG_SHARES = (() => {
  const splayTotal = DEFAULT_PROFILE.indexToMiddle + DEFAULT_PROFILE.middleToRing + DEFAULT_PROFILE.ringToLittle;
  return {
    indexToMiddle: DEFAULT_PROFILE.indexToMiddle / splayTotal,
    middleToRing:  DEFAULT_PROFILE.middleToRing  / splayTotal,
    ringToLittle:  DEFAULT_PROFILE.ringToLittle  / splayTotal,
  };
})();

/**
 * Flexibility score 1–10 (10 = most supple), independent of hand size.
 * Combines spread ratio (how wide the fingers splay for their span) with
 * evenness (how balanced the splay is vs. the typical hand shape).
 */
export function flexibilityScore(profile) {
  const p = { ...DEFAULT_PROFILE, ...profile };
  const total = p.thumbToIndex + p.indexToMiddle + p.middleToRing + p.ringToLittle;
  if (total <= 0) return 1;

  // 1. Spread ratio relative to the average hand's ratio → ~1.0 for average.
  const splay = p.indexToMiddle + p.middleToRing + p.ringToLittle;
  const spreadRatio = (splay / total) / AVG_SPLAY_RATIO;

  // 2. Evenness: 1 minus the average absolute deviation of each gap's share
  //    from its typical share. Perfect match → 1; lopsided → lower.
  const shares = {
    indexToMiddle: p.indexToMiddle / splay,
    middleToRing:  p.middleToRing  / splay,
    ringToLittle:  p.ringToLittle  / splay,
  };
  const dev = SPLAY_KEYS.reduce((s, k) => s + Math.abs(shares[k] - AVG_SHARES[k]), 0) / SPLAY_KEYS.length;
  const evenness = Math.max(0, 1 - dev * 2.5); // scale deviation into a 0..1 penalty

  // Combine: weight spread more than evenness. Map ~1.0 (average) → 6/10 so an
  // average hand reads mid-scale, leaving headroom for genuinely supple hands.
  const combined = spreadRatio * 0.7 + evenness * 0.3;
  const score = combined * 6;
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}

/**
 * Human-readable flexibility label, graded relative to the average hand.
 */
export function flexibilityLabel(profile) {
  const s = flexibilityScore(profile);
  if (s >= 7.5) return { label: 'Very flexible', color: 'text-green-600',  desc: 'Fingers splay wide for their size — wide shapes are within reach.' };
  if (s >= 5.5) return { label: 'Average flexibility', color: 'text-blue-600', desc: 'Typical finger spread — standard shapes should feel natural.' };
  if (s >= 3.5) return { label: 'Somewhat stiff', color: 'text-yellow-600', desc: 'Fingers spread less than average — some spans will feel tight.' };
  return              { label: 'Limited flexibility', color: 'text-red-600', desc: 'Fingers stay close together — favor compact shapes.' };
}

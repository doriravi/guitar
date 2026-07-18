// practiceAdvice.js
// =================
// Turn a single Verified-Practice attempt (the fused camera×mic verdict) into a
// short, plain-language coaching summary shown AFTER the attempt — "what went
// well, what to fix next." Pure logic (no React, no network), so it always works
// offline / in guest mode and is unit-testable. The AI advisor (when the backend
// is reachable) can enrich this, but this rule-based summary is the guaranteed
// baseline and never shows an error.
//
// Input `verdict` is the object from chordVerify.fuseVerdict:
//   { status:'both'|'shape-only'|'sound-only'|'none', agree, reason,
//     perString:[{string, label, cam:'ok|wrong|missing|n/a', mic:'correct|wrong|missing|muted|n/a'}] }

// A 1-5 star score for the attempt, so progress feels tangible across tries.
export function attemptScore(verdict) {
  switch (verdict?.status) {
    case 'both': return 5;
    case 'shape-only': return 3; // fingering right, sound needs cleaning
    case 'sound-only': return 2; // heard it, but we couldn't verify the shape
    default: return 1;
  }
}

// The single most useful "fix this next" tip, derived from the per-string cross
// of the two sensors. Returns null when there's nothing specific to fix.
export function primaryTip(verdict, targetName) {
  const ps = verdict?.perString || [];
  if (verdict?.status === 'both') return null;

  if (verdict?.status === 'sound-only') {
    return 'The sound was right, but the camera couldn’t read your hand — reposition so the whole neck is in frame.';
  }

  // Strings shaped correctly but that didn't ring (the classic beginner fault).
  const dead = ps.filter((p) => p.cam === 'ok' && (p.mic === 'missing' || p.mic === 'muted')).map((p) => p.label);
  if (dead.length) {
    return `String ${dead.join(', ')} didn’t ring. Press just behind the fret and arch that finger so it doesn’t mute the string.`;
  }

  // Strings fretted at the wrong place.
  const wrong = ps.filter((p) => p.cam === 'wrong').map((p) => p.label);
  if (wrong.length) {
    return `String ${wrong.join(', ')} is on the wrong fret — check the ${targetName} shape and move that finger.`;
  }

  // Strings the shape is missing entirely.
  const missing = ps.filter((p) => p.cam === 'missing').map((p) => p.label);
  if (missing.length) {
    return `You’re not covering string ${missing.join(', ')} yet — add that finger to complete ${targetName}.`;
  }

  return `Keep working the ${targetName} shape — hold it firmly and strum slowly.`;
}

// A short positive note about what already worked, so feedback isn't only
// corrective. Returns null when there's nothing to praise yet.
export function positiveNote(verdict, targetName) {
  if (verdict?.status === 'both') return `Clean ${targetName} — fingering and sound both nailed it.`;
  const ps = verdict?.perString || [];
  const okCount = ps.filter((p) => p.cam === 'ok').length;
  if (verdict?.status === 'shape-only') {
    return `Nice — the ${targetName} shape is correct.`;
  }
  if (okCount > 0) return `Good start — ${okCount} string${okCount > 1 ? 's' : ''} already in place.`;
  return null;
}

const HEADLINE = {
  both:         '✅ Verified!',
  'shape-only': '🖐️ Almost — clean up the sound',
  'sound-only': '🔊 Heard it — show your hand',
  none:         '🔁 Not yet',
};

/**
 * Build the full after-attempt summary.
 * @param {object} verdict     fuseVerdict output
 * @param {string} targetName  the target chord's name
 * @returns {{
 *   status:string, stars:number, headline:string,
 *   positive:string|null, tip:string|null, mastered:boolean
 * }}
 */
export function buildAttemptAdvice(verdict, targetName) {
  const stars = attemptScore(verdict);
  return {
    status: verdict?.status || 'none',
    stars,
    headline: HEADLINE[verdict?.status] || HEADLINE.none,
    positive: positiveNote(verdict, targetName),
    tip: primaryTip(verdict, targetName),
    mastered: verdict?.status === 'both',
  };
}

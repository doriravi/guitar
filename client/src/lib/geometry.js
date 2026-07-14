// Shared physical fretboard geometry — the single source of truth for where a
// note actually sits on a real neck, in millimetres.
//
// Both the Fretboard Measures visualizer (components/FretboardMeasures.jsx) and
// the reach engine (lib/fretboard.js) measure through THIS module, so the
// picture the user sees and the difficulty score the app computes are derived
// from the same equal-temperament ("Rule of 18") geometry and can never
// disagree.
//
// A note is { string: 0-5, fret: 0-22 }. String 0 = low E, string 5 = high e.
// Coordinates are in mm from the top-left origin at the nut.

// ── Instrument dimensions (mm) ────────────────────────────────────────────────
// Classical is the app default (the target user plays a 4/4 classical). Electric
// is offered for the side-by-side comparison in the visualizer.
export const INSTRUMENTS = {
  classical: {
    label: 'Classical (4/4)',
    scaleLength: 650,      // mm, nut → saddle
    nutWidth: 52,          // mm, neck width at the nut
    twelfthWidth: 62,      // mm, neck width at the 12th fret
    nutStringSpan: 43,     // mm, low-E → high-E centre span at the nut
    bridgeStringSpan: 50,  // mm, low-E → high-E span down the neck
  },
  electric: {
    label: 'Electric / Acoustic',
    scaleLength: 648,      // mm (25.5")
    nutWidth: 43,
    twelfthWidth: 54,
    nutStringSpan: 35,
    bridgeStringSpan: 52,
  },
};

export const NUM_STRINGS = 6;

// ── Equal-temperament fret spacing ────────────────────────────────────────────
// Distance from the nut to fret WIRE n along the scale. d(12) === scaleLength/2
// exactly, which is the physical property that makes this correct rather than
// the old linear approximation.
export function fretWireMm(scaleLength, n) {
  return scaleLength * (1 - 1 / Math.pow(2, n / 12));
}

/**
 * Build a geometry helper bound to one instrument. Everything spatial — the
 * visualizer's dots AND the engine's distances — goes through the returned
 * `coord()` so there is exactly one geometry in the codebase.
 *
 * @param {object} inst one of INSTRUMENTS (defaults to classical)
 */
export function makeGeometry(inst = INSTRUMENTS.classical) {
  const twelfthX = fretWireMm(inst.scaleLength, 12); // === scaleLength / 2

  // Playable x for a note: the nut for an open string, else the MIDDLE of the
  // bracket between fret wire (n-1) and wire n — where the fingertip lands.
  const noteX = (fret) => {
    if (fret <= 0) return 0;
    return (fretWireMm(inst.scaleLength, fret - 1) + fretWireMm(inst.scaleLength, fret)) / 2;
  };

  // Neck half-width and string span both taper linearly in x, calibrated so the
  // nut values hold at x=0 and the 12th-fret values hold at x=twelfthX; the
  // slope extrapolates past fret 12.
  const halfWidthAt = (x) => (inst.nutWidth + (inst.twelfthWidth - inst.nutWidth) * (x / twelfthX)) / 2;
  const spanAt = (x) => inst.nutStringSpan + (inst.bridgeStringSpan - inst.nutStringSpan) * (x / twelfthX);

  // String i (0 = low E at the top) y-centre at this x.
  const stringY = (i, x) => {
    const center = halfWidthAt(0) + 4; // small top margin, neck centred
    const span = spanAt(x);
    return center - span / 2 + (i * span) / (NUM_STRINGS - 1);
  };

  // THE function every measurement and every dot position derives from.
  const coord = (stringIndex, fretIndex) => {
    const xMm = noteX(fretIndex);
    return { xMm, yMm: stringY(stringIndex, xMm) };
  };

  return {
    inst,
    coord,
    noteX,
    fretWireMm: (n) => fretWireMm(inst.scaleLength, n),
    halfWidthAt,
    spanAt,
    twelfthX,
  };
}

// A module-level default-classical geometry for callers that don't need to pick
// an instrument (the reach engine). Built once.
export const CLASSICAL = makeGeometry(INSTRUMENTS.classical);

/**
 * Straight-line (Euclidean) physical distance between two notes, in mm, on the
 * given geometry (default classical). This is the exact diagonal hand-stretch
 * the visualizer draws — and what the reach engine now scores from.
 */
export function noteDistanceMm(noteA, noteB, geo = CLASSICAL) {
  const a = geo.coord(noteA.string, noteA.fret);
  const b = geo.coord(noteB.string, noteB.fret);
  return Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
}

/**
 * Axis-separated spans between two notes, in mm: along the neck (horizontal),
 * across the strings (vertical), and the Euclidean diagonal.
 */
export function noteSpansMm(noteA, noteB, geo = CLASSICAL) {
  const a = geo.coord(noteA.string, noteA.fret);
  const b = geo.coord(noteB.string, noteB.fret);
  const horizontal = Math.abs(b.xMm - a.xMm);
  const vertical = Math.abs(b.yMm - a.yMm);
  return { horizontal, vertical, diagonal: Math.hypot(horizontal, vertical) };
}

/**
 * The widest diagonal hand-stretch a chord shape demands: the max pairwise
 * physical distance between any two of its notes, in mm. This is the geometric
 * "reach" the difficulty score is calibrated against. Fewer than two notes → 0.
 */
export function maxReachMm(notes, geo = CLASSICAL) {
  if (!notes || notes.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const d = noteDistanceMm(notes[i], notes[j], geo);
      if (d > max) max = d;
    }
  }
  return max;
}

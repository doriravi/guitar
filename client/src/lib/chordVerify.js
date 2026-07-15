// chordVerify.js
// ==============
// Fuse the two independent chord detectors — the CAMERA (which sees the
// fingering: which (string,fret) cells are pressed) and the MICROPHONE (which
// hears the sound: which chord actually rang and per-string whether each note
// sounded) — into a single, more reliable, more diagnostic verdict.
//
// Why fuse: the two sensors have orthogonal blind spots.
//   - The mic hears a chord but can't tell HOW you fretted it: a buzzed or
//     half-muted string can still let an ambiguous chord ring.
//   - The camera sees the shape but can't tell whether the strings actually
//     sounded cleanly (occlusion, a lifted finger that still looks placed).
// Requiring BOTH to agree is a stricter "correct", and when they disagree the
// cross-product tells the player WHY (e.g. "shape right, but string 4 muted").
//
// Pure logic — no camera, no mic, no React — so it is unit-testable in isolation.
// Data shapes it consumes (all already produced elsewhere in the app):
//   - camera positions: [{string, fret}]         (fretboardMap.mapHandToPositions)
//   - camera chord name: "C" | "Am" | "G7" | null (chordAnalyzer.detectChord)
//   - target chord:      { name, tab, notes:[{string,fret}] } (chords.js entry)
//   - mic chord:         "<name>" | null           (matchChordConfigured().chord.name)
//   - mic stringResults: [{string, expected:'muted'|'play',
//                          status:'muted'|'missing'|'correct'|'wrong', fret?}]
//                        (pitchDetect.evaluateStrings)

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

/**
 * The target voicing's fretted positions, as [{string, fret}] (open/muted
 * strings are not in `notes`, matching the camera's fretted-only output).
 */
export function expectedPositions(targetChord) {
  if (!targetChord || !Array.isArray(targetChord.notes)) return [];
  return targetChord.notes.map((n) => ({ string: n.string, fret: n.fret }));
}

/**
 * Diff the camera's detected positions against the target voicing, per string.
 *
 * @returns {{
 *   matchedStrings: number[],   // fretted correctly (right string & fret)
 *   wrongStrings:   number[],   // fretted, but wrong fret vs the target
 *   missingStrings: number[],   // target expects a fretted note here, camera saw none
 *   extraStrings:   number[],   // camera saw a fretted note the target doesn't want
 *   isShapeMatch:   boolean     // every expected fretted string matched, no wrong/missing
 * }}
 */
export function compareShape(cameraPositions, targetChord) {
  const expected = expectedPositions(targetChord);
  const expByString = new Map(expected.map((p) => [p.string, p.fret]));
  const camByString = new Map(
    (cameraPositions || []).map((p) => [p.string, p.fret]),
  );

  const matchedStrings = [];
  const wrongStrings = [];
  const missingStrings = [];
  const extraStrings = [];

  for (const [string, fret] of expByString) {
    if (!camByString.has(string)) {
      missingStrings.push(string);
    } else if (camByString.get(string) === fret) {
      matchedStrings.push(string);
    } else {
      wrongStrings.push(string);
    }
  }
  for (const string of camByString.keys()) {
    if (!expByString.has(string)) extraStrings.push(string);
  }

  const isShapeMatch =
    expByString.size > 0 &&
    matchedStrings.length === expByString.size &&
    wrongStrings.length === 0 &&
    missingStrings.length === 0;

  return {
    matchedStrings: matchedStrings.sort((a, b) => a - b),
    wrongStrings: wrongStrings.sort((a, b) => a - b),
    missingStrings: missingStrings.sort((a, b) => a - b),
    extraStrings: extraStrings.sort((a, b) => a - b),
    isShapeMatch,
  };
}

// Normalize a chord name for comparison. Enharmonics already resolve upstream
// (chordAnalyzer emits sharps; the library stores one spelling), so a simple
// case-sensitive equality is right — but guard against null/whitespace.
function nameEq(a, b) {
  if (!a || !b) return false;
  return a.trim() === b.trim();
}

/**
 * Fuse the camera and mic readings against the target chord.
 *
 * @param {object} args
 * @param {string|null} args.cameraChord     camera-detected chord name
 * @param {object}      args.cameraShape     result of compareShape(...)
 * @param {string|null} args.micChord        mic-detected chord name
 * @param {Array|null}  args.micStringResults evaluateStrings(...) output
 * @param {string}      args.targetName      the target chord's name
 * @returns {{
 *   status: 'both'|'shape-only'|'sound-only'|'none',
 *   agree: boolean,
 *   reason: string,
 *   perString: Array<{string:number, label:string, cam:string, mic:string}>
 * }}
 */
export function fuseVerdict({ cameraChord, cameraShape, micChord, micStringResults, targetName }) {
  // Shape channel: the fingering is "right" when either the detected NAME equals
  // the target OR the per-string shape fully matches the target voicing. (Name
  // equality alone can hold for an alternate voicing; shape match is stricter.)
  const shapeMatch = cameraShape?.isShapeMatch || nameEq(cameraChord, targetName);
  // Sound channel: the mic heard the target chord.
  const soundMatch = nameEq(micChord, targetName);

  let status;
  if (shapeMatch && soundMatch) status = 'both';
  else if (shapeMatch) status = 'shape-only';
  else if (soundMatch) status = 'sound-only';
  else status = 'none';

  // Per-string cross-product of the two sensors, for the overlay + reason text.
  const micByString = new Map(
    (micStringResults || []).map((r) => [r.string, r.status]),
  );
  const camMatched = new Set(cameraShape?.matchedStrings || []);
  const camWrong = new Set(cameraShape?.wrongStrings || []);
  const camMissing = new Set(cameraShape?.missingStrings || []);

  const perString = [];
  for (let s = 0; s < 6; s++) {
    let cam = 'n/a';
    if (camMatched.has(s)) cam = 'ok';
    else if (camWrong.has(s)) cam = 'wrong';
    else if (camMissing.has(s)) cam = 'missing';
    const mic = micByString.get(s) || 'n/a';
    if (cam === 'n/a' && (mic === 'n/a' || mic === 'muted')) continue; // uninvolved string
    perString.push({ string: s, label: STRING_LABELS[s], cam, mic });
  }

  return { status, agree: status === 'both', reason: buildReason(status, perString, targetName), perString };
}

// Human-readable teaching signal derived from the fused per-string picture.
function buildReason(status, perString, targetName) {
  if (status === 'both') return `Clean ${targetName} — fingering and sound both match.`;
  if (status === 'sound-only') {
    return `Heard ${targetName}, but the camera can’t read your hand — reposition so the neck is in frame.`;
  }
  if (status === 'shape-only') {
    // Fingering is right but the chord didn't sound right: find strings that are
    // shaped OK yet didn't ring (muted/missing to the mic) — the usual culprit.
    const dead = perString
      .filter((p) => p.cam === 'ok' && (p.mic === 'missing' || p.mic === 'muted'))
      .map((p) => p.label);
    if (dead.length) {
      return `Shape is right, but string ${dead.join(', ')} didn’t sound — press harder or clear the touch.`;
    }
    return `Shape is right, but the sound didn’t match — check for buzzing or a muted string.`;
  }
  // none
  const wrong = perString.filter((p) => p.cam === 'wrong' || p.cam === 'missing').map((p) => p.label);
  if (wrong.length) return `Not ${targetName} yet — fix string ${wrong.join(', ')}.`;
  return `Hold the ${targetName} shape and strum.`;
}

/**
 * Map a fused verdict to FretboardDiagram `marks` ({ [string]: 'missing'|'weak' })
 * so the target diagram can paint per-string right/wrong live. A string that the
 * camera fretted wrong or missed is 'missing' (red); a string that's shaped OK
 * but didn't sound (mic missing/muted) is 'weak' (amber = buzzing/half-pressed).
 */
export function verdictToMarks(perString) {
  const marks = {};
  for (const p of perString || []) {
    if (p.cam === 'wrong' || p.cam === 'missing') marks[p.string] = 'missing';
    else if (p.cam === 'ok' && (p.mic === 'missing' || p.mic === 'muted')) marks[p.string] = 'weak';
  }
  return marks;
}

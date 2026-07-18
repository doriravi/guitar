// scaleGame.js
// ============
// The scoring + box math for "Scale Quest" — the scale-practice game. Pure JS,
// no React, no DOM, no mic. Everything here is unit-testable against real guitar
// facts, which is deliberate: this module is where the game's HONESTY lives, and
// honesty you can't test is just a claim.
//
// The one hard constraint the whole design bends around
// -----------------------------------------------------
// Audio detection gives a PITCH (with octave, via detectPitchYIN -> hzToMidi),
// never a string/fret. An A on the open A-string and an A on the low-E 5th fret
// are the same sound. So the game can NEVER verify which fret you played from
// audio alone. It inverts the causality instead: it PROMPTS one exact position,
// then listens for the specific MIDI that position uniquely produces — and it
// only claims to score "position" inside a box that has been PROVEN collision-
// free (see boxIsUnambiguous, whose test is ship-blocking). Where the same pitch
// is reachable twice (a "twin"), the game surfaces it and counts either, rather
// than silently mis-scoring an ambiguity the audio can't resolve.
//
// Reuse, not reinvention
// ----------------------
// Scale note sets come from improvEngine (SCALE_FORMULAS / scalePositions). Star
// and letter grades come from scalePractice/practiceGame (scoreToStars/gradeFor)
// verbatim — no new thresholds are invented here.

import { SCALE_FORMULAS, scalePositions } from './improvEngine';
import { OPEN_STRING_MIDI } from './chordAnalyzer';
import { scoreToStars } from './scalePractice';
import { gradeFor } from './practiceGame';

export const NUM_STRINGS = 6;

// The pedagogical unlock ladder — pentatonics first (one box, universal), full
// scales and modes later. Ids are SCALE_FORMULAS keys.
export const SCALE_UNLOCK_ORDER = [
  'minorPentatonic', 'majorPentatonic', 'blues', 'majorBlues',
  'naturalMinor', 'major', 'mixolydian', 'dorian',
  'phrygian', 'lydian', 'locrian', 'harmonicMinor', 'melodicMinor',
];

// The BPM ramp for the speed goal, and the honest ceiling above which YIN can't
// commit a pitch fast enough to score per-note (see the design brief). Beyond it
// the game must switch to onset-count "speed burst" scoring — not built in v1.
export const SPEED_STEPS = [60, 80, 100, 120];
export const PITCH_VERIFIED_CEILING_BPM = 120;

// Match tolerance in cents. Tighter than pitchDetect's ±60 chord tolerance so an
// ADJACENT fret (100 cents away) can never pass as correct.
export const MATCH_CENTS = 40;

// ── Exact MIDI on the neck ───────────────────────────────────────────────────
// Integer, derived from the same open-string table the rest of the app uses, so
// the collision math is exact (no float rounding of fretMidi's Hz round-trip).

/** Exact MIDI note number at (string, fret). string 0 = low E .. 5 = high e. */
export function fretMidiExact(string, fret) {
  return OPEN_STRING_MIDI[string] + fret;
}

// ── The collision predicate — the ship-blocking honesty check ────────────────

/**
 * Is this fret-window box UNAMBIGUOUS for a scale — i.e. does every in-box scale
 * note produce a DISTINCT exact-MIDI pitch? If two cells share a MIDI (e.g. the
 * G-string 9th fret and the B-string 5th fret are both E4/MIDI 64), then hearing
 * that pitch cannot tell which cell was played, and any "you played the target
 * position" claim in that box would be a lie.
 *
 * The game offers ONLY boxes that pass this, so position scoring is honest by
 * construction. Its unit test is ship-blocking: the verified A-min-pentatonic
 * 5-8 box must pass; the 5-9 box (which contains MIDI 64 twice) must fail.
 *
 * @param {{minFret:number,maxFret:number}} box
 * @param {Set<number>} scaleSet pitch classes in the scale (0..11)
 * @returns {{ok:boolean, collisions:Array<{midi:number, cells:Array<{string:number,fret:number}>}>}}
 */
export function boxIsUnambiguous(box, scaleSet) {
  const byMidi = new Map(); // exact MIDI -> [cells]
  for (let string = 0; string < NUM_STRINGS; string++) {
    for (let fret = box.minFret; fret <= box.maxFret; fret++) {
      const pc = fretMidiExact(string, fret) % 12;
      if (!scaleSet.has(pc)) continue;
      const midi = fretMidiExact(string, fret);
      if (!byMidi.has(midi)) byMidi.set(midi, []);
      byMidi.get(midi).push({ string, fret });
    }
  }
  const collisions = [];
  for (const [midi, cells] of byMidi) {
    if (cells.length > 1) collisions.push({ midi, cells });
  }
  return { ok: collisions.length === 0, collisions };
}

/**
 * The set of pitch classes for a scale, from SCALE_FORMULAS. Small helper so
 * callers don't re-implement the root+formula math.
 */
export function scaleSetOf(root, scaleId) {
  const formula = SCALE_FORMULAS[scaleId];
  if (!formula) return null;
  const rootPc = ((root % 12) + 12) % 12;
  return new Set(formula.map((iv) => (rootPc + iv) % 12));
}

/**
 * Slice a scale into ~5-fret position boxes across the neck and flag which are
 * collision-free. The setup screen offers only the clean ones for position
 * modes. Boxes are anchored to the lowest fret where a scale note sits and step
 * up the neck; each is `width` frets wide (default 4 -> a 5-fret span inclusive).
 *
 * @param {number} root pitch class 0..11
 * @param {string} scaleId a SCALE_FORMULAS key
 * @param {object} [opts]
 * @param {number} [opts.width=4]     frets above minFret the box spans (span = width+1)
 * @param {number} [opts.maxFret=15]  highest fret to consider
 * @returns {Array<{id:string,label:string,minFret:number,maxFret:number,clean:boolean,collisions:Array}>|null}
 */
export function scaleBoxes(root, scaleId, opts = {}) {
  const scaleSet = scaleSetOf(root, scaleId);
  if (!scaleSet) return null;
  const width = opts.width ?? 4;
  const maxFret = opts.maxFret ?? 15;
  const rootPc = ((root % 12) + 12) % 12;

  // Candidate box starts: fret positions of the ROOT on the low-E and A strings
  // (the natural "position" anchors a guitarist thinks in), clamped to the neck.
  const starts = new Set();
  for (const string of [0, 1]) {
    for (let fret = 0; fret + width <= maxFret; fret++) {
      if ((fretMidiExact(string, fret) % 12) === rootPc) starts.add(fret);
    }
  }
  // Always include an open-position box.
  starts.add(0);

  const boxes = [];
  let n = 1;
  for (const minFret of [...starts].sort((a, b) => a - b)) {
    const maxF = minFret + width;
    if (maxF > maxFret) continue;
    const { ok, collisions } = boxIsUnambiguous({ minFret, maxFret: maxF }, scaleSet);
    boxes.push({
      id: `pos${n}`,
      label: `Pos ${n} · fr ${minFret}–${maxF}`,
      minFret, maxFret: maxF, clean: ok, collisions,
    });
    n += 1;
  }
  return boxes;
}

// ── Target sequences — what the game asks you to play ────────────────────────

const DEGREE_NAME = {
  0: 'R', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4',
  6: 'b5', 7: '5', 8: 'b6', 9: '6', 10: 'b7', 11: '7',
};

/**
 * Build the ordered target sequence for a drill. Each target carries everything
 * the UI and scorer need: its cell, exact MIDI, degree, and its twins (other
 * cells in the box that make the same MIDI — empty in a clean box).
 *
 * mode:
 *   'run'  — the scale ascending by pitch, then mirrored for the descent (one
 *            up-and-down lap). The classic scale run.
 *   'hunt' — the box's cells in a shuffled-but-deterministic order (memory).
 *
 * @param {number} root
 * @param {string} scaleId
 * @param {object} params
 * @param {{minFret:number,maxFret:number}} params.box
 * @param {'run'|'hunt'} [params.mode='run']
 * @param {number} [params.seed=1]  determinism for 'hunt' order (no Math.random)
 * @returns {Array<{string,fret,midi,pc,degree,interval,twins,octaveUnique}>}
 */
export function buildTargetSequence(root, scaleId, params = {}) {
  const { box, mode = 'run', seed = 1 } = params;
  if (!box) return [];
  const rootPc = ((root % 12) + 12) % 12;
  const cells = scalePositions(root, scaleId, { minFret: box.minFret, maxFret: box.maxFret });
  if (!cells || !cells.length) return [];

  // Twin map: which cells share an exact MIDI within this box.
  const byMidi = new Map();
  for (const c of cells) {
    const midi = fretMidiExact(c.string, c.fret);
    if (!byMidi.has(midi)) byMidi.set(midi, []);
    byMidi.get(midi).push(c);
  }

  const enrich = (c) => {
    const midi = fretMidiExact(c.string, c.fret);
    const sharing = byMidi.get(midi).filter((o) => o.string !== c.string || o.fret !== c.fret);
    return {
      string: c.string, fret: c.fret, midi, pc: c.pc,
      degree: DEGREE_NAME[(c.pc - rootPc + 12) % 12], interval: c.interval,
      twins: sharing.map((o) => ({ string: o.string, fret: o.fret })),
      octaveUnique: sharing.length === 0,
    };
  };

  if (mode === 'hunt') {
    // Deterministic shuffle (no Math.random — it's unavailable in workflows and
    // makes tests flaky). A small LCG walk over the ascending list.
    const asc = [...cells].sort(byPitch).map(enrich);
    const out = [];
    const used = new Array(asc.length).fill(false);
    let x = (seed * 2654435761) >>> 0;
    for (let i = 0; i < asc.length; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      let idx = x % asc.length;
      // linear-probe to the next unused slot
      let guard = 0;
      while (used[idx] && guard < asc.length) { idx = (idx + 1) % asc.length; guard += 1; }
      used[idx] = true;
      out.push(asc[idx]);
    }
    return out;
  }

  // 'run': ascending by pitch, then descending (drop the duplicated turnaround
  // note so the top note isn't played twice in a row).
  const asc = [...cells].sort(byPitch).map(enrich);
  const desc = [...asc].reverse().slice(1);
  return [...asc, ...desc];

  function byPitch(a, b) {
    return fretMidiExact(a.string, a.fret) - fretMidiExact(b.string, b.fret);
  }
}

// ── Ordered alignment — the accuracy backbone the old grader lacked ──────────

/**
 * Monotonic (order-preserving) alignment of the played MIDI sequence to the
 * target sequence — a lightweight Needleman-Wunsch. Returns how much of the
 * target was matched IN ORDER, so a run that plays the right notes in the wrong
 * order scores low (a scale run's whole point is the order).
 *
 * A played note matches a target when their exact MIDI is within `tolMidi`
 * semitones (default 0 — exact match; the caller has already quantized cents).
 *
 * @param {number[]} playedMidi committed MIDI notes, in the order sounded
 * @param {number[]} targetMidi the target sequence's exact MIDI
 * @param {number} [tolMidi=0]
 * @returns {{orderMatch:number, matched:number, alignment:Array<[number,number]>}}
 */
export function alignOrdered(playedMidi, targetMidi, tolMidi = 0) {
  const P = playedMidi.length, T = targetMidi.length;
  if (T === 0) return { orderMatch: 0, matched: 0, alignment: [] };
  // DP table of longest in-order match count.
  const dp = Array.from({ length: P + 1 }, () => new Int32Array(T + 1));
  for (let i = 1; i <= P; i++) {
    for (let j = 1; j <= T; j++) {
      const hit = Math.abs(playedMidi[i - 1] - targetMidi[j - 1]) <= tolMidi;
      dp[i][j] = hit
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack for the alignment pairs.
  const alignment = [];
  let i = P, j = T;
  while (i > 0 && j > 0) {
    const hit = Math.abs(playedMidi[i - 1] - targetMidi[j - 1]) <= tolMidi;
    if (hit && dp[i][j] === dp[i - 1][j - 1] + 1) { alignment.push([i - 1, j - 1]); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  alignment.reverse();
  const matched = dp[P][T];
  return { orderMatch: matched / T, matched, alignment };
}

// ── Accuracy — extends gradeScaleRun's idea with order + octave ──────────────

/**
 * Grade a scale run for ACCURACY: in-scale (purity), all notes covered
 * (coverage), and — the part the old set-based grader threw away — played IN
 * ORDER (orderMatch). Blend and thresholds match the design brief.
 *
 * @param {Array<{midi:number}>} playedNotes committed notes, in order
 * @param {Array<{midi:number,pc:number}>} targets the target sequence
 * @param {object} ctx
 * @param {number} ctx.rootPc
 * @param {Set<number>} ctx.scaleSet
 * @returns {{accuracy:number, orderMatch:number, coverage:number, purity:number,
 *            tonicLanded:boolean, matched:number}}
 */
export function gradeScaleRunOrdered(playedNotes, targets, ctx) {
  const played = playedNotes || [];
  const playedMidi = played.map((n) => n.midi);
  const targetMidi = targets.map((t) => t.midi);
  const playedPc = new Set(played.map((n) => ((n.midi % 12) + 12) % 12));

  // Coverage — fraction of the scale's distinct notes actually sounded.
  const targetPc = new Set(targets.map((t) => ((t.midi % 12) + 12) % 12));
  const coveredPc = [...targetPc].filter((pc) => playedPc.has(pc)).length;
  const coverage = targetPc.size ? coveredPc / targetPc.size : 0;

  // Purity — of the notes sounded, fraction in the scale.
  const inScale = played.filter((n) => ctx.scaleSet.has(((n.midi % 12) + 12) % 12)).length;
  const purity = played.length ? inScale / played.length : 0;

  const { orderMatch } = alignOrdered(playedMidi, targetMidi, 0);

  // Tonic landing — first AND last graded note is the root.
  const firstPc = played.length ? ((played[0].midi % 12) + 12) % 12 : -1;
  const lastPc = played.length ? ((played[played.length - 1].midi % 12) + 12) % 12 : -1;
  const tonicLanded = firstPc === ctx.rootPc && lastPc === ctx.rootPc;

  const accuracy = 0.5 * orderMatch + 0.2 * coverage + 0.3 * purity;
  return {
    accuracy, orderMatch, coverage, purity, tonicLanded,
    matched: Math.round(orderMatch * targets.length),
  };
}

// ── Speed — from onset timing, honest below the detector ceiling ─────────────

/**
 * Score SPEED from the onset timestamps of the played notes against a target
 * tempo. Rewards keeping tempo (even inter-onset intervals) as much as raw
 * speed, and caps so faster-but-sloppy never beats on-tempo.
 *
 * @param {number[]} onsetTimesMs audio-onset timestamps (ms), monotonic
 * @param {object} p
 * @param {number} p.targetNps  target notes per second (BPM-derived by caller)
 * @param {number} p.runDurationMs total scored window length
 * @param {number} [p.latencyMs=0] measured detector latency, already subtracted
 *                                  by the caller if it wishes (kept for clarity)
 * @returns {{achievedNps:number, tempoRatio:number, tempoStability:number, speed:number}}
 */
export function scoreSpeed(onsetTimesMs, p) {
  const onsets = (onsetTimesMs || []).slice().sort((a, b) => a - b);
  const durSec = Math.max(1e-3, (p.runDurationMs || 0) / 1000);
  const achievedNps = onsets.length / durSec;
  const tempoRatio = p.targetNps > 0 ? Math.min(1, achievedNps / p.targetNps) : 0;

  // Inter-onset-interval stability: 1 - coefficient of variation, clamped.
  let tempoStability = onsets.length >= 3 ? computeStability(onsets) : (onsets.length ? 0.5 : 0);

  const speed = 0.7 * tempoRatio + 0.3 * tempoStability;
  return { achievedNps, tempoRatio, tempoStability, speed };
}

function computeStability(onsets) {
  const iois = [];
  for (let i = 1; i < onsets.length; i++) iois.push(onsets[i] - onsets[i - 1]);
  const mean = iois.reduce((a, b) => a + b, 0) / iois.length;
  if (mean <= 0) return 0;
  const variance = iois.reduce((a, b) => a + (b - mean) ** 2, 0) / iois.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(1, 1 - cv));
}

// ── Fretboard memory — the honest position score (Note-Hunt / Boss only) ──────

/**
 * Score FRETBOARD MEMORY. Nested so all three factors must be present for a high
 * score, with floors so a right-but-slow run doesn't zero. Only meaningful in a
 * collision-free box (octaveMatch is trustworthy only there).
 *
 * @param {object} p
 * @param {number} p.octaveMatch fraction of prompts answered with the exact MIDI
 * @param {number} p.orderMatch  from alignOrdered
 * @param {number} p.tempoStability from scoreSpeed
 * @returns {{memory:number, region:'in-box'|'drifting'}}
 */
export function scoreFretboardMemory(p) {
  const octaveMatch = clamp01(p.octaveMatch);
  const orderMatch = clamp01(p.orderMatch);
  const stability = clamp01(p.tempoStability);
  const memory = octaveMatch * (0.4 + 0.6 * orderMatch) * (0.5 + 0.5 * stability);
  return { memory, region: octaveMatch >= 0.75 ? 'in-box' : 'drifting' };
}

// ── Per-target capture — the ring-over defense (THE #1 engineering risk) ─────
// When you play an ascending run, the PREVIOUS string keeps ringing under the
// new note. YIN on that two-note blend returns an unstable, often wrong pitch —
// so a naive "commit every stable pitch" loop mis-reads half a real scale run.
//
// The fix is to commit a note only on evidence of a NEW attack:
//   - an ONSET (a sharp RMS rise — makeOnsetDetector already gives this), OR
//   - a STABLE genuinely-different pitch held for STABLE_FRAMES frames (covers
//     legato / hammer-ons / pull-offs, which have no clean re-attack).
// After committing, a short refractory blocks a second commit until either the
// pitch changes again or another onset fires — so one plucked note commits once,
// even while it rings and YIN keeps returning it.
//
// This is a pure state machine over a frame stream: feed it {midi, rms, onset,
// tMs} per frame, it returns a committed note (or null). No mic, no React — so
// the ring-over logic is unit-testable against synthetic frame sequences.

export const CAPTURE_STABLE_FRAMES = 3;   // frames a new pitch must hold to commit (legato path)
export const CAPTURE_STABLE_CENTS = 45;   // within this, two reads are "the same pitch"
export const CAPTURE_SILENCE_RMS = 0.01;  // below this, treat as silence (a gap)

/**
 * Make a per-target note-capture state machine.
 *
 * @param {object} [opts]
 * @param {number} [opts.stableFrames=CAPTURE_STABLE_FRAMES]
 * @param {number} [opts.stableCents=CAPTURE_STABLE_CENTS]
 * @param {number} [opts.silenceRms=CAPTURE_SILENCE_RMS]
 * @returns {{ push:(f:{midi:number|null, rms:number, onset:boolean, tMs:number}) => ({midi:number, tMs:number}|null), reset:()=>void }}
 */
export function makeNoteCapture(opts = {}) {
  const stableFrames = opts.stableFrames ?? CAPTURE_STABLE_FRAMES;
  const stableCents = opts.stableCents ?? CAPTURE_STABLE_CENTS;
  const silenceRms = opts.silenceRms ?? CAPTURE_SILENCE_RMS;

  let candMidi = null;     // pitch currently stabilizing
  let candFrames = 0;
  let committedMidi = null; // the last note we committed (still ringing)
  let armed = true;         // may we commit right now? (refractory gate)

  const sameNote = (a, b) => a != null && b != null && Math.abs(a - b) * 100 <= stableCents;

  return {
    push(f) {
      const { midi, rms, onset, tMs } = f;
      // Silence: a real gap. Reset everything and re-arm so a repeat of the same
      // note (played again after release) counts as a new note.
      if (midi == null || rms < silenceRms) {
        candMidi = null; candFrames = 0; committedMidi = null; armed = true;
        return null;
      }

      // Track the stabilizing candidate.
      if (sameNote(midi, candMidi)) {
        candFrames += 1;
        candMidi = (candMidi + midi) / 2; // light smoothing
      } else {
        candMidi = midi; candFrames = 1;
      }

      // A fresh attack re-arms us even mid-ring (you re-plucked the same string).
      if (onset) armed = true;

      const isNewPitch = !sameNote(candMidi, committedMidi);
      let commit = null;

      // Two independent commit paths:
      //  1. ONSET path — a fresh attack, even on the SAME pitch (re-picking a
      //     string). Gated by `armed` so one pluck's long ring commits once.
      //  2. LEGATO path — a stable, genuinely NEW pitch with no onset (hammer-on /
      //     pull-off). This does NOT need `armed`: a different held pitch is
      //     itself the evidence of a new note, and it can't retrigger the same
      //     note because isNewPitch is required.
      if (armed && onset && candFrames >= 1) {
        commit = candMidi;
      } else if (isNewPitch && candFrames >= stableFrames) {
        commit = candMidi;
      }

      if (commit != null) {
        committedMidi = commit;
        // Refractory only matters for the onset path (same-pitch re-picks); the
        // legato path is already guarded by isNewPitch. Disarm either way; a new
        // onset or a new pitch re-opens committing.
        armed = false;
        return { midi: Math.round(commit), tMs };
      }
      return null;
    },
    reset() { candMidi = null; candFrames = 0; committedMidi = null; armed = true; },
  };
}

/**
 * Does a committed note match a target's EXACT MIDI (right note, right octave)?
 *
 * Capture rounds to integer MIDI, so with the default ±40-cent tolerance this is
 * an exact-MIDI match: a semitone off is 100 cents, well outside 40, so an
 * ADJACENT FRET can never pass — which is the whole point (an adjacent fret is
 * the near-miss that would let a fumbled position score as correct).
 *
 * @param {number} playedMidi committed (integer) MIDI from makeNoteCapture
 * @param {number} targetMidi target's exact MIDI (fretMidiExact)
 * @param {number} [tolCents=MATCH_CENTS]
 * @returns {boolean}
 */
export function midiMatches(playedMidi, targetMidi, tolCents = MATCH_CENTS) {
  return Math.abs(playedMidi - targetMidi) * 100 <= tolCents;
}

// ── Turning a 0..1 track into a star/letter grade (reuse, no new thresholds) ──

/**
 * Convert a 0..1 track score to the app's star + letter grade, with the pass
 * CAPS from the design brief applied. Caps are guards so a fast-but-wrong-order
 * run can't buy five stars:
 *   purity   < 0.90 -> capped at C
 *   order    < 0.85 -> capped at B
 *   tonic not landed (when required) -> capped at B
 *
 * @param {number} track01  the goal's 0..1 score
 * @param {object} [caps]
 * @param {number} [caps.purity] 0..1
 * @param {number} [caps.orderMatch] 0..1
 * @param {boolean} [caps.tonicRequired]
 * @param {boolean} [caps.tonicLanded]
 * @returns {{score:number, stars:number, grade:string, capped:string|null}}
 */
export function scoreScaleTrack(track01, caps = {}) {
  let score = Math.round(clamp01(track01) * 100);
  let capped = null;
  const capTo = (max, reason) => { if (score > max) { score = max; capped = reason; } };
  if (caps.purity != null && caps.purity < 0.90) capTo(54, 'sprayed out-of-scale notes'); // < C floor(55)
  if (caps.orderMatch != null && caps.orderMatch < 0.85) capTo(69, 'wrong order');          // < B floor(70)
  if (caps.tonicRequired && !caps.tonicLanded) capTo(69, 'didn’t land the tonic');
  return { score, stars: scoreToStars(score), grade: gradeFor(score), capped };
}

function clamp01(n) { return Math.max(0, Math.min(1, n || 0)); }

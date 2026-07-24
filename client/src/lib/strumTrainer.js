// Strum Lab — the pattern library, expected-hit grid and mic timing scorer
// behind the "Build calluses & a steady strumming hand" milestone.
//
// A pattern is ONE 4/4 bar on an eighth-note grid: 8 slots, each 'D' (down-
// strum), 'U' (up-strum) or null (let it ring). A session repeats the bar
// SESSION_BARS times over a metronome; the mic records strum onsets and each
// expected slot is judged on TIMING. A microphone cannot hear stroke
// DIRECTION — the arrows teach the motion, the score judges the part a
// beginner can't self-assess: hitting the grid, evenly.
//
// Pure module: no React, no audio APIs (the component feeds it onset times),
// localStorage guarded — safe to import from node for sanity tests.

// Grid labels for one bar of eighths: beats and their "ands".
export const SLOT_LABELS = ['1', '&', '2', '&', '3', '&', '4', '&'];

// A session is short on purpose — callus building is daily minutes, not hours.
export const SESSION_BARS = 4;

// Pass bar per run, and how many DIFFERENT patterns must pass to complete the
// Level Plan step (one straight + one syncopated proves a steady hand).
export const STRUM_PASS = 80;
export const STRUM_PASS_PATTERNS = 2;

// Ordered easiest → hardest. `bpm` is the recommended starting tempo.
export const STRUM_PATTERNS = [
  {
    id: 'downs', level: 1, bpm: 70,
    name: 'Steady downs',
    count: 'D · D · D · D',
    blurb: 'One down-strum on every beat. The foundation — lock onto the click before anything fancier.',
    slots: ['D', null, 'D', null, 'D', null, 'D', null],
  },
  {
    id: 'eighths', level: 2, bpm: 64,
    name: 'Down-up eighths',
    count: 'DU DU DU DU',
    blurb: 'Down on the beat, up on the "and". Keep the arm swinging like a pendulum — never stop the motion.',
    slots: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'],
  },
  {
    id: 'campfire', level: 3, bpm: 72,
    name: 'Campfire',
    count: 'D · DU · U D ·',
    blurb: 'The first real groove: skip a strum but keep the arm moving through the gap.',
    slots: ['D', null, 'D', 'U', null, 'U', 'D', null],
  },
  {
    id: 'folk', level: 4, bpm: 76,
    name: 'Old faithful',
    count: 'D · DU · U DU',
    blurb: 'D-DU-UDU — the most-played strum in pop and folk. Nail this and thousands of songs open up.',
    slots: ['D', null, 'D', 'U', null, 'U', 'D', 'U'],
  },
  {
    id: 'offbeat', level: 5, bpm: 80,
    name: 'Offbeat ups',
    count: '· U · U · U · U',
    blurb: 'Reggae-style: ONLY the "and"s, nothing on the beat. The ultimate steadiness test.',
    slots: [null, 'U', null, 'U', null, 'U', null, 'U'],
  },
];

export function patternById(id) {
  return STRUM_PATTERNS.find((p) => p.id === id) || null;
}

/** Number of actual strums in one bar of the pattern. */
export function patternStrokes(pattern) {
  return pattern.slots.filter(Boolean).length;
}

/**
 * The expected-strum grid for a whole session, in seconds from the start of
 * the first SCORED bar (the caller plays one unscored "feel the beat" bar
 * before t=0). One entry per non-null slot: { time, stroke, bar, slot }.
 */
export function expectedStrums(pattern, bpm, bars = SESSION_BARS) {
  const slotSec = 60 / bpm / 2; // eighth note
  const out = [];
  for (let bar = 0; bar < bars; bar++) {
    pattern.slots.forEach((stroke, slot) => {
      if (!stroke) return;
      out.push({ time: (bar * 8 + slot) * slotSec, stroke, bar, slot });
    });
  }
  return out;
}

/**
 * Hit window around each expected strum. A quarter of a beat each way, capped
 * at 200 ms so fast tempos stay unambiguous (adjacent eighths are half a beat
 * apart, so the windows can never overlap).
 */
export function strumTolerance(bpm) {
  return Math.min(0.2, (60 / bpm) * 0.25);
}

/**
 * Score a run: match detected onset times against the expected grid.
 *
 * Two-pass matching: pass 1 pairs each expected strum with the nearest free
 * onset inside the window and measures the MEDIAN offset — that's the
 * constant mic/speaker latency of the device, which isn't the player's
 * fault. Pass 2 re-judges with that latency removed, so the score reflects
 * steadiness against the beat, not the hardware.
 *
 * @param {Array}  expected  from expectedStrums()
 * @param {Array}  onsets    detected strum times (seconds, same clock/origin)
 * @param {object} [opts]    { tol } seconds, default strum window 0.2
 * @returns {{ total, hits, extras, score, medianOffsetMs, steadinessMs, perSlot }}
 */
export function scoreStrumRun(expected, onsets, { tol = 0.2 } = {}) {
  const times = [...onsets].sort((a, b) => a - b);

  const match = (shift) => {
    const used = new Array(times.length).fill(false);
    const pairs = [];
    for (const e of expected) {
      let best = -1, bestD = Infinity;
      for (let i = 0; i < times.length; i++) {
        if (used[i]) continue;
        const d = Math.abs(times[i] - shift - e.time);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD <= tol) {
        used[best] = true;
        pairs.push({ e, diff: times[best] - shift - e.time });
      } else {
        pairs.push({ e, diff: null });
      }
    }
    return pairs;
  };

  const first = match(0).filter((p) => p.diff != null).map((p) => p.diff).sort((a, b) => a - b);
  const median = first.length ? first[Math.floor(first.length / 2)] : 0;
  const pairs = match(median);

  const residuals = pairs.filter((p) => p.diff != null).map((p) => p.diff);
  const hits = residuals.length;
  const mean = hits ? residuals.reduce((a, b) => a + b, 0) / hits : 0;
  const variance = hits ? residuals.reduce((a, b) => a + (b - mean) ** 2, 0) / hits : 0;

  const total = expected.length;
  const extras = Math.max(0, times.length - hits);
  // Extra strums cost PROPORTIONALLY to the pattern's size: rests are the one
  // pattern feature the mic can truly verify, so strumming straight eighths
  // through a rest-heavy pattern must fail (extras ≈ total → −45), while a
  // couple of string-noise ghosts barely register (2 of 24 → −5).
  const raw = total ? Math.round((hits / total) * 100) : 0;
  const extraPenalty = total ? Math.min(45, Math.round((extras / total) * 60)) : 0;
  const score = Math.max(0, Math.min(100, raw - extraPenalty));

  return {
    total,
    hits,
    extras,
    score,
    medianOffsetMs: Math.round(median * 1000),
    steadinessMs: Math.round(Math.sqrt(variance) * 1000),
    perSlot: pairs.map((p) => ({
      bar: p.e.bar,
      slot: p.e.slot,
      stroke: p.e.stroke,
      hit: p.diff != null,
      offsetMs: p.diff == null ? null : Math.round(p.diff * 1000),
    })),
  };
}

/**
 * Band-limited loudness for strum onset detection. The metronome clicks the
 * app plays through the speakers live at 2.5–3 kHz (deliberately, see
 * audio.js playTicks/playMetronome); a strummed guitar's energy is far lower.
 * Double one-pole low-pass (~12 dB/oct above `cutoffHz`) then RMS, so the
 * click barely registers while a strum spikes hard. Stateless — analyser
 * windows overlap heavily between frames, re-filtering is fine.
 */
export function strumBandRms(timeData, sampleRate, cutoffHz = 1200) {
  const n = timeData.length;
  if (!n || !sampleRate) return 0;
  const a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let y1 = timeData[0], y2 = timeData[0], sum = 0;
  for (let i = 0; i < n; i++) {
    y1 += a * (timeData[i] - y1);
    y2 += a * (y1 - y2);
    sum += y2 * y2;
  }
  return Math.sqrt(sum / n);
}

// ── Store (score-only, sync-shaped) ───────────────────────────────────────────
// Mirrors tabQuiz.js / memoryTrain.js so a later /api sync is copy-paste.

const KEY = 'guitar_strum_trainer_v1';
const MAX_TOTAL = 100;

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
 * Save a finished run.
 * @param {object} run { patternId, bpm, bars, hits, total, extras, score(0..100), steadinessMs }
 */
export function saveStrumRun(run) {
  const data = readStore();
  const record = {
    clientId: `st_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    serverId: null,
    synced: false,
    patternId: run.patternId,
    bpm: run.bpm,
    bars: run.bars,
    hits: run.hits,
    total: run.total,
    extras: run.extras,
    score: run.score,
    steadinessMs: run.steadinessMs,
    createdAt: new Date().toISOString(),
  };
  data.runs.unshift(record);
  data.runs = data.runs.slice(0, MAX_TOTAL);
  writeStore(data);
  return record;
}

/**
 * Mastery snapshot — the Level Plan's completion signal. `patternsPassed`
 * counts DISTINCT patterns with a run ≥ minScore.
 */
export function strumMastery(minScore = STRUM_PASS) {
  const runs = readStore().runs;
  const bestByPattern = {};
  for (const r of runs) {
    if (!r.patternId) continue;
    bestByPattern[r.patternId] = Math.max(bestByPattern[r.patternId] || 0, r.score || 0);
  }
  return {
    sessions: runs.length,
    bestScore: runs.reduce((m, r) => Math.max(m, r.score || 0), 0),
    patternsPassed: Object.values(bestByPattern).filter((s) => s >= minScore).length,
    bestByPattern,
  };
}

// Chord-transition drills — practice SWITCHING between chord pairs, ranked
// easy→hard, independent of any song. Pure logic (no React/audio/DOM), mirroring
// practiceGame.js. The Play-Along game (PracticeGame.jsx) consumes the timeline
// this module builds and scores each change with the existing mic engine.
//
// A "drill" is an ordered list of chord PAIRS (from, to). Each pair is played as
// a repeated A→B→A→B loop so the change grooves into muscle memory, then the
// game advances to the next, harder pair. Pairs are ordered by scoreTransition,
// personalized to the player's hand, so the ladder is genuinely easy→hard for
// THIS hand.
//
// Two kinds of drill sets:
//   • Built-in ladders — curated chord vocabularies, auto-ranked easy→hard.
//   • Saved sets — the player's own weak transitions, collected to grind and
//     track improvement over time. Persisted like customSongs.js (localStorage
//     cache + clientId/serverId shape, ready for a later /api sync).

import { scoreTransition } from './fretboard';
import { lookupVoicings, easiestVoicing } from './voicingLookup';
import { classifyChordPCs } from './practiceGame';

// ── Built-in chord vocabularies for auto-ranked ladders ───────────────────────
// Each ladder names a set of chords; every ordered pair among them that has a
// playable voicing is ranked easy→hard. Names must resolve via lookupVoicings.

// A big pool of genuinely OPEN-position shapes (open strings / low frets, no
// barres) — majors, minors, dominant & minor 7ths, sus2/sus4, add9 and 6ths.
// Ranking every ordered pair of these by transition difficulty yields a long
// easy→hard ladder (50+ changes) that stays entirely in open position.
export const OPEN_CHORD_POOL = [
  // Core open triads
  'C', 'A', 'G', 'E', 'D', 'Am', 'Em', 'Dm',
  // Open dominant 7ths
  'G7', 'C7', 'E7', 'A7', 'D7', 'B7',
  // Open minor 7ths
  'Am7', 'Em7', 'Dm7',
  // Open major 7ths
  'Cmaj7', 'Gmaj7', 'Dmaj7', 'Amaj7', 'Emaj7', 'Fmaj7',
  // Open 6ths
  'A6', 'D6', 'E6', 'G6', 'C6', 'Em6', 'Am6',
  // Open sus chords
  'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Esus4', 'Csus2', 'Gsus2',
  // Open add9
  'Aadd9', 'Cadd9', 'Gadd9', 'Eadd9', 'Dadd9',
  // The friendly (non-barre) F
  'F',
];

export const BUILTIN_LADDERS = [
  {
    id: 'open-basics',
    name: 'Open-chord basics',
    blurb: 'The first changes every beginner drills — G, C, D, E, A and their minors.',
    chords: ['G', 'C', 'D', 'E', 'A', 'Em', 'Am', 'Dm'],
  },
  {
    id: 'open-marathon',
    name: 'Open chords — the big ladder',
    blurb: 'A long easy→hard climb through 50 open-chord changes: triads, 7ths, sus, add9 and 6ths — all in open position, no barres.',
    chords: OPEN_CHORD_POOL,
    maxPairs: 50,
    spread: true,   // sample 50 across the full easy→hard range, not 50 easy ones
  },
  {
    id: 'sevenths',
    name: 'Open 7th chords',
    blurb: 'Bluesy dominant and minor 7ths that keep the hand near the open shapes.',
    chords: ['E7', 'A7', 'D7', 'G7', 'C7', 'B7', 'Am7', 'Em7', 'Dm7'],
  },
  {
    id: 'into-the-f',
    name: 'Adding the F barre',
    blurb: 'The wall most players hit — moving in and out of the full F barre chord.',
    chords: ['C', 'G', 'Am', 'Dm', 'F'],
    // Force the F BARRE voicing (not the easy F) so the drill is the real thing.
    prefer: { F: 'Major (barre)' },
  },
  {
    id: 'barre-changes',
    name: 'Barre-chord changes',
    blurb: 'Switching between barre shapes up the neck — the hardest common changes.',
    chords: ['F', 'Bm', 'Bm7', 'F#m7', 'Gm7', 'Cm7'],
    prefer: { F: 'Major (barre)' },
  },
];

// ── Voicing resolution ────────────────────────────────────────────────────────

// The concrete shape a drill uses for a chord name. Honors an optional per-name
// `prefer` (matching a voicing's `type`, e.g. force the F BARRE over the easy F),
// then falls back to the hand-easiest catalogued voicing.
function resolveShape(name, { prefer = {}, profile = null, limitToReach = false } = {}) {
  const wanted = prefer[name];
  if (wanted) {
    const hit = lookupVoicings(name).find(v => v.type === wanted);
    if (hit) return hit;
  }
  return easiestVoicing(name, { profile, limitToReach }) || lookupVoicings(name)[0] || null;
}

// ── Pair ranking (easy→hard) ──────────────────────────────────────────────────

/**
 * Rank every ordered chord pair drawn from `chords` by how hard the change is
 * for this hand (scoreTransition), ascending. Pairs whose either chord has no
 * playable shape are dropped. Returns [{ from, to, score }] easy→hard.
 *
 * @param {string[]} chords      chord names to draw pairs from
 * @param {object}   [opts]      { profile, limitToReach, prefer, maxPairs, bothWays }
 *   - bothWays: include B→A as well as A→B (default true — the return change is
 *     its own skill). When false, only the lower-index→higher-index direction.
 *   - maxPairs: cap the ladder length (default 12) so a drill stays focused.
 */
export function rankPairs(chords, opts = {}) {
  const { profile = null, limitToReach = false, prefer = {}, maxPairs = 12, bothWays = true } = opts;
  const names = [...new Set((chords || []).filter(Boolean))];

  // Resolve each name once; drop names with no shape on file.
  const shapes = new Map();
  for (const n of names) {
    const v = resolveShape(n, { prefer, profile, limitToReach });
    if (v) shapes.set(n, v);
  }
  const playable = names.filter(n => shapes.has(n));

  const pairs = [];
  for (let i = 0; i < playable.length; i++) {
    for (let j = 0; j < playable.length; j++) {
      if (i === j) continue;
      if (!bothWays && j < i) continue;
      const from = playable[i], to = playable[j];
      const score = scoreTransition(shapes.get(from), shapes.get(to), profile);
      pairs.push({ from, to, score });
    }
  }
  pairs.sort((a, b) => a.score - b.score || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return pairs.slice(0, maxPairs);
}

// Down-sample a long ranked list to `n` pairs spread EVENLY across the whole
// easy→hard range (keeping the first and last), so the ladder climbs the full
// difficulty gradient instead of clustering at the easy end. De-dupes so the
// same change never appears twice.
function spreadSample(ranked, n) {
  if (ranked.length <= n) return ranked;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (ranked.length - 1)) / (n - 1));
    const p = ranked[idx];
    const key = `${p.from}|${p.to}`;
    if (!seen.has(key)) { seen.add(key); out.push(p); }
  }
  return out;
}

/**
 * RANDOM practice pairs from an exact chord set: every ordered change among
 * `chords`, shuffled (Fisher-Yates), then capped to `maxPairs`. Used by the
 * Level Plan chord-changes deep link — a step like "G C D E A" drills ONLY
 * those basic chords, in a fresh random order every launch, instead of the
 * fixed easy→hard ladder (which may also mix in extra chords like the minors).
 * Scores still ride along on each pair for display; only the ORDER is random,
 * so the tier unlocks serve a random mix too.
 */
export function randomPairs(chords, opts = {}) {
  const { maxPairs = 12, ...rest } = opts;
  const all = rankPairs(chords, { ...rest, maxPairs: 100000 });
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, maxPairs);
}

/** Convenience: a built-in ladder's ranked pairs, personalized to the hand. A
 *  ladder may cap its length via `maxPairs`; when it also sets `spread`, the cap
 *  is filled by sampling evenly across the full easy→hard range (so a big open
 *  ladder actually climbs from easy to hard, not 50 near-identical easy ones). */
export function ladderPairs(ladder, opts = {}) {
  if (ladder.maxPairs && ladder.spread) {
    const all = rankPairs(ladder.chords, { ...opts, prefer: ladder.prefer || {}, maxPairs: 100000 });
    return spreadSample(all, ladder.maxPairs);
  }
  return rankPairs(ladder.chords, {
    ...opts,
    prefer: ladder.prefer || {},
    ...(ladder.maxPairs ? { maxPairs: ladder.maxPairs } : {}),
  });
}

// ── Tiered leveling (chord difficulty × speed) ────────────────────────────────
// A drill's level is a chord TIER plus a SPEED STEP. Within a tier the speed
// climbs through SPEED_STEPS (one step per real-elapsed minute); after the last
// step the next tier unlocks (harder pairs) and the speed RESETS to the bottom.
// Since a drill's pairs are already ranked easy→hard, a tier is just a contiguous
// slice of that ranked list, from the easiest up to the tier's ceiling.

// Tempo (as a fraction of the drill's base bpm) at each speed step within a tier.
export const SPEED_STEPS = [0.6, 0.8, 1.0];

// Largest number of changes a single tier introduces. Short drills split into
// ~3 tiers; long ones (the 50-change open ladder) get MANY tiers so the chords
// get harder often, not in three huge jumps.
const MAX_TIER_SIZE = 6;

/** Default tier size: a third of the list, but capped so long ladders yield
 *  more, smaller tiers (more frequent "chords get harder" steps). */
export function defaultPerTier(rankedPairs) {
  const len = (rankedPairs || []).length;
  if (!len) return 1;
  return Math.max(1, Math.min(Math.ceil(len / 3), MAX_TIER_SIZE));
}

/**
 * The pairs available at a given chord tier (0-based): the easiest `perTier ×
 * (tier+1)` pairs of the ranked list, so each higher tier ADDS the next harder
 * pairs on top of the easier ones (they keep appearing, the hard ones join).
 * Clamped to the full list. `perTier` defaults via defaultPerTier.
 */
export function tierPairs(rankedPairs, tier, perTier = null) {
  const pairs = rankedPairs || [];
  if (!pairs.length) return [];
  const step = perTier || defaultPerTier(pairs);
  const count = Math.min(pairs.length, step * (tier + 1));
  return pairs.slice(0, count);
}

/** How many chord tiers a ranked pair-list splits into (with `perTier` sizing). */
export function tierCount(rankedPairs, perTier = null) {
  const pairs = rankedPairs || [];
  if (!pairs.length) return 0;
  const step = perTier || defaultPerTier(pairs);
  return Math.ceil(pairs.length / step);
}

// ── Timeline build (game-consumable {windows, meta}) ──────────────────────────

const BEATS_PER_CHORD = 4;   // matches practiceGame.js's one-chord-per-bar convention

/**
 * Turn a drill (ordered pairs) into the Play-Along game's timed windows.
 *
 * Each pair becomes `reps` A→B changes: A, B, A, B, … The first chord of the
 * whole drill and each pair boundary are placed so the mic scorer sees the same
 * shape it does in a song. Window shape matches buildPlayTimeline exactly:
 *   { index, kind:'chord', name, tab, notes, lyric:'', pcs, beats, startSec, endSec, durSec }
 * meta matches too, so PracticeGame's loop/HUD/report run unchanged.
 *
 * @param {Array<{from,to}>} pairs
 * @param {object} [opts] { bpm=70, speed=1, reps=4, profile, limitToReach, prefer }
 */
export function buildDrillTimeline(pairs, opts = {}) {
  const { bpm: bpmBase0 = 70, speed = 1, reps = 4, profile = null, limitToReach = false, prefer = {} } = opts;
  const bpmBase = Math.min(220, Math.max(40, bpmBase0));
  const bpm = bpmBase * speed;
  const spb = 60 / bpm;
  const countInBeats = bpm > 120 ? 8 : 4;

  // Flatten pairs → the chord name sequence the drill plays. Play HARDEST FIRST
  // (pairs arrive ranked easy→hard, so reverse): the moment a new tier unlocks,
  // the very first change you drill is the newly-added hard one — so a tier bump
  // is immediately visible on screen, not buried behind a repeat of the easy
  // changes you've already mastered. The easier pairs then follow as a wind-down.
  const ordered = (pairs || []).slice().reverse();
  const seq = [];
  for (const p of ordered) {
    for (let r = 0; r < reps; r++) {
      seq.push(p.from);
      seq.push(p.to);
    }
  }

  // Cache resolved shapes + pitch-class targets per name (scoring + display).
  const shapeCache = new Map();
  const pcsCache = new Map();
  const shapeOf = (name) => {
    if (!shapeCache.has(name)) shapeCache.set(name, resolveShape(name, { prefer, profile, limitToReach }));
    return shapeCache.get(name);
  };
  const pcsOf = (name) => {
    if (!pcsCache.has(name)) pcsCache.set(name, classifyChordPCs(name));
    return pcsCache.get(name);
  };

  let beat = 0;
  const windows = seq.map((name, i) => {
    const v = shapeOf(name);
    const startSec = beat * spb;
    beat += BEATS_PER_CHORD;
    return {
      index: i,
      kind: 'chord',
      name,
      tab: v?.tab || '',
      notes: v?.notes || [],
      lyric: '',
      pcs: pcsOf(name),
      beats: BEATS_PER_CHORD,
      startSec,
      endSec: beat * spb,
      durSec: BEATS_PER_CHORD * spb,
    };
  });

  return {
    windows,
    meta: {
      bpmBase, bpm, spb, speed,
      beatsPerChord: BEATS_PER_CHORD,
      countInBeats,
      countInSec: countInBeats * spb,
      totalSec: beat * spb,
    },
  };
}

const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * Build the `item` object PracticeGame.start() consumes for a drill. It carries
 * a synthetic song (so songKeyOf / history / results all work unbranched), a
 * prebuilt timeline (so start() skips buildPlayTimeline), and isDrill so the UI
 * can skip the song-only level ramp.
 *
 * @param {object} drill  { id, name, pairs }  (pairs already ranked easy→hard)
 * @param {object} [opts] passed through to buildDrillTimeline
 */
export function drillToItem(drill, opts = {}) {
  const id = `drill_${drill.id || slug(drill.name) || 'custom'}`;
  const perTier = defaultPerTier(drill.pairs);
  const tiers = tierCount(drill.pairs, perTier);
  // Start at tier 0, slowest speed step — the easiest pairs at 60% tempo.
  const timeline = buildDrillTimeline(tierPairs(drill.pairs, 0, perTier), {
    ...opts, speed: SPEED_STEPS[0],
  });
  return {
    isDrill: true,
    drill,
    drillOpts: opts,          // remember reps/profile/prefer for per-level rebuilds
    perTier,
    tiers,
    key: id,
    timeline,
    song: {
      id,
      title: drill.name || 'Transition drill',
      artist: 'Chord changes',
      bpm: timeline.meta.bpmBase,
    },
  };
}

/**
 * Rebuild a drill's timeline for a specific chord tier + speed step. The game
 * calls this each time the drill levels up: 3 speed steps within a tier, then
 * the next tier's harder pairs at the slowest step again.
 *
 * @returns {{ timeline, tier, step, speed, tiers, isLastLevel }}
 */
export function buildDrillLevel(item, tier, step) {
  const pairs = tierPairs(item.drill.pairs, tier, item.perTier);
  const speed = SPEED_STEPS[Math.min(step, SPEED_STEPS.length - 1)];
  const timeline = buildDrillTimeline(pairs, { ...(item.drillOpts || {}), speed });
  const isLastLevel = tier >= item.tiers - 1 && step >= SPEED_STEPS.length - 1;
  return { timeline, tier, step, speed, tiers: item.tiers, pairs, isLastLevel };
}

/**
 * Advance one drill level: step up the speed, and when the speed steps are
 * exhausted, move to the next chord tier and reset the speed. Returns the next
 * { tier, step } or null when already at the hardest tier's top speed.
 */
export function nextDrillLevel(item, tier, step) {
  if (step < SPEED_STEPS.length - 1) return { tier, step: step + 1 };
  if (tier < item.tiers - 1) return { tier: tier + 1, step: 0 };   // harder chords, speed resets
  return null;                                                     // maxed out
}

// ── Saved drill sets (localStorage, sync-ready) ───────────────────────────────
// The player's OWN sets — typically weak transitions collected to grind. Same
// storage model as customSongs.js: localStorage is the working cache; each set
// carries a clientId/serverId so a later per-user /api sync is a copy-paste.

const KEY = 'guitar_transition_drills_v1';

function readStore() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && data.v === 1 && Array.isArray(data.sets) ? data : { v: 1, sets: [] };
  } catch { return { v: 1, sets: [] }; }
}

function writeStore(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

/** All saved drill sets (newest first). */
export function loadDrillSets() {
  return readStore().sets;
}

/**
 * Save (upsert by id) a drill set. A set is { id?, name, pairs:[{from,to}] }.
 * Pairs are stored bare (from/to names only); scores are recomputed on load so
 * the ladder re-ranks if the hand profile changes. Returns the updated list.
 */
export function saveDrillSet(set) {
  const data = readStore();
  const id = set.id || `td_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const clean = {
    id,
    clientId: set.clientId || id,
    serverId: set.serverId ?? null,
    name: (set.name || 'My transitions').trim(),
    pairs: (set.pairs || [])
      .filter(p => p && p.from && p.to)
      .map(p => ({ from: p.from, to: p.to })),
    updatedAt: set.updatedAt || null,   // stamped by the caller (Date unavailable here in some envs)
  };
  const kept = data.sets.filter(s => s.id !== id);
  kept.unshift(clean);
  writeStore({ v: 1, sets: kept });
  return kept;
}

export function deleteDrillSet(id) {
  const data = readStore();
  const sets = data.sets.filter(s => s.id !== id);
  writeStore({ v: 1, sets });
  return sets;
}

/**
 * Add one weak transition to a saved set (creating the set if needed). Used by
 * the "save this change to practice" affordance. De-dupes the pair. Returns the
 * updated list.
 */
export function addPairToSet(setId, pair, fallbackName = 'My weak changes') {
  const data = readStore();
  let set = data.sets.find(s => s.id === setId);
  if (!set) {
    return saveDrillSet({ name: fallbackName, pairs: [pair] });
  }
  const exists = set.pairs.some(p => p.from === pair.from && p.to === pair.to);
  if (!exists) set.pairs.push({ from: pair.from, to: pair.to });
  writeStore(data);
  return data.sets;
}

/**
 * Materialize a saved set into a runnable drill: re-rank its stored pairs
 * easy→hard for the current hand (so scores stay personalized), returning
 * { id, name, pairs:[{from,to,score}] }. When the set has no valid pairs, pairs
 * is [].
 */
export function hydrateDrillSet(set, opts = {}) {
  const { profile = null } = opts;
  const pairs = (set.pairs || [])
    .map(p => {
      const a = resolveShape(p.from, opts);
      const b = resolveShape(p.to, opts);
      if (!a || !b) return null;
      return { from: p.from, to: p.to, score: scoreTransition(a, b, profile) };
    })
    .filter(Boolean)
    .sort((x, y) => x.score - y.score);
  return { id: set.id, name: set.name, pairs };
}

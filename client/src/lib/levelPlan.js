// Level Plan — a guided Beginner → Master roadmap. Pure data + logic (no React,
// no DOM). This module ORCHESTRATES the engines the app already has; it invents
// no new leveling or scoring. Completion for measurable milestones is DERIVED
// from the existing practice-history store (guitar_practice_history_v1) and the
// hand profile — never stored — so the roadmap can never drift from the real
// record. Only manual check-offs (theory / off-app technique) are persisted, in
// guitar_level_plan_v1, mirroring the versioned/clientId/serverId sync-ready
// shape used by practiceGame.js and transitionDrills.js.
//
// Every milestone is honestly typed:
//   • 'auto'   — completion computed from existing signals (read-only ✓/○).
//   • 'route'  — the app has a real feature that trains/shows this; a "Go →"
//                button navigates there and the user self-checks (no detector
//                exists to auto-verify). Manual check-off allowed.
//   • 'offapp' — the app has no feature for this (theory recall, bending/vibrato/
//                sweep/legato, ear-training, artistic voice). Manual check + tip.
//                Never dressed up as tracked progress.

import { loadHistory, bestForSong, reachedLevelForSong, gradeFor } from './practiceGame';
import { DEFAULT_PROFILE } from './handProfile';
import { memoryMastery } from './memoryTrain';

// ── The plan ──────────────────────────────────────────────────────────────────
// Tiers, in order. Each milestone:
//   { id, tier, column: 'technical'|'theory'|'practical',
//     title, detail,            // detail names exactly what to do in-app
//     type: 'auto'|'route'|'offapp',
//     tab?,                     // where "Go →" navigates (route/auto with a home)
//     tip?,                     // off-app practice hint
//     check? }                  // AUTO rule descriptor (see isAutoComplete)
//
// AUTO `check` descriptors (all read guitar_practice_history_v1 / hand profile):
//   { kind: 'handMeasured' }
//   { kind: 'drillPlayed',  drillId, minGrade? }          — any run of drill_<id>
//   { kind: 'drillTopTier', drillId }                     — reached top speed step
//   { kind: 'songCompletedAny' }                          — any song run completed
//   { kind: 'songAtSpeed',  minSpeed }                    — a completed run ≥ speed
//   { kind: 'anySongGrade', minGrade, minSpeed? }         — best grade on any song
//   { kind: 'songGradeCount', minGrade, count, minSpeed } — N distinct songs graded
//   { kind: 'memoryMastered', level, minScore }           — scored ≥minScore% (0–100)
//                                                            in a Music Memory session
//                                                            that reached ≥level

export const TIERS = ['Beginner', 'Intermediate', 'Advanced', 'Master'];

// Ear-training (Music Memory) completion bar: a milestone is only "done" when the
// user scored at least this % in a session that reached the required difficulty.
// 80 = master the vast majority of the program, not just show up.
export const MEMORY_PASS_SCORE = 80;

export const LEVEL_PLAN = [
  // ── BEGINNER ────────────────────────────────────────────────────────────────
  {
    id: 'beg-measure-hand', tier: 'Beginner', column: 'technical', type: 'auto', tab: 'hand',
    title: 'Measure your hand',
    detail: 'Set your finger reach in My Hand — every difficulty score is tailored to it.',
    check: { kind: 'handMeasured' },
  },
  {
    id: 'beg-open-chords', tier: 'Beginner', column: 'technical', type: 'route', tab: 'chords',
    title: 'Learn your first open chords (C A G E D)',
    detail: 'Go opens a guided mic walk that plays C → A → G → E → D one at a time and listens as you play each. (You can also open the Chords tab to see every shape rated for your hand.)',
    // Concrete sub-goals: play each of these chords cleanly. The guided walk
    // below routes to the mic Practice screen and steps through them in order;
    // the step also tracks which you've recorded cleanly elsewhere.
    chords: ['C', 'A', 'G', 'E', 'D'],
    // Go → opens the mic Practice screen in guided timed-cycle mode over this
    // exact sequence, listening to the player. `practiceTab` is the route target;
    // `tab` ('chords') stays the secondary "see the shapes" link.
    practiceSequence: ['C', 'A', 'G', 'E', 'D'],
    practiceTab: 'micpractice',
  },
  {
    id: 'beg-gcd-changes', tier: 'Beginner', column: 'technical', type: 'auto', tab: 'listen',
    title: 'Master the G–C–D–E–A changes',
    detail: 'Play-Along → Drills → “Open-chord basics”. Reach grade B or better.',
    check: { kind: 'drillPlayed', drillId: 'open-basics', minGrade: 'B' },
    chords: ['G', 'C', 'D', 'E', 'A'],
  },
  {
    id: 'beg-tab-reading', tier: 'Beginner', column: 'theory', type: 'route', tab: 'chords',
    title: 'Read basic tab',
    detail: 'The Chords and Audio → Tab tabs show the 6-string EADGBe tab notation — learn to read it.',
  },
  {
    id: 'beg-note-names', tier: 'Beginner', column: 'theory', type: 'auto', tab: 'memory',
    title: 'Recognise the note names by ear',
    detail: 'Music Memory tab (Stage 1 · Notes) → score 80%+ in a session. Naming a pitch you hear is the anchor for finding any chord or scale.',
    check: { kind: 'memoryMastered', level: 1, minScore: 80 },
  },
  {
    id: 'beg-ear-intervals', tier: 'Beginner', column: 'theory', type: 'auto', tab: 'memory',
    title: 'Recognise intervals by ear',
    detail: 'Music Memory tab (Stage 2 · Intervals) → score 80%+ in a session that reaches Level 2. Hearing the distance between two notes is the first real "theory ear".',
    check: { kind: 'memoryMastered', level: 2, minScore: 80 },
  },
  {
    id: 'beg-strum-calluses', tier: 'Beginner', column: 'practical', type: 'offapp',
    title: 'Build calluses & a steady strumming hand',
    detail: 'Daily short sessions to toughen fingertips and groove a basic down/up strum.',
    tip: 'A few minutes every day beats one long session. (No strum/callus detector — this is on you.)',
  },
  {
    id: 'beg-simple-song', tier: 'Beginner', column: 'practical', type: 'auto', tab: 'listen',
    title: 'Play a simple song slowly, start to finish',
    detail: 'Pick a song in Play-Along and complete a full run at Easy or Medium.',
    check: { kind: 'songCompletedAny' },
  },

  // ── INTERMEDIATE ──────────────────────────────────────────────────────────────
  {
    id: 'int-f-barre', tier: 'Intermediate', column: 'technical', type: 'auto', tab: 'listen',
    title: 'Break the F-barre wall',
    detail: 'Play-Along → Drills → “Adding the F barre” (it forces the real barre shape). Grade B+.',
    check: { kind: 'drillPlayed', drillId: 'into-the-f', minGrade: 'B' },
  },
  {
    id: 'int-barre-changes', tier: 'Intermediate', column: 'technical', type: 'auto', tab: 'listen',
    title: 'Clean barre-chord changes',
    detail: 'Play-Along → Drills → “Barre-chord changes” (F, Bm, F#m7, Gm7, Cm7).',
    check: { kind: 'drillPlayed', drillId: 'barre-changes' },
  },
  {
    id: 'int-pentatonic', tier: 'Intermediate', column: 'technical', type: 'route', tab: 'scale',
    title: 'Learn the minor & major pentatonic shapes',
    detail: 'Scales tab → choose “Pentatonic Minor”, then “Pentatonic Major”. See and hear the shape across the neck.',
  },
  {
    id: 'int-major-scale', tier: 'Intermediate', column: 'technical', type: 'route', tab: 'scale',
    title: 'Learn the major scale shape',
    detail: 'Scales tab → choose “Major”. Learn the pattern in a couple of positions.',
  },
  {
    id: 'int-bend-vibrato', tier: 'Intermediate', column: 'technical', type: 'offapp',
    title: 'Basic bending & vibrato',
    detail: 'Bend a note up to pitch and add controlled vibrato — expressive-playing fundamentals.',
    tip: 'Bend to match a target note by ear. (No bend/vibrato detector in the app yet.)',
  },
  {
    id: 'int-intervals', tier: 'Intermediate', column: 'theory', type: 'offapp',
    title: 'Understand intervals & chord construction',
    detail: 'Know how a chord is built from a root, third and fifth, and what turns it major/minor/7th.',
    tip: 'Use the Chord Finder to see the notes in each voicing while you learn the theory.',
  },
  {
    id: 'int-ear-chords', tier: 'Intermediate', column: 'theory', type: 'auto', tab: 'memory',
    title: 'Recognise chord quality by ear',
    detail: 'Music Memory tab (Stage 3 · Chords) → score 80%+ in a session that reaches Level 3. Hear a triad and name it — major vs minor and beyond.',
    check: { kind: 'memoryMastered', level: 3, minScore: 80 },
  },
  {
    id: 'int-root-tracking', tier: 'Intermediate', column: 'theory', type: 'offapp',
    title: 'Track root notes across the neck',
    detail: 'Instantly find any chord’s root on strings 6 and 5 so you can move shapes anywhere.',
    tip: 'Builds on the low-E & A note names. Practise naming roots as you move a barre shape.',
  },
  {
    id: 'int-12bar-blues', tier: 'Intermediate', column: 'practical', type: 'route', tab: 'progressions',
    title: 'Jam over a 12-bar blues (I–IV–V)',
    detail: 'Progressions tab → find the “I – IV – V” / blues loop and play along with its songs.',
  },
  {
    id: 'int-full-tempo-song', tier: 'Intermediate', column: 'practical', type: 'auto', tab: 'listen',
    title: 'Play a full song at original tempo',
    detail: 'Complete a Play-Along run at 100% speed (level 10) or faster.',
    check: { kind: 'songAtSpeed', minSpeed: 1.0 },
  },

  // ── ADVANCED ────────────────────────────────────────────────────────────────
  {
    id: 'adv-modes', tier: 'Advanced', column: 'technical', type: 'route', tab: 'scale',
    title: 'Learn the Dorian & Mixolydian modes',
    detail: 'Scales tab → choose “Dorian”, then “Mixolydian”. Hear how each mode colours the same root.',
  },
  {
    id: 'adv-triads', tier: 'Advanced', column: 'technical', type: 'route', tab: 'chordfinder',
    title: 'Explore triads up the neck',
    detail: 'Chord Finder → look up a chord and study its higher voicings across string sets.',
  },
  {
    id: 'adv-sweep-legato', tier: 'Advanced', column: 'technical', type: 'offapp',
    title: 'Sweep picking & legato',
    detail: 'Advanced picking-hand and fretting-hand techniques for fast, fluid lines.',
    tip: 'Start painfully slow with a metronome. (No technique detector in the app.)',
  },
  {
    id: 'adv-modal-theory', tier: 'Advanced', column: 'theory', type: 'offapp',
    title: 'Modal theory & target-tone soloing',
    detail: 'Aim solo lines at chord tones as the harmony changes underneath you.',
    tip: 'Pair with the Scales tab to see the mode while you internalise the theory.',
  },
  {
    id: 'adv-marathon', tier: 'Advanced', column: 'practical', type: 'auto', tab: 'listen',
    title: 'Complete the 50-change open marathon',
    detail: 'Play-Along → Drills → “Open chords — the big ladder”. Climb the full easy→hard ladder.',
    check: { kind: 'drillTopTier', drillId: 'open-marathon' },
  },
  {
    id: 'adv-hard-song', tier: 'Advanced', column: 'practical', type: 'auto', tab: 'listen',
    title: 'Grade S or A on a full-tempo song',
    detail: 'Land an S/A grade on a demanding song at original tempo in Play-Along.',
    check: { kind: 'anySongGrade', minGrade: 'A', minSpeed: 1.0 },
  },
  {
    id: 'adv-ear-degrees', tier: 'Advanced', column: 'theory', type: 'auto', tab: 'memory',
    title: 'Hear scale degrees & harmonic function',
    detail: 'Music Memory tab (Stage 4 · Scale degrees) → score 80%+ in a session that reaches Level 4. Place a note as the 1, 4, 5, etc. within its key.',
    check: { kind: 'memoryMastered', level: 4, minScore: 80 },
  },
  {
    id: 'adv-ear-progressions', tier: 'Advanced', column: 'theory', type: 'auto', tab: 'memory',
    title: 'Recognise whole progressions by ear',
    detail: 'Music Memory tab (Stage 5 · Progressions) → score 80%+ in a session that reaches Level 5 — the top of the ear-training ladder.',
    check: { kind: 'memoryMastered', level: 5, minScore: 80 },
  },
  {
    id: 'adv-improvise-by-ear', tier: 'Advanced', column: 'practical', type: 'offapp',
    title: 'Improvise fluidly & learn parts by ear',
    detail: 'Solo confidently across genres and pick up new parts by listening.',
    tip: 'Train your ear in the Music Memory tab and use Audio → Tab to transcribe a clip; applying it live is still on you.',
  },

  // ── MASTER ──────────────────────────────────────────────────────────────────
  {
    id: 'mas-flawless-mechanics', tier: 'Master', column: 'technical', type: 'auto', tab: 'listen',
    title: 'Flawless execution — S-grade 5 different songs at full tempo',
    detail: 'A capstone the app CAN measure: S grades on five distinct songs at original tempo.',
    check: { kind: 'songGradeCount', minGrade: 'S', count: 5, minSpeed: 1.0 },
  },
  {
    id: 'mas-clear-all-drills', tier: 'Master', column: 'technical', type: 'auto', tab: 'listen',
    title: 'Clear every built-in drill’s top tier',
    detail: 'Reach the top speed step of all five built-in transition-drill ladders.',
    check: { kind: 'allBuiltinDrillsTopTier' },
  },
  {
    id: 'mas-fretboard-visualization', tier: 'Master', column: 'theory', type: 'offapp',
    title: 'Absolute fretboard visualization',
    detail: 'See every note, chord and scale anywhere on the neck instantly, without hunting.',
    tip: 'Self-assessed — the natural result of years of the milestones above.',
  },
  {
    id: 'mas-artistic-voice', tier: 'Master', column: 'practical', type: 'offapp',
    title: 'A distinct, recognizable artistic voice',
    detail: 'World-class / session-level playing with a sound that’s unmistakably yours.',
    tip: 'Self-assessed — no app can measure this. It’s the destination, not a checkbox.',
  },
];

// ── AUTO completion (read-only; computed from existing stores) ─────────────────

const GRADE_ORDER = { D: 0, C: 1, B: 2, A: 3, S: 4 };
function gradeAtLeast(grade, min) {
  return (GRADE_ORDER[grade] ?? -1) >= (GRADE_ORDER[min] ?? 99);
}

const drillKey = (drillId) => `drill_${drillId}`;

// Every built-in ladder id — mirrors BUILTIN_LADDERS in transitionDrills.js. Kept
// as a literal to avoid importing the whole ladder table (and its heavy deps)
// just for the id list; the Master "clear all drills" capstone uses it.
const BUILTIN_DRILL_IDS = ['open-basics', 'open-marathon', 'sevenths', 'into-the-f', 'barre-changes'];

// A drill session is "top tier" when it recorded the fastest speed step (1.0).
// Drill runs save `speed` (the SPEED_STEPS value) — 1.0 is the last step, which
// is only reachable after climbing through every chord tier.
const DRILL_TOP_SPEED = 1.0;

function sessionsFor(songKey, history) {
  return history.sessions.filter((s) => s.songKey === songKey);
}

/**
 * Is an AUTO milestone complete? `handProfile` is the live profile (from context);
 * everything else is read from the practice-history store. Returns false for any
 * non-auto milestone or unknown check kind (so it can only ever UNDER-report, not
 * fake a completion).
 */
export function isAutoComplete(milestone, { handProfile } = {}) {
  const check = milestone?.check;
  if (milestone?.type !== 'auto' || !check) return false;

  const history = loadHistory();

  switch (check.kind) {
    case 'handMeasured': {
      // Trust the live profile if it's been changed from the default, OR any
      // recorded practice session (you can't practice without a profile loaded).
      const p = handProfile;
      const changed = p && (
        p.thumbToIndex !== DEFAULT_PROFILE.thumbToIndex ||
        p.indexToMiddle !== DEFAULT_PROFILE.indexToMiddle ||
        p.middleToRing !== DEFAULT_PROFILE.middleToRing ||
        p.ringToLittle !== DEFAULT_PROFILE.ringToLittle
      );
      return !!changed || history.sessions.length > 0;
    }

    case 'drillPlayed': {
      const runs = sessionsFor(drillKey(check.drillId), history);
      if (!runs.length) return false;
      if (!check.minGrade) return true;
      return runs.some((s) => gradeAtLeast(s.grade, check.minGrade));
    }

    case 'drillTopTier':
      return sessionsFor(drillKey(check.drillId), history)
        .some((s) => (s.speed ?? 0) >= DRILL_TOP_SPEED);

    case 'allBuiltinDrillsTopTier':
      return BUILTIN_DRILL_IDS.every((id) =>
        sessionsFor(drillKey(id), history).some((s) => (s.speed ?? 0) >= DRILL_TOP_SPEED));

    case 'songCompletedAny':
      return history.sessions.some((s) => s.completed && !String(s.songKey).startsWith('drill_'));

    case 'songAtSpeed':
      return history.sessions.some((s) =>
        s.completed && !String(s.songKey).startsWith('drill_') && (s.speed ?? 0) >= check.minSpeed);

    case 'anySongGrade':
      return history.sessions.some((s) =>
        !String(s.songKey).startsWith('drill_') &&
        gradeAtLeast(s.grade, check.minGrade) &&
        (check.minSpeed == null || (s.speed ?? 0) >= check.minSpeed));

    case 'songGradeCount': {
      const winners = new Set();
      for (const s of history.sessions) {
        if (String(s.songKey).startsWith('drill_')) continue;
        if (!gradeAtLeast(s.grade, check.minGrade)) continue;
        if (check.minSpeed != null && (s.speed ?? 0) < check.minSpeed) continue;
        winners.add(s.songKey);
      }
      return winners.size >= check.count;
    }

    // ── Music Memory (ear-training) ──────────────────────────────────────────
    // Read from guitar_memory_train_v1 via memoryMastery(). Completion requires
    // real MASTERY — scoring at least `minScore`% (default 80) in a session that
    // actually reached the required difficulty `level`. Merely playing a session,
    // or briefly touching a level, is not enough. Read-only: can only under-report.
    case 'memoryMastered': {
      const minScore = check.minScore ?? MEMORY_PASS_SCORE;
      return memoryMastery().bestScoreAtLevel(check.level ?? 1) >= minScore;
    }

    default:
      return false;
  }
}

// bestForSong / reachedLevelForSong are re-exported conveniences for any UI that
// wants richer per-song detail beside a milestone (kept so callers import from one
// place). They remain the single source of truth in practiceGame.js.
export { bestForSong, reachedLevelForSong, gradeFor };

// ── Manual check-off store (guitar_level_plan_v1) ─────────────────────────────
// Only manual completions are persisted. AUTO results are recomputed every render.

const KEY = 'guitar_level_plan_v1';

function readStore() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && data.v === 1 && data.manual && typeof data.manual === 'object') return data;
  } catch { /* fall through */ }
  return { v: 1, clientId: null, serverId: null, manual: {}, updatedAt: null };
}

function writeStore(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore quota */ }
}

/** The manual-completion map { [milestoneId]: true }. */
export function loadManual() {
  return readStore().manual;
}

/**
 * Set (or clear) a manual check-off for a milestone. Stamps a clientId on first
 * write, matching the sync-ready shape of practiceGame.js / transitionDrills.js.
 * Returns the updated manual map.
 */
export function setManualDone(milestoneId, done) {
  const data = readStore();
  if (!data.clientId) data.clientId = `lp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (done) data.manual[milestoneId] = true;
  else delete data.manual[milestoneId];
  data.updatedAt = new Date().toISOString();
  writeStore(data);
  return data.manual;
}

// ── Recording → Level Plan auto-advance ───────────────────────────────────────
// A recording (scale practice or a chord take) is graded 1–5 STARS. A run scoring
// ABOVE 3 (i.e. 4 or 5) is a genuine pass and advances the plan by completing the
// milestone that trains that exact skill — so real, measured play moves the
// roadmap forward, not just manual check-offs.
//
// PASS threshold is expressed once here so the UI and the auto-advance agree.
export const RECORDING_PASS_STARS = 3;   // must score ABOVE this (→ 4 or 5) to pass

// Which milestone a strong recording completes, by what was recorded.
//   scale "<Root> <ScaleName>" → the scale-learning milestone for that family
//   chord  "<name>"            → the open-chords milestone (its core CAGED set)
function milestoneForRecording({ kind, name }) {
  if (kind === 'scale') {
    const scaleName = (name || '').toLowerCase();
    if (scaleName.includes('pentatonic')) return 'int-pentatonic';
    if (scaleName.includes('major') && !scaleName.includes('pentatonic')) return 'int-major-scale';
    return null;   // other scales have no dedicated milestone (yet)
  }
  if (kind === 'chord') {
    // The core open-chord milestone tracks the CAGED set; any of them passing
    // contributes to it. (Its own `chords` sub-goals still track per-chord.)
    return 'beg-open-chords';
  }
  return null;
}

/**
 * Called after a recording is graded. If it PASSED (stars > RECORDING_PASS_STARS)
 * and maps to a milestone, mark that milestone done so the Level Plan advances.
 * No-op for a weak take or an unmapped recording. Safe to call every recording.
 * @param {{ kind:'scale'|'chord', name:string, stars:number }} rec
 * @returns {string|null} the milestoneId advanced, or null.
 */
export function advanceForRecording({ kind, name, stars }) {
  if (!(stars > RECORDING_PASS_STARS)) return null;
  const milestoneId = milestoneForRecording({ kind, name });
  if (!milestoneId) return null;
  setManualDone(milestoneId, true);
  return milestoneId;
}

// ── Roadmap status (combines AUTO + manual) ───────────────────────────────────

/**
 * Whether a milestone counts as done: AUTO milestones are done when their signal
 * fires OR the user manually ticked them (route/offapp items are manual-only).
 * @param {object} ctx { handProfile, manual }  manual = loadManual() (passed in so
 *   the caller reads localStorage once per render).
 */
export function isMilestoneDone(milestone, ctx = {}) {
  const manual = ctx.manual || {};
  if (manual[milestone.id]) return true;
  if (milestone.type === 'auto') return isAutoComplete(milestone, ctx);
  return false;
}

/**
 * Partial-progress signal for a milestone, so the UI can show yellow "in progress"
 * for auto milestones that are underway but not yet complete. Currently the
 * ear-training (memoryMastered) checks report progress as best-score-so-far vs the
 * required minScore; everything else is binary (done → 1, else 0). Returns a
 * fraction 0..1 (1 = done). Never fakes completion — capped below 1 until actually
 * done so isMilestoneDone stays the single source of truth for "complete".
 */
export function milestoneProgress(milestone, ctx = {}) {
  if (isMilestoneDone(milestone, ctx)) return 1;
  const check = milestone?.check;
  if (milestone?.type === 'auto' && check?.kind === 'memoryMastered') {
    const minScore = check.minScore ?? MEMORY_PASS_SCORE;
    const best = memoryMastery().bestScoreAtLevel(check.level ?? 1);
    if (minScore <= 0) return 0;
    return Math.min(0.99, Math.max(0, best / minScore));
  }
  return 0;
}

/** Milestones of a tier. */
export function milestonesForTier(tier) {
  return LEVEL_PLAN.filter((m) => m.tier === tier);
}

/** { tier, done, total, pct, nextMilestone, state } for one tier.
 *  state: 'complete' (all done) | 'partial' (some done) | 'notStarted' (none). */
export function tierStatus(tier, ctx = {}) {
  const ms = milestonesForTier(tier);
  let done = 0;
  let next = null;
  for (const m of ms) {
    if (isMilestoneDone(m, ctx)) done += 1;
    else if (!next) next = m;
  }
  const total = ms.length;
  const state = total === 0 ? 'complete' : done === total ? 'complete' : done > 0 ? 'partial' : 'notStarted';
  return { tier, done, total, pct: total ? Math.round((done / total) * 100) : 0, nextMilestone: next, state };
}

/** Status for every tier, in order. */
export function allTierStatus(ctx = {}) {
  return TIERS.map((t) => tierStatus(t, ctx));
}

/**
 * The player's "current tier" and single next actionable milestone — the earliest
 * tier that still has an incomplete milestone. Powers the Start-tab "Continue your
 * plan →" nudge. Returns { tier, nextMilestone } (nextMilestone null if all done).
 */
export function currentFocus(ctx = {}) {
  for (const t of TIERS) {
    const st = tierStatus(t, ctx);
    if (st.done < st.total) return { tier: t, nextMilestone: st.nextMilestone };
  }
  return { tier: TIERS[TIERS.length - 1], nextMilestone: null };
}

/** The tier AFTER `tier` (null if `tier` is the last / unknown). */
export function nextTier(tier) {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

/**
 * The player's step-by-step progress THROUGH their current tier — the ordered
 * milestones as numbered steps, so the UI can show "step N of TOTAL" and exactly
 * what completing the next step requires. Each step: the milestone + `done` +
 * `current` (the first incomplete one = what to do to advance a step).
 * @returns { tier, nextTier, total, stepDone, currentStep(1-based), steps:[{ ...milestone, done, current }] }
 */
export function tierSteps(ctx = {}) {
  const { tier } = currentFocus(ctx);
  const ms = milestonesForTier(tier);
  let firstOpen = -1;
  const steps = ms.map((m, i) => {
    const done = isMilestoneDone(m, ctx);
    if (!done && firstOpen < 0) firstOpen = i;
    return { ...m, done, current: false };
  });
  if (firstOpen >= 0) steps[firstOpen].current = true;
  const stepDone = steps.filter((s) => s.done).length;
  return {
    tier,
    nextTier: nextTier(tier),
    total: ms.length,
    stepDone,
    // The step you're ON (1-based): the first incomplete one, or total+... when all done.
    currentStep: firstOpen >= 0 ? firstOpen + 1 : ms.length,
    steps,
  };
}

// ── Tier → content difficulty ceiling ─────────────────────────────────────────
// Maps the player's current tier to a max RAW chord difficulty (calcDifficulty
// 1–10 / voicing.score scale) used by the "Limit everything by my level" filter.
// A chord/song above the ceiling is hidden while the limit is on.
//
// Calibrated to the EXACT-geometry difficulty scores (lib/fretboard.js now
// measures the real Rule-of-18 stretch via lib/geometry.js — the same physics
// the Fretboard Measures tool shows). On that scale the core open chords score
// C 5.4, Dm 5.1, easy-F 5.4, G 3.6, Am 2.9, D 2.6 — so Beginner needs ≤6 to keep
// all of them, while still hiding the G7 6.1 and higher barres that mark the
// next tier (full F barre 5.4 and Bm 5.2 sit right at the boundary and are shown,
// which is fair — their reach genuinely equals a C). Intermediate ≤7 admits 7ths
// & moving barres; Advanced ≤9 most stretches; Master 10 = everything.
export const LEVEL_CEILINGS = {
  Beginner: 6,
  Intermediate: 7,
  Advanced: 9,
  Master: 10,
};

/** The player's current tier (the earliest with an incomplete milestone). */
export function currentTier(ctx = {}) {
  return currentFocus(ctx).tier;
}

/** The max chord difficulty allowed at a tier (defaults to no limit). */
export function levelCeiling(tier) {
  return LEVEL_CEILINGS[tier] ?? 10;
}

/** Convenience: the ceiling for the player's current tier. */
export function currentLevelCeiling(ctx = {}) {
  return levelCeiling(currentTier(ctx));
}

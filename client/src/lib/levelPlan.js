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
//                exists to auto-verify). Manual check-off allowed. A route
//                milestone MAY also carry a `check` — then real measured play
//                completes it automatically too (manual stays available).
//   • 'offapp' — the app has no feature for this (theory recall, bending/vibrato/
//                sweep/legato, ear-training, artistic voice). Manual check + tip.
//                Never dressed up as tracked progress.

import { loadHistory, bestForSong, reachedLevelForSong, gradeFor } from './practiceGame';
import { DEFAULT_PROFILE } from './handProfile';
import { memoryMastery } from './memoryTrain';
import { tabQuizMastery, TAB_QUIZ_PASS } from './tabQuiz';
import { strumMastery, STRUM_PASS, STRUM_PASS_PATTERNS } from './strumTrainer';

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
//   { kind: 'drillPlayed',  drillId, minGrade?, minAccuracy? } — a run of drill_<id>
//   { kind: 'drillTopTier', drillId }                     — reached top speed step
//   { kind: 'songCompletedAny' }                          — any song run completed
//   { kind: 'songAtSpeed',  minSpeed }                    — a completed run ≥ speed
//   { kind: 'anySongGrade', minGrade, minSpeed? }         — best grade on any song
//   { kind: 'songGradeCount', minGrade, count, minSpeed } — N distinct songs graded
//   { kind: 'memoryMastered', level, minScore }           — scored ≥minScore% (0–100)
//                                                            in a Music Memory session
//                                                            that reached ≥level
//   { kind: 'tabQuizMastered', minScore }                 — scored ≥minScore% in the
//                                                            tab-reading quiz (tabquiz tab,
//                                                            store guitar_tab_quiz_v1)
//   { kind: 'strumMastered', minScore, minPatterns }      — ≥minPatterns different Strum
//                                                            Lab patterns passed at
//                                                            ≥minScore% (strum tab, store
//                                                            guitar_strum_trainer_v1)

export const TIERS = ['Beginner', 'Intermediate', 'Advanced', 'Master'];

// Drill completion bar for the beginner chord milestones: 80% accuracy in a run
// of the drill is enough to finish that part of the plan — mastery, not
// perfection. (Letter grades sit elsewhere: B = 70, A = 85.)
export const DRILL_PASS_ACCURACY = 80;

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
    detail: 'Go opens a guided mic walk that plays C → A → G → E → D one at a time, listens as you play each and scores it. (The Chords tab shows every shape rated for your hand.)',
    // Concrete sub-goals: play each of these chords cleanly. The step tracks
    // which you've recorded cleanly elsewhere.
    chords: ['C', 'A', 'G', 'E', 'D'],
    // Go → the guided mic walk (ChordListener practice mode over this exact
    // sequence: shows a chord, listens, scores). The chord-CHANGES drill
    // belongs to 'beg-gcd-changes' below — but an 80%+ run of that drill
    // covers this chord set too, so it completes this step automatically as
    // well (manual tick still available).
    check: { kind: 'drillPlayed', drillId: 'open-basics', minAccuracy: DRILL_PASS_ACCURACY },
    practiceSequence: ['C', 'A', 'G', 'E', 'D'],
    practiceTab: 'micpractice',
  },
  {
    id: 'beg-gcd-changes', tier: 'Beginner', column: 'technical', type: 'auto', tab: 'listen',
    title: 'Master the G–C–D–E–A changes',
    detail: 'Go starts random changes between G, C, D, E and A. Score 80% accuracy or better.',
    check: { kind: 'drillPlayed', drillId: 'open-basics', minAccuracy: DRILL_PASS_ACCURACY },
    chords: ['G', 'C', 'D', 'E', 'A'],
    // Go → auto-starts random changes over exactly these chords (see above),
    // not the songs list.
    drill: 'open-basics',
  },
  {
    // Route + check hybrid: Go opens the tab-reading lesson + quiz (hidden
    // 'tabquiz' route); scoring 80%+ there completes this step on its own.
    // Manual tick stays for players who already read tab.
    id: 'beg-tab-reading', tier: 'Beginner', column: 'theory', type: 'route', tab: 'tabquiz',
    title: 'Read basic tab',
    detail: 'Go opens a 2-minute lesson, then an 8-round quiz — match tabs like x32010 to the right shape. Score 80%+ to finish. The Chords and Audio → Tab tabs use the same EADGBe notation.',
    check: { kind: 'tabQuizMastered', minScore: TAB_QUIZ_PASS },
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
    // Route + check hybrid: Go opens the Strum Lab (hidden 'strum' route) —
    // pick a strumming pattern, play it over a metronome, and the mic scores
    // every strum's timing. Passing two different patterns at 80%+ completes
    // this step on its own; manual tick stays for players who already strum
    // steadily. The callus half stays a daily off-app habit (see tip).
    id: 'beg-strum-calluses', tier: 'Beginner', column: 'practical', type: 'route', tab: 'strum',
    title: 'Build calluses & a steady strumming hand',
    detail: 'Go opens the Strum Lab: hold a chord, follow the arrows and strum with the click — the mic checks every hit against the beat. Pass 2 different patterns at 80%+ to finish.',
    tip: 'A few minutes every day beats one long session — fingertips harden between sessions, not during them.',
    check: { kind: 'strumMastered', minScore: STRUM_PASS, minPatterns: STRUM_PASS_PATTERNS },
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
 * Is a milestone's `check` satisfied? `handProfile` is the live profile (from
 * context); everything else is read from the practice-history store. Evaluated
 * for ANY milestone carrying a check — auto milestones always do; a route
 * milestone may carry one too, so real measured play completes it without a
 * manual tick. Returns false for a missing check or unknown kind (so it can
 * only ever UNDER-report, not fake a completion).
 */
export function isAutoComplete(milestone, { handProfile } = {}) {
  const check = milestone?.check;
  if (!check) return false;

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
      if (!check.minGrade && check.minAccuracy == null) return true;
      return runs.some((s) =>
        (check.minGrade == null || gradeAtLeast(s.grade, check.minGrade)) &&
        (check.minAccuracy == null || (s.accuracy ?? 0) >= check.minAccuracy));
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

    // ── Tab reading (the Read-basic-tab lesson + quiz) ───────────────────────
    // Read from guitar_tab_quiz_v1 via tabQuizMastery(). Read-only: can only
    // under-report — a saved quiz run of ≥minScore% is the only signal.
    case 'tabQuizMastered':
      return tabQuizMastery().bestScore >= (check.minScore ?? TAB_QUIZ_PASS);

    // ── Strumming (the Strum Lab) ────────────────────────────────────────────
    // Read from guitar_strum_trainer_v1 via strumMastery(). Done when enough
    // DIFFERENT patterns have a run at ≥minScore% — one straight and one
    // syncopated pattern is what "a steady strumming hand" actually means.
    case 'strumMastered':
      return strumMastery(check.minScore ?? STRUM_PASS).patternsPassed >=
        (check.minPatterns ?? STRUM_PASS_PATTERNS);

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

// ── One-time heal for the open-chords false-completion bug ─────────────────────
// An earlier build completed 'beg-open-chords' on the FIRST single passing chord
// recording (of any name) by writing a permanent manual tick — so the whole
// "Learn your first open chords (C A G E D)" step went green after one chord. This
// clears that spurious tick UNLESS the step was genuinely earned by either real
// path: the open-basics drill passed (its `check`), or all five required chords
// actually mastered. A truly-earned step keeps its state (the drill check re-fires
// on its own; a full mastered set re-completes on the next recording), so this can
// only ever REMOVE a false green, never a real one. Runs once (a guard flag).
//
// `isChordMastered` is injected by the caller (LevelPlan reads it from
// chordRecordings) so this module avoids importing it back — that would be a cycle.
const OPEN_CHORDS_HEAL_FLAG = 'guitar_open_chords_heal_v1';

export function healOpenChordsFalseCompletion(ctx = {}, isChordMastered) {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem(OPEN_CHORDS_HEAL_FLAG) === '1') return false;
    localStorage.setItem(OPEN_CHORDS_HEAL_FLAG, '1');   // once, regardless of outcome

    const manual = loadManual();
    if (!manual['beg-open-chords']) return false;       // nothing ticked → nothing to heal

    const milestone = LEVEL_PLAN.find((m) => m.id === 'beg-open-chords');
    if (!milestone) return false;

    // Path 1: the drill was genuinely passed (read-only check).
    if (isAutoComplete(milestone, ctx)) return false;
    // Path 2: every required chord is genuinely mastered.
    const required = milestone.chords || [];
    if (typeof isChordMastered === 'function' &&
        required.length && required.every((c) => isChordMastered(c))) return false;

    // Neither path holds → the tick was the bug's. Clear it.
    setManualDone('beg-open-chords', false);
    return true;
  } catch {
    return false;
  }
}

// ── Declared starting level (guitar_declared_level_v1) ────────────────────────
// What the user said they are when they first registered ("Where are you starting
// from?"). This is a DISPLAY preference only: it focuses the Level Plan on that
// tier (scroll + highlight) so a self-declared intermediate isn't dumped at the
// bottom of Beginner. It deliberately does NOT touch currentTier/currentFocus or
// LEVEL_CEILINGS — real progress stays derived from what the app can measure, so
// the roadmap can never claim skill the player hasn't shown.

const DECLARED_KEY = 'guitar_declared_level_v1';

/** The tier the user declared at sign-up, or null if they never picked/skipped. */
export function getDeclaredTier() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DECLARED_KEY) : null;
    const data = raw ? JSON.parse(raw) : null;
    if (data && data.v === 1 && TIERS.includes(data.tier)) return data.tier;
  } catch { /* fall through */ }
  return null;
}

/**
 * Record the user's declared starting tier. Junk (a non-TIERS string) is ignored
 * and returns null so a bad value can never focus a nonexistent tier. Sync-shaped
 * ({ v, tier, clientId, updatedAt }) to mirror the manual store for a future sync.
 */
export function setDeclaredTier(tier) {
  if (!TIERS.includes(tier)) return null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DECLARED_KEY, JSON.stringify({
        v: 1,
        tier,
        clientId: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        updatedAt: new Date().toISOString(),
      }));
    }
  } catch { /* ignore quota */ }
  return tier;
}

// ── First-chord welcome (guitar_first_chord_seen_v1) ──────────────────────────
// A one-time flag: has the brand-new user seen the "Start here — your first chord"
// welcome that runs right after the hand scan? It's the plain-words hand-off from
// onboarding into playing (idea #1, Absolute Beginner). Purely a "seen it" boolean
// so the welcome never re-shows; it changes no scoring and completes no milestone.

const FIRST_CHORD_KEY = 'guitar_first_chord_seen_v1';

/** True once the user has seen (or skipped) the first-chord welcome. */
export function hasSeenFirstChord() {
  try {
    return typeof localStorage !== 'undefined' &&
      localStorage.getItem(FIRST_CHORD_KEY) === '1';
  } catch { /* fall through */ }
  return false;
}

/** Mark the first-chord welcome as seen so it doesn't show again. */
export function markFirstChordSeen() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FIRST_CHORD_KEY, '1');
  } catch { /* ignore quota */ }
}

// ── Recording → Level Plan auto-advance ───────────────────────────────────────
// A recording (scale practice or a chord take) is graded 1–5 STARS. A run scoring
// ABOVE 3 (i.e. 4 or 5) is a genuine pass and advances the plan by completing the
// milestone that trains that exact skill — so real, measured play moves the
// roadmap forward, not just manual check-offs.
//
// PASS threshold is expressed once here so the UI and the auto-advance agree.
export const RECORDING_PASS_STARS = 3;   // must score ABOVE this (→ 4 or 5) to pass

// The open-chords milestone whose required set a chord recording contributes to.
const OPEN_CHORDS_MILESTONE = 'beg-open-chords';

// Which SCALE milestone a strong scale recording completes (one recording is a
// genuine pass — there's a single scale to learn, unlike the 5-chord set below).
function scaleMilestoneFor(name) {
  const scaleName = (name || '').toLowerCase();
  if (scaleName.includes('pentatonic')) return 'int-pentatonic';
  if (scaleName.includes('major') && !scaleName.includes('pentatonic')) return 'int-major-scale';
  return null;   // other scales have no dedicated milestone (yet)
}

/**
 * Called after a recording is graded. A strong take (stars > RECORDING_PASS_STARS)
 * may advance the Level Plan:
 *   • scale  — completes that scale's milestone (a single pass is enough).
 *   • chord  — the open-chords milestone lists FIVE chords (C A G E D). One good
 *     take is NOT the milestone; it completes ONLY once EVERY required chord has a
 *     mastered recording. Per-chord progress is tracked from the recordings store
 *     itself (chordListProgress), so this never fakes completion off one chord.
 *
 * The `isChordMastered` predicate is injected by the caller (chordRecordings.js,
 * which owns the recordings store) so this module doesn't import it back — that
 * would be a cycle. When absent, a chord recording advances nothing.
 *
 * @param {{ kind:'scale'|'chord', name:string, stars:number,
 *           isChordMastered?:(chord:string)=>boolean }} rec
 * @returns {string|null} the milestoneId advanced, or null.
 */
export function advanceForRecording({ kind, name, stars, isChordMastered }) {
  if (!(stars > RECORDING_PASS_STARS)) return null;

  if (kind === 'scale') {
    const id = scaleMilestoneFor(name);
    if (!id) return null;
    setManualDone(id, true);
    return id;
  }

  if (kind === 'chord') {
    // Only complete the milestone when its WHOLE required set is mastered.
    if (typeof isChordMastered !== 'function') return null;
    const milestone = LEVEL_PLAN.find((m) => m.id === OPEN_CHORDS_MILESTONE);
    const required = milestone?.chords || [];
    if (!required.length) return null;
    // The just-passed chord is already saved, so this read sees it. Requiring the
    // recorded chord to be one of the five keeps an off-list chord from ever
    // counting — but even an on-list one only completes the step if all five are in.
    if (!required.includes(name)) return null;
    if (!required.every((c) => isChordMastered(c))) return null;
    setManualDone(OPEN_CHORDS_MILESTONE, true);
    return OPEN_CHORDS_MILESTONE;
  }

  return null;
}

// ── Roadmap status (combines AUTO + manual) ───────────────────────────────────

/**
 * Whether a milestone counts as done: any milestone with a `check` is done when
 * its signal fires (auto milestones always have one; route milestones may), OR
 * when the user manually ticked it (route/offapp).
 * @param {object} ctx { handProfile, manual }  manual = loadManual() (passed in so
 *   the caller reads localStorage once per render).
 */
export function isMilestoneDone(milestone, ctx = {}) {
  const manual = ctx.manual || {};
  if (manual[milestone.id]) return true;
  if (milestone.check) return isAutoComplete(milestone, ctx);
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
  // Tab-reading quiz: best-score-so-far vs the pass bar (route+check hybrid,
  // so no 'auto' gate — any milestone carrying this check reports progress).
  if (check?.kind === 'tabQuizMastered') {
    const minScore = check.minScore ?? TAB_QUIZ_PASS;
    if (minScore <= 0) return 0;
    return Math.min(0.99, Math.max(0, tabQuizMastery().bestScore / minScore));
  }
  // Strum Lab: whole patterns passed count fully toward the required number;
  // before the first pass, the best score so far counts as a fraction of one
  // pattern so the row turns yellow from the very first session.
  if (check?.kind === 'strumMastered') {
    const need = check.minPatterns ?? STRUM_PASS_PATTERNS;
    const pass = check.minScore ?? STRUM_PASS;
    if (need <= 0 || pass <= 0) return 0;
    const m = strumMastery(pass);
    const partial = m.patternsPassed === 0 ? Math.min(0.99, Math.max(0, m.bestScore / pass)) : 0;
    return Math.min(0.99, (m.patternsPassed + partial) / need);
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

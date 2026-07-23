// Tab-reading quiz — the "Read basic tab" Level Plan step made measurable.
// Pure data + logic (no React, no DOM): round generation from the real chord
// library and a score-only localStorage store, mirroring memoryTrain.js. The
// Level Plan gates its `tabQuizMastered` check on tabQuizMastery().bestScore,
// so completion is DERIVED from real quiz runs — never stored on the milestone.
//
// A round is one of three decode directions over the same 6-char EADGBe tab:
//   pickDiagram — read a tab string, pick the matching shape (1 of 4 diagrams)
//   pickTab     — see a shape, pick the tab string that writes it (1 of 4)
//   readString  — one highlighted character: what does it tell the hand?
//                 (muted / open / press fret N)

import { easiestVoicing } from './voicingLookup';

export const TAB_QUIZ_ROUNDS = 8;
// Pass bar — same "mastery, not perfection" 80% the beginner drills use.
export const TAB_QUIZ_PASS = 80;

// Tab characters read low→high pitch, left→right: E A D G B e.
export const TAB_STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

// Beginner pool: the open chords the Beginner tier already teaches. Each quiz
// draws its shapes from here via the SAME easiestVoicing resolver the hover
// tooltips use, so the quiz can never disagree with the rest of the app.
const POOL_NAMES = ['C', 'A', 'G', 'E', 'D', 'Em', 'Am', 'Dm', 'E7', 'A7'];

/** The quiz's chord pool: [{ name, voicing }] — only chords with a shape on file. */
export function quizPool() {
  return POOL_NAMES
    .map((name) => ({ name, voicing: easiestVoicing(name) }))
    .filter((x) => x.voicing && typeof x.voicing.tab === 'string' && x.voicing.tab.length === 6);
}

// Fisher–Yates with an injectable rng (deterministic in tests).
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/** Human meaning of one tab character (UI renders the label). */
export function charMeaning(ch) {
  if (ch === 'x') return { kind: 'mute' };
  if (ch === '0') return { kind: 'open' };
  return { kind: 'fret', fret: parseInt(ch, 10) };
}

// One multiple-choice option set: the correct entry + 3 distinct distractors,
// shuffled, with the answer's index recorded.
function withOptions(correct, distractors, rng, keyOf = (x) => x) {
  const seen = new Set([keyOf(correct)]);
  const wrong = [];
  for (const d of shuffle(distractors, rng)) {
    if (wrong.length >= 3) break;
    if (seen.has(keyOf(d))) continue;
    seen.add(keyOf(d));
    wrong.push(d);
  }
  const options = shuffle([correct, ...wrong], rng);
  return { options, answer: options.findIndex((o) => keyOf(o) === keyOf(correct)) };
}

/**
 * Build one quiz session: `count` rounds cycling through the three types so
 * every session trains all three decode directions. Each round is
 * { type, name, voicing, options, answer, ... } — the component only renders
 * and compares chosen index vs `answer`.
 */
export function buildQuizRounds({ count = TAB_QUIZ_ROUNDS, rng = Math.random } = {}) {
  const pool = quizPool();
  if (pool.length < 4) return [];
  const types = shuffle(
    Array.from({ length: count }, (_, i) => ['pickDiagram', 'pickTab', 'readString'][i % 3]),
    rng,
  );
  // Deal chords so a chord repeats only after the whole pool has been seen.
  let deck = shuffle(pool, rng);
  return types.map((type) => {
    if (!deck.length) deck = shuffle(pool, rng);
    const { name, voicing } = deck.pop();
    const others = pool.filter((p) => p.name !== name);

    if (type === 'pickDiagram') {
      // Read "x32010" → point at the right shape. Options keyed by tab so two
      // enharmonic entries can never yield duplicate diagrams.
      const { options, answer } = withOptions({ name, voicing }, others, rng, (o) => o.voicing.tab);
      return { type, name, voicing, options, answer };
    }
    if (type === 'pickTab') {
      // See the shape → pick the tab string that writes it.
      const { options, answer } = withOptions(
        { name, tab: voicing.tab },
        others.map((o) => ({ name: o.name, tab: o.voicing.tab })),
        rng,
        (o) => o.tab,
      );
      return { type, name, voicing, options, answer };
    }
    // readString — decode ONE character of this tab: the fretted/open/muted
    // spot on a specific string. Distractors are other meanings (always offer
    // mute + open + nearby frets so all three symbol kinds stay in play).
    const stringIndex = Math.floor(rng() * 6);
    const ch = voicing.tab[stringIndex];
    const correct = charMeaning(ch);
    const distractorPool = ['x', '0', '1', '2', '3', '4'].map(charMeaning);
    const keyOf = (m) => (m.kind === 'fret' ? `f${m.fret}` : m.kind);
    const { options, answer } = withOptions(correct, distractorPool, rng, keyOf);
    return { type, name, voicing, stringIndex, options, answer };
  });
}

// ─── Store (guitar_tab_quiz_v1) — score-only, sync-shaped ───────────────────────
// Mirrors memoryTrain.js / scalePractice.js so a later /api sync is copy-paste.

const KEY = 'guitar_tab_quiz_v1';
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

/** Save a finished quiz run. @param {object} run { correct, total, score(0..100) } */
export function saveTabQuizRun(run) {
  const data = readStore();
  const record = {
    clientId: `tq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    serverId: null,
    synced: false,
    correct: run.correct,
    total: run.total,
    score: run.score,
    createdAt: new Date().toISOString(),
  };
  data.runs.unshift(record);
  data.runs = data.runs.slice(0, MAX_TOTAL);
  writeStore(data);
  return record;
}

/** Mastery snapshot: best score across all runs — the Level Plan's completion signal. */
export function tabQuizMastery() {
  const runs = readStore().runs;
  return {
    sessions: runs.length,
    bestScore: runs.reduce((m, r) => Math.max(m, r.score || 0), 0),
  };
}

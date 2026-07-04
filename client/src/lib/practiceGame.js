// Play-Along practice game — pure logic (no React, no audio, no DOM).
//
// Consolidated from the three-specialist design:
//   • theory: pitch-class chord classification (any voicing counts; root+third
//     required; extensions/harmonics tolerated; quality-flippers never), ring-over
//     tolerance, speed-adjusted accuracy as the progress metric.
//   • game:   onset timing gate (perfect ≤1.25 beats, good ≤2.5), 100/70/40/0
//     points, combo ladder ×1/×2/×3/×4 at 5/10/20, S–D grades, ghost pace.
//   • tech:   amplitude-weighted pitch-class histogram accumulator whose live
//     value IS the final grade; versioned sync-ready history records.
//
// The component (PracticeGame.jsx) owns the clock, the mic and the DOM; this
// module owns every decision that could be unit-tested without a browser.

import { resolveChordCells } from './songTimeline';
import { lookupVoicings, easiestVoicing } from './voicingLookup';
import { songBpm } from './songs';

// ── Pitch-class plumbing ──────────────────────────────────────────────────────

const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
// Open-string MIDI notes, standard tuning (low E → high e) — matches audio.js.
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

export function hzToPc(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return ((midi % 12) + 12) % 12;
}

// Sharp-spelled pitch-class names, for the post-run report and any UI copy.
export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function pcsOfTab(tab) {
  const pcs = new Set();
  for (let s = 0; s < 6 && s < (tab || '').length; s++) {
    const ch = tab[s];
    if (ch === 'x' || ch === 'X') continue;
    const fret = parseInt(ch, 10);
    if (Number.isNaN(fret)) continue;
    pcs.add((OPEN_MIDI[s] + fret) % 12);
  }
  return pcs;
}

/**
 * Classify a chord name into the pitch-class sets the scorer needs:
 *   expected  — every pc any catalogued voicing of the chord plays (so ANY
 *               fingering of the chord counts as correct)
 *   required  — the identity tones: root + third (sus tone / fifth when there
 *               is no third). The fifth is never required — guitarists drop it.
 *   tolerated — same-root extension colours (9th/6th/b7/maj7) and string
 *               harmonics (+7/+4 semitones over expected tones), MINUS anything
 *               within a semitone of the root or third: never forgive a note
 *               that would flip the chord's quality.
 */
export function classifyChordPCs(name) {
  const voicings = lookupVoicings(name);
  const expected = new Set();
  for (const v of voicings) for (const pc of pcsOfTab(v.tab)) expected.add(pc);

  const m = (name || '').match(/^([A-G][#b]?)/);
  const rootPc = m ? NOTE_TO_PC[m[1]] : null;
  if (rootPc == null || !expected.size) {
    return { expected, required: [...expected].slice(0, 2), tolerated: new Set(), rootPc };
  }

  const has = iv => expected.has((rootPc + iv) % 12);
  const third = has(4) ? (rootPc + 4) % 12 : has(3) ? (rootPc + 3) % 12 : null;
  const fifth = has(7) ? (rootPc + 7) % 12 : has(6) ? (rootPc + 6) % 12 : has(8) ? (rootPc + 8) % 12 : null;
  const sus   = third == null ? (has(5) ? (rootPc + 5) % 12 : has(2) ? (rootPc + 2) % 12 : null) : null;

  const required = [rootPc];
  if (third != null) required.push(third);
  else if (sus != null) required.push(sus);
  else if (fifth != null) required.push(fifth);

  const tolerated = new Set();
  for (const iv of [2, 9, 10, 11]) tolerated.add((rootPc + iv) % 12); // 9th/6th/b7/maj7 colours
  for (const p of expected) {                                        // string harmonics
    tolerated.add((p + 7) % 12);
    tolerated.add((p + 4) % 12);
  }
  const nearIdentity = (p) => {
    const dRoot = Math.min((p - rootPc + 12) % 12, (rootPc - p + 12) % 12);
    if (dRoot <= 1) return true;
    if (third != null) {
      const dThird = Math.min((p - third + 12) % 12, (third - p + 12) % 12);
      if (dThird === 1) return true;
    }
    return false;
  };
  for (const p of [...tolerated]) {
    if (expected.has(p) || nearIdentity(p)) tolerated.delete(p);
  }

  return { expected, required, tolerated, rootPc };
}

// ── Timeline ──────────────────────────────────────────────────────────────────

const BEATS_PER_CHORD = 4;   // the app-wide "one chord per bar" convention

/**
 * Turn a song into the game's timed chord windows.
 * @returns {{ windows: Array, meta: object }}
 */
export function buildPlayTimeline(song, { speed = 1, profile = null, limitToReach = false } = {}) {
  const cells = resolveChordCells(song);
  const bpmBase = Math.min(220, Math.max(40, song.bpm ?? songBpm(song.title) ?? 100));
  const bpm = bpmBase * speed;
  const spb = 60 / bpm;
  const countInBeats = bpm > 120 ? 8 : 4;

  const windows = cells.map((cell, i) => {
    const v = easiestVoicing(cell.chordName, { profile, limitToReach }) || cell.voicings?.[0] || null;
    return {
      index: i,
      name: cell.chordName,
      tab: v?.tab || '',
      notes: v?.notes || [],
      pcs: classifyChordPCs(cell.chordName),
      startSec: i * BEATS_PER_CHORD * spb,
      endSec: (i + 1) * BEATS_PER_CHORD * spb,
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
      totalSec: windows.length * BEATS_PER_CHORD * spb,
    },
  };
}

// ── Per-window scorer ─────────────────────────────────────────────────────────
// Amplitude-weighted pitch-class histogram, fed one ~100 ms FFT snapshot at a
// time. current() and final() are the same evaluation, so what the live meter
// shows during the window IS the grade the window gets at close.

const NEED_SHARE   = 0.06;  // a pc "counts" as sounded at ≥6% of window energy
const ACTIVE_MIN   = 0.15;  // <15% non-silent snapshots → the window is 'silent'
const RING_OVER_S  = 0.5;   // previous chord's tones forgiven this long
const PERFECT_Q    = 0.80;
const GOOD_Q       = 0.60;
const PARTIAL_Q    = 0.35;
const PERFECT_BEAT = 1.25;  // onset gates (in beats from window start)
const GOOD_BEAT    = 2.5;

export function windowScorer(target, cfg, prevPcs = null) {
  const H = new Float32Array(12);
  const { expected, required, tolerated } = target.pcs;
  const spb = target.durSec / BEATS_PER_CHORD;
  let snaps = 0, active = 0, onsetRel = null;

  const evaluate = (detailed = false) => {
    if (!snaps || active / snaps < ACTIVE_MIN) {
      return { quality: 'silent', q: 0, coverage: 0, purity: 0, onsetBeat: null,
               ...(detailed ? { tones: [], wrongTop: [] } : null) };
    }
    let expW = 0, tolW = 0, totalW = 0;
    for (let pc = 0; pc < 12; pc++) {
      const w = H[pc];
      if (!w) continue;
      totalW += w;
      if (expected.has(pc)) expW += w;
      else if (tolerated.has(pc)) tolW += w;
    }
    if (totalW <= 0) {
      return { quality: 'silent', q: 0, coverage: 0, purity: 0, onsetBeat: null,
               ...(detailed ? { tones: [], wrongTop: [] } : null) };
    }
    const need = NEED_SHARE * totalW;
    let reqHit = 0, expHit = 0;
    for (const pc of required) if (H[pc] >= need) reqHit++;
    for (const pc of expected) if (H[pc] >= need) expHit++;
    const reqCov = required.length ? reqHit / required.length : 0;
    const expCov = expected.size ? expHit / expected.size : 0;
    const coverage = 0.7 * reqCov + 0.3 * expCov;
    const purity = (expW + tolW) / totalW;   // tolerated tones never hurt
    const q = Math.max(0, Math.min(1, 0.6 * coverage + 0.4 * purity));
    const onsetBeat = onsetRel == null ? null : onsetRel / spb;

    let quality;
    if (q >= PERFECT_Q && reqCov >= 1 && onsetBeat != null && onsetBeat <= PERFECT_BEAT) quality = 'perfect';
    else if (q >= GOOD_Q && (onsetBeat == null || onsetBeat <= GOOD_BEAT)) quality = 'good';
    else if (q >= PARTIAL_Q) quality = 'partial';
    else quality = 'miss';

    const base = { quality, q, coverage, purity, onsetBeat };
    if (!detailed) return base;

    // Per-tone forensics for the post-run report:
    //  • each expected tone: ok (rang clearly) / weak (some energy — a buzzing,
    //    palm-brushed or lightly-fretted string reads exactly like this) /
    //    missing (no meaningful energy — muted string or finger not down).
    //  • the loudest WRONG pitch classes, for "you played X instead" analysis.
    const tones = [];
    for (const pc of expected) {
      const w = H[pc];
      tones.push({
        pc,
        required: required.includes(pc),
        status: w >= need ? 'ok' : w >= need * 0.3 ? 'weak' : 'missing',
      });
    }
    const wrongTop = [];
    for (let pc = 0; pc < 12; pc++) {
      const w = H[pc];
      if (!w || expected.has(pc) || tolerated.has(pc)) continue;
      wrongTop.push({ pc, share: w / totalW });
    }
    wrongTop.sort((a, b) => b.share - a.share);
    return { ...base, tones, wrongTop: wrongTop.slice(0, 2).filter(x => x.share >= 0.08) };
  };

  return {
    /** @param peaks [{hz, amplitude(dB)}] @param rms number @param relSec seconds into the window */
    add(peaks, rms, relSec) {
      snaps++;
      if (rms < cfg.silenceRms) return;
      active++;
      let expHitNow = 0;
      for (const p of peaks || []) {
        if (!p || !(p.hz > 0)) continue;
        const pc = hzToPc(p.hz);
        const w = Math.max(0, p.amplitude - cfg.ampThresh);
        if (!w) continue;
        // Ring-over: early in the window, the PREVIOUS chord is still sounding —
        // its tones are ignored entirely rather than counted wrong.
        if (relSec < RING_OVER_S && prevPcs && prevPcs.expected.has(pc) && !expected.has(pc)) continue;
        H[pc] += w;
        if (expected.has(pc)) expHitNow++;
      }
      if (onsetRel == null && expHitNow >= Math.min(2, expected.size)) onsetRel = relSec;
    },
    current: () => evaluate(false),   // cheap — runs every 100 ms for the live meter
    final: () => evaluate(true),      // window close — includes per-tone forensics
  };
}

/** Batch equivalent of the live scorer (the manager-contract entry point). */
export function scoreChordWindow(detections, targetWindow, cfg, prevPcs = null) {
  const s = windowScorer(targetWindow, cfg, prevPcs);
  for (const d of detections || []) s.add(d.peaks, d.rms, d.relSec ?? 0);
  const r = s.final();
  return { quality: r.quality, points: GRADE_POINTS[r.quality], detail: r };
}

// ── Session scoring ───────────────────────────────────────────────────────────

export const GRADE_POINTS = { perfect: 100, good: 70, partial: 40, miss: 0, silent: 0 };

export function multiplierFor(combo) {
  return combo >= 20 ? 4 : combo >= 10 ? 3 : combo >= 5 ? 2 : 1;
}

export function gradeFor(accuracyPct) {
  return accuracyPct >= 95 ? 'S' : accuracyPct >= 85 ? 'A' : accuracyPct >= 70 ? 'B' : accuracyPct >= 50 ? 'C' : 'D';
}

export const initialGameState = () => ({
  score: 0, combo: 0, maxCombo: 0, resolved: 0, qSum: 0,
  counts: { perfect: 0, good: 0, partial: 0, miss: 0, silent: 0 },
  results: [],        // per-window { quality, q, points }
  scoreTimeline: [],  // cumulative score after each window (ghost pace)
});

/** Fold one resolved window into the running game state (pure reducer). */
export function applyWindowResult(state, result, speed = 1) {
  const mult = multiplierFor(state.combo);   // multiplier read BEFORE increment
  // Speed bonus: 50% speed → ×0.8, 100% → ×1.0, 150% → ×1.2.
  const speedMult = 0.6 + 0.4 * speed;
  const points = Math.round(GRADE_POINTS[result.quality] * mult * speedMult);
  const wasGood = result.quality === 'perfect' || result.quality === 'good';
  const wasBad = result.quality === 'miss' || result.quality === 'silent';
  const combo = wasGood ? state.combo + 1 : wasBad ? 0 : state.combo;
  const score = state.score + points;
  return {
    score,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    resolved: state.resolved + 1,
    qSum: state.qSum + (result.q || 0),
    counts: { ...state.counts, [result.quality]: state.counts[result.quality] + 1 },
    results: [...state.results, {
      quality: result.quality, q: result.q || 0, points,
      onsetBeat: result.onsetBeat ?? null,
      tones: result.tones || null,       // per-tone forensics for the practice report
      wrongTop: result.wrongTop || null,
    }],
    scoreTimeline: [...state.scoreTimeline, score],
  };
}

export function accuracyPct(state) {
  return state.resolved ? (state.qSum / state.resolved) * 100 : 0;
}

/** Speed-adjusted accuracy — the headline progress metric: full-speed clean runs
 *  rank above slow clean runs, but slow practice still counts. */
export function speedAdjAccuracy(accuracy, speed) {
  return accuracy * (0.6 + 0.4 * speed);
}

/** The 3 worst-played distinct chords of a run (for the "practice these" panel). */
export function worstChords(windows, results, max = 3) {
  const byName = new Map();
  results.forEach((r, i) => {
    const name = windows[i]?.name;
    if (!name) return;
    const e = byName.get(name) || { name, n: 0, qSum: 0 };
    e.n++; e.qSum += r.q || 0;
    byName.set(name, e);
  });
  return [...byName.values()]
    .map(e => ({ name: e.name, avgQ: e.qSum / e.n, attempts: e.n }))
    .filter(e => e.avgQ < GOOD_Q)
    .sort((a, b) => a.avgQ - b.avgQ)
    .slice(0, max);
}

// ── History (localStorage, sync-ready) ────────────────────────────────────────

const HISTORY_KEY = 'guitar_practice_history_v1';
const MAX_PER_SONG = 20;
const MAX_TOTAL = 400;

const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function songKeyOf(song) {
  return song.id || `${slug(song.title)}|${slug(song.artist)}`;
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && data.v === 1 && Array.isArray(data.sessions) ? data : { v: 1, sessions: [] };
  } catch { return { v: 1, sessions: [] }; }
}

function persistHistory(data) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(data)); } catch {}
}

/**
 * Save a finished (or quit) session. Record shape is deliberately flat with a
 * clientId, mirroring customSongs.js, so a later /api sync is a copy-paste of
 * the established pattern.
 */
export function saveSession(rec) {
  const data = loadHistory();
  data.sessions.unshift({
    clientId: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    serverId: null,
    ...rec,
  });
  // Prune: per-song cap, then global cap — oldest first.
  const perSong = new Map();
  data.sessions = data.sessions.filter(s => {
    const n = (perSong.get(s.songKey) || 0) + 1;
    perSong.set(s.songKey, n);
    return n <= MAX_PER_SONG;
  }).slice(0, MAX_TOTAL);
  persistHistory(data);
  return data;
}

export function sessionsForSong(songKey) {
  return loadHistory().sessions.filter(s => s.songKey === songKey);
}

/** Personal best (completed runs only), by speed-adjusted accuracy. */
export function bestForSong(songKey) {
  const done = sessionsForSong(songKey).filter(s => s.completed);
  if (!done.length) return null;
  return done.reduce((a, b) => (b.speedAdjAccuracy > a.speedAdjAccuracy ? b : a));
}

/** The previous completed run at the same speed — the "ghost" to beat. */
export function ghostForSong(songKey, speed) {
  return sessionsForSong(songKey).find(
    s => s.completed && s.speed === speed && Array.isArray(s.scoreTimeline) && s.scoreTimeline.length,
  ) || null;
}

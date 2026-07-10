// Play-Along — the practice game. Pick a song, its chords scroll toward a
// now-line in time with the song's bpm, the mic listens to you play along on a
// real guitar, and every chord window is scored live (perfect/good/partial/miss)
// with combo, grade and per-song improvement history.
//
// Architecture (from the 3-specialist design):
//   • ONE clock: the mic AudioContext's currentTime, anchored at start. Every
//     visual/scoring event derives from songSec inside a single rAF loop.
//   • Per-frame work writes ONLY to refs/styles (lane transform, volume, count-in,
//     live meter). React state changes happen once per resolved window (~2 s).
//   • Detection reuses the Listen tab's mic stack + the user's saved calibration
//     (lib/micDetect.js), opened RAW (no echo-cancel/NS/AGC — they garble guitar).
//   • No chord/bass audio during play (the mic would score the app itself):
//     silent mode with 2.5 kHz count-in ticks (above the detection band), plus an
//     optional drums-only backing (hats/snare live outside the 60–1200 Hz scan).
//   • All game math is pure lib/practiceGame.js.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  buildPlayTimeline, windowScorer, applyWindowResult, initialGameState,
  accuracyPct, speedAdjAccuracy, gradeFor, multiplierFor, worstChords,
  songKeyOf, saveSession, sessionsForSong, bestForSong, ghostForSong,
} from '../lib/practiceGame';
import { useMic, detectPeaksConfigured } from '../lib/micDetect';
import { playTicks, playBacking, playMetronome, playSoloGuitar, stopAudio, unlockAudio } from '../lib/audio';
import { loadCustomSongs } from '../lib/customSongs';
import { loadCatalogSongs } from '../lib/catalogSongs';
import { loadComposerSongs, composerSongToLyricSong } from '../lib/composerLibrary';
import { filterSongsByReach, chordWithinReach, songAllChordNames } from '../lib/songReach';
import { buildSessionReport } from '../lib/practiceReport';
import { personalDifficulty } from '../lib/handProfile';
import { easiestVoicing } from '../lib/voicingLookup';
import { songBpm } from '../lib/songs';
import { useHandProfile, useReachLimit } from '../App';
import FretboardDiagram from './FretboardDiagram';
import DifficultyBadge from './DifficultyBadge';
import ChordTip from './ChordTip';
import Lazy3D from './Lazy3D';

// Static-literal dynamic import so Rollup splits Neck3D (and all of three) into
// the shared three-vendor chunk; only fetched when the 3D neck is actually shown.
const loadNeck3D = () => import('./Neck3D');

// Timeline windows now vary in length (a chord = 4 beats, a solo note = 1), so
// the count-in bar, metronome and lane must read each window's own `beats`.
const totalBeatsOf = (windows) => windows.reduce((n, w) => n + (w.beats || 4), 0);
// Backing-band chord list from windows: solo windows carry no chord (name ''),
// so bass/drums keep their grid without playing a phantom chord under the solo.
const backingChords = (windows) =>
  windows.map(w => ({ name: w.kind === 'solo' ? '' : w.name, beats: w.beats || 4 }));

// Schedule the run's solo notes to sound on the beat. The audio engine's clock
// is separate from the mic's, so we schedule relative to NOW: window `w` starts
// at (t0Ref - micNow) + w.startSec from now. `fromIdx` skips already-played
// windows on resume.
function collectSoloNotes(tl, t0MinusMicNow, fromIdx = 0) {
  const notes = [];
  for (let i = fromIdx; i < tl.windows.length; i++) {
    const w = tl.windows[i];
    if (w.kind !== 'solo' || !w.notes?.length) continue;
    const atSec = t0MinusMicNow + w.startSec;
    for (const n of w.notes) notes.push({ string: n.string, fret: n.fret, atSec, durSec: w.durSec });
  }
  return notes;
}

// Musical note name for a solo cell's notes, shown under its fretboard dot
// (e.g. a single D3 → "D", a double-stop → "D+F#"). Standard-tuning open MIDI.
const OPEN_MIDI_PG = [40, 45, 50, 55, 59, 64];
const PC_NAMES_PG = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function soloNoteLabel(notes) {
  if (!notes?.length) return '♪';
  return notes
    .filter(n => n.string >= 0 && n.string <= 5)
    .map(n => PC_NAMES_PG[(OPEN_MIDI_PG[n.string] + n.fret) % 12])
    .join('+') || '♪';
}

const PX_PER_BEAT = 36;          // lane geometry: one bar cell = 4 × 36 = 144 px
const NOW_X = 110;               // px position of the now-line inside the lane
const SNAP_LAG = 0.10;           // s — analyser latency compensation
const FFT_MS = 100;              // detection cadence (≈ one full 4096-FFT frame)
const SILENCE_PAUSE_MS = 8000;   // sustained silence → auto-pause

// Level system: a fixed 20-stage ladder from 10% to 200% of the song's tempo
// in +10% steps (level N = N×10% speed). The difficulty pill picks the
// STARTING level; the game then climbs one level per RAMP_EVERY_SEC of actual
// playing until level MAX_LEVEL (double tempo).
const RAMP_EVERY_SEC = 120;
const MAX_LEVEL = 20;
const speedForLevel = (level) => level / 10;
const levelForSpeed = (speed) => Math.min(MAX_LEVEL, Math.max(1, Math.round(speed * 10)));
const DIFFICULTIES = [
  { id: 'easy',     label: '🐢 Easy',     speed: 0.3 },
  { id: 'medium',   label: '🚶 Medium',   speed: 0.5 },
  { id: 'hard',     label: '🏃 Hard',     speed: 0.8 },
  { id: 'original', label: '🎸 Original', speed: 1   },
];

const QUALITY_COLOR = {
  perfect: 'var(--color-success)',
  good: 'var(--color-brand)',
  partial: 'var(--color-warning)',
  miss: 'var(--color-danger)',
  silent: 'var(--color-ink-ghost)',
};
const QUALITY_LABEL = { perfect: 'PERFECT', good: 'GOOD', partial: 'ALMOST', miss: 'MISS', silent: '—' };
const GRADE_COLOR = {
  S: 'var(--color-brand)', A: 'var(--color-success)', B: 'var(--color-info)',
  C: 'var(--color-warning)', D: 'var(--color-danger)',
};

export default function PracticeGame({ cfg }) {
  const profile = useHandProfile();
  const limitToReach = useReachLimit();

  // ── Screen phase ──
  const [phase, setPhase] = useState('select');   // select | playing | paused | done
  const [pauseReason, setPauseReason] = useState(null);
  const [permDenied, setPermDenied] = useState(false);

  // ── Song select state ──
  const [customSongs, setCustomSongs] = useState([]);
  const [composerSongs, setComposerSongs] = useState([]);
  const [catalogSongs, setCatalogSongs] = useState([]);
  const [search, setSearch] = useState('');
  const [speed, setSpeed] = useState(DIFFICULTIES[0].speed);   // default: level 1 = 10%
  const [drumsOn, setDrumsOn] = useState(false);
  const [metronomeOn, setMetronomeOn] = useState(true);
  const [view3D, setView3D] = useState(false);
  const [rampMsg, setRampMsg] = useState(null);   // transient toast: { level, pct }
  const [levelUp, setLevelUp] = useState(null);   // giant 5s "Good luck!" interlude: { level, pct }
  const [level, setLevel] = useState(1);          // current game level (1..MAX_LEVEL)
  const [histTick, setHistTick] = useState(0);    // bump to refresh history-derived chips

  // ── Game state (one React update per resolved window) ──
  const [game, setGame] = useState(initialGameState);
  const [summary, setSummary] = useState(null);   // { record, worst, prevBest, history }
  const [song, setSong] = useState(null);

  // ── Refs (per-frame mutable, never re-render) ──
  const mic = useMic();
  const cfgRef = useRef(cfg); cfgRef.current = cfg;
  const gameRef = useRef(game);
  const timelineRef = useRef(null);               // { windows, meta }
  const scorersRef = useRef([]);
  const ghostRef = useRef(null);                  // previous run's scoreTimeline
  const t0Ref = useRef(0);                        // mic-clock time of song beat 0
  const rafRef = useRef(null);
  const lastFFTRef = useRef(0);
  const cursorRef = useRef(0);                    // window receiving snapshots
  const nextToScoreRef = useRef(0);
  const silenceSinceRef = useRef(null);
  const metroStopRef = useRef(null);              // stop handle for the in-play metronome
  const playedSecRef = useRef(0);                 // actual playing time toward the next level
  const lastTsRef = useRef(null);                 // previous rAF timestamp for playedSec accumulation
  const levelUpTimerRef = useRef(null);           // 5s "Good luck!" interlude timer
  const levelRef = useRef(1);                     // current level, mirrored for the rAF loop
  const levelClockRef = useRef(null);             // stopwatch <span> — written per frame, no re-render
  const startSpeedRef = useRef(1);                // the difficulty's tempo at run start (before ramping)
  const phaseRef = useRef(phase); phaseRef.current = phase;

  const laneTrackRef = useRef(null);
  const volRef = useRef(null);
  const meterRef = useRef(null);
  const countWrapRef = useRef(null);
  const countNumRef = useRef(null);

  // The rAF loop is a stable callback; pause/finish close over CURRENT state
  // (song, speed), so the loop reaches them through refs refreshed each render.
  const pauseRef = useRef(null);
  const finishRef = useRef(null);
  const resumeRef = useRef(null);
  const speedUpRef = useRef(null);
  const speedRef = useRef(speed); speedRef.current = speed;

  // ── Load song sources ──
  useEffect(() => {
    let alive = true;
    loadCatalogSongs().then(s => { if (alive) setCatalogSongs(s || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (phase === 'select') {
      setCustomSongs(loadCustomSongs());
      setComposerSongs(loadComposerSongs().map(composerSongToLyricSong).filter(Boolean));
      setHistTick(t => t + 1);
    }
  }, [phase]);

  // ── Song list (custom + composer + catalog, dedup, ≥4 chord hits, reach-aware) ──
  const songItems = useMemo(() => {
    const keyOf = s => `${(s.title || '').toLowerCase()}|${(s.artist || '').toLowerCase()}`;
    const seen = new Set();
    const merged = [];
    for (const s of [...customSongs, ...composerSongs, ...catalogSongs]) {
      const k = keyOf(s);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(s);
    }
    const withOcc = merged
      .map(s => {
        const occ = (s.lyricLines || []).reduce((n, ln) => n + (ln.chordNames?.length || 0), 0);
        return { song: s, occ };
      })
      .filter(x => x.occ >= 4);
    const reachFiltered = limitToReach
      ? withOcc.filter(x => filterSongsByReach([x.song], profile, true).length)
      : withOcc;
    return reachFiltered.map(({ song: s, occ }) => {
      const key = songKeyOf(s);
      const uniq = songAllChordNames(s);
      let hardest = 0;
      for (const n of uniq) {
        const v = easiestVoicing(n, { profile, limitToReach });
        if (v) hardest = Math.max(hardest, personalDifficulty(v.score, profile));
      }
      const beyond = limitToReach ? 0 : uniq.filter(n => !chordWithinReach(n, profile)).length;
      const sessions = sessionsForSong(key);
      const best = bestForSong(key);
      return {
        song: s, key, occ, uniq, hardest, beyond,
        bpm: Math.min(220, Math.max(40, s.bpm ?? songBpm(s.title) ?? 100)),
        best, last: sessions[0] || null,
        spark: sessions.slice(0, 5).reverse().map(x => x.accuracy),
      };
    }).sort((a, b) => (a.song.title || '').localeCompare(b.song.title || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customSongs, composerSongs, catalogSongs, profile, limitToReach, histTick]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return songItems;
    return songItems.filter(x => `${x.song.title} ${x.song.artist}`.toLowerCase().includes(q));
  }, [songItems, search]);

  // ── Cleanup on unmount ──
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (levelUpTimerRef.current) clearTimeout(levelUpTimerRef.current);
    mic.current.close();
    stopAudio();
  }, [mic]);

  // ── Auto-pause when the tab is hidden (rAF throttling would corrupt scoring) ──
  useEffect(() => {
    const onVis = () => { if (document.hidden && phaseRef.current === 'playing') pauseRef.current?.('hidden'); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setGameBoth = (next) => { gameRef.current = next; setGame(next); };

  // ── The single rAF loop ──
  const loop = useCallback((ts) => {
    rafRef.current = requestAnimationFrame(loop);
    const api = mic.current;
    const tl = timelineRef.current;
    if (!api.audioCtx || !tl) return;
    const { windows, meta } = tl;
    const songSec = api.audioCtx.currentTime - t0Ref.current;

    // Lane scroll + count-in — style/ref writes only.
    if (laneTrackRef.current) {
      laneTrackRef.current.style.transform =
        `translate3d(${NOW_X - (songSec / meta.spb) * PX_PER_BEAT}px,0,0)`;
    }
    if (songSec < 0) {
      if (countWrapRef.current) {
        countWrapRef.current.style.display = 'flex';
        if (countNumRef.current) countNumRef.current.textContent = String(Math.ceil(-songSec / meta.spb));
      }
      return;
    }
    if (countWrapRef.current && countWrapRef.current.style.display !== 'none') {
      countWrapRef.current.style.display = 'none';
    }

    // Level clock: accumulate actual playing time (count-in and pauses excluded);
    // every RAMP_EVERY_SEC climb one level, up to MAX_LEVEL (= double tempo).
    if (lastTsRef.current != null) playedSecRef.current += Math.min(0.1, (ts - lastTsRef.current) / 1000);
    lastTsRef.current = ts;
    if (levelClockRef.current) {
      if (levelRef.current >= MAX_LEVEL) {
        levelClockRef.current.textContent = 'MAX';
      } else {
        const rem = Math.max(0, RAMP_EVERY_SEC - playedSecRef.current);
        levelClockRef.current.textContent = `${Math.floor(rem / 60)}:${String(Math.floor(rem % 60)).padStart(2, '0')}`;
      }
    }
    if (playedSecRef.current >= RAMP_EVERY_SEC && levelRef.current < MAX_LEVEL) {
      playedSecRef.current = 0;
      speedUpRef.current?.();
      return;   // speedUp rebuilds the timeline and restarts this loop
    }

    // Detection tick (~100 ms).
    if (ts - lastFFTRef.current >= FFT_MS) {
      lastFFTRef.current = ts;
      const rms = api.getRMS();
      if (volRef.current) volRef.current.style.width = `${Math.min(100, Math.round(rms * 800))}%`;

      // Sustained-silence auto-pause.
      if (rms < cfgRef.current.silenceRms) {
        if (silenceSinceRef.current == null) silenceSinceRef.current = ts;
        else if (ts - silenceSinceRef.current > SILENCE_PAUSE_MS) { pauseRef.current?.('silence'); return; }
      } else {
        silenceSinceRef.current = null;
      }

      const t = songSec - SNAP_LAG;
      if (t >= 0 && t < meta.totalSec) {
        while (cursorRef.current < windows.length - 1 && t >= windows[cursorRef.current].endSec) {
          cursorRef.current++;
        }
        const w = windows[cursorRef.current];
        if (t >= w.startSec) {
          const fd = api.getFreqData();
          if (fd) {
            const peaks = detectPeaksConfigured(fd, api.audioCtx.sampleRate, api.analyser.fftSize, cfgRef.current);
            const sc = scorersRef.current[cursorRef.current];
            sc.add(peaks, rms, t - w.startSec);
            const live = sc.current();
            if (meterRef.current) {
              meterRef.current.style.width = `${Math.round(live.q * 100)}%`;
              meterRef.current.style.background = QUALITY_COLOR[live.quality] || 'var(--color-ink-ghost)';
            }
          }
        }
      }
    }

    // Close every window whose end has passed — ONE state update per window.
    while (nextToScoreRef.current < windows.length &&
           songSec - SNAP_LAG >= windows[nextToScoreRef.current].endSec) {
      const i = nextToScoreRef.current++;
      const r = scorersRef.current[i].final();
      setGameBoth(applyWindowResult(gameRef.current, r, speedRef.current));
    }

    if (songSec > meta.totalSec + 0.5) finishRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic]);

  // Sound the solo notes for this run through the audio engine. Called AFTER
  // t0Ref is set, so it can convert the mic-clock start into an audio-clock delay.
  const scheduleSolos = (tl, micNow, fromIdx = 0) => {
    const notes = collectSoloNotes(tl, t0Ref.current - micNow, fromIdx);
    if (notes.length) playSoloGuitar(notes);
  };

  // ── Start / pause / resume / finish ──
  const start = async (item) => {
    setPermDenied(false);
    try {
      await mic.current.open(cfgRef.current.smoothing, { raw: true });
    } catch (e) {
      if (e.name === 'NotAllowedError') setPermDenied(true);
      return;
    }
    const tl = buildPlayTimeline(item.song, { speed, profile, limitToReach });
    if (!tl.windows.length) { mic.current.close(); return; }
    timelineRef.current = tl;
    scorersRef.current = tl.windows.map((w, i) =>
      windowScorer(w, cfgRef.current, i > 0 ? tl.windows[i - 1].pcs : null));
    ghostRef.current = ghostForSong(item.key, speed)?.scoreTimeline || null;
    cursorRef.current = 0;
    nextToScoreRef.current = 0;
    lastFFTRef.current = 0;
    silenceSinceRef.current = null;
    playedSecRef.current = 0;
    lastTsRef.current = null;
    startSpeedRef.current = speed;
    levelRef.current = levelForSpeed(speed);
    setLevel(levelRef.current);
    setRampMsg(null);
    setGameBoth(initialGameState());
    setSummary(null);
    setSong(item.song);

    // Count-in: audible ticks (silent mode) or a drums-only count bar (backing on).
    unlockAudio();
    const micNow = mic.current.audioCtx.currentTime;
    if (drumsOn) {
      playBacking(
        [{ name: '', beats: tl.meta.countInBeats }, ...backingChords(tl.windows)],
        tl.meta.bpm, { drums: true, bass: false },
      );
      t0Ref.current = micNow + 0.15 + tl.meta.countInSec;   // audio.js scheduling lead
    } else {
      const lead = playTicks(tl.meta.countInBeats, tl.meta.spb);
      t0Ref.current = micNow + lead;
    }
    // Sound the solo/riff notes on the beat so the lead line plays along too.
    // audio.js clock ≠ mic clock, so schedule relative to NOW: the first playable
    // window starts at (t0 - micNow) from now, plus each window's own offset.
    scheduleSolos(tl, micNow);
    if (metronomeOn) {
      metroStopRef.current = playMetronome(totalBeatsOf(tl.windows), tl.meta.spb, {
        startInSec: t0Ref.current - mic.current.audioCtx.currentTime,
      });
    }
    setPhase('playing');
    rafRef.current = requestAnimationFrame(loop);
  };

  const pause = (reason = null) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopAudio();
    metroStopRef.current = null;   // stopAudio silenced it; drop the stale handle
    lastTsRef.current = null;      // paused time must not count toward the speed ramp
    if (levelUpTimerRef.current) { clearTimeout(levelUpTimerRef.current); levelUpTimerRef.current = null; }
    setLevelUp(null);
    setPauseReason(reason);
    setPhase('paused');
  };

  const resume = () => {
    const tl = timelineRef.current;
    if (!tl) return;
    const i = Math.min(nextToScoreRef.current, tl.windows.length - 1);
    // Restart at the top of the first unscored window with a fresh count-in;
    // its partial evidence is discarded (completed windows keep their scores).
    scorersRef.current[i] = windowScorer(tl.windows[i], cfgRef.current, i > 0 ? tl.windows[i - 1].pcs : null);
    cursorRef.current = i;
    silenceSinceRef.current = null;
    lastTsRef.current = null;
    const micNow = mic.current.audioCtx.currentTime;
    const countSec = 4 * tl.meta.spb;
    if (drumsOn) {
      playBacking(
        [{ name: '', beats: 4 }, ...backingChords(tl.windows.slice(i))],
        tl.meta.bpm, { drums: true, bass: false },
      );
      t0Ref.current = micNow + 0.15 + countSec - tl.windows[i].startSec;
    } else {
      const lead = playTicks(4, tl.meta.spb);
      t0Ref.current = micNow + lead - tl.windows[i].startSec;
    }
    scheduleSolos(tl, micNow, i);
    if (metronomeOn) {
      const remainingBeats = totalBeatsOf(tl.windows.slice(i));
      metroStopRef.current = playMetronome(remainingBeats, tl.meta.spb, {
        startInSec: t0Ref.current + tl.windows[i].startSec - mic.current.audioCtx.currentTime,
      });
    }
    setPauseReason(null);
    setPhase('playing');
    rafRef.current = requestAnimationFrame(loop);
  };

  // Toggle the metronome click at any time — including mid-song. Turning it on
  // during play joins in on the next beat, keeping the bar accent aligned.
  const toggleMetronome = () => {
    const next = !metronomeOn;
    setMetronomeOn(next);
    if (phase !== 'playing' || !timelineRef.current) return;
    if (!next) { metroStopRef.current?.(); metroStopRef.current = null; return; }
    const tl = timelineRef.current;
    const songSec = mic.current.audioCtx.currentTime - t0Ref.current;
    const nextBeat = Math.max(0, Math.ceil(songSec / tl.meta.spb + 0.02));
    const totalBeats = totalBeatsOf(tl.windows);
    if (nextBeat >= totalBeats) return;
    metroStopRef.current = playMetronome(totalBeats - nextBeat, tl.meta.spb, {
      startInSec: t0Ref.current + nextBeat * tl.meta.spb - mic.current.audioCtx.currentTime,
      accentPhase: nextBeat % 4,
    });
  };

  const finish = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopAudio();
    metroStopRef.current = null;
    if (levelUpTimerRef.current) { clearTimeout(levelUpTimerRef.current); levelUpTimerRef.current = null; }
    setLevelUp(null);
    mic.current.close();

    const tl = timelineRef.current;
    if (!tl) { setPhase('select'); return; }
    const g = gameRef.current;
    const completed = nextToScoreRef.current >= tl.windows.length;
    const key = songKeyOf(song || {});
    const acc = accuracyPct(g);
    const spdAcc = speedAdjAccuracy(acc, speed);
    const worst = worstChords(tl.windows, g.results);
    const prevBest = bestForSong(key);   // captured BEFORE saving this run

    let record = null;
    if (g.resolved >= 3) {               // don't record trivial abandons
      record = {
        songKey: key,
        title: song?.title || '', artist: song?.artist || '',
        bpm: tl.meta.bpmBase, speed, startSpeed: startSpeedRef.current, level: levelRef.current,
        endedAt: new Date().toISOString(),
        completed,
        score: g.score, maxCombo: g.maxCombo,
        accuracy: Math.round(acc * 10) / 10,
        speedAdjAccuracy: Math.round(spdAcc * 10) / 10,
        grade: gradeFor(acc),
        counts: g.counts,
        worst: worst.map(w => w.name),
        scoreTimeline: g.scoreTimeline,
      };
      saveSession(record);
    }
    // The detailed practice report: buzz/mute inference per failed chord tone,
    // finger attribution, wrong-note analysis, hardest transitions, suggestions.
    const report = buildSessionReport(tl.windows, g.results, profile);

    setSummary({
      record, worst, prevBest, report,
      history: key ? sessionsForSong(key).slice(0, 10) : [],
      accuracy: acc, grade: gradeFor(acc), completed,
    });
    setPhase('done');
  };

  // Level up: rebuild the timeline at the next level's tempo, keep all
  // already-scored windows, hold the game behind a giant 5-second "Good luck!"
  // interlude, then resume (with its own count-in) at the new tempo from the
  // first unscored window.
  const speedUp = () => {
    if (!timelineRef.current || phaseRef.current !== 'playing' || !song) return;
    if (levelRef.current >= MAX_LEVEL) return;
    const nextLevel = levelRef.current + 1;
    const next = speedForLevel(nextLevel);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopAudio();
    metroStopRef.current = null;
    const tl = buildPlayTimeline(song, { speed: next, profile, limitToReach });
    timelineRef.current = tl;
    for (let j = nextToScoreRef.current; j < tl.windows.length; j++) {
      scorersRef.current[j] = windowScorer(tl.windows[j], cfgRef.current, j > 0 ? tl.windows[j - 1].pcs : null);
    }
    levelRef.current = nextLevel;
    setLevel(nextLevel);
    setSpeed(next);
    speedRef.current = next;
    const msg = { level: nextLevel, pct: Math.round(next * 100) };
    setLevelUp(msg);
    levelUpTimerRef.current = setTimeout(() => {
      levelUpTimerRef.current = null;
      setLevelUp(null);
      setRampMsg(msg);
      setTimeout(() => setRampMsg(null), 4000);
      resumeRef.current?.();
    }, 5000);
  };

  pauseRef.current = pause;
  finishRef.current = finish;
  resumeRef.current = resume;
  speedUpRef.current = speedUp;

  const quitToSelect = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopAudio();
    if (levelUpTimerRef.current) { clearTimeout(levelUpTimerRef.current); levelUpTimerRef.current = null; }
    setLevelUp(null);
    mic.current.close();
    setPhase('select');
  };

  // ── Derived HUD values ──
  const acc = accuracyPct(game);
  const ghostDelta = ghostRef.current && game.resolved > 0
    ? game.score - (ghostRef.current[game.resolved - 1] ?? 0)
    : null;
  const lastResult = game.results[game.results.length - 1] || null;
  const tl = timelineRef.current;
  const activeIdx = game.resolved;
  const hasLyrics = !!tl?.windows.some(w => w.lyric);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes pgPop   { 0%{transform:scale(1)} 40%{transform:scale(1.06)} 100%{transform:scale(1)} }
        @keyframes pgShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
        @keyframes pgFloat { 0%{opacity:1; transform:translateY(0)} 100%{opacity:0; transform:translateY(-24px)} }
        @keyframes pgPulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes pgLuckFloat { 0%{transform:translateY(14px) scale(0.92); opacity:0} 12%{transform:translateY(0) scale(1); opacity:1} 100%{transform:translateY(-10px) scale(1.02); opacity:1} }
      `}</style>

      {/* ══ LEVEL-UP INTERLUDE — giant 5s "Good luck!" while the game holds ══ */}
      {levelUp != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(8,8,6,0.85)', backdropFilter: 'blur(5px)' }}>
          <div className="text-center px-6" style={{ animation: 'pgLuckFloat 5s ease-out forwards' }}>
            <p className="text-2xl sm:text-3xl font-bold mb-3" style={{ color: 'var(--color-success)' }}>
              ⏫ Level {levelUp.level} — {levelUp.pct}% speed
            </p>
            <p className="text-6xl sm:text-8xl font-black leading-tight"
              style={{ color: 'var(--color-brand)', textShadow: '0 0 60px rgba(201,169,110,0.45)', animation: 'pgPulse 1.4s ease-in-out infinite' }}>
              Good luck! 🍀
            </p>
            <p className="text-sm mt-4" style={{ color: 'var(--color-ink-muted)' }}>
              Take a breath — the count-in starts in a moment…
            </p>
          </div>
        </div>
      )}

      {/* ══ SONG SELECT ══ */}
      {phase === 'select' && (
        <>
          <div className="rounded-xl p-4" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
              <p className="text-sm font-bold" style={{ color: 'var(--color-ink)' }}>🎮 Play-Along</p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-widest font-semibold mr-0.5" style={{ color: 'var(--color-ink-ghost)' }}>Difficulty</span>
                  {DIFFICULTIES.map(d => (
                    <button key={d.id} onClick={() => setSpeed(d.speed)}
                      className="text-xs px-2.5 py-1.5 rounded-lg font-semibold"
                      title={`Starts at level ${levelForSpeed(d.speed)} of ${MAX_LEVEL} (${Math.round(d.speed * 100)}% tempo); +10% every 2 minutes, up to 200%`}
                      style={speed === d.speed
                        ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                        : { background: 'var(--color-surface-800)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}>
                      {d.label} <span className="font-normal opacity-70">{Math.round(d.speed * 100)}%</span>
                    </button>
                  ))}
                </div>
                <button onClick={toggleMetronome}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                  title="Audible metronome click while you play (safe through speakers)"
                  style={metronomeOn
                    ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                    : { background: 'var(--color-surface-800)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}>
                  🎵 Metronome
                </button>
                <button onClick={() => setDrumsOn(v => !v)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                  title="Drum backing while you play (headphones recommended — the mic must not hear the app)"
                  style={drumsOn
                    ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                    : { background: 'var(--color-surface-800)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}>
                  🥁 Drums
                </button>
                <button onClick={() => setView3D(v => !v)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                  title="Show the current chord on a rotating 3D neck instead of a flat diagram"
                  style={view3D
                    ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                    : { background: 'var(--color-surface-800)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}>
                  🧊 3D Neck
                </button>
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              Chords scroll in time — play each one on your guitar and the mic scores how well you match.
              {' '}The ladder has <strong>{MAX_LEVEL} levels</strong> from 10% to 200% tempo (+10% each). You start at
              {' '}<strong>level {levelForSpeed(speed)}</strong> ({Math.round(speed * 100)}%); every 2 minutes of playing climbs one level,
              {' '}ending at <strong>level {MAX_LEVEL} — double tempo</strong>. Faster levels earn a bigger score multiplier.
              {drumsOn && <span style={{ color: 'var(--color-warning)' }}> Headphones recommended with drums on.</span>}
            </p>
            {permDenied && <p className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>Microphone access denied — the game needs the mic to hear you play.</p>}
          </div>

          <div className="flex items-center gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search songs…"
              className="flex-1 text-sm rounded-lg px-3 py-2 outline-none"
              style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }} />
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-ink-ghost)' }}>{filteredItems.length} songs</span>
          </div>

          <div className="space-y-1.5">
            {filteredItems.map(item => (
              <div key={item.key} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-700)' }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-ink)' }}>{item.song.title}</span>
                    <span className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>— {item.song.artist}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] flex-wrap" style={{ color: 'var(--color-ink-ghost)' }}>
                    <span>♩{item.bpm}</span>
                    <span>{item.occ} chords</span>
                    <DifficultyBadge score={item.hardest || 1} />
                    {item.beyond > 0 && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.1)', color: 'var(--color-warning)' }}>
                        {item.beyond} beyond reach
                      </span>
                    )}
                    {item.best && (
                      <span style={{ color: 'var(--color-success)' }}>Best {item.best.grade} {Math.round(item.best.accuracy)}%</span>
                    )}
                    {item.last && !item.best && <span>Last {Math.round(item.last.accuracy)}%</span>}
                    {!item.last && <span style={{ color: 'var(--color-surface-550)' }}>Never played</span>}
                  </div>
                </div>
                {item.spark.length > 1 && (
                  <div className="hidden sm:flex items-end gap-0.5 h-6 shrink-0">
                    {item.spark.map((a, k) => (
                      <div key={k} className="w-1.5 rounded-sm"
                        style={{ height: `${Math.max(12, a)}%`, background: k === item.spark.length - 1 ? 'var(--color-brand)' : 'var(--color-surface-550)' }} />
                    ))}
                  </div>
                )}
                <button onClick={() => start(item)}
                  className="text-xs font-bold px-4 py-2 rounded-lg shrink-0"
                  style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
                  ▶ Play
                </button>
              </div>
            ))}
            {!filteredItems.length && (
              <div className="text-center py-10 text-sm" style={{ color: 'var(--color-ink-ghost)' }}>
                {songItems.length === 0
                  ? (limitToReach
                    ? 'No songs fully within your reach yet — import easier songs, or turn off "limit to my reach" in Account settings.'
                    : 'No songs yet — import one in the Import tab, and it appears here.')
                  : `No songs match “${search}”.`}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ PLAYING / PAUSED ══ */}
      {(phase === 'playing' || phase === 'paused') && tl && (
        <>
          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => (phase === 'paused' ? resume() : pause())}
              className="text-xs font-semibold px-3 py-2 rounded-lg"
              style={{ background: 'var(--color-surface-750)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
              {phase === 'paused' ? '▶ Resume' : '⏸ Pause'}
            </button>
            <div className="text-sm min-w-0 flex-1 truncate" style={{ color: 'var(--color-ink)' }}>
              <span className="font-semibold">{song?.title}</span>
              <span style={{ color: 'var(--color-ink-faint)' }}> — {song?.artist}</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(56,189,248,0.1)', color: 'var(--color-info)' }}>
              ♩{Math.round(tl.meta.bpm)}{speed !== 1 ? ` · ${Math.round(speed * 100)}%` : ''}
              {speed !== 1 && (
                <span className="ml-1" style={{ color: speed > 1 ? 'var(--color-success)' : 'var(--color-ink-ghost)' }}>
                  ×{(0.6 + 0.4 * speed).toFixed(2)}
                </span>
              )}
            </span>
            {rampMsg && (
              <span className="text-xs px-2 py-1 rounded-lg font-bold"
                style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--color-success)', animation: 'pgPop 0.5s ease' }}>
                ⏫ Level {rampMsg.level} — {rampMsg.pct}%
              </span>
            )}
            <button onClick={toggleMetronome}
              className="text-xs font-semibold px-2.5 py-2 rounded-lg"
              title={metronomeOn ? 'Metronome on — click to mute' : 'Metronome off — click to hear the beat'}
              style={metronomeOn
                ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                : { background: 'var(--color-surface-750)', color: 'var(--color-ink-ghost)', border: '1px solid var(--color-surface-550)' }}>
              🎵
            </button>
            <button onClick={finish}
              className="text-xs font-semibold px-3 py-2 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)' }}>
              ✕ End
            </button>
          </div>

          {/* HUD */}
          <div className="flex items-center gap-4 flex-wrap rounded-xl px-4 py-2.5"
            style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
            <div>
              <span className="text-[10px] uppercase tracking-widest font-semibold block" style={{ color: 'var(--color-ink-ghost)' }}>Score</span>
              <span className="text-lg font-black tabular-nums" style={{ color: 'var(--color-ink)' }}>{game.score.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest font-semibold block" style={{ color: 'var(--color-ink-ghost)' }}>Combo</span>
              <span className="text-lg font-black tabular-nums" style={{ color: game.combo >= 5 ? 'var(--color-brand)' : 'var(--color-ink-subtle)' }}>
                {game.combo > 0 ? `🔥${game.combo}` : '—'}
                <span className="text-xs font-bold ml-1" style={{ color: 'var(--color-ink-ghost)' }}>×{multiplierFor(game.combo)}</span>
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest font-semibold block" style={{ color: 'var(--color-ink-ghost)' }}>Accuracy</span>
              <span className="text-lg font-black tabular-nums" style={{ color: 'var(--color-ink)' }}>{game.resolved ? `${Math.round(acc)}%` : '—'}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest font-semibold block" style={{ color: 'var(--color-ink-ghost)' }}>
                Level {level}/{MAX_LEVEL} · {Math.round(speed * 100)}%
              </span>
              <span className="text-lg font-black tabular-nums" style={{ color: level >= MAX_LEVEL ? 'var(--color-brand)' : 'var(--color-ink)' }}>
                ⏱ <span ref={levelClockRef}>2:00</span>
              </span>
            </div>
            {ghostDelta != null && (
              <div>
                <span className="text-[10px] uppercase tracking-widest font-semibold block" style={{ color: 'var(--color-ink-ghost)' }}>vs last run</span>
                <span className="text-lg font-black tabular-nums"
                  style={{ color: ghostDelta >= 0 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                  {ghostDelta >= 0 ? `▲ +${ghostDelta}` : `▼ ${ghostDelta}`}
                </span>
              </div>
            )}
            <div className="flex-1" />
            {/* mic volume */}
            <div className="w-24">
              <span className="text-[10px] uppercase tracking-widest font-semibold block mb-1" style={{ color: 'var(--color-ink-ghost)' }}>Mic</span>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-550)' }}>
                <div ref={volRef} className="h-full rounded-full" style={{ width: '0%', background: 'var(--color-success)' }} />
              </div>
            </div>
          </div>

          {/* Level ladder — one cell per stage with its tempo percentage */}
          <div className="flex gap-0.5">
            {Array.from({ length: MAX_LEVEL }, (_, i) => {
              const lv = i + 1;
              const pct = lv * 10;
              const done = lv < level;
              const now = lv === level;
              return (
                <div key={lv} title={`Level ${lv} — ${pct}% speed`}
                  className="flex-1 min-w-0 rounded-sm text-center overflow-hidden"
                  style={{
                    height: 15, lineHeight: '15px', fontSize: 8, fontWeight: 700, cursor: 'default',
                    background: now ? 'var(--color-brand)' : done ? 'rgba(201,169,110,0.4)' : 'var(--color-surface-700)',
                    color: now ? 'var(--color-surface-900)' : done ? 'var(--color-surface-900)' : 'var(--color-ink-ghost)',
                    boxShadow: now ? '0 0 8px rgba(201,169,110,0.6)' : 'none',
                    animation: now ? 'pgPulse 2s ease-in-out infinite' : 'none',
                  }}>
                  <span className="hidden sm:inline">{pct}</span>
                </div>
              );
            })}
          </div>

          {/* Lane — styled as a realistic rosewood neck: warm wood gradient,
              horizontal steel strings, and metallic fret wires. Purely visual;
              the conveyor mechanics below are unchanged. */}
          <div className="relative rounded-xl overflow-hidden" style={{
            height: 96,
            border: '1px solid var(--color-surface-700)',
            backgroundColor: '#2a1a10',
            backgroundImage: [
              // 6 steel strings, thicker toward the bass (top)
              'repeating-linear-gradient(0deg, transparent 0 13px, rgba(216,212,204,0.55) 13px 14.4px, transparent 14.4px 16px)',
              // fret wires every ~one bar, with a bright top edge (metallic)
              `repeating-linear-gradient(90deg, transparent 0 ${4 * PX_PER_BEAT - 1.5}px, rgba(255,255,255,0.28) ${4 * PX_PER_BEAT - 1.5}px ${4 * PX_PER_BEAT - 1}px, rgba(150,152,158,0.9) ${4 * PX_PER_BEAT - 1}px ${4 * PX_PER_BEAT + 1}px, transparent ${4 * PX_PER_BEAT + 1}px ${4 * PX_PER_BEAT}px)`,
              // wood grain / depth shading
              'linear-gradient(180deg, #4a3222 0%, #3a2517 50%, #2a1a10 100%)',
            ].join(', '),
          }}>
            {/* now-line — lit gold with a soft halo */}
            <div className="absolute top-0 bottom-0 z-10" style={{
              left: NOW_X, width: 2.5, background: 'var(--color-brand)',
              boxShadow: '0 0 12px var(--brand-glow), 0 0 4px var(--brand-glow)',
              animation: `pgPulse ${tl.meta.spb}s ease-in-out infinite`,
            }} />
            {/* judgment floater */}
            {lastResult && (
              <div key={game.resolved} className="absolute z-20 text-sm font-black pointer-events-none"
                style={{ left: NOW_X + 10, top: 8, color: QUALITY_COLOR[lastResult.quality], animation: 'pgFloat 0.6s ease-out forwards' }}>
                {QUALITY_LABEL[lastResult.quality]}{lastResult.points > 0 ? ` +${lastResult.points}` : ''}
              </div>
            )}
            {/* conveyor track */}
            <div ref={laneTrackRef} className="absolute top-0 bottom-0 left-0" style={{ willChange: 'transform' }}>
              {tl.windows.map((w, i) => {
                const res = game.results[i];
                const isActive = i === activeIdx && phase === 'playing';
                const isSolo = w.kind === 'solo';
                // Beat-based geometry: solo notes are narrow (1 beat), chords a
                // full bar (4 beats). Position by the window's own start beat.
                const leftPx = (w.startSec / tl.meta.spb) * PX_PER_BEAT;
                const widthPx = (w.beats || 4) * PX_PER_BEAT - (isSolo ? 4 : 8);
                // Solo notes get a distinct cyan "lead" look so they read apart
                // from the gold chord blocks.
                const soloBg = isActive
                  ? 'radial-gradient(120% 120% at 35% 25%, #d6f4ff 0%, #6fd3f0 40%, #2aa8d4 80%)'
                  : 'radial-gradient(120% 120% at 35% 25%, rgba(147,220,242,0.9) 0%, rgba(56,189,248,0.8) 60%, rgba(14,120,170,0.75) 100%)';
                const chordBg = isActive
                  ? 'radial-gradient(120% 120% at 35% 25%, #fff3cf 0%, #f0cf7a 32%, #d4a63c 70%, #a97d24 100%)'
                  : 'radial-gradient(120% 120% at 35% 25%, rgba(240,207,122,0.85) 0%, rgba(212,166,60,0.8) 60%, rgba(169,125,36,0.75) 100%)';
                return (
                  <div key={i} className="absolute rounded-lg flex flex-col items-center justify-center"
                    title={isSolo && w.notes?.length ? w.notes.map(n => `${['E','A','D','G','B','e'][n.string]}${n.fret}`).join(' ') : undefined}
                    style={{
                      left: leftPx, width: widthPx, top: isSolo ? 24 : 10, bottom: isSolo ? 24 : 10,
                      // Un-judged cells read as glossy markers riding the neck;
                      // once judged they take their result color as a flat tint.
                      background: res
                        ? 'var(--color-surface-800)'
                        : isSolo ? soloBg : chordBg,
                      border: `1.5px solid ${res ? QUALITY_COLOR[res.quality] : isActive ? (isSolo ? '#d6f4ff' : '#fff3cf') : isSolo ? 'rgba(14,120,170,0.9)' : 'rgba(122,90,20,0.9)'}`,
                      boxShadow: res ? 'none' : isActive
                        ? `0 0 16px ${isSolo ? 'rgba(56,189,248,0.5)' : 'var(--brand-glow)'}, inset 0 1px 2px rgba(255,255,255,0.5)`
                        : '0 2px 8px rgba(0,0,0,0.35), inset 0 1px 2px rgba(255,255,255,0.35)',
                      opacity: res ? (res.quality === 'miss' || res.quality === 'silent' ? 0.4 : 0.75) : 1,
                      animation: res
                        ? (res.quality === 'miss' ? 'pgShake 0.3s' : res.quality === 'perfect' || res.quality === 'good' ? 'pgPop 0.24s' : 'none')
                        : 'none',
                    }}>
                    <span className={isSolo ? 'text-xs font-black leading-none' : 'text-base font-black leading-none'}
                      style={{ color: res ? QUALITY_COLOR[res.quality] : isSolo ? '#062b3a' : '#3a2708' }}>
                      {isSolo && w.notes?.length
                        ? w.notes.map(n => n.fret).join('/')
                        : w.name}
                    </span>
                    {w.lyric && (
                      <span className="text-[9px] leading-tight mt-1 px-1 text-center truncate max-w-full"
                        style={{ color: res ? 'var(--color-ink-faint)' : 'rgba(58,39,8,0.75)' }}>
                        {w.lyric}
                      </span>
                    )}
                    {res && <span className="text-[9px] font-bold mt-0.5" style={{ color: QUALITY_COLOR[res.quality] }}>{QUALITY_LABEL[res.quality]}</span>}
                  </div>
                );
              })}
            </div>
            {/* count-in overlay (ref-driven) */}
            <div ref={countWrapRef} className="absolute inset-0 z-30 items-center justify-center gap-3" style={{ display: 'none', background: 'rgba(0,0,0,0.55)' }}>
              <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--color-ink-faint)' }}>Get ready</span>
              <span ref={countNumRef} className="text-4xl font-black" style={{ color: 'var(--color-brand)' }}>4</span>
            </div>
            {/* paused overlay */}
            {phase === 'paused' && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.6)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  {pauseReason === 'silence' ? "Paused — can't hear your guitar" : pauseReason === 'hidden' ? 'Paused — tab was hidden' : 'Paused'}
                </p>
                <div className="flex gap-2">
                  <button onClick={resume} className="text-xs font-bold px-4 py-2 rounded-lg" style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>▶ Resume</button>
                  <button onClick={finish} className="text-xs font-semibold px-4 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)' }}>End</button>
                </div>
              </div>
            )}
          </div>

          {/* synced lyrics — karaoke line: the word under the current chord is
              lit; a few words on either side give context */}
          {hasLyrics && (
            <div className="rounded-xl px-4 py-3 text-center" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
              <span className="text-[10px] uppercase tracking-widest font-semibold block mb-1.5" style={{ color: 'var(--color-ink-ghost)' }}>🎤 Sing along</span>
              <p className="leading-relaxed" style={{ fontSize: 15 }}>
                {(() => {
                  const from = Math.max(0, activeIdx - 3);
                  const to = Math.min(tl.windows.length, activeIdx + 6);
                  const slice = tl.windows.slice(from, to);
                  if (!slice.some(w => w.lyric)) {
                    return <span style={{ color: 'var(--color-ink-ghost)' }}>♪ (instrumental) ♪</span>;
                  }
                  return slice.map((w, k) => {
                    const idx = from + k;
                    if (!w.lyric) return null;
                    const active = idx === activeIdx;
                    const past = idx < activeIdx;
                    return (
                      <span key={idx}
                        style={{
                          color: active ? 'var(--color-brand)' : past ? 'var(--color-ink-ghost)' : 'var(--color-ink-subtle)',
                          fontWeight: active ? 800 : 500,
                          textShadow: active ? '0 0 18px rgba(201,169,110,0.5)' : 'none',
                          transition: 'color 0.2s',
                        }}>
                        {w.lyric}{' '}
                      </span>
                    );
                  });
                })()}
              </p>
            </div>
          )}

          {/* live match meter */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--color-ink-ghost)' }}>Match</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-650)' }}>
              <div ref={meterRef} className="h-full rounded-full" style={{ width: '0%', background: 'var(--color-ink-ghost)', transition: 'width 0.15s' }} />
            </div>
          </div>

          {/* current + next shapes */}
          <div className="flex items-start gap-4 rounded-xl px-4 py-3" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
            {tl.windows[activeIdx] && (() => {
              const w = tl.windows[activeIdx];
              const solo = w.kind === 'solo';
              // For a solo, label it "Solo" and show the note name(s) instead of a
              // chord name; the FretboardDiagram already draws each note as a dot.
              const label = solo ? 'Solo' : 'Now';
              const caption = solo ? soloNoteLabel(w.notes) : w.name;
              return (
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase tracking-widest font-semibold mb-1"
                    style={{ color: solo ? 'var(--color-info)' : 'var(--color-brand)' }}>{label}</span>
                  {view3D ? (
                    <div style={{ width: 160, height: 140 }}>
                      <Lazy3D
                        load={loadNeck3D}
                        componentProps={{ notes: w.notes }}
                        fallback={<FretboardDiagram chord={{ name: caption, tab: w.tab, notes: w.notes }} showFingers={!solo} />}
                      />
                      <p className="text-center text-xs font-semibold -mt-1" style={{ color: solo ? 'var(--color-info)' : 'var(--color-ink)' }}>{caption}</p>
                    </div>
                  ) : (
                    <FretboardDiagram chord={{ name: caption, tab: w.tab, notes: w.notes }} showFingers={!solo} />
                  )}
                </div>
              );
            })()}
            {tl.windows[activeIdx + 1] && (() => {
              const w = tl.windows[activeIdx + 1];
              const solo = w.kind === 'solo';
              return (
                <div className="flex flex-col items-center opacity-60">
                  <span className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--color-ink-ghost)' }}>{solo ? 'Solo' : 'Next'}</span>
                  <FretboardDiagram chord={{ name: solo ? soloNoteLabel(w.notes) : w.name, tab: w.tab, notes: w.notes }} />
                </div>
              );
            })()}
            <div className="flex-1 text-xs self-center" style={{ color: 'var(--color-ink-faint)' }}>
              {activeIdx < tl.windows.length
                ? <>Chord {Math.min(activeIdx + 1, tl.windows.length)} of {tl.windows.length}</>
                : 'Finishing…'}
            </div>
          </div>
        </>
      )}

      {/* ══ RESULTS ══ */}
      {phase === 'done' && summary && (
        <>
          <div className="rounded-xl p-6 text-center" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
            <div className="text-6xl font-black mb-1" style={{
              color: GRADE_COLOR[summary.grade],
              textShadow: summary.grade === 'S' ? '0 0 24px rgba(201,169,110,0.5)' : 'none',
            }}>
              {summary.grade}
            </div>
            {summary.record && summary.completed &&
              (!summary.prevBest || summary.record.speedAdjAccuracy > summary.prevBest.speedAdjAccuracy) && (
              <div className="text-xs font-bold mb-2" style={{ color: 'var(--color-brand)' }}>★ Personal best!</div>
            )}
            <p className="text-sm" style={{ color: 'var(--color-ink)' }}>
              Accuracy <strong>{Math.round(summary.accuracy)}%</strong> · Score <strong>{game.score.toLocaleString()}</strong>
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-ink-faint)' }}>
              Best combo {game.maxCombo}{speed !== 1 ? ` · ${speed * 100}% speed` : ''}{!summary.completed ? ' · ended early' : ''}
            </p>

            {/* quality bar */}
            {game.resolved > 0 && (
              <div className="flex h-2.5 rounded-full overflow-hidden mt-4" style={{ background: 'var(--color-surface-650)' }}>
                {['perfect', 'good', 'partial', 'miss', 'silent'].map(q => (
                  game.counts[q] > 0 && (
                    <div key={q} style={{ width: `${(game.counts[q] / game.resolved) * 100}%`, background: QUALITY_COLOR[q] }} />
                  )
                ))}
              </div>
            )}
            <div className="flex justify-center gap-3 mt-2 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
              <span style={{ color: 'var(--color-success)' }}>{game.counts.perfect}✦</span>
              <span style={{ color: 'var(--color-brand)' }}>{game.counts.good}✓</span>
              <span style={{ color: 'var(--color-warning)' }}>{game.counts.partial}◐</span>
              <span style={{ color: 'var(--color-danger)' }}>{game.counts.miss + game.counts.silent}✗</span>
            </div>
          </div>

          {/* progress on this song */}
          {summary.history.length > 1 && (
            <div className="rounded-xl p-4" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--color-ink-ghost)' }}>Progress on this song</p>
              <div className="flex items-end gap-1.5 h-16">
                {summary.history.slice().reverse().map((s, k, arr) => (
                  <div key={k} className="flex-1 rounded-t"
                    title={`${Math.round(s.accuracy)}% · ${s.grade} · ${new Date(s.endedAt).toLocaleDateString()}`}
                    style={{
                      height: `${Math.max(6, s.accuracy)}%`,
                      background: k === arr.length - 1 ? 'var(--color-brand)' : 'var(--color-surface-550)',
                    }} />
                ))}
              </div>
              {summary.history.length >= 2 && (
                <p className="text-xs mt-2" style={{ color: 'var(--color-ink-muted)' }}>
                  {(() => {
                    const delta = Math.round(summary.history[0].accuracy - summary.history[1].accuracy);
                    return delta >= 0 ? `▲ +${delta}% vs last run` : `▼ ${delta}% vs last run`;
                  })()}
                </p>
              )}
            </div>
          )}

          {/* ── Practice report — detailed post-run diagnosis ── */}
          {summary.report && (
            <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
              <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--color-brand)' }}>
                📋 Practice report
              </p>

              {/* Overall narrative */}
              {summary.report.overall.length > 0 && (
                <div className="space-y-2">
                  {summary.report.overall.map((line, k) => (
                    <p key={k} className="text-xs leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>{line}</p>
                  ))}
                </div>
              )}

              {/* Finger scoreboard */}
              {summary.report.fingerStats.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--color-ink-ghost)' }}>Fingers this run</p>
                  <div className="flex flex-wrap gap-2">
                    {summary.report.fingerStats.slice().sort((a, b) => a.finger - b.finger).map(f => (
                      <span key={f.finger} className="text-[11px] px-2.5 py-1 rounded-lg tabular-nums"
                        style={{
                          background: f.rate >= 0.35 ? 'rgba(239,68,68,0.1)' : f.rate >= 0.2 ? 'rgba(251,191,36,0.08)' : 'rgba(74,222,128,0.08)',
                          color: f.rate >= 0.35 ? 'var(--color-danger)' : f.rate >= 0.2 ? 'var(--color-warning)' : 'var(--color-success)',
                          border: '1px solid var(--color-surface-600)',
                        }}>
                        {f.finger} · {f.name}: {Math.round(f.rate * 100)}% failed ({f.issues}/{f.attempts})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Per-chord diagnosis */}
              {summary.report.chordIssues.map(ci => (
                <div key={ci.name} className="rounded-lg p-3" style={{ background: 'var(--color-surface-850)', border: '1px solid var(--color-surface-700)' }}>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 flex flex-col items-center">
                      <ChordTip name={ci.name}>
                        <span className="text-base font-black cursor-help" style={{ color: 'var(--color-danger)' }}>{ci.name}</span>
                      </ChordTip>
                      {ci.tab && (() => {
                        // Paint the diagnosis onto the diagram: one mark per
                        // failed string; 'missing' (red) wins over 'weak' (amber).
                        const marks = {};
                        for (const t of ci.tones) for (const sp of t.spots) {
                          if (marks[sp.string] !== 'missing') marks[sp.string] = t.kind;
                        }
                        return (
                          <>
                            <FretboardDiagram chord={{ name: '', tab: ci.tab, notes: ci.notes }} showFingers marks={marks} />
                            {Object.keys(marks).length > 0 && (
                              <p className="text-[9px] leading-tight text-center" style={{ color: 'var(--color-ink-ghost)' }}>
                                <span style={{ color: '#ef4444' }}>●</span> didn't sound{' '}
                                <span style={{ color: '#f59e0b' }}>●</span> buzzed
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className="text-[11px]" style={{ color: 'var(--color-ink-ghost)' }}>
                        {Math.round(ci.avgQ * 100)}% avg match over {ci.attempts} bar{ci.attempts !== 1 ? 's' : ''}
                        {ci.lateRate >= 0.4 && <span style={{ color: 'var(--color-warning)' }}> · often late</span>}
                        {ci.silentRate >= 0.5 && <span style={{ color: 'var(--color-ink-faint)' }}> · often silent</span>}
                        {ci.beyondReach && <span style={{ color: 'var(--color-danger)' }}> · beyond your reach ceiling</span>}
                      </p>
                      {/* failed tones: string / fret / finger with buzz-vs-mute reading */}
                      {ci.tones.map((t, k) => (
                        <p key={k} className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--color-ink-subtle)' }}>
                          <span className="mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full"
                            style={{ background: t.kind === 'missing' ? 'var(--color-danger)' : 'var(--color-warning)' }} />
                          <span>{t.text}{t.required && <strong style={{ color: 'var(--color-ink-muted)' }}> (a defining tone of the chord)</strong>}</span>
                        </p>
                      ))}
                      {/* wrong notes heard */}
                      {ci.wrongNotes.map((wn, k) => (
                        <p key={k} className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--color-ink-subtle)' }}>
                          <span className="mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)' }} />
                          <span>Heard a stray <strong>{wn.noteName}</strong> — {wn.hint}.</span>
                        </p>
                      ))}
                      {/* suggestions */}
                      {ci.suggestions.length > 0 && (
                        <ul className="mt-1 space-y-1">
                          {ci.suggestions.map((s, k) => (
                            <li key={k} className="text-[11px] leading-relaxed pl-2" style={{ color: 'var(--color-success)', borderLeft: '2px solid rgba(74,222,128,0.35)' }}>
                              {s}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {summary.report.chordIssues.length === 0 && (
                <p className="text-xs italic" style={{ color: 'var(--color-ink-ghost)' }}>
                  No chord-level problems worth flagging — nice hands.
                </p>
              )}

              {/* Hardest transitions */}
              {summary.report.transitions.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--color-ink-ghost)' }}>Hardest changes</p>
                  {summary.report.transitions.map((t, k) => (
                    <p key={k} className="text-[11px] mb-0.5" style={{ color: 'var(--color-ink-subtle)' }}>
                      <ChordTip name={t.from}><strong className="cursor-help" style={{ color: 'var(--color-ink)' }}>{t.from}</strong></ChordTip>
                      {' → '}
                      <ChordTip name={t.to}><strong className="cursor-help" style={{ color: 'var(--color-ink)' }}>{t.to}</strong></ChordTip>
                      {`: ${Math.round(t.avgQ * 100)}% avg match`}
                      {t.lateRate >= 0.4 ? `, late ${Math.round(t.lateRate * 100)}% of the time` : ''}
                      {t.physicalCost != null ? ` · physical cost ${t.physicalCost}/10 for this switch` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* toughest chords (simple list — only when the detailed report has nothing) */}
          {!(summary.report?.chordIssues?.length) && summary.worst.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: 'var(--color-ink-ghost)' }}>Toughest chords — practice these</p>
              <div className="flex flex-wrap gap-4">
                {summary.worst.map(w => {
                  const v = easiestVoicing(w.name, { profile, limitToReach });
                  return (
                    <div key={w.name} className="flex flex-col items-center gap-1">
                      <ChordTip name={w.name}>
                        <span className="text-sm font-bold cursor-help" style={{ color: 'var(--color-danger)' }}>{w.name}</span>
                      </ChordTip>
                      {v && <FretboardDiagram chord={{ name: w.name, tab: v.tab, notes: v.notes }} showFingers />}
                      <span className="text-[10px]" style={{ color: 'var(--color-ink-ghost)' }}>{Math.round(w.avgQ * 100)}% avg match</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => { const item = songItems.find(x => x.key === songKeyOf(song || {})); if (item) start(item); }}
              className="text-sm font-bold px-5 py-2.5 rounded-xl"
              style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
              ▶ Play again
            </button>
            <button onClick={quitToSelect}
              className="text-sm font-semibold px-5 py-2.5 rounded-xl"
              style={{ background: 'var(--color-surface-750)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
              Songs
            </button>
          </div>
        </>
      )}
    </div>
  );
}

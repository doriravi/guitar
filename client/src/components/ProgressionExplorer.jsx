import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ROOT_NOTES, getDiatonicChords } from '../lib/scales';
import { MAJOR_PROGRESSIONS, MINOR_PROGRESSIONS } from '../lib/progressions';
import { fingerGapUsage, GAP_REF_MAX, transitionDifficulty, scoreTransition } from '../lib/fretboard';
import { DEFAULT_PROFILE, gapStrain } from '../lib/handProfile';
import { suggestEasierProgression } from '../lib/substitutions';
import { suggestUpperProgression } from '../lib/upperVoicings';
import { suggestTriadProgression } from '../lib/triadVoicings';
import { alignChordsToLyrics, enrichChords } from '../lib/lyricChords';
import { bestCapo, capoPlaybackTab } from '../lib/capo';
import { lyrics as lyricsApi } from '../lib/api';
import { playProgression, stopAudio } from '../lib/audio';
import { useMic, loadConfig, detectPeaksConfigured, matchChordConfigured } from '../lib/micDetect';
import { fretHz } from '../lib/pitchDetect';
import { makeCountdownCue } from '../lib/countdownCue';
import { sparkBurst } from '../lib/sparkBurst';
import { SONGS_BY_PROGRESSION, songBpm } from '../lib/songs';
import { loadCustomSongs, addCustomSong, updateCustomSong, songToText } from '../lib/customSongs';
import { loadCatalogSongs } from '../lib/catalogSongs';
import { parseChordSheet } from '../lib/chordSheetParser';
import { lookupVoicings, easiestVoicing } from '../lib/voicingLookup';
import { resolveChordCells } from '../lib/songTimeline';
import { filterSongsByReach } from '../lib/songReach';
import { filterSongsByLevel } from '../lib/levelFilter';
import { currentLevelCeiling, loadManual } from '../lib/levelPlan';
import { prefersReducedMotion } from '../lib/gpu';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';
import ChordTip from './ChordTip';
import CapoSuggestion from './CapoSuggestion';
import ErrorBoundary from './ErrorBoundary';
import SongEditor from './SongEditor';
import SoloTabView from './SoloTabView';
import Celebration from './Celebration';
import Lazy3D from './Lazy3D';
import { buildSimplifiedAutoTab } from '../lib/autoTab';
import { useT } from '../lib/i18n';
import { useHandProfile, useAIFingers, useReachLimit, useLevelLimit } from '../App';

// Shared empty degree set for song-search results (no progression context, so no
// out-of-progression chord flagging). Module-scoped so its identity is stable.
const EMPTY_DEGREE_SET = new Set();

// Lazy loaders for the opened-song header's ambient TSL backdrop and the
// chord-change "tension field". Static-literal specifiers so Vite splits them
// into the shared three-vendor chunk; only fetched when should3D() passes (see
// Lazy3D). Module-scoped so Lazy3D's memo stays stable across renders.
const loadSongHeaderAmbient = () => import('./three/SongHeaderAmbient');
const loadTensionField = () => import('./three/TensionField');

function resolveForKey(root, scaleType, maxDiff) {
  const diatonic = getDiatonicChords(root, scaleType);
  const progList = scaleType === 'major' ? MAJOR_PROGRESSIONS : MINOR_PROGRESSIONS;
  return progList
    .map(prog => {
      const chords = prog.degrees.map(deg => {
        const { roman, chordName } = diatonic[deg];
        const voicings = lookupVoicings(chordName)
          .slice()
          .sort((a, b) => a.score - b.score);
        const minScore = voicings.length ? voicings[0].score : null;
        return { roman, chordName, voicings, minScore };
      });
      const scores = chords.map(c => c.minScore);
      const playable = scores.every(s => s !== null);
      const maxScore = playable ? Math.max(...scores) : Infinity;
      return { ...prog, chords, maxScore, playable, root, scaleType };
    })
    .filter(p => p.playable && p.maxScore <= maxDiff);
}

function cardKey(prog) {
  return `${prog.root}|${prog.scaleType}|${prog.name}`;
}

// ─── Finger gap bars ─────────────────────────────────────────────────────────

const PAIR_META = [
  { key: 'thumbToIndex',  label: 'T→I', color: 'var(--color-accent)' },
  { key: 'indexToMiddle', label: 'I→M', color: 'var(--color-info)' },
  { key: 'middleToRing',  label: 'M→R', color: 'var(--color-success)' },
  { key: 'ringToLittle',  label: 'R→P', color: 'var(--color-warning)' },
];

function FingerGapBars({ notes, profile }) {
  const usage = fingerGapUsage(notes);
  if (!usage) return null;

  const pairs = PAIR_META.map(p => {
    const rawFraction = usage[p.key];
    const refMax = GAP_REF_MAX[p.key];
    const requiredCm = rawFraction * refMax;
    const userCm = profile[p.key];
    // On-neck strain (1-fret gaps are comfortable) — see gapStrain in handProfile.js.
    const userFraction = gapStrain(requiredCm, userCm, p.key);
    return { ...p, rawFraction, userFraction, requiredCm, userCm };
  }).filter(p => p.rawFraction > 0.05);

  if (pairs.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 mt-1.5">
      {pairs.map(p => {
        const over = p.userFraction > 1;
        const barColor = over ? 'var(--color-danger)' : p.userFraction > 0.9 ? 'var(--color-warning)' : p.userFraction > 0.7 ? 'var(--color-caution)' : 'var(--color-success)';
        const tip = `${p.label}: needs ~${p.requiredCm.toFixed(1)} cm — your span ${p.userCm.toFixed(1)} cm (${Math.round(p.userFraction * 100)}%)`;
        return (
          <div key={p.key} className="flex items-center gap-1" title={tip}>
            <span className="text-[8px] w-5 shrink-0" style={{ color: p.color }}>{p.label}</span>
            <div className="relative h-1 rounded-full overflow-hidden" style={{ width: 36, background: 'var(--color-surface-550)' }}>
              <div className="absolute left-0 top-0 h-full rounded-full"
                style={{ width: `${Math.min(1, p.userFraction) * 100}%`, background: barColor }} />
            </div>
            <span className="text-[8px] tabular-nums" style={{ color: over ? 'var(--color-danger)' : 'var(--color-ink-faint)' }}>
              {p.requiredCm.toFixed(1)}<span style={{ color: 'var(--color-surface-600)' }}>/{p.userCm.toFixed(1)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card-header action chip ───────────────────────────────────────────────────
// The easier / up-the-neck / changes / triads toggles. One unified pill so the
// whole row reads as a single system (same padding/radius). At REST the icon is
// tinted with the chip's feature color (colorful yet legible on a calm surface);
// when OPEN it fills with a feature-colored wash + a matching soft shadow, so
// "this is on" reads at a glance. Gold-family chips also get the shared .ui-glow.
// `feat` is a CSS color value (a token var). Reduced-motion is handled by
// .ui-press already degrading to brightness-only.

function ActionChip({ onClick, open, feat, icon, title, dataExplain, children }) {
  const isGold = feat === 'var(--color-brand)' || feat === 'var(--color-warning)';
  return (
    <button
      onClick={onClick}
      title={title}
      data-explain={dataExplain}
      className={`ui-press flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all${open && isGold ? ' ui-glow' : ''}`}
      style={open
        ? {
            background: `color-mix(in srgb, ${feat} 14%, transparent)`,
            color: feat,
            border: `1px solid color-mix(in srgb, ${feat} 30%, transparent)`,
            boxShadow: isGold ? undefined : `0 2px 10px color-mix(in srgb, ${feat} 18%, transparent)`,
          }
        : {
            background: 'var(--color-surface-700)',
            color: 'var(--color-ink-faint)',
            border: '1px solid var(--color-surface-550)',
          }}
    >
      {/* Icon carries the feature color even at rest so the row isn't all-grey.
          Text stays legible ink; color here is redundant with the label. */}
      <span aria-hidden="true" style={{ color: open ? feat : `color-mix(in srgb, ${feat} 55%, var(--color-ink-faint))` }}>{icon}</span>
      {children}
    </button>
  );
}

// ─── Collapsible section ───────────────────────────────────────────────────────
// Animates a panel open AND closed via a CSS grid-rows trick (0fr↔1fr + opacity),
// so closing eases shut instead of hard-cutting — the enter/exit symmetry the
// card panels were missing. Children mount LAZILY on first open (so five closed
// panels per card don't run their useMemos), then stay mounted so the collapse
// can animate. grid-template-rows / opacity are compositor-friendly; under
// prefers-reduced-motion the transition duration collapses to ~0 (see index.css).

function CollapsibleSection({ open, children }) {
  const [everOpened, setEverOpened] = useState(open);
  useEffect(() => { if (open) setEverOpened(true); }, [open]);
  if (!everOpened) return null;
  return (
    <div className="pwm-collapse" data-open={open ? 'true' : 'false'}>
      <div className="pwm-collapse-inner">
        {children}
      </div>
    </div>
  );
}

// ─── Transition badge (difficulty of switching between two chords) ─────────────

function transitionColor(score) {
  if (score <= 3) return 'var(--color-success)';
  if (score <= 6) return 'var(--color-caution)';
  if (score <= 8) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function TransitionBadge({ fromName, toName, score, tr }) {
  const tc = transitionColor(score);
  const label = `${tr.changeLabel || 'Change'} ${fromName} → ${toName}: ${score.toFixed(1)} out of 10`;
  return (
    <div
      className="ui-press flex flex-col items-center justify-center shrink-0 px-1 self-stretch select-none rounded"
      role="button" tabIndex={0}
      title={label} aria-label={label}
      style={{ '--tc': tc }}
    >
      <span className="text-[10px] leading-none" style={{ color: 'var(--color-ink-ghost)' }}>→</span>
      <span className="badge-glow text-[10px] font-bold tabular-nums leading-tight mt-0.5"
        style={{ color: tc }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

// ─── Transition strip (per-CHANGE difficulty across a whole progression) ───────
//
// Given a progression's chord names (e.g. G-C-D), score each ADJACENT change
// with the hand-aware scoreTransition() and lay them out inline: chord · score ·
// chord · score · … Every chord name shows its shape on hover (ChordTip), per
// the CLAUDE.md hover-shape rule. Personalized to the active hand profile.

function TransitionStrip({ chordNames, profile }) {
  const items = useMemo(() => {
    // Resolve each name to its easiest catalogued voicing; a name with no shape
    // on file (returns []) can't be scored, so its adjacent changes are skipped.
    const voicings = chordNames.map(name => ({
      name,
      voicing: lookupVoicings(name).slice().sort((a, b) => a.score - b.score)[0] || null,
    }));
    const transitions = [];
    for (let i = 0; i < voicings.length - 1; i++) {
      const from = voicings[i], to = voicings[i + 1];
      const score = (from.voicing && to.voicing)
        ? scoreTransition(from.voicing, to.voicing, profile)
        : null;
      transitions.push({ from, to, score });
    }
    return { voicings, transitions };
  }, [chordNames, profile]);

  if (items.voicings.length < 2) return null;

  const hardest = items.transitions.reduce(
    (m, t) => (t.score != null && t.score > (m?.score ?? -1) ? t : m), null);

  return (
    <div className="relative overflow-hidden px-3 sm:px-4 py-3"
      style={{ borderTop: '1px solid var(--color-surface-800)', background: 'var(--color-surface-900)',
        boxShadow: 'inset 3px 0 0 0 color-mix(in srgb, var(--color-indigo) 65%, transparent)' }}>
      {/* Tension-field underlay — turbulence + color encode the HARDEST change in
          this strip (calm green → turbulent red). Lazy + gated (should3D via
          Lazy3D, real-WebGPU inside the component); the numeric badges stay ground
          truth on top. Idles when there are no scores. */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true">
        <Lazy3D load={loadTensionField} fallback={null} componentProps={{ score: hardest?.score ?? 0 }} />
      </div>

      <div className="relative text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-indigo)', zIndex: 1 }}>
        Chord-change difficulty
      </div>

      <div className="relative flex flex-wrap items-center gap-y-2 font-mono" style={{ zIndex: 1 }}>
        {items.voicings.map((c, i) => (
          <span key={i} className="flex items-center">
            <ChordTip name={c.name}>
              <span className="text-sm font-semibold px-1 cursor-default"
                style={{ color: c.voicing ? 'var(--color-ink)' : 'var(--color-danger)' }}>
                {c.name}
              </span>
            </ChordTip>
            {i < items.transitions.length && (() => {
              const t = items.transitions[i];
              if (t.score == null) {
                return <span className="text-[10px] px-1.5" style={{ color: 'var(--color-ink-ghost)' }}>→</span>;
              }
              return (
                <span className="flex flex-col items-center px-1.5 select-none"
                  title={`Change ${t.from.name} → ${t.to.name}: ${t.score.toFixed(1)}/10`}>
                  <span className="text-[10px] leading-none" style={{ color: 'var(--color-ink-ghost)' }}>→</span>
                  <span className="text-[11px] font-bold tabular-nums leading-tight"
                    style={{ color: transitionColor(t.score) }}>
                    {t.score.toFixed(1)}
                  </span>
                </span>
              );
            })()}
          </span>
        ))}
      </div>

      {hardest?.score != null && (
        <div className="relative text-[11px] mt-2" style={{ color: 'var(--color-ink-faint)', zIndex: 1 }}>
          Hardest change:{' '}
          <span className="font-semibold" style={{ color: transitionColor(hardest.score) }}>
            {hardest.from.name} → {hardest.to.name} ({hardest.score.toFixed(1)}/10)
          </span>
          <span style={{ color: 'var(--color-ink-ghost)' }}> · personalized to your hand</span>
        </div>
      )}
    </div>
  );
}

// ─── Song player (synth / MIDI-style) ─────────────────────────────────────────
// Plays the WHOLE song as a strummed synth backing track via the app's Web Audio
// engine — no external service. It plays the chords in the exact order they sit
// in the lyrics (one strum per lyric segment, top to bottom), and reports which
// segment is currently sounding so the words highlight in time. Chords are the
// capo'd easy voicings when a capo is suggested.
//
// `sequence` = [{ voicing, lineIdx, segIdx }] in lyric order.

function SongPlayer({ sequence, bpm, onActive }) {
  const [playing, setPlaying] = useState(false);
  const loopRef = useRef(false);

  // Use the song's real tempo (one chord per bar at that BPM). Clamp to a sane
  // range and fall back to 100 when a song has no bpm on file.
  const tempo = Math.max(50, Math.min(220, Math.round(bpm) || 100));

  useEffect(() => () => { loopRef.current = false; stopAudio(); }, []);

  const start = () => {
    const voicings = sequence.map(s => s.voicing).filter(Boolean);
    if (!voicings.length) return;
    setPlaying(true);
    loopRef.current = true;
    const playOnce = () => {
      playProgression(
        voicings, tempo,
        idx => onActive(sequence[idx] || null),   // report active lyric segment
        () => {
          if (loopRef.current) playOnce();          // loop the whole song
          else { setPlaying(false); onActive(null); }
        },
      );
    };
    playOnce();
  };

  const stop = () => {
    loopRef.current = false;
    stopAudio();
    setPlaying(false);
    onActive(null);
  };

  if (!sequence.length) return null;

  return (
    <div className="mb-3" style={{ borderBottom: '1px solid var(--color-surface-750)', paddingBottom: 10 }}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={playing ? stop : start}
          className={`flex items-center gap-2 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all${playing ? ' pulse-glow' : ''}`}
          style={playing
            ? { background: 'rgba(239,68,68,0.14)', color: 'var(--color-danger)',
                '--halo': 'rgba(239,68,68,0.45)', animationDuration: `${(60 / tempo).toFixed(2)}s` }
            : { background: 'rgba(74,222,128,0.10)', color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.25)' }}
        >
          <span className="text-sm leading-none">{playing ? '■' : '▶'}</span>
          {playing ? 'Stop' : 'Play the song'}
        </button>
        <span className="text-[10px]" style={{ color: 'var(--color-ink-ghost)' }}>
          synth · {tempo} BPM · plays the chords through the lyrics · loops
        </span>
      </div>
    </div>
  );
}

// ─── Play WITH me (mic-driven, self-paced) ─────────────────────────────────────
// Unlike SongPlayer (which strums the whole song at a fixed tempo), this LISTENS
// through the mic and only advances to the next chord in the song when it HEARS
// you play roughly the right chord. So the song follows YOUR pace — a karaoke
// prompter for guitar. Per the app's practice rules it opens with a 5-second
// count-in (clock ticks → "go", recording begins during the count), confirms
// each correct chord by strumming it back, and fires a big celebration when you
// finish the whole song.
//
// `sequence` = [{ voicing, lineIdx, segIdx }] in lyric order (same as SongPlayer).
// `onActive(seg|null)` reports the segment being LISTENED FOR, so the lyrics
// view highlights + auto-scrolls to it exactly as it does during playback.

// Expected pitch classes (0-11) of a voicing, from its 6-char EADGBe tab. Used
// to gate the generic chord matcher so we only accept a match that is actually
// the chord this segment wants (the matcher alone can return a near neighbour).
function voicingPitchClasses(voicing) {
  const tab = voicing?.tab;
  if (!tab || tab.length < 6) return null;
  const pcs = new Set();
  for (let s = 0; s < 6; s++) {
    const ch = tab[s];
    if (ch === 'x') continue;
    const fret = parseInt(ch, 10);
    if (Number.isNaN(fret)) continue;
    const midi = Math.round(69 + 12 * Math.log2(fretHz(s, fret) / 440));
    pcs.add(((midi % 12) + 12) % 12);
  }
  return pcs;
}

// Per-string colors (low-E … high-e) matching the --color-string-* tokens, so a
// spark burst reads as "your strings rang out". Returns the colors of the strings
// this voicing actually sounds (non-muted), for the correct-chord confirmation.
const PWM_STRING_COLORS = ['#a78bfa', '#38bdf8', '#34d399', '#e9c46a', '#fb923c', '#f87171'];
function voicingStringColors(voicing) {
  const tab = voicing?.tab;
  if (!tab || tab.length < 6) return PWM_STRING_COLORS;
  const cols = [];
  for (let s = 0; s < 6; s++) if (tab[s] !== 'x') cols.push(PWM_STRING_COLORS[s]);
  return cols.length ? cols : PWM_STRING_COLORS;
}

// How many recent detected pitch-classes must fall inside the target chord for
// us to accept "you played it": the chord's root/3rd/5th over a short window.
const PWM_STABLE_FRAMES = 8;   // consecutive matching frames before we advance (~130ms)
// Release gate: after accepting a chord, require the input to fall this quiet for
// this many consecutive frames before the NEXT chord can be accepted — proving a
// real release + re-strum rather than one sustained chord bleeding into the next.
const PWM_RELEASE_FRAMES = 5;              // ~consecutive quiet frames = a release
const PWM_RELEASE_RMS_FACTOR = 1.6;        // "quiet" = below silenceRms × this

function PlayWithMe({ sequence, onActive, onFinished, songTitle, tr }) {
  const profileCfg = useRef(loadConfig());
  const mic = useMic();
  const rafRef = useRef(null);
  const countTimerRef = useRef(null);

  const [phase, setPhase] = useState('idle');   // idle | counting | listening | done
  const [count, setCount] = useState(0);        // count-in seconds remaining
  const [permDenied, setPermDenied] = useState(false);
  const [idx, setIdx] = useState(0);            // current segment index in sequence
  const [goFlash, setGoFlash] = useState(false); // one-shot gold "GO" flash overlay

  // Mutable loop state (kept in refs so the RAF loop never re-binds mid-run).
  const idxRef = useRef(0);
  const okFramesRef = useRef(0);
  const cueRef = useRef(null);
  const runningRef = useRef(false);
  // Live meter is driven IMPERATIVELY from the mic loop (no setState-per-frame):
  // meterRef = the confidence fill, labelRef = the "play {chord}" text. We write
  // transform/color/box-shadow straight to the DOM ~60×/s so React never
  // re-renders the listening subtree on every frame.
  const meterRef = useRef(null);
  const labelRef = useRef(null);
  const wasAboveRef = useRef(false);   // was confidence ≥ accept threshold last frame?
  const reducedRef = useRef(false);    // cached prefers-reduced-motion at start()
  // Release gate: after a chord is accepted, the NEXT chord can't be accepted
  // until the strings are released (mic goes quiet for a few frames). Without
  // this, one sustained/ringing chord double-advances — its notes often also fit
  // the next chord (adjacent chords share notes), and the strum-back confirmation
  // bleeds into the open mic. You must actually re-strum for the next chord.
  const mustReleaseRef = useRef(false); // true right after an accept, until a release is seen
  const quietFramesRef = useRef(0);     // consecutive frames below the "playing" RMS floor

  const stop = useCallback((finished = false) => {
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (countTimerRef.current) { clearTimeout(countTimerRef.current); countTimerRef.current = null; }
    cueRef.current?.cancel();
    try { mic.current.close(); } catch { /* not open */ }
    stopAudio();
    setPhase(finished ? 'done' : 'idle');
    setCount(0);
    setGoFlash(false);
    onActive(null);
  }, [mic, onActive]);

  useEffect(() => () => stop(), [stop]);

  // Paint the live confidence meter + chord label straight to the DOM — no React
  // state. `frac` is 0..1 correctness; `rms` scales the gold bloom by attack so
  // the prompter feels like it's truly listening. GPU-composited transform +
  // box-shadow only. Above the 0.6 accept threshold it snaps to success green.
  const paintMeter = useCallback((frac, rms) => {
    const fill = meterRef.current;
    const label = labelRef.current;
    const above = frac >= 0.6;
    if (fill) {
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
      fill.style.background = above ? 'var(--color-success)' : 'var(--color-brand)';
    }
    if (label) {
      // Bloom intensity: correctness sets the base, live level adds attack.
      const glow = reducedRef.current ? 0 : Math.min(1, frac * 0.8 + Math.min(1, rms * 8) * 0.3);
      label.style.textShadow = glow > 0.05
        ? `0 0 ${Math.round(4 + glow * 14)}px var(--brand-glow)` : 'none';
      label.style.color = above ? 'var(--color-success)' : 'var(--color-brand)';
    }
    // One-shot brightness pulse the instant we cross into "you've got it".
    if (above && !wasAboveRef.current && !reducedRef.current) {
      const el = meterRef.current?.parentElement;
      if (el) { el.classList.remove('pwm-lock'); void el.offsetWidth; el.classList.add('pwm-lock'); }
    }
    wasAboveRef.current = above;
  }, []);

  // Advance to the next chord: strum the one just nailed back as confirmation,
  // move the highlight/scroll, and celebrate at the end.
  const advance = useCallback(() => {
    const seq = sequence;
    const cur = seq[idxRef.current];
    if (cur?.voicing) {
      // Confirm the correct chord by strumming it back (one voicing, one strum).
      try { playProgression([cur.voicing], 150, () => {}, () => {}); } catch { /* audio busy */ }
      // Reward the locked chord with a spark burst from the chord label, tinted by
      // the strings that just rang out. Skipped under reduced motion.
      if (!reducedRef.current && labelRef.current) {
        try { sparkBurst(labelRef.current.getBoundingClientRect(), { colors: voicingStringColors(cur.voicing) }); } catch { /* view-only chrome */ }
      }
    }
    const nextIdx = idxRef.current + 1;
    okFramesRef.current = 0;
    wasAboveRef.current = false;
    // Arm the release gate: the next chord is locked out until the strings go
    // quiet (a real release), so this chord's sustain / the strum-back can't
    // double-advance.
    mustReleaseRef.current = true;
    quietFramesRef.current = 0;
    paintMeter(0, 0);   // reset the confidence meter for the next chord
    if (nextIdx >= seq.length) {
      // Finished the whole song — the <Celebration> that renders on phase 'done'
      // fires the big fanfare itself (once), so we don't play it here too.
      setIdx(nextIdx);
      onFinished?.();
      stop(true);
      return;
    }
    idxRef.current = nextIdx;
    setIdx(nextIdx);
    onActive(seq[nextIdx] || null);
  }, [sequence, onActive, onFinished, stop, paintMeter]);

  // One mic frame: detect peaks, match against the catalog, and accept only when
  // the match IS this segment's chord (pitch-classes overlap) for enough frames.
  const listenFrame = useCallback(() => {
    if (!runningRef.current) return;
    rafRef.current = requestAnimationFrame(listenFrame);
    const cfg = profileCfg.current;
    const m = mic.current;
    if (!m.audioCtx || !m.analyser) return;
    const rms = m.getRMS();

    // Release tracking: count consecutive "quiet" frames. Once the input has been
    // quiet long enough after an accept, the strings are considered released and
    // the next chord becomes acceptable again.
    if (rms < cfg.silenceRms * PWM_RELEASE_RMS_FACTOR) {
      quietFramesRef.current++;
      if (quietFramesRef.current >= PWM_RELEASE_FRAMES) mustReleaseRef.current = false;
    } else {
      quietFramesRef.current = 0;
    }

    if (rms < cfg.silenceRms) { paintMeter(0, 0); okFramesRef.current = 0; return; }

    const fd = m.getFreqData();
    if (!fd) return;
    const sr = m.audioCtx.sampleRate;
    const fftSz = m.analyser.fftSize;
    const peaks = detectPeaksConfigured(fd, sr, fftSz, cfg);
    const hzList = peaks.map(p => p.hz);
    const matched = matchChordConfigured(hzList, cfg);

    const target = sequence[idxRef.current]?.voicing;
    const targetPCs = voicingPitchClasses(target);

    // Distinct pitch classes we actually heard this frame.
    const detPCs = new Set(hzList.map(hz => {
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      return ((midi % 12) + 12) % 12;
    }));

    // How much of the TARGET CHORD did you play? overlap = target notes present;
    // coverage = overlap / (# distinct notes the chord has). This is the right
    // measure: it asks "did you play THIS chord", not "does what I heard happen to
    // fit". `precision` = of what you played, how much belongs to the chord — it
    // penalises playing the WRONG chord that merely includes a target note.
    let overlap = 0;
    if (targetPCs) for (const pc of detPCs) if (targetPCs.has(pc)) overlap++;
    const targetSize = targetPCs ? targetPCs.size : 0;
    const coverage = targetSize ? overlap / targetSize : 0;      // 0..1 of the chord's notes
    const precision = detPCs.size ? overlap / detPCs.size : 0;   // 0..1 of what you played

    // Accept only when you've genuinely played the chord:
    //   • at least 2 distinct notes heard (kills single-note / room-noise triggers)
    //   • you covered MOST of the chord's notes (≥⅔ — e.g. 2 of 3 in a triad)
    //   • and most of what you played belongs to the chord (not a different chord
    //     that merely shares a note) — OR the catalog matcher names this exact chord.
    const exactMatch = !!matched && target && matched.chord?.name === target.name;
    const enoughNotes = detPCs.size >= 2;
    const heardIt = enoughNotes && coverage >= 0.66 && (precision >= 0.6 || exactMatch);

    // Confidence for the meter blends coverage (main signal) with precision.
    const overlapFrac = Math.min(1, coverage * 0.7 + precision * 0.3);

    // While waiting for a release after the last accept, keep the meter dim and
    // don't accumulate toward an accept — the sustained/ringing chord must decay
    // and you must re-strum before the next chord counts.
    if (mustReleaseRef.current) {
      okFramesRef.current = 0;
      paintMeter(Math.min(overlapFrac, 0.35), rms);  // show life, but never "locked"
      return;
    }

    // Imperative paint — never setState here (this runs ~60×/s).
    paintMeter(heardIt ? Math.max(overlapFrac, 0.6) : overlapFrac, rms);
    if (heardIt) {
      okFramesRef.current++;
      if (okFramesRef.current >= PWM_STABLE_FRAMES) advance();
    } else {
      okFramesRef.current = Math.max(0, okFramesRef.current - 1);
    }
  }, [sequence, mic, advance, paintMeter]);

  const begin = useCallback(async () => {
    if (!sequence.length) return;
    setPermDenied(false);
    // Reset to the top. Cache reduced-motion once per run (used by the mic loop's
    // imperative paint, which must not call matchMedia ~60×/s).
    idxRef.current = 0; okFramesRef.current = 0; wasAboveRef.current = false;
    mustReleaseRef.current = false; quietFramesRef.current = 0;
    reducedRef.current = prefersReducedMotion();
    setIdx(0);
    try {
      // Open the mic raw (guitar detection wants no AEC/NS/AGC). Recording starts
      // NOW, during the count-in, per the app's practice-countdown rule.
      await mic.current.open(profileCfg.current.smoothing, { raw: true });
    } catch (e) {
      if (e?.name === 'NotAllowedError') setPermDenied(true);
      return;
    }
    runningRef.current = true;
    setPhase('counting');

    // 5-second count-in with clock ticks → "go". onGo fires the visual half of
    // the ritual — a one-shot gold flash, cleared on animationend below.
    setGoFlash(false);
    cueRef.current = makeCountdownCue({ onGo: () => setGoFlash(true) });
    let remaining = 5;
    setCount(remaining);
    cueRef.current.set(remaining);
    const tick = () => {
      if (!runningRef.current) return;
      remaining -= 1;
      setCount(remaining);
      cueRef.current.set(remaining);
      if (remaining > 0) {
        countTimerRef.current = setTimeout(tick, 1000);
      } else {
        // "go" — begin listening for the first chord.
        setPhase('listening');
        onActive(sequence[0] || null);
        rafRef.current = requestAnimationFrame(listenFrame);
      }
    };
    countTimerRef.current = setTimeout(tick, 1000);
  }, [sequence, mic, listenFrame, onActive]);

  useEffect(() => () => { if (countTimerRef.current) clearTimeout(countTimerRef.current); }, []);

  const total = sequence.length;
  const progressPct = total ? Math.round((idx / total) * 100) : 0;
  const running = phase === 'counting' || phase === 'listening';

  // Screen-reader announcement — derived ONLY from phase/count/idx (never `heard`),
  // so it fires on real transitions (count tick, chord change, done) and not ~60×/s
  // like the confidence meter. Read out through a polite live region below.
  const nowChord = sequence[idx]?.voicing?.name;
  const announce =
    phase === 'counting' ? `Get ready. ${count}`
    : phase === 'listening' ? `Now play ${nowChord || 'the next chord'}. Chord ${idx + 1} of ${total}.`
    : phase === 'done' ? 'Song complete.'
    : '';

  if (!sequence.length) return null;

  return (
    <div className="mb-3 relative" style={{ borderBottom: '1px solid var(--color-surface-750)', paddingBottom: 10 }}>
      {/* Polite live region — announces count-in, the chord to play now, and
          completion to screen readers. Visually hidden; the sighted UI below
          shows the same information. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</span>

      {/* One-shot "GO" flash — the visual half of the count-in ritual, fired by
          the countdown cue's onGo. A gold wash + word, self-clearing on
          animationend. pointer-events off so it never blocks the row. */}
      {goFlash && (
        <div className="go-flash absolute inset-0 z-10 flex items-center justify-center rounded-lg pointer-events-none"
          aria-hidden="true"
          onAnimationEnd={() => setGoFlash(false)}
          style={{ background: 'radial-gradient(ellipse at center, var(--brand-glow) 0%, transparent 70%)' }}>
          <span className="font-black tracking-widest" style={{ fontSize: '1.5rem', color: 'var(--color-brand)', textShadow: '0 0 18px var(--brand-glow)' }}>GO</span>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={running ? () => stop(false) : begin}
          className="flex items-center gap-2 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all"
          style={running
            ? { background: 'rgba(239,68,68,0.14)', color: 'var(--color-danger)' }
            : { background: 'rgba(201,169,110,0.12)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.3)' }}
          title="Listen through your mic and advance the song only when you play each chord — self-paced"
        >
          <span className="text-sm leading-none">{running ? '■' : '🎤'}</span>
          {running ? 'Stop' : 'Play with me'}
        </button>

        {phase === 'idle' && (
          <span className="text-[10px]" style={{ color: 'var(--color-ink-ghost)' }}>
            mic · the song waits for you — advances when it hears each chord
          </span>
        )}

        {phase === 'counting' && (
          <span className="flex items-baseline gap-2" style={{ color: 'var(--color-brand)' }}>
            <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-ink-faint)' }}>Get ready</span>
            {/* Remount the digit each second (key={count}) so ui-dot-pop replays,
                giving each tick a scale-punch; the final tick is a touch larger.
                Reduced-motion neutralizes ui-dot-pop to a fade (index.css). */}
            <span key={count} className="ui-dot-pop inline-block font-black tabular-nums leading-none"
              style={{ fontSize: count === 1 ? '1.9rem' : '1.6rem', textShadow: '0 0 14px var(--brand-glow-soft)' }}>
              {count}
            </span>
          </span>
        )}

        {phase === 'listening' && (
          <div className="flex items-center gap-2 flex-1 min-w-[140px]">
            <span className="text-[10px] shrink-0" style={{ color: 'var(--color-success)' }}>
              <span className="animate-pulse">●</span> listening — play{' '}
              {/* labelRef: the chord name blooms warmer as you lock the shape,
                  then snaps to success green at the accept threshold (imperative,
                  from the mic loop — no per-frame React state). */}
              <strong ref={labelRef} style={{ color: 'var(--color-brand)', transition: 'color 150ms ease, text-shadow 150ms ease' }}>
                {sequence[idx]?.voicing?.name || '…'}
              </strong>
            </span>
            {/* Live "how close" meter — driven imperatively via meterRef ~60×/s,
                so it's aria-hidden; the polite live region above carries state to
                AT. The fill uses transform:scaleX (compositor-only, no reflow)
                instead of width. pwm-lock fires a one-shot pulse at the 0.6
                accept threshold. */}
            <div className="pwm-meter flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-650)' }} aria-hidden="true">
              <div ref={meterRef} className="h-full w-full rounded-full"
                style={{ transformOrigin: 'left', transform: 'scaleX(0)',
                  background: 'var(--color-brand)',
                  transition: 'transform 90ms linear, background-color 150ms ease' }} />
            </div>
            <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--color-ink-ghost)' }}>
              {idx}/{total}
            </span>
          </div>
        )}

        {permDenied && (
          <span className="text-[10px]" style={{ color: 'var(--color-danger)' }}>
            Mic access denied — allow the microphone to play along.
          </span>
        )}
      </div>

      {running && (
        <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-750)' }}
          role="progressbar" aria-label="Song progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={idx}>
          <div className="h-full rounded-full transition-all"
            style={{ width: `${progressPct}%`, background: 'var(--color-brand)' }} />
        </div>
      )}

      {phase === 'done' && (
        <div className="mt-2">
          <Celebration
            advancement={{ advanced: true, big: true, top: { type: 'songComplete', detail: { title: songTitle } } }}
            tr={tr}
          />
        </div>
      )}
    </div>
  );
}

// ─── Live chord map (now-playing + next 2) ─────────────────────────────────────
// While a song plays (synth OR play-with-me), show the chord being fretted RIGHT
// NOW as a full fretboard diagram, plus the next two chords as smaller "up next"
// shapes — a live, always-visible prompter so the player sees the shape to make
// now and can pre-shape the two coming up. `sequence` is the same ordered
// [{ voicing, lineIdx, segIdx }] the players walk; `activeIndex` is the position
// currently sounding (−1 when nothing is playing). Consecutive identical chords
// are collapsed for the "up next" list so a chord repeated over several lyric
// segments doesn't fill all three slots with the same shape.

function LiveChordMap({ sequence, activeIndex, profile, limitToReach, simplifyMap }) {
  // Resolve a play-sequence entry to the SHAPE we display: always the EASIEST
  // catalogued voicing for that chord (personalized to the hand when a reach
  // limit is on), per the chord-map rule. When "Simplify all" is on, the chord
  // is first swapped to its eased name (simplifyMap) so the map shows the SAME
  // simplified shape the lyrics now show — otherwise the map would keep showing
  // the original, harder chord. Falls back to the sequence's own voicing if the
  // name isn't in the library.
  const shapeFor = useCallback((entry) => {
    const own = entry?.voicing;
    if (!own) return null;
    // simplifyMap is keyed by the ORIGINAL chord name — use entry.chordName if we
    // have it (matches the lyrics' own simplify lookup), else the voicing's name.
    const origName = entry.chordName || own.name;
    const name = simplifyMap?.get(origName) || origName;
    const easy = easiestVoicing(name, { profile, limitToReach });
    return easy || own;
  }, [profile, limitToReach, simplifyMap]);

  const upcoming = useMemo(() => {
    if (activeIndex < 0 || activeIndex >= sequence.length) return null;
    const current = shapeFor(sequence[activeIndex]);
    if (!current) return null;
    // Walk forward, skipping repeats of the last shown chord, to collect the next
    // two DISTINCT upcoming chords.
    const next = [];
    let lastName = current.name;
    for (let i = activeIndex + 1; i < sequence.length && next.length < 2; i++) {
      const v = shapeFor(sequence[i]);
      if (!v || v.name === lastName) continue;
      next.push(v);
      lastName = v.name;
    }
    return { current, next };
  }, [sequence, activeIndex, shapeFor]);

  if (!upcoming) return null;

  return (
    <div className="relative z-[1] mb-3 flex items-stretch gap-3 px-3 py-2.5 rounded-xl overflow-x-auto"
      style={{ background: 'var(--color-surface-800)', border: '1px solid var(--color-surface-600)' }}>
      {/* NOW — the chord being fretted this instant, full-size with finger dots. */}
      <div className="flex flex-col items-center shrink-0">
        <span className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-brand)' }}>
          Now
        </span>
        <div className="rounded-lg p-1 live-chord-now"
          style={{ background: 'color-mix(in srgb, var(--color-brand) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-brand) 40%, transparent)',
            boxShadow: '0 0 16px color-mix(in srgb, var(--color-brand) 22%, transparent)' }}>
          <FretboardDiagram chord={upcoming.current} showFingers />
        </div>
        <span className="text-xs font-bold mt-1" style={{ color: 'var(--color-brand)' }}>
          {upcoming.current.name}
        </span>
      </div>

      {/* NEXT — the two upcoming distinct chords, smaller + dimmed so the eye reads
          the "now" shape first, then pre-shapes what's coming. */}
      {upcoming.next.length > 0 && (
        <div className="flex items-center shrink-0" style={{ color: 'var(--color-ink-ghost)' }}>
          <span className="text-lg leading-none px-1">→</span>
        </div>
      )}
      {upcoming.next.map((v, i) => (
        <div key={i} className="flex flex-col items-center shrink-0" style={{ opacity: i === 0 ? 0.85 : 0.6 }}>
          <span className="text-[9px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-ink-faint)' }}>
            {i === 0 ? 'Next' : 'Then'}
          </span>
          <div className="rounded-lg p-1"
            style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-600)',
              transform: 'scale(0.82)', transformOrigin: 'top center' }}>
            <FretboardDiagram chord={v} />
          </div>
          <span className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--color-ink-subtle)' }}>
            {v.name}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Lyrics fetch ────────────────────────────────────────────────────────────

function LyricsSection({ song, title, artist, bpm, lineChords, customLyricLines, tabBlocks, progChordsWithVoicings, tr, lang }) {
  // Imported songs carry their own pasted lyrics+chords → render those directly,
  // no fetch. Otherwise fetch the real lyrics from a public lyrics database.
  const isCustom = Array.isArray(customLyricLines) && customLyricLines.length > 0;
  const soloProfile = useHandProfile();
  const limitToReach = useReachLimit();
  const [status, setStatus] = useState(isCustom ? 'done' : 'loading');
  const [lyrics, setLyrics]  = useState('');
  const [active, setActive] = useState(null); // { lineIdx, segIdx } currently sounding
  const [simplified, setSimplified] = useState(false); // "Simplify all" — eases chords in tab + lyrics

  // Auto-scroll the lyrics box so the currently-sounding line stays in view while
  // the song plays (like a karaoke prompter). scrollRef is the overflow box;
  // activeLineRef points at the DOM node of the line that's sounding right now.
  const scrollRef = useRef(null);
  const activeLineRef = useRef(null);
  useEffect(() => {
    const box = scrollRef.current, line = activeLineRef.current;
    if (!box || !line || active == null) return;
    // Center the active line within the box. Use getBoundingClientRect (viewport-
    // relative) for BOTH nodes so the math doesn't depend on offsetParent — the
    // box isn't a positioned ancestor, so line.offsetTop would be measured against
    // some far ancestor and slam the scroll to the bottom. The delta between the
    // two rects, added to the box's current scrollTop, is the exact target. We set
    // scrollTop directly (not scrollIntoView) so ONLY this box scrolls, never the
    // page.
    const boxRect = box.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const delta = (lineRect.top - boxRect.top) - (box.clientHeight / 2 - lineRect.height / 2);
    const target = Math.max(0, box.scrollTop + delta);
    // Repeated user-uninitiated vertical motion is exactly what reduced-motion
    // suppresses — jump instantly for those users; the active line still centers.
    box.scrollTo({ top: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  // The eased-chord map (original name → simplified name) for the WHOLE song,
  // computed the same way the auto-tab simplifies. Applied to the lyrics chords
  // in place when "Simplify all" is on, so the words show the easy shape you
  // actually fret. Only recomputed when simplified is toggled on.
  const simplifyMap = useMemo(() => {
    if (!simplified || !song) return null;
    const { changes } = buildSimplifiedAutoTab(song, soloProfile);
    const map = new Map();
    for (const c of changes) map.set(c.from, c.to);
    return map;
  }, [simplified, song, soloProfile]);

  useEffect(() => {
    if (isCustom) { setStatus('done'); return; }   // pasted song → no fetch
    setStatus('loading');
    // Lyrics come from public databases (LRCLIB primary, with fuzzy-search and
    // api.lyrics.ovh fallbacks) — see lyricsApi.fetch. It distinguishes "not
    // found" from "all sources down" so the message stays honest.
    const controller = new AbortController();
    let alive = true;

    lyricsApi.fetch(artist, title, { signal: controller.signal })
      .then(res => {
        if (!alive) return;
        if (res.status === 'done') { setLyrics(res.text); setStatus('done'); }
        else setStatus(res.status); // 'empty' | 'error'
      })
      .catch(() => { if (alive) setStatus('error'); });

    return () => { alive = false; controller.abort(); };
  }, [title, artist, isCustom]);

  // A capo suggestion when the song's key forces barre chords — lets a short-
  // fingered player restate the whole song as easy open shapes (e.g. a B♭/E♭/F
  // song → "Capo 1, play A/D/E"). null when the chords are already easy.
  //
  // Reach-driven via bestCapo (lib/capo), personalized to the active hand: it
  // sums calcDifficulty of every transposed-down open shape and picks the fret
  // that minimises total reach (ties → lowest fret). Applied on ALL surfaces —
  // custom/imported (pasted) songs get the suggestion too, not just the app's
  // own derived songs (design decision: capo everywhere). `capo.map` (origName →
  // capoName) and `capo.fret` drive the in-line relabel + capo'd playback below.
  const capoSuggestion = useMemo(
    () => bestCapo(progChordsWithVoicings.map(c => c.chordName), soloProfile),
    [progChordsWithVoicings, soloProfile],
  );
  // The user can turn the capo restatement OFF to see the song's real chords as
  // written. Default ON when one is suggested (the whole point is to help). The
  // EFFECTIVE capo (used for the inline Bb→A relabels + capo'd playback below) is
  // the suggestion only while enabled; off → behave exactly as if no capo exists.
  const [capoOn, setCapoOn] = useState(true);
  const capo = capoOn ? capoSuggestion : null;

  // Align chords over the lyrics realistically: chords change at phrase
  // boundaries (punctuation), cycle through the progression across sub-phrases,
  // and resolve to the tonic at sentence ends — instead of one chord per line.
  const annotatedLines = useMemo(() => {
    // Imported song: build directly from the pasted lines, mapping each line's
    // chord name(s) to the matching voicing index. A line with no chord carries
    // the previous chord (so it still highlights/plays through).
    if (isCustom) {
      const idxByName = new Map(progChordsWithVoicings.map((c, i) => [c.chordName, i]));
      // A lyric line that looks like leaked sheet noise rather than real lyrics:
      // a lone "X"/"N.C." marker or a "...bpm" footer that slipped past an older
      // import. We don't delete it (the saved song is left untouched) — we flag it
      // so it can be highlighted for the user to clean up.
      const looksLikeNoise = (t) =>
        /^(x|n\.?c\.?)$/i.test(t) || /\b\d{2,3}\s*bpm\b/i.test(t);
      let lastIdx = 0;
      return customLyricLines.map(ln => {
        if (!ln.text && !(ln.chordNames || []).length) return { blank: true };
        const names = ln.chordNames || [];
        const text = ln.text || '';
        const problem = !!text && !names.length && looksLikeNoise(text.trim());

        // Render ONE segment per chord on the line, exactly as in the sheet
        // (e.g. "C  G/B  Am  F" → four chord cells). The line's lyric text sits
        // under the first chord; the rest are chord-only cells over the same
        // phrase. A line with no chords carries the previous chord so it still
        // highlights/plays through.
        if (!names.length) {
          return { blank: false, problem, segments: [{ chordIndex: lastIdx, text }] };
        }
        const segments = names.map((name, k) => {
          const idx = idxByName.get(name);
          if (idx != null) lastIdx = idx;
          return { chordIndex: idx != null ? idx : lastIdx, text: k === 0 ? text : '' };
        });
        return { blank: false, problem, segments };
      });
    }
    if (status !== 'done' || !lyrics || !progChordsWithVoicings.length) return [];
    return alignChordsToLyrics(lyrics.split('\n'), progChordsWithVoicings, lineChords);
  }, [lyrics, status, progChordsWithVoicings, lineChords, isCustom, customLyricLines]);

  // Pick the voicing to PLAY for a chord. When a capo is suggested, play the
  // capo'd easy shape (e.g. A) fretted at the capo position — i.e. the open
  // shape with every fret shifted up by the capo fret. That's exactly what the
  // player does with a real capo, and it sounds like the original chord (Bb).
  const playVoicing = useCallback((chord) => {
    const base = chord?.voicings?.[0];
    if (!base) return null;
    if (!capo) return base;
    const easyName = capo.map[chord.chordName];
    // Play the EXACT shape bestCapo chose (from capo.shapes) — the same voicing
    // the diagram shows and the reach score used — so the heard chord, the drawn
    // shape and the score never diverge. Fall back to the easiest-voicing lookup
    // only if this chord isn't in the map (shouldn't happen).
    const chosen = capo.shapes?.find(s => s.orig === chord.chordName)?.voicing;
    const easyShape = chosen || (easyName ? easiestVoicing(easyName) : null);
    if (!easyShape) return base; // no easy shape on file → fall back to real voicing
    // Shift the easy shape up by the capo fret so it sounds at the original
    // pitch — a capo presses ALL strings, so open (0) strings move to the capo
    // fret and fretted notes move up by the same amount. capoPlaybackTab (the
    // single, centralized capo shift in lib/capo) does this for every surface;
    // the synth reads .tab.
    return { ...easyShape, name: easyName, tab: capoPlaybackTab(easyShape, capo.fret) };
  }, [capo]);

  // The full play sequence: every chord in the order it appears in the lyrics
  // (one entry per lyric segment), so playback walks the whole song. Falls back
  // to the bare progression when lyrics aren't available, so Play still works.
  const playSequence = useMemo(() => {
    if (annotatedLines.length) {
      const seq = [];
      annotatedLines.forEach((line, lineIdx) => {
        if (line.blank) return;
        line.segments.forEach((seg, segIdx) => {
          const chord = progChordsWithVoicings[seg.chordIndex];
          const voicing = playVoicing(chord);
          // chordName = the ORIGINAL (un-capo'd) chord name, so the live chord map
          // can look it up in simplifyMap (keyed by original names) exactly as the
          // lyrics do.
          if (voicing) seq.push({ voicing, chordName: chord?.chordName, lineIdx, segIdx });
        });
      });
      if (seq.length) return seq;
    }
    return progChordsWithVoicings
      .map((c, i) => ({ voicing: playVoicing(c), chordName: c?.chordName, lineIdx: -1, segIdx: i }))
      .filter(s => s.voicing);
  }, [annotatedLines, progChordsWithVoicings, playVoicing]);

  // Index of the currently-sounding chord within playSequence, so the live chord
  // map can look ahead to the next two. `active` is the sequence entry itself
  // ({ voicing, lineIdx, segIdx }); match it back to its position. For the bare-
  // progression fallback (lineIdx === -1) match on segIdx alone.
  const activeIndex = useMemo(() => {
    if (!active) return -1;
    return playSequence.findIndex(s =>
      active.lineIdx === -1
        ? s.lineIdx === -1 && s.segIdx === active.segIdx
        : s.lineIdx === active.lineIdx && s.segIdx === active.segIdx);
  }, [active, playSequence]);

  return (
    <div className="px-3 sm:px-4 py-3 font-mono text-xs"
      style={{ borderTop: '1px solid var(--color-surface-750)', background: 'var(--color-surface-base)' }}>

      {/* Song controls row — synth play, "play WITH me" (mic self-paced), and a
          "Simplify all" toggle. A confined ambient TSL wash sits BEHIND this band
          (opened-song "now playing" glow), gated + lazy via Lazy3D so it never
          mounts under reduced-motion / no-GPU / software-WebGL, and unmounts with
          the whole LyricsSection when the song collapses. It warms up while a
          player is walking the song (active != null). */}
      <div className="relative flex items-center justify-between gap-2 flex-wrap mb-1 rounded-lg overflow-hidden">
        {/* ambient underlay */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true">
          <Lazy3D load={loadSongHeaderAmbient} fallback={null} componentProps={{ playing: active != null }} />
        </div>
        <div className="relative flex flex-col gap-1 flex-1 min-w-[200px]" style={{ zIndex: 1 }}>
          <SongPlayer sequence={playSequence} bpm={bpm} onActive={setActive} />
          <PlayWithMe sequence={playSequence} onActive={setActive} songTitle={title} tr={tr} />
        </div>
        {song && (
          <button
            onClick={() => setSimplified(v => !v)}
            className="relative text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all shrink-0"
            style={simplified
              ? { zIndex: 1, background: 'rgba(74,222,128,0.15)', color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.35)' }
              : { zIndex: 1, background: 'var(--color-surface-700)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}
            title="Rewrite every chord over the lyrics as the easiest shape for your hand"
          >
            {simplified ? '✓ Simplified' : '✨ Simplify all'}
          </button>
        )}
      </div>

      {/* Live chord map — the shape being fretted NOW plus the next two, visible
          only while a player is walking the song (active != null). Sits directly
          above the lyrics so the player reads shape + words together. */}
      <LiveChordMap sequence={playSequence} activeIndex={activeIndex}
        profile={soloProfile} limitToReach={limitToReach} simplifyMap={simplifyMap} />

      {status === 'loading' && (
        <div className="py-1 text-xs italic" style={{ color: 'var(--color-ink-ghost)' }}>Loading lyrics…</div>
      )}
      {status === 'error' && (
        <div className="py-1 text-xs italic" style={{ color: 'var(--color-ink-ghost)' }}>
          Lyrics service is unavailable right now. Try again later.
        </div>
      )}
      {status === 'empty' && (
        <div className="py-1 text-xs italic" style={{ color: 'var(--color-ink-ghost)' }}>No lyrics found for this song.</div>
      )}

      {status === 'done' && (
      <div ref={scrollRef} className="max-h-72 overflow-y-auto">

      {/* Capo suggestion — the shared, reach-driven banner (lib/capo + the
          CapoSuggestion component used on every surface). It computes its own
          bestCapo from the same chord names + hand profile, so it appears exactly
          when the local `capo` memo above does, and every chord name inside it
          shows its shape on hover (ChordTip). The in-line lyric relabel below
          still uses `capo.map`/`capo.fret` for the Bb→A restatement + playback. */}
      {/* The capo banner is a non-essential add-on — never let a failure in it
          blank the lyrics view. It degrades to nothing on any render error.
          `enabled`/`onToggle` let the user turn the capo restatement off (see the
          real chords) and back on; the banner explains WHY a capo helps here. */}
      <ErrorBoundary label="CapoSuggestion" fallback={null}>
        <CapoSuggestion
          chordNames={progChordsWithVoicings.map(c => c.chordName)}
          profile={soloProfile}
          lang={lang}
          enabled={capoOn}
          onToggle={setCapoOn}
        />
      </ErrorBoundary>

      {annotatedLines.map((line, i) => {
        if (line.blank) return <div key={i} className="mt-2" />;
        const lineActive = active && active.lineIdx === i;
        return (
          <div key={i}
            ref={lineActive ? activeLineRef : undefined}
            className="mb-1.5 flex flex-wrap items-end gap-x-1 leading-tight"
            style={line.problem ? {
              background: 'rgba(250,204,21,0.14)',
              border: '1px solid rgba(250,204,21,0.4)',
              borderRadius: 6, padding: '2px 6px',
            } : undefined}
            title={line.problem ? 'This line looks like leftover sheet text (not lyrics). Edit this song in the Import tab to remove it.' : undefined}>
            {line.segments.map((seg, j) => {
              const chord = progChordsWithVoicings[seg.chordIndex];
              const isActive = active && active.lineIdx === i && active.segIdx === j;
              // Show BOTH: the real (sounding) chord, and — when a capo makes it
              // easier — the easy shape you actually fret, e.g. "Bb→A".
              const realName = chord?.chordName;
              // "Simplify all" swaps the shown chord to its eased version in
              // place (and its hover shape follows). Capo relabeling is separate.
              const eased = simplifyMap?.get(realName) || null;
              const real = eased || realName;
              const inProg = chord?.inProgression !== false;
              const easy = capo ? (capo.map[real] || real) : null;
              const hasEasy = easy && easy !== real;
              // The chord shape shown on hover follows what's actually fretted:
              // the capo shape if a capo is suggested, else the (possibly eased)
              // chord. ChordTip resolves the voicing itself via lookupVoicings,
              // so the hover works even when this song carried no voicing list.
              const hoverName = hasEasy ? easy : real;
              return (
                <span key={j}
                  className="inline-flex flex-col rounded transition-colors"
                  style={isActive ? { background: 'rgba(201,169,110,0.18)', padding: '0 3px' } : undefined}>
                  <ChordTip name={hoverName}
                    className="font-bold cursor-help select-none"
                    style={{ color: isActive ? 'var(--color-brand)' : (eased ? 'var(--color-success)' : (inProg ? 'var(--color-accent)' : 'var(--color-danger)')) }}>
                    <span title={eased ? `${realName} simplified to ${eased}` : (hasEasy ? `${real} (sounding) — fret the ${easy} shape with capo ${capo.fret}` : real)}>
                      {real}{hasEasy && <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>→{easy}</span>}
                    </span>
                  </ChordTip>
                  <span style={{ color: isActive ? '#b8a88a' : (line.problem ? 'var(--color-caution)' : 'var(--color-ink-subtle)') }}>{seg.text}</span>
                </span>
              );
            })}
            {line.problem && (
              <span className="ml-1 text-[10px] font-semibold self-center" style={{ color: 'var(--color-caution)' }}>
                ⚠ leftover sheet text — edit in Import to remove
              </span>
            )}
          </div>
        );
      })}
      </div>
      )}

      {/* Solo / riff tab passages parsed out of the imported sheet — shown with
          hover shapes and their own Play button. */}
      <SoloTabView song={{ tabBlocks }} bpm={bpm} profile={soloProfile} />

    </div>
  );
}

// ─── Song row ─────────────────────────────────────────────────────────────────

// "Bm" / "C" — a compact key label from a parsed song's key + scaleType.
function keyLabelFor(s) {
  return `${s.key || '?'}${s.scaleType === 'minor' ? 'm' : ''}`;
}

function SongRow({ song, progDegreeSet, tr, lang, customSongs = [], currentProgName, onEdited, onMoved }) {
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editMsg, setEditMsg] = useState('');
  const [preview, setPreview] = useState(null); // parsed result from "Check", before Save
  const [editorOpen, setEditorOpen] = useState(false); // full-screen Song Editor overlay
  const editorProfile = useHandProfile();

  // Every song can be edited. A custom song (has its own stored lyricLines) edits
  // in place; a built-in is theory-derived, so editing it saves an editable copy.
  const isCustom = !!(song.id && song.lyricLines);

  // For a built-in, find an already-saved copy (matched by title + artist) so a
  // re-edit updates that copy instead of piling up duplicates.
  const existingCopy = useMemo(
    () => (isCustom ? null : customSongs.find(s =>
      (s.title || '').toLowerCase() === (song.title || '').toLowerCase() &&
      (s.artist || '').toLowerCase() === (song.artist || '').toLowerCase())),
    [isCustom, customSongs, song.title, song.artist],
  );

  const openEditor = () => {
    // Prefer an existing saved copy's text (your prior edits) over the built-in.
    setEditText(songToText(existingCopy || song));
    setEditMsg(''); setPreview(null); setEditing(true);
  };

  // "Check" — parse the text and show what WILL be saved, without saving yet.
  const checkEdit = () => {
    const { song: parsed, warnings } = parseChordSheet(editText);
    setPreview({ parsed, warnings });
  };

  // "Paste real chords" — pull the chord sheet the user copied from the opened
  // Ultimate Guitar tab off the clipboard, drop it into the editor, and preview
  // the FILTERED result (parseChordSheet strips section labels, repeat markers,
  // ads/footers — everything that isn't chords-over-lyrics). Then Save overwrites
  // this song. We read the clipboard (a same-origin, user-granted action), NOT
  // the UG page itself — the browser forbids reading that cross-origin tab.
  const pasteRealChords = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setEditMsg('Clipboard blocked — paste into the box manually (Ctrl+V), then Save.');
      return;
    }
    if (!text.trim()) {
      setEditMsg('Clipboard is empty — copy the chord sheet from the opened tab first.');
      return;
    }
    setEditText(text);
    const { song: parsed, warnings } = parseChordSheet(text);
    setPreview({ parsed, warnings });
    setEditMsg('Pasted & filtered — review the preview, then Save to overwrite this song.');
  };

  const saveEdit = () => {
    const { song: parsed, warnings } = parseChordSheet(editText);
    if (isCustom) {
      updateCustomSong(song.id, { ...parsed, id: song.id, custom: true });
    } else if (existingCopy) {
      updateCustomSong(existingCopy.id, { ...parsed, id: existingCopy.id, custom: true });
    } else {
      addCustomSong({ ...parsed, custom: true });
    }
    setEditMsg(warnings.length ? `Saved (${warnings.length} note${warnings.length > 1 ? 's' : ''})` : 'Saved');
    setEditing(false);
    setPreview(null);

    // The list is filtered by progression. If the edited chords no longer fit the
    // progression this song was shown under, find the progression they DO fit and
    // tell the user the song has moved there. The list re-filters on its own once
    // customSongs reloads; this just announces where it went.
    const chordNames = (parsed.chords && parsed.chords.length)
      ? parsed.chords
      : [...new Set((parsed.lyricLines || []).flatMap(ln => ln.chordNames || []))];
    const stillFitsHere = currentProgName
      ? !!detectBestProgression(chordNames, parsed.key, parsed.scaleType) &&
        (() => {
          // Does it still contain THIS progression's pattern?
          const dia = getDiatonicChords(parsed.key, parsed.scaleType);
          const here = (scaleProgsByName.get(currentProgName)?.degrees || []);
          const songDegs = chordNames.map(c => chordDegreeIn(c, parsed.key, parsed.scaleType));
          return here.length > 0 && containsProgression(songDegs, here);
        })()
      : true;

    if (!stillFitsHere) {
      const best = detectBestProgression(chordNames, parsed.key, parsed.scaleType);
      onMoved?.(best
        ? { title: parsed.title, from: currentProgName, to: best.name, key: best.key, found: true }
        : { title: parsed.title, from: currentProgName, found: false });
    }

    onEdited?.();   // tell the parent to reload custom songs so this re-renders
  };

  // Full chord sequence from the song's own key, with inProgression flag.
  // A song may carry an optional `qualities` array (same length/order as
  // `degrees`) giving the REAL chord quality at each spot — e.g. '7' to make the
  // V a dominant 7th — so the shown chords match the actual sheet (G → G7).
  const songChordsWithVoicings = useMemo(() => {
    // Custom (saved) song: the source of truth is its own lyricLines. Build the
    // voicing set from EVERY unique chord name that appears across the lines, in
    // order of first appearance — so the lyrics view can map each chord exactly
    // (including slash chords like G/B that aren't a plain diatonic triad) and
    // the display matches the editor 1:1.
    if (song.lyricLines && song.lyricLines.length) {
      const dia = getDiatonicChords(song.key, song.scaleType);
      const progSet = new Set([...progDegreeSet].map(d => dia[d]?.chordName));
      const seen = new Map();
      for (const ln of song.lyricLines) {
        for (const name of (ln.chordNames || [])) {
          if (!seen.has(name)) {
            const voicings = lookupVoicings(name).slice().sort((a, b) => a.score - b.score);
            seen.set(name, { chordName: name, voicings, inProgression: progSet.has(name) });
          }
        }
      }
      const list = [...seen.values()];
      if (list.length) return list;
      // No chords in the lines — fall through to the degree-based path below.
    }

    // No usable degree data (e.g. a search-index song that carries only raw
    // chords/lyrics) — nothing to derive; the lyrics view handles its own chords.
    if (!Array.isArray(song.degrees) || !song.degrees.length) return [];
    const diatonic = getDiatonicChords(song.key, song.scaleType);
    const baseNames = song.degrees.map(d => diatonic[d].chordName);

    // Decide final chord names, in priority order:
    //   1. explicit `chords` — the REAL chords you typed in, used verbatim
    //   2. explicit `qualities` — diatonic triads + your per-spot quality
    //   3. plain diatonic triads when the song specifies its own chords via
    //      `lineChords` or `exact` (your data wins — no theory guessing)
    //   4. idiomatic inference (7ths/slash) from general theory
    const userSpecified = song.lineChords || song.exact;
    let finalNames;
    if (song.chords && song.chords.length) {
      finalNames = song.degrees.map((_, i) => song.chords[i] || baseNames[i]);
    } else if (song.qualities) {
      finalNames = baseNames.map((base, i) => {
        const quality = song.qualities[i] || '';
        if (!quality) return base;
        const m = base.match(/^([A-G][#b]?)(.*)$/);
        const root = m ? m[1] : base;
        const triadSuffix = m ? m[2] : '';
        return /^(m|dim|aug|sus|maj|add|°)/.test(quality)
          ? root + quality
          : root + triadSuffix + quality;
      });
    } else if (userSpecified) {
      finalNames = baseNames; // plain triads — exactly what the user gave
    } else {
      finalNames = enrichChords(song.degrees, baseNames, song.scaleType);
    }

    return song.degrees.map((d, i) => {
      const chordName = finalNames[i];
      const voicings = lookupVoicings(chordName).slice().sort((a, b) => a.score - b.score);
      return { chordName, voicings, inProgression: progDegreeSet.has(d) };
    });
  }, [song.key, song.scaleType, song.degrees, song.qualities, song.chords, song.lineChords, song.exact, song.lyricLines, progDegreeSet]);

  // Deduplicated unique chords for strip display
  const stripChords = useMemo(() => {
    const seen = new Set();
    return songChordsWithVoicings.filter(c => {
      if (seen.has(c.chordName)) return false;
      seen.add(c.chordName);
      return true;
    });
  }, [songChordsWithVoicings]);

  // The real BPM for this song (per-song map, falls back to a sensible default).
  const playBpm = song.bpm ?? songBpm(song.title) ?? 100;

  // The Play button walks the WHOLE song — every chord cell in the exact order
  // it appears through the song, resolved the SAME way the display, Song Editor
  // and Play-Along game resolve it (resolveChordCells: lyricLines verbatim, else
  // the song's real per-line sequence via lineChords, else the full chord chain).
  // This is the fix for "play should play the all song": built-in progression
  // songs previously fell back to each unique chord once instead of the whole
  // structure. Each cell resolves to its easiest catalogued voicing.
  const songPlaySequence = useMemo(() => {
    const byName = new Map(songChordsWithVoicings.map(c => [c.chordName, c.voicings[0]]));
    const seq = [];
    for (const cell of resolveChordCells(song)) {
      const v = byName.get(cell.chordName) || cell.voicings?.[0] || lookupVoicings(cell.chordName)[0];
      if (v) seq.push(v);
    }
    if (seq.length) return seq;
    return songChordsWithVoicings.map(c => c.voicings[0]).filter(Boolean);
  }, [song, songChordsWithVoicings]);

  return (
    <div style={{ borderBottom: '1px solid var(--color-surface-750)' }}>
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 pt-2 pb-1"
        style={lyricsOpen ? {
          background: 'linear-gradient(180deg, rgba(201,169,110,0.10), transparent)',
          borderBottom: '1px solid rgba(201,169,110,0.18)',
          paddingTop: 14, paddingBottom: 12,
        } : undefined}>
        {/* The title itself is the same toggle as the Lyrics button — tap the
            song name to open/close its lyrics. */}
        <button
          type="button"
          onClick={() => setLyricsOpen(v => !v)}
          className="min-w-0 flex-1 text-left cursor-pointer"
          title={lyricsOpen ? tr.hide : tr.lyrics}
        >
          {lyricsOpen ? (
            // Grand header for the opened song — large display title with a gold
            // gradient wash, the artist as an eyebrow beneath.
            <div className="flex flex-col gap-0.5">
              <span
                className="font-black leading-none tracking-tight"
                style={{
                  fontSize: 'clamp(1.6rem, 4.5vw, 2.6rem)',
                  background: 'linear-gradient(92deg, var(--color-brand), #f3e2b8 55%, var(--color-brand))',
                  WebkitBackgroundClip: 'text', backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent', color: 'transparent',
                  textWrap: 'balance', filter: 'drop-shadow(0 1px 8px rgba(201,169,110,0.25))',
                }}
              >{song.title}</span>
              <span className="text-xs uppercase tracking-[0.25em] font-semibold"
                style={{ color: 'var(--color-brand)', opacity: 0.85 }}>
                {song.artist}
              </span>
            </div>
          ) : (
            <>
              <span
                className="font-semibold text-sm"
                style={{ color: 'var(--color-ink)' }}
              >{song.title}</span>
              <span className="text-sm" style={{ color: 'var(--color-ink-faint)' }}> — {song.artist}</span>
            </>
          )}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs px-1.5 py-0.5 rounded font-medium hidden sm:inline"
            style={{ background: 'rgba(56,189,248,0.1)', color: 'var(--color-info)' }}>
            {song.key}
          </span>
          <button
            onClick={() => {
              if (isPlaying) { stopAudio(); setIsPlaying(false); }
              else {
                if (!songPlaySequence.length) return;
                setIsPlaying(true);
                // Play the whole song through its chords at the real tempo.
                playProgression(songPlaySequence, playBpm, () => {}, () => setIsPlaying(false));
              }
            }}
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all"
            style={isPlaying
              ? { background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)' }
              : { background: 'var(--color-surface-600)', color: 'var(--color-ink-subtle)' }}
            title="Play the whole song"
          >
            {isPlaying ? '■' : '▶'}
          </button>
          <button
            onClick={() => setLyricsOpen(v => !v)}
            className="text-xs px-2 py-0.5 rounded font-medium transition-all"
            style={lyricsOpen
              ? { background: 'color-mix(in srgb, var(--color-indigo) 12%, transparent)', color: 'var(--color-accent)' }
              : { background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)' }}
          >
            {lyricsOpen ? tr.hide : tr.lyrics}
          </button>
          <button
            onClick={() => (editing ? setEditing(false) : openEditor())}
            className="text-xs px-2 py-0.5 rounded font-medium transition-all"
            style={editing
              ? { background: 'rgba(201,169,110,0.15)', color: 'var(--color-brand)' }
              : { background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)' }}
            title={isCustom ? 'Edit this saved song and save it back' : 'Edit this song — saves an editable copy to your songs'}
          >
            {editing ? 'Close' : 'Edit'}
          </button>
          <button
            onClick={() => { stopAudio(); setIsPlaying(false); setEditorOpen(true); }}
            className="text-xs px-2 py-0.5 rounded font-medium transition-all"
            style={{ background: 'color-mix(in srgb, var(--color-indigo) 12%, transparent)', color: 'var(--color-accent)' }}
            title="Open the Song Editor — mark a section and transform it (move up frets, easier voicings, capo, melody, rhythm, style)"
          >
            Editor
          </button>
        </div>
      </div>
      {editorOpen && (
        <SongEditor song={song} profile={editorProfile} onClose={() => setEditorOpen(false)} />
      )}
      <div className="flex flex-wrap gap-x-0 overflow-x-auto pb-1" style={{ borderTop: '1px solid var(--color-surface-750)' }}>
        {stripChords.map((c, j) => (
          <div key={j} className="px-2 sm:px-3 py-1" style={{ minWidth: 48 }}>
            <ChordTip name={c.chordName}>
              <a
                href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(c.chordName)}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs font-mono font-semibold hover:underline"
                style={{ color: c.inProgression ? 'var(--color-ink-subtle)' : 'var(--color-danger)' }}
              >
                {c.chordName}
              </a>
            </ChordTip>
          </div>
        ))}
      </div>
      {editing && (
        <div className="px-3 sm:px-4 py-3" style={{ borderTop: '1px solid var(--color-surface-750)', background: 'var(--color-surface-base)' }}>
          <div className="text-[11px] mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>
            Edit the chord sheet — chord line above each lyric line.{' '}
            {isCustom
              ? 'Saves back to this song.'
              : existingCopy
                ? 'Updates your saved copy of this song.'
                : 'Saves an editable copy to your songs.'}
            {' '}Use <span style={{ color: 'var(--color-brand)' }}>Check</span> to preview before saving.
          </div>
          <textarea
            value={editText}
            onChange={e => { setEditText(e.target.value); setPreview(null); }}
            spellCheck={false}
            className="w-full font-mono text-xs rounded p-2"
            rows={12}
            style={{ background: 'var(--color-surface-800)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)', resize: 'vertical' }}
          />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button
              onClick={pasteRealChords}
              className="text-xs px-3 py-1 rounded font-semibold"
              style={{ background: 'rgba(56,189,248,0.12)', color: 'var(--color-info)', border: '1px solid rgba(56,189,248,0.3)' }}
              title="Paste a chord sheet copied from the Ultimate Guitar tab — junk is filtered out, then Save to overwrite this song"
            >Paste real chords</button>
            <button
              onClick={checkEdit}
              className="text-xs px-3 py-1 rounded font-semibold"
              style={{ background: 'rgba(201,169,110,0.15)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.3)' }}
            >Check</button>
            <button
              onClick={saveEdit}
              className="text-xs px-3 py-1 rounded font-semibold"
              style={{ background: 'rgba(74,222,128,0.15)', color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.3)' }}
            >Save</button>
            <button
              onClick={() => { setEditing(false); setPreview(null); }}
              className="text-xs px-3 py-1 rounded font-medium"
              style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)' }}
            >Cancel</button>
            {editMsg && <span className="text-[11px]" style={{ color: 'var(--color-success)' }}>{editMsg}</span>}
          </div>

          {/* Preview of the parsed result, shown by "Check" before you Save. */}
          {preview && (
            <div className="mt-3 rounded p-2.5 text-[11px]"
              style={{ background: 'var(--color-surface-850)', border: '1px solid var(--color-surface-550)' }}>
              <div className="font-semibold mb-1.5" style={{ color: 'var(--color-brand)' }}>
                Preview — this is what will be saved
              </div>
              <div style={{ color: 'var(--color-ink-muted)' }}>
                <span style={{ color: 'var(--color-ink)' }}>{preview.parsed.title || '(no title)'}</span>
                <span style={{ color: 'var(--color-ink-faint)' }}> — {preview.parsed.artist || '(no artist)'}</span>
              </div>
              <div className="mt-0.5" style={{ color: 'var(--color-ink-subtle)' }}>
                Key {keyLabelFor(preview.parsed)} · {preview.parsed.bpm ? `${preview.parsed.bpm} bpm · ` : ''}
                {(preview.parsed.chords || []).length} chord{(preview.parsed.chords || []).length === 1 ? '' : 's'} · {(preview.parsed.lyricLines || []).length} line{(preview.parsed.lyricLines || []).length === 1 ? '' : 's'}
              </div>
              {(preview.parsed.chords || []).length > 0 && (
                <div className="mt-1 font-mono" style={{ color: 'var(--color-accent)' }}>
                  {(preview.parsed.chords || []).join('  ')}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <ul className="mt-1.5 list-disc list-inside" style={{ color: 'var(--color-caution)' }}>
                  {preview.warnings.map((w, k) => <li key={k}>{w}</li>)}
                </ul>
              )}
              <div className="mt-2 max-h-40 overflow-y-auto font-mono leading-snug"
                style={{ color: 'var(--color-ink-muted)' }}>
                {(preview.parsed.lyricLines || []).map((ln, k) => (
                  <div key={k}>
                    {(ln.chordNames || []).length > 0 && (
                      <span style={{ color: 'var(--color-accent)' }}>[{(ln.chordNames || []).join(' ')}] </span>
                    )}
                    <span>{ln.text || (ln.chordNames?.length ? '' : '·')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {lyricsOpen && <LyricsSection song={song} title={song.title} artist={song.artist} bpm={song.bpm ?? songBpm(song.title)} lineChords={song.lineChords} customLyricLines={song.lyricLines} tabBlocks={song.tabBlocks} progChordsWithVoicings={songChordsWithVoicings} tr={tr} lang={lang} />}
    </div>
  );
}

// ─── Songs panel ─────────────────────────────────────────────────────────────

function containsProgression(songDegrees, progDegrees) {
  const len = progDegrees.length;
  for (let i = 0; i <= songDegrees.length - len; i++) {
    if (progDegrees.every((d, j) => songDegrees[i + j] === d)) return true;
  }
  return false;
}

// Pitch class of a key/root name, so enharmonic spellings (Bb == A#) compare equal.
const KEY_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
function sameKey(a, b) {
  const pa = KEY_PC[a], pb = KEY_PC[b];
  return pa != null && pb != null && pa === pb;
}

// Root pitch class of a chord name (ignores quality/suffix). 'Gm7' → G's pc.
// Cached — song matching runs this against every chord of every catalog song
// for every progression card, and the regex dominated that cost.
const _chordPcCache = new Map();
function chordPc(name) {
  if (_chordPcCache.has(name)) return _chordPcCache.get(name);
  const m = (name || '').match(/^([A-G][#b]?)/);
  const pc = m ? KEY_PC[m[1]] : null;
  _chordPcCache.set(name, pc);
  return pc;
}

// Diatonic chord names of a progression in a key, cached for the same reason —
// getDiatonicChords was being rebuilt per song per card during matching.
const _progNamesCache = new Map();
function progChordNamesFor(keyRoot, scaleType, degrees) {
  const k = `${keyRoot}|${scaleType}|${degrees.join(',')}`;
  let names = _progNamesCache.get(k);
  if (!names) {
    const dia = getDiatonicChords(keyRoot, scaleType);
    names = degrees.map(d => dia[d]?.chordName).filter(Boolean);
    _progNamesCache.set(k, names);
  }
  return names;
}

// Does the song's actual chord-name list contain the progression's chords (by
// root pitch class), as a CONSECUTIVE run? Used for custom songs so matching is
// based on the chords the user actually pasted, not just derived degrees.
function chordsContainProgression(songChordNames, progChordNames) {
  const songPcs = songChordNames.map(chordPc);
  const progPcs = progChordNames.map(chordPc);
  if (progPcs.some(p => p == null)) return false;
  const len = progPcs.length;
  for (let i = 0; i + len <= songPcs.length; i++) {
    if (progPcs.every((p, j) => songPcs[i + j] === p)) return true;
  }
  return false;
}

// Degree (0–6) of a chord within a key+scale, by root pitch class, or null if
// the chord's root is outside the diatonic scale.
const MAJOR_PC_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_PC_STEPS = [0, 2, 3, 5, 7, 8, 10];
function chordDegreeIn(chordName, keyRoot, scaleType) {
  const cpc = chordPc(chordName);
  const kpc = KEY_PC[keyRoot];
  if (cpc == null || kpc == null) return null;
  const interval = (cpc - kpc + 12) % 12;
  const steps = scaleType === 'minor' ? MINOR_PC_STEPS : MAJOR_PC_STEPS;
  const idx = steps.indexOf(interval);
  return idx === -1 ? null : idx;
}

// Given a song's actual chord names + key + scale, find the progression it best
// fits: the one whose degree pattern appears as the LONGEST consecutive run in
// the song's chords. Returns { name, degrees, key, scaleType } or null when no
// known progression matches. Used on Save to decide where a song now belongs.
// Quick name → progression lookup across both scales (names are unique).
const scaleProgsByName = new Map(
  [...MAJOR_PROGRESSIONS, ...MINOR_PROGRESSIONS].map(p => [p.name, p]),
);

function detectBestProgression(chordNames, keyRoot, scaleType) {
  const songDegrees = (chordNames || []).map(c => chordDegreeIn(c, keyRoot, scaleType));
  const list = scaleType === 'minor' ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS;
  let best = null;
  for (const prog of list) {
    if (containsProgression(songDegrees, prog.degrees) &&
        (!best || prog.degrees.length > best.degrees.length)) {
      best = prog;
    }
  }
  return best ? { ...best, key: keyRoot, scaleType } : null;
}

// The single source of truth for which songs match a progression: same scale,
// the song actually CONTAINS the progression's degree pattern, and — when a key
// is pinned — the song is originally in that key. Used by BOTH the ♪ badge count
// and the songs panel so they never disagree.
//
// Built-in songs are keyed by progression name; user-imported (custom) songs
// have no progression name, so they're matched purely on scale + key + the
// degree pattern, and folded in here so they appear alongside the built-ins.
function matchingSongs(progName, progDegrees, progScaleType, targetRoot, customSongs = [], catalogSongs = [], reach = null) {
  // Built-ins: degree-based match (their data is degree-shaped and well-formed).
  const fitsBuiltIn = song => {
    if (song.scaleType !== progScaleType) return false;
    if (targetRoot && targetRoot !== 'all' && !sameKey(song.key, targetRoot)) return false;
    return containsProgression(song.degrees || [], progDegrees);
  };
  // Custom (pasted) songs: match on the ACTUAL chord names the user pasted. The
  // song must literally contain the progression's chords — built in the chosen
  // key (or the song's own key when "all roots" is selected) — as a run.
  const fitsCustom = song => {
    if (song.scaleType !== progScaleType) return false;
    if (targetRoot && targetRoot !== 'all' && !sameKey(song.key, targetRoot)) return false;
    if (!Array.isArray(song.chords) || !song.chords.length) return false;
    const keyForProg = (targetRoot && targetRoot !== 'all') ? targetRoot : song.key;
    const progChordNames = progChordNamesFor(keyForProg, progScaleType, progDegrees);
    return chordsContainProgression(song.chords, progChordNames);
  };
  const custom = customSongs.filter(fitsCustom);
  // A custom (user-saved/edited) song with the same name supersedes the built-in,
  // so the same title never shows twice.
  const customTitles = new Set(custom.map(s => (s.title || '').trim().toLowerCase()));

  // The DB catalog — every song regenerated from a REAL chord sheet (actual
  // chords + full lyrics) — REPLACES the static songs.js entries. Catalog songs
  // carry real chord names, so they match exactly like pasted songs. The static
  // degree-based list is only the fallback while the catalog hasn't loaded
  // (backend down and no cache yet).
  // When "limit to my reach" is on, hide any song with a chord ANYWHERE in it the
  // hand can't comfortably play — the whole song is excluded from the list + count.
  // "Limit by my level" does the same against the tier's difficulty ceiling.
  const applyReach = (list) => {
    let out = reach?.limitToReach ? filterSongsByReach(list, reach.profile, true) : list;
    if (reach?.limitToLevel && reach.levelCeil < 10) out = filterSongsByLevel(out, reach.levelCeil, true);
    return out;
  };

  if (catalogSongs.length) {
    const catalog = catalogSongs
      .filter(fitsCustom)
      .filter(s => !customTitles.has((s.title || '').trim().toLowerCase()));
    return applyReach([...custom, ...catalog]);
  }

  const builtIn = (SONGS_BY_PROGRESSION[progName] || [])
    .filter(fitsBuiltIn)
    .filter(s => !customTitles.has((s.title || '').trim().toLowerCase()));
  return applyReach([...custom, ...builtIn]);
}

function SongsPanel({ progressionName, progDegrees, progScaleType, targetRoot, customSongs, catalogSongs, tr, lang, reach, onSongEdited, onSongMoved }) {
  // Set of degree indices that belong to this progression — used to flag "outside" chords in red
  const progDegreeSet = useMemo(() => new Set(progDegrees), [progDegrees]);

  const songs = matchingSongs(progressionName, progDegrees, progScaleType, targetRoot, customSongs, catalogSongs, reach).slice(0, 10);

  if (!songs.length) {
    const keyed = targetRoot && targetRoot !== 'all';
    return (
      <div className="px-4 py-3 text-sm italic" style={{ color: 'var(--color-ink-ghost)', borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
        {reach?.limitToReach
          ? 'No songs here are fully within your reach. Turn off “limit to my reach” in Account settings to see songs with harder chords.'
          : keyed
            ? `No famous songs on record for this progression in the key of ${targetRoot}. Try another key, or "All roots".`
            : 'No song examples on record for this progression.'}
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-ghost)' }}>
        {tr.famousSongs}
      </div>
      <div style={{ borderTop: '1px solid var(--color-surface-750)' }}>
        {songs.map((song, i) => (
          <SongRow key={song.id || i} song={song} progDegreeSet={progDegreeSet} tr={tr} lang={lang} customSongs={customSongs} currentProgName={progressionName} onEdited={onSongEdited} onMoved={onSongMoved} />
        ))}
      </div>
    </div>
  );
}

// ─── Hand filter helpers ──────────────────────────────────────────────────────

const FINGER_COLORS = { thumb: 'var(--color-accent)', index: 'var(--color-info)', middle: 'var(--color-success)', ring: 'var(--color-brand)', pinky: 'var(--color-danger)' };
const FINGER_LABELS = { thumb: 'T', index: 'I', middle: 'M', ring: 'R', pinky: 'P' };

const LENGTH_ORDER  = { Short: 0, Medium: 1, Long: 2 };
const FLEX_ORDER    = { Low: 0, Medium: 1, High: 2 };
const REACH_ORDER   = { Weak: 0, Moderate: 1, Strong: 2 };
const STRAIGHT_ORDER = { Curved: 0, Straight: 1 };
const INDEP_ORDER   = { Low: 0, Medium: 1, High: 2 };

// ─── Hand Filters Panel ───────────────────────────────────────────────────────

function HandFiltersPanel({ profile, aiFingers, handFilters, setHandFilters, onSaveProfile, onGapsChange }) {
  const GAPS = [
    { key: 'thumbToIndex',  label: 'Thumb → Index',  range: [0, 10],  step: 0.25, color: 'var(--color-accent)' },
    { key: 'indexToMiddle', label: 'Index → Middle', range: [0, 7],   step: 0.25, color: 'var(--color-info)' },
    { key: 'middleToRing',  label: 'Middle → Ring',  range: [0, 6],   step: 0.25, color: 'var(--color-success)' },
    { key: 'ringToLittle',  label: 'Ring → Pinky',   range: [0, 8.5], step: 0.25, color: 'var(--color-brand)' },
  ];

  const [localGaps, setLocalGaps] = useState({
    thumbToIndex:  profile.thumbToIndex  ?? DEFAULT_PROFILE.thumbToIndex,
    indexToMiddle: profile.indexToMiddle ?? DEFAULT_PROFILE.indexToMiddle,
    middleToRing:  profile.middleToRing  ?? DEFAULT_PROFILE.middleToRing,
    ringToLittle:  profile.ringToLittle  ?? DEFAULT_PROFILE.ringToLittle,
  });
  const [saved, setSaved] = useState(false);

  // Sync if profile changes externally
  useEffect(() => {
    setLocalGaps({
      thumbToIndex:  profile.thumbToIndex  ?? DEFAULT_PROFILE.thumbToIndex,
      indexToMiddle: profile.indexToMiddle ?? DEFAULT_PROFILE.indexToMiddle,
      middleToRing:  profile.middleToRing  ?? DEFAULT_PROFILE.middleToRing,
      ringToLittle:  profile.ringToLittle  ?? DEFAULT_PROFILE.ringToLittle,
    });
  }, [profile]);

  function handleGapChange(key, val) {
    const updated = { ...localGaps, [key]: val };
    setLocalGaps(updated);
    setSaved(false);
    if (onGapsChange) onGapsChange(updated);
  }

  function handleSave() {
    if (onSaveProfile) onSaveProfile({ ...profile, ...localGaps });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const fingers = aiFingers || {};

  function toggleFilter(key, val) {
    setHandFilters(prev => {
      const cur = prev[key];
      if (cur === val) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: val };
    });
  }

  function FilterChip({ label, active, color, onClick }) {
    return (
      <button
        onClick={onClick}
        className="text-[10px] px-2 py-0.5 rounded-full font-semibold transition-all"
        style={active
          ? { background: `${color}25`, color, border: `1px solid ${color}50` }
          : { background: 'var(--color-surface-750)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}
      >{label}</button>
    );
  }

  return (
    <div className="rounded-xl p-4 mb-4 space-y-4" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
      <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--color-ink-faint)' }}>My Hand Filters</p>

      {/* Gap sliders — editable, saves to profile */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--color-ink-ghost)' }}>Finger Gap Measurements</p>
          <button
            onClick={handleSave}
            className="text-xs px-3 py-1 rounded-lg font-semibold transition-all"
            style={saved
              ? { background: 'rgba(74,222,128,0.1)', color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.2)' }
              : { background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}
          >
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
        <div className="space-y-2">
          {GAPS.map(({ key, label, range, step, color }) => {
            const val = localGaps[key];
            const pct = ((val - range[0]) / (range[1] - range[0])) * 100;
            return (
              <div key={key} className="rounded-lg px-3 py-2" style={{ background: 'var(--color-surface-base)', border: `1px solid ${color}18` }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px]" style={{ color: 'var(--color-ink-ghost)' }}>{label}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color }}>{val.toFixed(1)} cm</span>
                </div>
                <input
                  type="range" min={range[0]} max={range[1]} step={step} value={val}
                  onChange={e => handleGapChange(key, parseFloat(e.target.value))}
                  className="w-full"
                  style={{ background: `linear-gradient(to right, ${color} ${pct}%, var(--color-surface-550) ${pct}%)`, color }}
                />
                <div className="flex justify-between text-[9px] mt-0.5" style={{ color: 'var(--color-surface-550)' }}>
                  <span>{range[0]} cm</span><span>{range[1]} cm</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-finger filters — only shown if AI data available */}
      {Object.keys(fingers).length > 0 ? (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-ink-subtle)' }}>Finger Attributes (from AI Analysis)</p>
          <div className="space-y-2">
            {['thumb', 'index', 'middle', 'ring', 'pinky'].map(name => {
              const f = fingers[name];
              if (!f) return null;
              const color = FINGER_COLORS[name];
              return (
                <div key={name} className="flex items-start gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--color-surface-base)', border: `1px solid ${color}15` }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-black shrink-0 mt-0.5" style={{ background: color }}>
                    {FINGER_LABELS[name]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold capitalize mb-1.5" style={{ color }}>{name}</p>
                    <div className="flex flex-wrap gap-1">
                      {/* Flexibility (thumb) — caps raw difficulty */}
                      {name === 'thumb' && f.flexibility && ['Low','Medium','High'].map(v => (
                        <FilterChip key={v} label={`${v} flex`} color={color}
                          active={handFilters.thumb_flex === v}
                          onClick={() => toggleFilter('thumb_flex', v)} />
                      ))}
                      {/* Straightness (index) */}
                      {name === 'index' && f.straightness && ['Curved','Straight'].map(v => (
                        <FilterChip key={v} label={v} color={color}
                          active={handFilters.index_straight === v}
                          onClick={() => toggleFilter('index_straight', v)} />
                      ))}
                      {/* Independence (middle, ring) */}
                      {(name === 'middle' || name === 'ring') && f.independence && ['Low','Medium','High'].map(v => (
                        <FilterChip key={v} label={`${v} indep`} color={color}
                          active={handFilters[`${name}_indep`] === v}
                          onClick={() => toggleFilter(`${name}_indep`, v)} />
                      ))}
                      {/* Reach (pinky) */}
                      {name === 'pinky' && f.reach && ['Weak','Moderate','Strong'].map(v => (
                        <FilterChip key={v} label={v} color={color}
                          active={handFilters.pinky_reach === v}
                          onClick={() => toggleFilter('pinky_reach', v)} />
                      ))}
                      {/* Show AI-assessed value as info */}
                      {f.length && <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>{f.length}</span>}
                    </div>
                    {f.note && <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-ink-subtle)' }}>{f.note}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-700)', color: 'var(--color-ink-subtle)' }}>
          Per-finger data not yet available. Use <strong style={{ color: 'var(--color-accent)' }}>AI Hand Analysis</strong> on the My Hand tab to unlock finger-level filters.
        </div>
      )}

      {/* Clear filters */}
      {Object.keys(handFilters).length > 0 && (
        <button
          onClick={() => setHandFilters({})}
          className="text-xs px-3 py-1 rounded-lg"
          style={{ color: 'var(--color-danger)', border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.05)' }}
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

// Each gap drives a difficulty cap for the chord types that rely on it.
// At 0 cm the cap is 1; at reference max the cap is 10. Linear between.
function gapDiffCap(val, refMax) {
  if (refMax <= 0) return 1;
  return Math.max(1, Math.min(10, Math.round((val / refMax) * 10)));
}

// Filter progressions by gap measurements + finger chip constraints
function filterByHandData(progs, profile, aiFingers, handFilters) {
  const fingers = aiFingers || {};

  // Cap from each gap measurement
  const thumbCap  = gapDiffCap(profile.thumbToIndex  ?? GAP_REF_MAX.thumbToIndex,  GAP_REF_MAX.thumbToIndex);
  const indexCap  = gapDiffCap(profile.indexToMiddle ?? GAP_REF_MAX.indexToMiddle, GAP_REF_MAX.indexToMiddle);
  const middleCap = gapDiffCap(profile.middleToRing  ?? GAP_REF_MAX.middleToRing,  GAP_REF_MAX.middleToRing);
  const pinkyCap  = gapDiffCap(profile.ringToLittle  ?? GAP_REF_MAX.ringToLittle,  GAP_REF_MAX.ringToLittle);

  // Overall cap = most restrictive gap
  let rawDiffCap = Math.min(thumbCap, indexCap, middleCap, pinkyCap);

  // Finger chip overrides (further restrict)
  if (handFilters.thumb_flex === 'Low')         rawDiffCap = Math.min(rawDiffCap, 4);
  if (handFilters.thumb_flex === 'Medium')      rawDiffCap = Math.min(rawDiffCap, 7);
  if (handFilters.index_straight === 'Curved')  rawDiffCap = Math.min(rawDiffCap, 6);
  if (handFilters.middle_indep === 'Low')       rawDiffCap = Math.min(rawDiffCap, 5);
  if (handFilters.middle_indep === 'Medium')    rawDiffCap = Math.min(rawDiffCap, 7);
  if (handFilters.ring_indep === 'Low')         rawDiffCap = Math.min(rawDiffCap, 5);
  if (handFilters.ring_indep === 'Medium')      rawDiffCap = Math.min(rawDiffCap, 7);
  if (handFilters.pinky_reach === 'Weak')       rawDiffCap = Math.min(rawDiffCap, 5);
  if (handFilters.pinky_reach === 'Moderate')   rawDiffCap = Math.min(rawDiffCap, 7);

  return progs.filter(prog => {
    const rawMax = Math.max(...prog.chords.map(c => c.voicings[0]?.score ?? 0));
    return rawMax <= rawDiffCap;
  });
}

// ─── Easier-alternative chords panel ──────────────────────────────────────────

const SUB_KIND_LABEL = {
  simplified: 'simplified shape',
  power:      'power chord',
};

function EasierChordsPanel({ prog, profile, onTooltip, onTooltipLeave }) {
  // Compute once per (progression, profile) — cheap, but memoize anyway.
  const { perChord, count } = useMemo(
    () => suggestEasierProgression(prog.chords, profile),
    [prog.chords, profile],
  );

  if (count === 0) {
    return (
      <div className="px-4 py-3 text-xs italic" style={{ color: 'var(--color-ink-ghost)', borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
        No easier alternatives found — these shapes are already a good fit for your hand.
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--color-surface-800)', background: 'var(--color-surface-900)',
      boxShadow: 'inset 3px 0 0 0 color-mix(in srgb, var(--color-success) 65%, transparent)' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-success)' }}>
        Easier alternatives for your hand
      </div>
      <div className="px-3 sm:px-4 pb-3 flex flex-wrap gap-2">
        {prog.chords.map((chord, j) => {
          const sub = perChord[j];
          if (!sub) {
            return (
              <div key={j} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-800)' }}>
                <span className="text-xs font-mono font-semibold" style={{ color: 'var(--color-ink-faint)' }}>{chord.chordName}</span>
                <span className="text-[10px]" style={{ color: 'var(--color-surface-550)' }}>ok as-is</span>
              </div>
            );
          }
          const v = sub.substitute.voicing;
          return (
            <div key={j} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.18)' }}>
              <div className="flex items-center gap-1">
                <span className="text-xs font-mono line-through" style={{ color: 'var(--color-ink-faint)' }}>{chord.chordName}</span>
                <span className="text-[11px]" style={{ color: 'var(--color-success)' }}>→</span>
                <span
                  className="text-xs font-mono font-bold cursor-default"
                  style={{ color: 'var(--color-success)' }}
                  onMouseEnter={e => onTooltip(e, v)}
                  onMouseLeave={onTooltipLeave}
                >{sub.substitute.name}</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-success) 12%, #000)', color: 'color-mix(in srgb, var(--color-success) 60%, var(--color-ink-subtle))' }}>
                {SUB_KIND_LABEL[sub.substitute.kind]}
              </span>
              <span className="text-[9px] tabular-nums" style={{ color: 'color-mix(in srgb, var(--color-success) 52%, #000)' }}>
                −{sub.saved.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="px-3 sm:px-4 pb-3 text-[10px] leading-relaxed" style={{ color: 'var(--color-ink-ghost)' }}>
        Substitutes keep each chord's root and harmonic role. Numbers show how much easier the shape is on
        your personal 1–10 difficulty scale. Hover a chord to preview the fingering.
      </p>
    </div>
  );
}

// ─── Up-the-neck voicings panel ────────────────────────────────────────────────

function UpperVoicingsPanel({ prog, onTooltip, onTooltipLeave }) {
  const { perChord, count } = useMemo(
    () => suggestUpperProgression(prog.chords),
    [prog.chords],
  );

  if (count === 0) {
    return (
      <div className="px-4 py-3 text-xs italic" style={{ color: 'var(--color-ink-ghost)', borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
        No movable up-the-neck voicings available for these chords.
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--color-surface-800)', background: 'var(--color-surface-900)',
      boxShadow: 'inset 3px 0 0 0 color-mix(in srgb, var(--color-violet) 65%, transparent)' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-violet)' }}>
        Play it higher up the neck
      </div>
      <div className="px-3 sm:px-4 pb-3 flex flex-wrap gap-2">
        {prog.chords.map((chord, j) => {
          const up = perChord[j];
          if (!up) {
            return (
              <div key={j} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-800)' }}>
                <span className="text-xs font-mono font-semibold" style={{ color: 'var(--color-ink-faint)' }}>{chord.chordName}</span>
                <span className="text-[10px]" style={{ color: 'var(--color-surface-550)' }}>—</span>
              </div>
            );
          }
          const v = up.voicing;
          return (
            <div key={j} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: 'color-mix(in srgb, var(--color-violet) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--color-violet) 18%, transparent)' }}>
              <span
                className="text-xs font-mono font-bold cursor-default"
                style={{ color: 'var(--color-violet)' }}
                onMouseEnter={e => onTooltip(e, v)}
                onMouseLeave={onTooltipLeave}
              >{chord.chordName}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-violet) 14%, #000)', color: 'color-mix(in srgb, var(--color-violet) 70%, var(--color-ink-subtle))' }}>
                {up.shape} · fret {up.barreFret}
              </span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--color-ink-faint)' }}>{v.tab}</span>
            </div>
          );
        })}
      </div>
      <p className="px-3 sm:px-4 pb-3 text-[10px] leading-relaxed" style={{ color: 'var(--color-ink-ghost)' }}>
        Movable barre (CAGED) shapes for the same chords, positioned further up the neck — the same hand shape
        slides between chords. Hover a chord to preview the fingering.
      </p>
    </div>
  );
}

// ─── Up-the-neck triads panel (no barre) ───────────────────────────────────────

function TriadVoicingsPanel({ prog, onTooltip, onTooltipLeave }) {
  const { perChord, count } = useMemo(
    () => suggestTriadProgression(prog.chords),
    [prog.chords],
  );

  if (count === 0) {
    return (
      <div className="px-4 py-3 text-xs italic" style={{ color: 'var(--color-ink-ghost)', borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
        No up-the-neck triad voicings available for these chords.
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--color-surface-800)', background: 'var(--color-surface-900)',
      boxShadow: 'inset 3px 0 0 0 color-mix(in srgb, var(--color-warning) 65%, transparent)' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warning)' }}>
        Up the neck — triads (no barre)
      </div>
      <div className="px-3 sm:px-4 pb-3 flex flex-wrap gap-2">
        {prog.chords.map((chord, j) => {
          const t = perChord[j];
          if (!t) {
            return (
              <div key={j} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-800)' }}>
                <span className="text-xs font-mono font-semibold" style={{ color: 'var(--color-ink-faint)' }}>{chord.chordName}</span>
                <span className="text-[10px]" style={{ color: 'var(--color-surface-550)' }}>—</span>
              </div>
            );
          }
          const v = t.voicing;
          return (
            <div key={j} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.18)' }}>
              <span
                className="text-xs font-mono font-bold cursor-default"
                style={{ color: 'var(--color-warning)' }}
                onMouseEnter={e => onTooltip(e, v)}
                onMouseLeave={onTooltipLeave}
              >{chord.chordName}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#241f10', color: '#b89a4a' }}>
                triad · fret {t.baseFret}
              </span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--color-ink-faint)' }}>{v.tab}</span>
            </div>
          );
        })}
      </div>
      <p className="px-3 sm:px-4 pb-3 text-[10px] leading-relaxed" style={{ color: 'var(--color-ink-ghost)' }}>
        Three-note triad grips on adjacent strings, higher up the neck — same root/3rd/5th as each chord,
        no barre. Hover a chord to preview the fingering.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProgressionExplorer({ lang, onSaveProfile }) {
  const tr = useT(lang);
  const handProfile = useHandProfile();
  const aiFingers   = useAIFingers();
  const limitToReach = useReachLimit();
  const limitToLevel = useLevelLimit();
  const levelCeil = currentLevelCeiling({ handProfile, manual: loadManual() });
  const [root,        setRoot]        = useState('C');
  const [scaleType,   setScaleType]   = useState('major');
  const [showHandFilters, setShowHandFilters] = useState(false);
  const [handFilters, setHandFilters] = useState({});
  const [liveGaps, setLiveGaps] = useState(null); // overrides handProfile gaps for live preview
  const [playState,   setPlayState]   = useState(null);  // { key, chordIdx }
  const [openSongs,   setOpenSongs]   = useState(new Set()); // Set of card keys
  const [openEasier,  setOpenEasier]  = useState(new Set()); // Set of card keys
  const [openUpper,   setOpenUpper]   = useState(new Set()); // Set of card keys
  const [openTriad,   setOpenTriad]   = useState(new Set()); // Set of card keys
  const [openChanges, setOpenChanges] = useState(new Set()); // Set of card keys
  // User-imported songs (localStorage) folded into the song matching, so a song
  // you import shows up under its progression + key like the built-ins.
  const [customSongs, setCustomSongs] = useState(loadCustomSongs);
  useEffect(() => {
    // Re-read when returning to this tab (a song may have been imported since).
    const reload = () => setCustomSongs(loadCustomSongs());
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, []);
  // The DB song catalog (real fetched chord sheets) — replaces the static
  // songs.js entries in the lists once loaded; [] keeps the static fallback.
  const [catalogSongs, setCatalogSongs] = useState([]);
  useEffect(() => {
    let alive = true;
    loadCatalogSongs().then(songs => { if (alive) setCatalogSongs(songs); });
    return () => { alive = false; };
  }, []);
  const [tooltip,     setTooltip]     = useState(null);  // { voicing, x, y }
  const [moveNotice,  setMoveNotice]  = useState(null);  // banner after a Save moves a song
  const [songSearch,  setSongSearch]  = useState('');    // song search box (title/artist)

  const allRoots   = root === 'all';
  const bothScales = scaleType === 'both';
  const multiKey   = allRoots || bothScales;

  const diatonicChords = useMemo(
    () => (!multiKey ? getDiatonicChords(root, scaleType) : null),
    [root, scaleType, multiKey],
  );

  const resolved = useMemo(() => {
    setOpenSongs(new Set());
    setOpenEasier(new Set());
    setOpenUpper(new Set());
    setOpenTriad(new Set());
    setOpenChanges(new Set());
    const roots  = allRoots   ? ROOT_NOTES         : [root];
    const scales = bothScales ? ['major', 'minor'] : [scaleType];
    const all = [];
    for (const r of roots)
      for (const st of scales)
        all.push(...resolveForKey(r, st, 10));
    return all.sort((a, b) => a.maxScore - b.maxScore);
  }, [root, scaleType, allRoots, bothScales]);

  const activeProfile = useMemo(
    () => liveGaps ? { ...handProfile, ...liveGaps } : handProfile,
    [handProfile, liveGaps],
  );

  const filtered = useMemo(() => {
    if (!showHandFilters) return resolved;
    return filterByHandData(resolved, activeProfile, aiFingers, handFilters);
  }, [resolved, activeProfile, aiFingers, handFilters, showHandFilters]);

  // ♪ badge counts for every card, computed ONCE per data change. Matching all
  // catalog songs (real chord names) against every card inside the render loop
  // froze the UI — each state change re-ran cards × songs × chords regex work.
  const reach = useMemo(
    () => ({ profile: activeProfile, limitToReach, limitToLevel, levelCeil }),
    [activeProfile, limitToReach, limitToLevel, levelCeil],
  );
  const songCounts = useMemo(() => {
    const counts = new Map();
    for (const prog of filtered) {
      counts.set(
        cardKey(prog),
        matchingSongs(prog.name, prog.degrees, prog.scaleType, prog.root, customSongs, catalogSongs, reach).length,
      );
    }
    return counts;
  }, [filtered, customSongs, catalogSongs, reach]);

  // ── Song search: a flat, de-duped index of every song (built-in + catalog +
  // custom) so the user can find a song by title/artist without first knowing
  // which progression it belongs to. Custom/catalog titles supersede built-ins.
  const songIndex = useMemo(() => {
    const byTitle = new Map();     // lowercased title → song (last write wins for priority)
    const add = (song, progName) => {
      const title = (song.title || '').trim();
      if (!title) return;
      byTitle.set(title.toLowerCase(), { ...song, __progName: progName || song.progression || '' });
    };
    // Lowest priority first so higher-priority sources overwrite: built-in → catalog → custom.
    for (const [progName, list] of Object.entries(SONGS_BY_PROGRESSION)) {
      for (const song of list) add(song, progName);
    }
    for (const song of catalogSongs) add(song, '');
    for (const song of customSongs) add(song, '');
    return [...byTitle.values()].sort((a, b) =>
      (a.title || '').localeCompare(b.title || ''));
  }, [catalogSongs, customSongs]);

  const searchResults = useMemo(() => {
    const q = songSearch.trim().toLowerCase();
    if (!q) return [];
    return songIndex
      .filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.artist || '').toLowerCase().includes(q))
      .slice(0, 40);
  }, [songSearch, songIndex]);

  // ── Playback ────────────────────────────────────────────────────────────────

  const handlePlay = useCallback((prog, key) => {
    if (playState?.key === key) {
      stopAudio();
      setPlayState(null);
      return;
    }
    stopAudio();
    setPlayState({ key, chordIdx: 0 });
    playProgression(
      prog.chords.map(c => c.voicings[0]),
      72,
      idx => setPlayState({ key, chordIdx: idx }),
      ()  => setPlayState(null),
    );
  }, [playState]);

  // ── Songs toggle ─────────────────────────────────────────────────────────────

  const toggleSongs = useCallback((key) => {
    setOpenSongs(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleEasier = useCallback((key) => {
    setOpenEasier(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleUpper = useCallback((key) => {
    setOpenUpper(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleTriad = useCallback((key) => {
    setOpenTriad(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleChanges = useCallback((key) => {
    setOpenChanges(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // ── Tooltip ──────────────────────────────────────────────────────────────────

  const showTooltip = useCallback((e, voicing) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const tipW = 140;
    const x = rect.right + 10 + tipW > window.innerWidth
      ? rect.left - tipW - 6
      : rect.right + 10;
    setTooltip({ voicing, x, y: rect.top - 10 });
  }, []);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-3 sm:p-4">

      {/* Banner shown when an edited song's chords moved it to a different
          progression group (or no longer match any known progression). */}
      {moveNotice && (
        <div className="mb-4 px-3 py-2.5 rounded-lg flex items-start gap-2 text-sm"
          style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)', color: '#bcdff0' }}>
          <span style={{ color: 'var(--color-info)' }}>↪</span>
          <div className="flex-1">
            {moveNotice.found ? (
              <>
                <span className="font-semibold" style={{ color: '#e0f0fa' }}>{moveNotice.title || 'This song'}</span>
                {"'s chords no longer fit "}
                {moveNotice.from ? <span style={{ color: '#7a9aad' }}>{moveNotice.from}</span> : 'that progression'}
                {'. Moved it to '}
                <span className="font-semibold" style={{ color: 'var(--color-info)' }}>{moveNotice.to}</span>
                {' in the key of '}
                <span className="font-semibold" style={{ color: 'var(--color-info)' }}>{moveNotice.key}</span>
                {'. Open that progression to find it.'}
              </>
            ) : (
              <>
                <span className="font-semibold" style={{ color: '#e0f0fa' }}>{moveNotice.title || 'This song'}</span>
                {"'s chords no longer match any known progression, so it was left where it is. Check the chords if that's unexpected."}
              </>
            )}
          </div>
          <button
            onClick={() => setMoveNotice(null)}
            className="shrink-0 text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(56,189,248,0.12)', color: '#7a9aad' }}
          >Dismiss</button>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-4 items-end mb-4 sm:mb-5">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-faint)' }}>{tr.root}</label>
          <select
            value={root}
            onChange={e => setRoot(e.target.value)}
            className="rounded px-2 py-1.5 text-sm"
            style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}
          >
            <option value="all">{tr.allRoots}</option>
            {ROOT_NOTES.map(n => <option key={n}>{n}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-faint)' }}>{tr.scale}</label>
          <select
            value={scaleType}
            onChange={e => setScaleType(e.target.value)}
            className="rounded px-2 py-1.5 text-sm"
            style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}
          >
            <option value="both">{tr.allScales}</option>
            <option value="major">{tr.major}</option>
            <option value="minor">{tr.minor}</option>
          </select>
        </div>

        {/* Song search — find a song by title or artist across every progression */}
        <div className="col-span-2 sm:col-span-1 flex flex-col gap-1 sm:min-w-[220px] sm:flex-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-faint)' }}>
            {tr.searchSong || 'Search a song'}
          </label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: 'var(--color-ink-ghost)' }}>🔎</span>
            <input
              type="search"
              value={songSearch}
              onChange={e => setSongSearch(e.target.value)}
              placeholder={tr.searchSongHint || 'Title or artist…'}
              className="w-full rounded pl-8 pr-8 py-1.5 text-sm"
              style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}
            />
            {songSearch && (
              <button
                onClick={() => setSongSearch('')}
                aria-label={tr.close || 'Clear'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-sm leading-none"
                style={{ color: 'var(--color-ink-faint)' }}
              >×</button>
            )}
          </div>
        </div>

        {/* My Hand filter toggle */}
        <div className="col-span-2 sm:col-span-1 flex items-end">
          <button
            onClick={() => setShowHandFilters(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={showHandFilters
              ? { background: 'color-mix(in srgb, var(--color-indigo) 15%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-indigo) 30%, transparent)' }
              : { background: 'var(--color-surface-750)', color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}
          >
            ✋ {showHandFilters ? 'Hide Hand Filters' : 'My Hand Filters'}
            {Object.keys(handFilters).length > 0 && (
              <span className="rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--color-accent)', color: '#fff' }}>
                {Object.keys(handFilters).length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Hand filters panel ── */}
      {showHandFilters && (
        <>
          <HandFiltersPanel
            profile={activeProfile}
            aiFingers={aiFingers}
            handFilters={handFilters}
            setHandFilters={setHandFilters}
            onSaveProfile={onSaveProfile}
            onGapsChange={setLiveGaps}
          />
        </>
      )}

      {/* ── Scale summary (single key only) ── */}
      {!multiKey && diatonicChords && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-4 sm:mb-5 px-3 py-2 rounded text-xs"
          style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-700)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-brand)' }}>{root} {scaleType}:</span>
          {diatonicChords.map(c => (
            <span key={c.degree} style={{ color: 'var(--color-ink-faint)' }}>
              <span style={{ color: 'var(--color-ink-ghost)' }}>{c.roman}</span>&thinsp;{c.chordName}
            </span>
          ))}
        </div>
      )}

      {/* ── Song search results (replaces the progression list while searching) ── */}
      {songSearch.trim() ? (
        <div className="mb-2">
          <p className="text-xs mb-3" style={{ color: 'var(--color-ink-ghost)' }}>
            {searchResults.length === 0
              ? (tr.searchNoResults || `No songs match “${songSearch.trim()}”`)
              : `${searchResults.length}${searchResults.length === 40 ? '+' : ''} ${searchResults.length === 1 ? (tr.songResult || 'song') : (tr.songResults || 'songs')} · “${songSearch.trim()}”`}
          </p>
          {searchResults.length === 0 ? (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--color-ink-ghost)' }}>
              {tr.searchTryOther || 'Try a different title or artist. Not all songs have chord data yet.'}
            </div>
          ) : (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-surface-700)' }}>
              {searchResults.map((song, i) => (
                <SongRow
                  key={song.id || `${song.title}-${i}`}
                  song={song}
                  progDegreeSet={EMPTY_DEGREE_SET}
                  tr={tr}
                  lang={lang}
                  customSongs={customSongs}
                  currentProgName={song.__progName}
                  onEdited={() => setCustomSongs(loadCustomSongs())}
                  onMoved={(n) => { setMoveNotice(n); try { window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); } catch { /* noop */ } }}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      {/* ── Result count ── */}
      <p className="text-xs mb-3" style={{ color: 'var(--color-ink-ghost)' }}>
        {filtered.length} progression{filtered.length !== 1 ? 's' : ''}
        {showHandFilters ? ' matching your hand' : ''}
        {filtered.length < resolved.length && <span style={{ color: 'var(--color-ink-faint)' }}> (filtered from {resolved.length})</span>}
      </p>

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--color-ink-ghost)' }}>
          {showHandFilters ? 'No progressions match your current hand filters. Try raising the personal difficulty or relaxing finger filters.' : tr.noProgressions}
        </div>
      )}

      {/* ── Progression cards ── */}
      <div className="space-y-3">
        {filtered.map((prog, i) => {
          const key         = cardKey(prog);
          const isPlaying   = playState?.key === key;
          const activeChord = isPlaying ? playState.chordIdx : -1;
          const songsOpen   = openSongs.has(key);
          // With the app-wide "limit to my reach" preference on, surface the
          // easier (in-reach) alternatives automatically on every card.
          const easierOpen  = openEasier.has(key) || limitToReach;
          const upperOpen   = openUpper.has(key);
          const triadOpen   = openTriad.has(key);
          const changesOpen = openChanges.has(key);
          const songCount   = songCounts.get(key) ?? 0;

          return (
            <div key={i} className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-surface-700)' }}>

              {/* Card header — a titled card, not a flat toolbar: a 2px inset gold
                  left-rail (echoing the now-playing chord cell), the progression
                  NAME as the bold anchor, genre demoted to a tracked eyebrow, and
                  a gold-tinted key badge so gold actually enters the header. */}
              <div className="flex items-center justify-between px-3 sm:px-4 py-2"
                style={{ background: 'var(--color-surface-750)', borderBottom: '1px solid var(--color-surface-700)',
                  boxShadow: 'inset 2px 0 0 0 var(--color-brand)' }}>
                <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  {multiKey && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: 'color-mix(in srgb, var(--color-brand) 12%, var(--color-surface-600))', color: 'var(--color-brand)' }}>
                      {prog.root} {prog.scaleType === 'major' ? 'maj' : 'min'}
                    </span>
                  )}
                  <span className="font-bold text-[15px] truncate tracking-tight" style={{ color: 'var(--color-ink)' }}>{prog.name}</span>
                  <span className="text-[10px] uppercase tracking-wider hidden sm:inline" style={{ color: 'var(--color-ink-ghost)' }}>{prog.genre}</span>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
                  <span className="hidden sm:flex items-center gap-1 text-xs" style={{ color: 'var(--color-ink-ghost)' }}>
                    max <DifficultyBadge score={prog.maxScore} />
                  </span>

                  <ActionChip
                    onClick={() => toggleEasier(key)}
                    open={easierOpen} feat="var(--color-success)" icon="✋"
                    title={limitToReach ? 'Shown automatically — “limit to my reach” is on (Account settings)' : 'Suggest easier chords that fit your hand'}
                    dataExplain="The easier button suggests simpler chord shapes that fit your hand, with the same sound — so you can play this progression even with short fingers."
                  >easier{limitToReach && ' ✓'}</ActionChip>

                  <ActionChip
                    onClick={() => toggleUpper(key)}
                    open={upperOpen} feat="var(--color-violet)" icon="▲"
                    title="Play this progression higher up the neck (movable barre shapes)"
                    dataExplain="The up the neck button shows movable barre shapes for the same chords played higher on the fretboard."
                  >up the neck</ActionChip>

                  <ActionChip
                    onClick={() => toggleChanges(key)}
                    open={changesOpen} feat="var(--color-indigo)" icon="⇄"
                    title="Score how hard it is to SWITCH between each pair of chords, personalized to your hand"
                    dataExplain="The changes button scores how hard it is to switch between each pair of chords in the progression — the real difficulty of playing it, personalized to your hand."
                  >changes</ActionChip>

                  <ActionChip
                    onClick={() => toggleTriad(key)}
                    open={triadOpen} feat="var(--color-warning)" icon="♦"
                    title="Up the neck without barre chords — 3-note triad grips using the same notes"
                    dataExplain="The triads button gives small three-note shapes higher up the neck, using the same notes but with no barre — easier grips for small hands."
                  >triads</ActionChip>

                  <button
                    onClick={() => toggleSongs(key)}
                    title={songCount > 0
                      ? `${songCount} famous song${songCount === 1 ? '' : 's'} use this progression — tap to play them`
                      : 'No famous songs on record for this progression'}
                    data-explain="Shows famous songs built on this exact chord progression, with lyrics and a play-along — proof you already know songs that use it."
                    className="ui-press flex items-center gap-1.5 px-2 py-1 rounded-md font-semibold transition-all"
                    style={songCount > 0
                      ? {
                          background: songsOpen
                            ? 'linear-gradient(95deg, color-mix(in srgb, var(--color-info) 28%, transparent), color-mix(in srgb, var(--color-indigo) 22%, transparent))'
                            : 'linear-gradient(95deg, color-mix(in srgb, var(--color-info) 16%, transparent), color-mix(in srgb, var(--color-indigo) 12%, transparent))',
                          color: 'var(--color-info)',
                          border: '1px solid color-mix(in srgb, var(--color-info) 45%, transparent)',
                          boxShadow: songsOpen
                            ? '0 0 0 1px color-mix(in srgb, var(--color-info) 25%, transparent), 0 2px 10px color-mix(in srgb, var(--color-info) 18%, transparent)'
                            : '0 1px 6px color-mix(in srgb, var(--color-info) 10%, transparent)',
                        }
                      : {
                          background: 'var(--color-surface-700)',
                          color: 'var(--color-ink-ghost)',
                          border: '1px solid var(--color-surface-550)',
                          fontWeight: 500,
                        }}
                  >
                    {songCount > 0 ? (
                      <>
                        <span className="text-sm leading-none">🎵</span>
                        <span className="tabular-nums text-sm font-bold leading-none">{songCount}</span>
                        <span className="text-xs uppercase tracking-wide leading-none hidden sm:inline">
                          {songCount === 1 ? 'song' : 'songs'}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs">♪</span>
                    )}
                  </button>

                  <button
                    onClick={() => handlePlay(prog, key)}
                    // While playing, a halo breathes once per beat (72 BPM here →
                    // 60/72 s). Schedule-driven, CSS-timed; --halo tints it to the
                    // danger red so it matches the ■ Stop state.
                    className={`ui-press w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all${isPlaying ? ' pulse-glow' : ''}`}
                    style={isPlaying
                      ? { background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)',
                          '--halo': 'rgba(239,68,68,0.5)', animationDuration: `${(60 / 72).toFixed(2)}s` }
                      : { background: 'var(--color-surface-600)', color: 'var(--color-ink-subtle)' }}
                  >
                    {isPlaying ? '■' : '▶'}
                  </button>
                </div>
              </div>

              {/* Chord cells, with change-difficulty badges between them */}
              <div className="flex overflow-x-auto items-stretch" style={{ background: 'var(--color-surface-850)' }}>
                {prog.chords.map((chord, j) => {
                  const next = prog.chords[j + 1];
                  const here = chord.voicings[0];
                  const there = next?.voicings[0];
                  const transScore = here && there
                    ? transitionDifficulty(here.notes, there.notes)
                    : null;
                  return (
                    <div key={j} className="flex items-stretch">
                      <div
                        // Remount the active cell each time it becomes the sounding
                        // chord so the .chord-strum animation retriggers per beat
                        // (like .string-vibrate is re-applied per pluck). Inactive
                        // cells share a stable key, so only the active one animates.
                        key={activeChord === j ? `strum-${activeChord}` : 'idle'}
                        className={`flex-1 px-2 sm:px-3 py-2.5 duration-150${activeChord === j ? ' chord-strum' : ''}`}
                        style={{
                          minWidth: 72,
                          transition: 'background 0.15s ease, box-shadow 0.15s ease',
                          background: activeChord === j
                            // lit "now playing" cell — top-lit warm fill + inset gold
                            // left rail, well above the old barely-there 7% wash.
                            ? 'linear-gradient(180deg, var(--brand-glow-soft), transparent 80%)'
                            : 'transparent',
                          boxShadow: activeChord === j ? 'inset 2px 0 0 0 var(--color-brand)' : 'none',
                        }}
                      >
                        <div className="text-xs mb-0.5" style={{ color: 'var(--color-ink-ghost)' }}>{chord.roman}</div>
                        <div className={`font-bold text-sm mb-1.5 transition-colors${activeChord === j ? ' ui-text-glow' : ''}`}
                          style={{ color: activeChord === j ? 'var(--color-brand)' : 'var(--color-ink)' }}>
                          <a
                            href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(chord.chordName)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="hover:underline"
                            onMouseEnter={chord.voicings?.[0] ? e => showTooltip(e, chord.voicings[0]) : undefined}
                            onMouseLeave={chord.voicings?.[0] ? hideTooltip : undefined}
                          >
                            {chord.chordName}
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {chord.voicings.map((v, k) => (
                            <span key={k} className="ui-press inline-flex cursor-default rounded"
                              onMouseEnter={e => showTooltip(e, v)}
                              onMouseLeave={hideTooltip}>
                              <DifficultyBadge score={v.score} />
                            </span>
                          ))}
                        </div>
                        {here && (
                          <FingerGapBars notes={here.notes} profile={activeProfile} />
                        )}
                      </div>
                      {transScore !== null && (
                        <div style={{ borderLeft: '1px solid var(--color-surface-700)', borderRight: '1px solid var(--color-surface-700)' }}>
                          <TransitionBadge
                            fromName={chord.chordName}
                            toName={next.chordName}
                            score={transScore}
                            tr={tr}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Collapsible card panels — CollapsibleSection animates each open
                  AND closed (grid-rows 0fr↔1fr), mounting content lazily on first
                  open. Reduced motion → instant show/hide (index.css). */}
              <CollapsibleSection open={changesOpen}>
                <TransitionStrip
                  chordNames={prog.chords.map(c => c.chordName)}
                  profile={activeProfile}
                />
              </CollapsibleSection>

              <CollapsibleSection open={easierOpen}>
                <EasierChordsPanel
                  prog={prog}
                  profile={activeProfile}
                  onTooltip={showTooltip}
                  onTooltipLeave={hideTooltip}
                />
              </CollapsibleSection>

              <CollapsibleSection open={upperOpen}>
                <UpperVoicingsPanel
                  prog={prog}
                  onTooltip={showTooltip}
                  onTooltipLeave={hideTooltip}
                />
              </CollapsibleSection>

              <CollapsibleSection open={triadOpen}>
                <TriadVoicingsPanel
                  prog={prog}
                  onTooltip={showTooltip}
                  onTooltipLeave={hideTooltip}
                />
              </CollapsibleSection>

              <CollapsibleSection open={songsOpen}>
                <SongsPanel progressionName={prog.name} progDegrees={prog.degrees} progScaleType={prog.scaleType} targetRoot={prog.root} customSongs={customSongs} catalogSongs={catalogSongs} tr={tr} lang={lang} reach={reach} onSongEdited={() => setCustomSongs(loadCustomSongs())} onSongMoved={(n) => { setMoveNotice(n); try { window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); } catch {} }} />
              </CollapsibleSection>

            </div>
          );
        })}
      </div>
      </>
      )}

      {/* ── Fretboard tooltip ── */}
      {tooltip && (
        <div
          className="tip-in fixed z-50 rounded-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <div className="text-xs mb-1 text-center" style={{ color: 'var(--color-ink-faint)' }}>{tooltip.voicing.type}</div>
          <FretboardDiagram chord={tooltip.voicing} />
        </div>
      )}

    </div>
  );
}

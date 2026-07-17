// FretboardNoteMap — a "learn the neck" reference chart, and a live improv HUD.
//
// Every note from the nut to the 12th fret (a full octave — notes repeat at 12),
// laid out like a tab view: high-e on top, low-E at the bottom.
//
// This is PURE DATA derived from geometry.js/chordAnalyzer.js, so it is always
// correct and always available — no camera, no calibration, nothing to fail.
//
// The improv HUD (optional, mic-driven)
// -------------------------------------
// Turn on "Listen" and the grid lights up over whatever chord you play: solid
// gold dots for the chord's own tones (the landing notes), dimmer cyan for the
// scale you can improvise with. The fretboard itself NEVER moves — it's a static
// diagram, not an overlay on a camera image, so there is nothing to align and
// nothing to drift.
//
// Honesty about the mic
// ---------------------
// The raw detector never says "I don't know" — it always returns a best guess.
// Measured: three frequencies of pure noise score 0.750 as "Bbm7", a single open
// low-E scores a perfect 1.000 as "E5". At the shared 0.25 threshold all of that
// passes. So this screen gates on improvEngine.trustDetection() and never acts
// on a reading that isn't a real, complete, analysable chord — a HUD that lights
// up a whole scale for a chord you never played is worse than a blank one.
//
// Holding vs. clearing
// --------------------
// A chord decays, so detection drops out between strums. The display therefore
// LATCHES (improvEngine.makeChordLatch): once a chord is trusted it stays lit
// until a DIFFERENT chord is confidently heard. Silence never clears it — you
// stopped strumming, you didn't change chord — because a HUD that mirrors the
// strum envelope frame-by-frame strobes and is useless to improvise against.
//
// Strum to change, solo freely
// ----------------------------
// Only a STRUM (>=strumNotes sounding at once) replaces the held chord. While you
// improvise OVER it you play single notes, and the detector may name those as
// other chords — so single-note frames are treated as live playing that never
// swaps the scale overlay. This is what lets you solo without the board jumping.
//
// Live notes
// ----------
// The grid also lights the notes you're sounding RIGHT NOW, in real time. Audio
// gives PITCH CLASSES, not fret positions — an A is an A whether it's the open A
// string or the low-E 5th fret — so every position of a sounding note lights (a
// white ring over its base colour), not a guessed single fingering. Over the
// scale overlay this shows which scale tones you're actually hitting as you play.
//
// That is a hold, not a fabrication: the chord shown is one you really played.
// The genuine gap is the window between changing chord and the detector becoming
// confident about the new one, when the display still shows the previous chord.
// It's bounded by detection latency (about a strum), and the status dot marks a
// held chord as held rather than passing it off as heard-right-now.
//
// History: this screen used to carry a camera half that projected note labels
// onto the real fretboard, which depended on detecting the physical neck. That
// detection proved unreliable (clutter won the dominant axis, lighting moved the
// band, the board drifted while playing) and has been removed from the app. The
// grid stayed because its value never depended on the camera in the first place
// — and audio turned out to be the sensor this feature actually wanted.

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useT } from '../lib/i18n';
import { OPEN_STRING_MIDI, NOTE_NAMES } from '../lib/chordAnalyzer';
import { improvMap, trustDetection, makeChordLatch, livePitchClasses } from '../lib/improvEngine';
import ChordTip from './ChordTip';
import {
  useMic,
  loadConfig,
  detectPeaksConfigured,
  matchChordConfigured,
} from '../lib/micDetect';

const FRETS = 12;                                     // nut → 12th = one octave
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']; // 0 = low E … 5 = high e
const IS_SHARP = (pc) => NOTE_NAMES[pc].includes('#');

// Note name at (string, fret) — open-string MIDI + fret semitones.
function noteAt(string, fret) {
  return NOTE_NAMES[(OPEN_STRING_MIDI[string] + fret) % 12];
}

export default function FretboardNoteMap({ lang }) {
  const tr = useT(lang);
  const mic = useMic();
  const rafRef = useRef(null);
  const cfgRef = useRef(loadConfig());

  // The latch is what makes this usable: a chord decays, so detection drops out
  // between strums. Holding the last chord until a DIFFERENT one is confidently
  // heard means the HUD stays put while you actually improvise over it, instead
  // of strobing with the strum envelope.
  // strumNotes: only a strum (>=3 notes at once) changes the held chord; soloing
  // over it — single notes — must not be read as a chord change.
  const latchRef = useRef(makeChordLatch({ confirmFrames: 2, strumNotes: 3 }));
  // Last values pushed to React state, so the 60fps loop only calls setState when
  // something actually changed — a held chord otherwise re-dispatches identical
  // state every frame for the whole session.
  const lastPushRef = useRef({ chord: null, live: false, hint: null, liveKey: '' });

  const [listening, setListening] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [detected, setDetected] = useState(null);   // the LATCHED chord name
  const [live, setLive] = useState(false);          // is it sounding right now?
  // Pitch classes sounding RIGHT NOW (0..11), lit live on the grid at every
  // position. Audio can't give the exact fret, so we light all of a class.
  const [livePcs, setLivePcs] = useState([]);
  // Why the CURRENT input isn't being acted on, even though a chord is held.
  // Lets the UI say "the thing you're playing now isn't recognised" instead of
  // silently keeping the old chord's scales up with no explanation.
  const [inputHint, setInputHint] = useState(null);
  const [scaleId, setScaleId] = useState(null);     // which scale the user picked

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    mic.current.close();
    latchRef.current.reset();
    // Reset the change-detector too, so the next session's first real update
    // isn't suppressed by stale last-pushed values.
    lastPushRef.current = { chord: null, live: false, hint: null, liveKey: '' };
    setListening(false);
    setDetected(null);
    setLive(false);
    setLivePcs([]);
    setInputHint(null);
  }, [mic]);

  const start = useCallback(async () => {
    setPermDenied(false);
    try {
      await mic.current.open(cfgRef.current.smoothing, { raw: true });
      setListening(true);
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const rms = mic.current.getRMS();
        const fd = mic.current.getFreqData();
        if (!fd || !mic.current.audioCtx) return;
        const peaks = detectPeaksConfigured(
          fd, mic.current.audioCtx.sampleRate, mic.current.analyser.fftSize, cfgRef.current,
        );
        const hzList = peaks.map((p) => p.hz);
        const match = matchChordConfigured(hzList, cfgRef.current);
        // The notes sounding right now, as pitch classes. Drives both the
        // strum-vs-solo decision (how many) and the live grid lights (which).
        // Silence shows nothing live rather than the fading tail of a decay.
        const silent = rms < (cfgRef.current.silenceRms ?? 0.008);
        const pcs = silent ? new Set() : livePitchClasses(hzList);
        const noteCount = pcs.size;
        const verdict = trustDetection(match, { noteCount, rms });
        // The latch owns hold-vs-replace. Silence never clears the display (you
        // stopped strumming, you didn't change chord); only a STRUM of a different
        // chord (>=strumNotes) takes over — soloing single notes does not.
        const state = latchRef.current.update(verdict, match?.chord?.name ?? null, noteCount);

        // What is the CURRENT input doing, separate from what's latched? If a
        // chord is held but you're now playing something we can't act on (noise,
        // an unsupported chord), say so — otherwise the old scales just sit there
        // unexplained. Silence isn't a complaint, so it clears the hint.
        let hint = null;
        if (state.chord && !verdict.trust && verdict.reason !== 'silence') {
          hint = verdict.reason === 'unsupported chord' ? 'unsupported' : 'unclear';
        }

        // Only touch React state when something actually changed — this loop runs
        // ~60fps and a held chord would otherwise re-dispatch identical state
        // every frame for the entire session.
        const last = lastPushRef.current;
        if (state.chord !== last.chord) { setDetected(state.chord); last.chord = state.chord; }
        if (state.live !== last.live) { setLive(state.live); last.live = state.live; }
        if (hint !== last.hint) { setInputHint(hint); last.hint = hint; }
        // Live notes: push a stable, sorted array only when the set of sounding
        // classes actually changes, so we're not allocating a new array 60x/sec.
        const liveKey = [...pcs].sort((a, b) => a - b).join(',');
        if (liveKey !== last.liveKey) {
          setLivePcs(liveKey ? liveKey.split(',').map(Number) : []);
          last.liveKey = liveKey;
        }
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      if (e.name === 'NotAllowedError') setPermDenied(true);
      setListening(false);
    }
  }, [mic]);

  useEffect(() => () => stop(), [stop]);

  // The improv map for whatever we currently trust. Full neck: 0..12, matching
  // the grid below. Memoized on the chord NAME: a latched chord persists for the
  // whole session now, so without this the ~124-position map would rebuild on
  // every one of the ~60 renders/sec while you improvise.
  const map = useMemo(
    () => (detected ? improvMap(detected, { minFret: 0, maxFret: FRETS }) : null),
    [detected],
  );

  // Keep the user's scale pick only while it still applies to the chord being
  // played. Without this, picking "Blues" over an Am and then playing a C would
  // silently fall back to major pentatonic while the dropdown still read Blues —
  // or worse, stay selected across a chord it happens to also exist for.
  const activeScale = map?.scales.find((s) => s.id === scaleId) || map?.scales[0] || null;
  // Depend on the chord NAME, not `map` — map is a fresh object every render, so
  // depending on it would re-fire this effect forever.
  const validScaleIds = map ? map.scales.map((s) => s.id).join(',') : '';
  useEffect(() => {
    if (scaleId && validScaleIds && !validScaleIds.split(',').includes(scaleId)) {
      setScaleId(null);
    }
  }, [validScaleIds, scaleId]);

  // Lookup tables for the grid: "is (string,fret) a chord tone / scale note?"
  // Memoized alongside map so they're rebuilt only when the chord or the chosen
  // scale changes, not on every frame a chord is held.
  const key = (s, f) => `${s}:${f}`;
  const { toneAt, scaleAt } = useMemo(() => {
    const tone = new Map();
    const scale = new Map();
    if (map) {
      for (const t of map.tones) tone.set(key(t.string, t.fret), t);
      if (activeScale) {
        for (const p of activeScale.positions) scale.set(key(p.string, p.fret), p);
      }
    }
    return { toneAt: tone, scaleAt: scale };
  }, [map, activeScale]);

  // Pitch classes sounding right now, as a Set for O(1) per-cell lookup.
  const liveSet = useMemo(() => new Set(livePcs), [livePcs]);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">🎼</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {tr.noteMapTitle || 'Fretboard Note Map'}
          </span>
        </div>
        <button onClick={listening ? stop : start}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold"
          style={listening
            ? { background: 'var(--color-danger, #ef4444)', color: '#fff' }
            : { background: 'var(--color-brand)', color: '#0b0b0b' }}>
          {listening ? (tr.improvStop || '⏹ Stop') : (tr.improvListen || '🎤 Listen & improvise')}
        </button>
      </div>

      {/* Live improv status. Shows the LATCHED chord (deliberately held through
          its own decay until a different chord is confirmed — see makeChordLatch),
          with a dot marking whether it's sounding right now, and a hint when the
          current input isn't something we can act on. */}
      {listening && (
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)', background: 'var(--color-surface-800)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            {/* A dot that tracks the strum: lit while the chord is actually
                sounding, hollow while we're holding it through the decay. The
                board doesn't move either way — this is how the user can tell
                "heard right now" from "still showing what you played". */}
            <span className="inline-block rounded-full"
              title={live ? (tr.improvDotLive || 'Hearing it now') : (tr.improvDotHold || 'Holding your last chord')}
              style={{
                width: 8, height: 8,
                background: live ? '#34d399' : 'transparent',
                border: `2px solid ${live ? '#34d399' : 'var(--color-surface-550)'}`,
                boxShadow: live ? '0 0 8px rgba(52,211,153,0.8)' : 'none',
              }} />
            {map ? (
              <>
                {/* CLAUDE.md: every displayed chord name must show its shape on
                    hover — never plain text. */}
                <ChordTip name={map.chord.name}>
                  <span className="text-lg font-bold" style={{ color: 'var(--color-brand)' }}>
                    {map.chord.name}
                  </span>
                </ChordTip>
                <div className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                  {inputHint === 'unsupported'
                    ? (tr.improvUnsupported || 'Heard a chord I can’t map scales for yet — still showing your last')
                    : inputHint === 'unclear'
                      ? (tr.improvUnclear || 'That didn’t read as a clear chord — still showing your last')
                      : live
                        ? (tr.improvPlaying || 'Playing')
                        : (tr.improvHolding || 'Holding — play a new chord to change')}
                </div>
                {map.scales.length > 1 && (
                  <select value={activeScale?.id || ''} onChange={(e) => setScaleId(e.target.value)}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)' }}>
                    {map.scales.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                )}
              </>
            ) : (
              <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                {tr.improvSilence || 'Play a chord…'}
              </div>
            )}
          </div>
          {activeScale && (
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--color-ink-muted)' }}>
              {activeScale.why}
            </div>
          )}
        </div>
      )}

      {permDenied && (
        <div className="px-4 py-2 text-xs" style={{ color: 'var(--color-danger, #ef4444)', borderBottom: '1px solid var(--color-surface-650)' }}>
          {tr.micDenied || 'Microphone permission was blocked. Allow mic access for this site, then try again.'}
        </div>
      )}

      <div className="p-4 overflow-x-auto">
        <p className="text-sm mb-4" style={{ color: 'var(--color-ink-muted)' }}>
          {tr.noteMapIntro2 ||
            'Every note from the nut to the 12th fret. At the 12th the notes repeat — it’s the same as the open string, one octave up.'}
        </p>

        <div style={{ minWidth: '34rem' }}>
          {/* Fret-number header */}
          <div className="flex items-center mb-1">
            <div style={{ width: '2rem' }} />
            {Array.from({ length: FRETS + 1 }, (_, f) => (
              <div key={f} className="flex-1 text-center text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                {f}
              </div>
            ))}
          </div>

          {/* high-e (5) at top → low-E (0) at the bottom, like a tab view */}
          {[5, 4, 3, 2, 1, 0].map((s) => (
            <div key={s} className="flex items-center mb-1">
              <div className="text-xs font-bold text-center" style={{ width: '2rem', color: 'var(--color-ink-muted)' }}>
                {STRING_LABELS[s]}
              </div>
              {Array.from({ length: FRETS + 1 }, (_, f) => {
                const pc = (OPEN_STRING_MIDI[s] + f) % 12;
                const open = f === 0;
                const tone = toneAt.get(key(s, f));      // a chord tone: landing note
                const scaleNote = scaleAt.get(key(s, f)); // in the improv scale
                // Is this note SOUNDING right now? (every position of the class —
                // audio can't say which one you actually fretted).
                const nowPlaying = liveSet.has(pc);
                // Chord tones win: they're the notes that resolve.
                const lit = tone || scaleNote;
                let style;
                if (tone) {
                  style = {
                    background: 'var(--color-brand, #e9c46a)',
                    color: '#3a2708',
                    border: '1px solid #f0cf7a',
                    boxShadow: '0 0 10px rgba(233,196,106,0.5)',
                  };
                } else if (scaleNote) {
                  style = {
                    background: 'rgba(56,189,248,0.18)',
                    color: '#7dd3fc',
                    border: '1px solid rgba(56,189,248,0.45)',
                  };
                } else {
                  style = {
                    background: open
                      ? 'var(--color-surface-650)'
                      : IS_SHARP(pc) ? 'var(--color-surface-800)' : 'var(--color-surface-700)',
                    // Dim the non-scale notes while a chord is lit, so the shape
                    // you can actually play reads at a glance.
                    color: map
                      ? 'var(--color-ink-faint)'
                      : IS_SHARP(pc) ? 'var(--color-ink-faint)' : 'var(--color-ink)',
                    border: '1px solid var(--color-surface-650)',
                    opacity: map ? 0.35 : 1,
                  };
                }
                // Live overlay: a bright white ring + full opacity ON TOP of the
                // base colour, so a sounding note reads as "playing now" without
                // losing whether it's a chord tone or a scale note underneath.
                if (nowPlaying) {
                  style = {
                    ...style,
                    opacity: 1,
                    border: '2px solid #fff',
                    boxShadow: '0 0 12px 2px rgba(255,255,255,0.7)',
                  };
                }
                return (
                  <div key={f} className="flex-1 px-0.5">
                    <div className="text-center rounded text-[11px] font-semibold py-1"
                      style={style}
                      title={lit ? `${noteAt(s, f)} — ${lit.degree}${tone ? ' (chord tone)' : ''}` : noteAt(s, f)}>
                      {noteAt(s, f)}
                      {tone && (
                        <span className="ml-0.5 text-[8px] font-bold" style={{ opacity: 0.7 }}>
                          {tone.degree}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {map ? (
          <div className="flex items-center gap-4 mt-3 text-[11px] flex-wrap" style={{ color: 'var(--color-ink-faint)' }}>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded" style={{ background: 'var(--color-brand)' }} />
              {tr.improvLegendTone || 'Chord tone — lands, sounds resolved'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded"
                style={{ background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)' }} />
              {tr.improvLegendScale || 'Scale note — safe to pass through'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded"
                style={{ background: 'var(--color-surface-700)', border: '2px solid #fff', boxShadow: '0 0 6px rgba(255,255,255,0.7)' }} />
              {tr.improvLegendLive || 'Playing now (all positions of that note)'}
            </span>
          </div>
        ) : (
          <p className="text-[11px] mt-3" style={{ color: 'var(--color-ink-faint)' }}>
            {tr.noteMapLegend2 ||
              'Fret 0 = the open string. Naturals are bright, sharps/flats dimmed.'}
          </p>
        )}
      </div>
    </div>
  );
}

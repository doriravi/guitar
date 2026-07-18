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
import {
  improvMap, improvMapManual, diatonicChords, trustDetection, makeChordLatch,
  makeOnsetDetector, livePitchClasses, SCALE_LABELS,
} from '../lib/improvEngine';
import ChordTip from './ChordTip';
import {
  useMic,
  loadConfig,
  detectPeaksConfigured,
  matchChordConfigured,
} from '../lib/micDetect';
import ScaleQuest from './ScaleQuest';

const FRETS = 12;                                     // nut → 12th = one octave
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']; // 0 = low E … 5 = high e
const IS_SHARP = (pc) => NOTE_NAMES[pc].includes('#');

// Note name at (string, fret) — open-string MIDI + fret semitones.
function noteAt(string, fret) {
  return NOTE_NAMES[(OPEN_STRING_MIDI[string] + fret) % 12];
}

// ─── Realistic SVG neck ───────────────────────────────────────────────────────
// Draws the note map as an actual guitar fingerboard (wood + fret wires + nut +
// strings + inlay dots), matching the Fretboard Measures visual language, instead
// of a grid of cells. It is a PURE RENDERER: it consumes the same lookup maps the
// old grid did (toneAt / scaleAt / arpAt keyed "s:f", liveSet of pitch classes)
// so all the improv/scale/arpeggio logic is untouched — only the pixels changed.
//
// Layout: high-e (string 5) on top → low-E (0) on the bottom (tab convention).
// Fret 0 is the "open" column drawn just left of the nut; frets 1..FRETS follow.
const NECK = {
  padL: 22,     // room for the open-string letter labels
  padR: 8,
  padT: 16,     // room for the fret numbers on top
  padB: 6,
  fretW: 46,    // horizontal px per fret cell
  stringGap: 30, // vertical px between strings
  dotR: 12,     // note dot radius
};
const STRING_GAUGE = [3.0, 2.6, 2.2, 1.8, 1.5, 1.2]; // low-E thickest → high-e thin
const INLAY_FRETS = new Set([3, 5, 7, 9]);           // single dots
const DOUBLE_INLAY = 12;                              // twin dots at the octave

// Colour a note dot exactly as the old cells did (arpeggio > tone > scale > base;
// playing-now = white ring; dimmed when a chord is lit). Returns SVG props.
function dotStyle({ arpNote, tone, scaleNote, open, isSharp, chordLit, nowPlaying }) {
  let fill, stroke, textFill, glow = null, strokeW = 1, opacity = 1;
  if (arpNote) {
    fill = 'rgba(217,70,239,0.9)'; stroke = arpNote.isRoot ? '#fff' : '#f0abfc';
    textFill = '#fff'; glow = 'rgba(217,70,239,0.7)';
  } else if (tone) {
    fill = 'var(--color-brand, #e9c46a)'; stroke = '#f0cf7a';
    textFill = '#3a2708'; glow = 'rgba(233,196,106,0.6)';
  } else if (scaleNote) {
    fill = 'rgba(56,189,248,0.22)'; stroke = 'rgba(56,189,248,0.6)'; textFill = '#7dd3fc';
  } else {
    // Base note pip: naturals brighter than sharps; sits on the wood.
    fill = open ? 'rgba(201,169,110,0.20)' : 'rgba(20,14,6,0.55)';
    stroke = 'rgba(201,169,110,0.35)';
    textFill = isSharp ? 'rgba(233,225,205,0.5)' : 'rgba(233,225,205,0.9)';
    opacity = chordLit ? 0.3 : 1;
  }
  if (nowPlaying) { stroke = '#fff'; strokeW = 2.5; glow = 'rgba(255,255,255,0.85)'; opacity = 1; }
  return { fill, stroke, textFill, glow, strokeW, opacity };
}

function SvgNeck({ frets, toneAt, scaleAt, arpAt, liveSet, chordLit, map, degreeTitle }) {
  const rows = [5, 4, 3, 2, 1, 0]; // high-e top → low-E bottom
  const n = frets.length;          // FRETS + 1 columns (0..FRETS)
  const W = NECK.padL + NECK.padR + n * NECK.fretW;
  const H = NECK.padT + NECK.padB + rows.length * NECK.stringGap;
  // x for the CENTRE of a fret column c (0 = open, 1 = 1st fret, …)
  const colX = (c) => NECK.padL + c * NECK.fretW + NECK.fretW / 2;
  // x of the fret WIRE to the left of column c (nut sits left of col 1)
  const wireX = (c) => NECK.padL + c * NECK.fretW;
  const rowY = (i) => NECK.padT + i * NECK.stringGap + NECK.stringGap / 2;
  const boardX = wireX(1);                       // fingerboard starts at the nut
  const boardW = W - NECK.padR - boardX;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }}
      role="img" aria-label="Guitar fretboard note map">
      <defs>
        <linearGradient id="nm-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2817" />
          <stop offset="1" stopColor="#241809" />
        </linearGradient>
      </defs>

      {/* fingerboard */}
      <rect x={boardX} y={NECK.padT} width={boardW} height={rows.length * NECK.stringGap}
        rx="4" fill="url(#nm-wood)" stroke="#5a4326" strokeWidth="1" />

      {/* fret numbers (top) */}
      {frets.map((f) => (
        <text key={`fn${f}`} x={colX(f)} y={NECK.padT - 5} fontSize="10"
          textAnchor="middle" fill="var(--color-ink-faint)">{f}</text>
      ))}

      {/* inlay position dots (behind strings) */}
      {frets.filter((f) => INLAY_FRETS.has(f) || f === DOUBLE_INLAY).map((f) => {
        const midY = NECK.padT + (rows.length * NECK.stringGap) / 2;
        return f === DOUBLE_INLAY ? (
          <g key={`in${f}`} fill="#c9a96e" opacity="0.5">
            <circle cx={colX(f)} cy={midY - NECK.stringGap} r="4" />
            <circle cx={colX(f)} cy={midY + NECK.stringGap} r="4" />
          </g>
        ) : (
          <circle key={`in${f}`} cx={colX(f)} cy={midY} r="4" fill="#c9a96e" opacity="0.45" />
        );
      })}

      {/* fret wires (nut is the bright, thick one at col 1's left edge) */}
      {frets.map((f) => {
        if (f === 0) return null;                 // no wire left of the open column
        const isNut = f === 1;
        const x = wireX(f);
        return (
          <line key={`w${f}`} x1={x} y1={NECK.padT} x2={x} y2={NECK.padT + rows.length * NECK.stringGap}
            stroke={isNut ? '#e8dcc8' : '#9a9a9a'} strokeWidth={isNut ? 3 : 1.2}
            strokeLinecap="round" />
        );
      })}

      {/* strings (thicker for the low strings) */}
      {rows.map((s, i) => (
        <line key={`s${s}`} x1={boardX} y1={rowY(i)} x2={W - NECK.padR} y2={rowY(i)}
          stroke="#d8d2c4" strokeWidth={STRING_GAUGE[s]} strokeLinecap="round" opacity="0.8" />
      ))}

      {/* open-string letter labels (left gutter) */}
      {rows.map((s, i) => (
        <text key={`sl${s}`} x={NECK.padL - 8} y={rowY(i) + 3.5} fontSize="11"
          fontWeight="700" textAnchor="end" fill="var(--color-ink-muted)">
          {STRING_LABELS[s]}
        </text>
      ))}

      {/* note dots */}
      {rows.map((s, i) => frets.map((f) => {
        const k = `${s}:${f}`;
        const pc = (OPEN_STRING_MIDI[s] + f) % 12;
        const tone = toneAt.get(k);
        const scaleNote = scaleAt.get(k);
        const arpNote = arpAt.get(k);
        const nowPlaying = liveSet.has(pc);
        const lit = arpNote || tone || scaleNote;
        // Hide plain base pips entirely while a chord is lit? No — dim them, same
        // as the old grid, so the neck still reads as a neck.
        const st = dotStyle({
          arpNote, tone, scaleNote,
          open: f === 0, isSharp: IS_SHARP(pc), chordLit: !!map, nowPlaying,
        });
        const cx = colX(f), cy = rowY(i);
        return (
          <g key={k} opacity={st.opacity}>
            {st.glow && (
              <circle cx={cx} cy={cy} r={NECK.dotR + 2} fill={st.glow} opacity="0.5" />
            )}
            <circle cx={cx} cy={cy} r={NECK.dotR} fill={st.fill}
              stroke={st.stroke} strokeWidth={st.strokeW}>
              <title>{degreeTitle(s, f, lit, arpNote, tone)}</title>
            </circle>
            <text x={cx} y={cy + 3.5} fontSize="10" fontWeight="600"
              textAnchor="middle" fill={st.textFill} style={{ pointerEvents: 'none' }}>
              {noteAt(s, f)}
            </text>
            {(arpNote || tone) && (
              <text x={cx + NECK.dotR - 2} y={cy - NECK.dotR + 5} fontSize="7"
                fontWeight="700" textAnchor="middle" fill={st.textFill}
                opacity="0.8" style={{ pointerEvents: 'none' }}>
                {(arpNote || tone).degree}
              </text>
            )}
          </g>
        );
      }))}
    </svg>
  );
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
  // Only a STRUM (a sharp attack/onset) changes the held chord — a chord you fret
  // and let RING produces no onset, so it can't swap the display. The onset
  // detector reads the RMS envelope; the latch only accepts a change inside the
  // short window an onset opens.
  const latchRef = useRef(makeChordLatch({ confirmFrames: 2 }));
  const onsetRef = useRef(makeOnsetDetector());
  // Last values pushed to React state, so the 60fps loop only calls setState when
  // something actually changed — a held chord otherwise re-dispatches identical
  // state every frame for the whole session.
  const lastPushRef = useRef({ chord: null, live: false, hint: null, liveKey: '' });

  // When true, the tab hands its whole surface to the Scale Quest game (a scoring
  // game with a count-in, lives, and results is a different attention mode than
  // the free improv HUD, so it takes over rather than crowding a panel).
  const [playing, setPlaying] = useState(false);
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
  const [scaleId, setScaleId] = useState(null);     // which AUTO scale the user picked
  // Manual override: pick a key + scale to solo in, independent of detection.
  // { root, scaleId } locks the overlay to that scale; null = follow the mic.
  // Works before AND during play.
  const [manual, setManual] = useState(null);
  // Which diatonic chord's arpeggio to overlay on the filtered scale (by degree
  // index into diatonicChords), or null for scale-only. Reset when the scale
  // changes so we never overlay a chord that isn't in the new scale.
  const [arpDegree, setArpDegree] = useState(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    mic.current.close();
    latchRef.current.reset();
    onsetRef.current.reset();
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
        // Onset first — a strum's attack. Feed raw rms every frame so the envelope
        // tracks continuously; it returns true only on an actual attack.
        const strummed = onsetRef.current.push(rms);
        const verdict = trustDetection(match, { noteCount, rms });
        // The latch owns hold-vs-replace. Silence never clears the display (you
        // stopped strumming, you didn't change chord); only a chord change that
        // lands right after a STRUM (an onset) takes over — a ringing/sustained
        // chord produces no onset, so it can't swap.
        const state = latchRef.current.update(verdict, match?.chord?.name ?? null, strummed);

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

  // The diatonic chords of the filtered scale — the arpeggios the user can
  // overlay. Empty unless a scale filter is active.
  const scaleChords = useMemo(
    () => (manual ? diatonicChords(manual.root, manual.scaleId) : []),
    [manual],
  );

  // The improv map. A MANUAL pick (key + scale) overrides detection entirely and
  // stays locked; otherwise we follow the latched chord from the mic. When a
  // diatonic chord is chosen, its arpeggio rides along as a separate overlay.
  // Full neck 0..12, memoized so the ~124-position map isn't rebuilt every render.
  const arpChord = manual && arpDegree != null
    ? scaleChords.find((c) => c.degree === arpDegree) || null
    : null;
  const map = useMemo(() => {
    if (manual) return improvMapManual(manual.root, manual.scaleId, { minFret: 0, maxFret: FRETS, arpeggio: arpChord });
    return detected ? improvMap(detected, { minFret: 0, maxFret: FRETS }) : null;
  }, [manual, detected, arpChord]);

  // Which scale is drawn. In manual mode the map has exactly one scale (the pick).
  // In auto mode: the scale the user chose from the chord's options, else the
  // first (safe) one. Keep the user's pick only while it still applies (below).
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
  const { toneAt, scaleAt, arpAt } = useMemo(() => {
    const tone = new Map();
    const scale = new Map();
    const arp = new Map();
    if (map) {
      for (const t of map.tones) tone.set(key(t.string, t.fret), t);
      if (activeScale) {
        for (const p of activeScale.positions) scale.set(key(p.string, p.fret), p);
      }
      if (map.arpeggio) {
        for (const p of map.arpeggio.positions) arp.set(key(p.string, p.fret), p);
      }
    }
    return { toneAt: tone, scaleAt: scale, arpAt: arp };
  }, [map, activeScale]);

  // Drop the arpeggio pick whenever the scale (or key) changes — a chord from
  // the old scale may not exist in the new one.
  const scaleKey = manual ? `${manual.root}:${manual.scaleId}` : '';
  useEffect(() => { setArpDegree(null); }, [scaleKey]);

  // Pitch classes sounding right now, as a Set for O(1) per-cell lookup.
  const liveSet = useMemo(() => new Set(livePcs), [livePcs]);

  // The game takes over the whole surface. (The improv mic is stopped before we
  // get here — see the "Play Scale Quest" button — so only one mic is ever open.)
  if (playing) {
    return <ScaleQuest lang={lang} onClose={() => setPlaying(false)} />;
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">🎼</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            {tr.noteMapTitle || 'Fretboard Note Map'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { if (listening) stop(); setPlaying(true); }}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ border: '1px solid var(--color-brand)', color: 'var(--color-brand)' }}>
            {tr.sqPlay || '🎯 Play Scale Quest'}
          </button>
        <button onClick={listening ? stop : start}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold"
          style={listening
            ? { background: 'var(--color-danger, #ef4444)', color: '#fff' }
            : { background: 'var(--color-brand)', color: '#0b0b0b' }}>
          {listening ? (tr.improvStop || '⏹ Stop') : (tr.improvListen || '🎤 Listen & improvise')}
        </button>
        </div>
      </div>

      {/* Scale filter — a standalone reference control on the note chart. Pick a
          key + scale and the grid highlights just those notes (root in gold, the
          rest of the scale in cyan) and dims everything else. Works with the mic
          OFF — a "learn this scale on the neck" tool. When the mic IS on, this
          same pick also locks the improv overlay to your chosen scale instead of
          following the detected chord; clearing it hands that back to the mic.
          (State is `manual`: mic-off it's a plain filter, mic-on it's a manual
          override — one control, both jobs.) */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-2"
        style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <span className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
          🔎 {tr.scaleFilter || 'Scale filter'}
        </span>
        <select
          value={manual ? manual.root : ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') { setManual(null); return; }
            // Default to natural minor, not a pentatonic: pentatonics have no
            // diatonic triads, so defaulting there would hide the arpeggio picker
            // the moment you choose a key.
            setManual((m) => ({ root: Number(v), scaleId: m?.scaleId || 'naturalMinor' }));
          }}
          className="text-xs px-2 py-1 rounded-lg"
          style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)' }}>
          <option value="">{tr.scaleFilterOff || 'Off (show all notes)'}</option>
          {NOTE_NAMES.map((n, pc) => (
            <option key={pc} value={pc}>{n}</option>
          ))}
        </select>
        {manual && (
          <select
            value={manual.scaleId}
            onChange={(e) => setManual((m) => ({ ...m, scaleId: e.target.value }))}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)' }}>
            {Object.entries(SCALE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        )}
        {/* Arpeggio-by-chord: pick a chord built from the filtered scale and its
            arpeggio (root/3rd/5th) lights in magenta over the scale. Always shown
            while a scale is active — when the scale has no diatonic triads
            (pentatonics), we say so rather than silently hiding the control. */}
        {manual && (
          <>
            <span className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              🎵 {tr.arpChord || 'Arpeggio'}
            </span>
            {scaleChords.length > 0 ? (
              <select
                value={arpDegree ?? ''}
                onChange={(e) => setArpDegree(e.target.value === '' ? null : Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg"
                style={{ background: 'var(--color-surface-700)', color: 'var(--color-ink)', border: '1px solid var(--color-surface-550)' }}>
                <option value="">{tr.arpNone || 'None'}</option>
                {scaleChords.map((c) => (
                  <option key={c.degree} value={c.degree}>{c.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs italic" style={{ color: 'var(--color-ink-faint)' }}>
                {tr.arpNoneInScale || 'no chords in a pentatonic — try a 7-note scale'}
              </span>
            )}
          </>
        )}
        {manual && (
          <button onClick={() => setManual(null)}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
            {tr.scaleFilterClear || '✕ Clear'}
          </button>
        )}
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
                {manual ? (
                  // Manual mode: this is a SCALE name, not a chord — no ChordTip
                  // (there's no chord shape to show for "A Minor pentatonic").
                  <span className="text-lg font-bold" style={{ color: 'var(--color-brand)' }}>
                    {map.chord.name}
                  </span>
                ) : (
                  // CLAUDE.md: every displayed chord name must show its shape on
                  // hover — never plain text.
                  <ChordTip name={map.chord.name}>
                    <span className="text-lg font-bold" style={{ color: 'var(--color-brand)' }}>
                      {map.chord.name}
                    </span>
                  </ChordTip>
                )}
                <div className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                  {manual
                    ? (tr.improvManualLocked || 'Manual — locked to your scale')
                    : inputHint === 'unsupported'
                      ? (tr.improvUnsupported || 'Heard a chord I can’t map scales for yet — still showing your last')
                      : inputHint === 'unclear'
                        ? (tr.improvUnclear || 'That didn’t read as a clear chord — still showing your last')
                        : live
                          ? (tr.improvPlaying || 'Playing')
                          : (tr.improvHolding || 'Holding — play a new chord to change')}
                </div>
                {!manual && map.scales.length > 1 && (
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
          {manual
            ? (tr.noteMapFiltered || 'Showing')
              + ` ${map?.chord?.name || ''} — `
              + (tr.noteMapFilteredHint || 'scale notes are highlighted, the rest dimmed.')
            : (tr.noteMapIntro2 ||
              'Every note from the nut to the 12th fret. At the 12th the notes repeat — it’s the same as the open string, one octave up.')}
        </p>

        {/* Realistic SVG neck — same data (chord tones / scale / arpeggio /
            playing-now), drawn as an actual fretboard instead of a cell grid. */}
        <SvgNeck
          frets={Array.from({ length: FRETS + 1 }, (_, f) => f)}
          toneAt={toneAt}
          scaleAt={scaleAt}
          arpAt={arpAt}
          liveSet={liveSet}
          map={map}
          degreeTitle={(s, f, lit, arpNote, tone) =>
            lit
              ? `${noteAt(s, f)} — ${lit.degree}${arpNote ? ` (${map.arpeggio.name} arpeggio)` : tone ? ' (chord tone)' : ''}`
              : noteAt(s, f)}
        />

        {map ? (
          <div className="flex items-center gap-4 mt-3 text-[11px] flex-wrap" style={{ color: 'var(--color-ink-faint)' }}>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded" style={{ background: 'var(--color-brand)' }} />
              {/* In pure filter mode the gold dots are the scale's ROOT, not a
                  chord tone — label accordingly so the legend stays truthful. */}
              {manual && !listening
                ? (tr.filterLegendRoot || 'Root — the note the scale is named after')
                : (tr.improvLegendTone || 'Chord tone — lands, sounds resolved')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded"
                style={{ background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.45)' }} />
              {manual && !listening
                ? (tr.filterLegendScale || 'In the scale')
                : (tr.improvLegendScale || 'Scale note — safe to pass through')}
            </span>
            {/* The chord arpeggio overlay, when one is chosen. */}
            {map.arpeggio && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded"
                  style={{ background: 'rgba(217,70,239,0.85)', border: '1px solid #f0abfc' }} />
                {(tr.arpLegend || 'arpeggio').replace('{chord}', map.arpeggio.name)}
              </span>
            )}
            {/* "Playing now" only means something when the mic is on. */}
            {listening && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded"
                  style={{ background: 'var(--color-surface-700)', border: '2px solid #fff', boxShadow: '0 0 6px rgba(255,255,255,0.7)' }} />
                {tr.improvLegendLive || 'Playing now (all positions of that note)'}
              </span>
            )}
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

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
// passes. So this screen gates on improvEngine.trustDetection() and shows
// NOTHING when the signal isn't a real, complete, analysable chord — a HUD that
// lights up a whole scale for a chord you never played is worse than a blank one.
//
// History: this screen used to carry a camera half that projected note labels
// onto the real fretboard, which depended on detecting the physical neck. That
// detection proved unreliable (clutter won the dominant axis, lighting moved the
// band, the board drifted while playing) and has been removed from the app. The
// grid stayed because its value never depended on the camera in the first place
// — and audio turned out to be the sensor this feature actually wanted.

import { useState, useRef, useCallback, useEffect } from 'react';
import { useT } from '../lib/i18n';
import { OPEN_STRING_MIDI, NOTE_NAMES } from '../lib/chordAnalyzer';
import { improvMap, trustDetection } from '../lib/improvEngine';
import {
  useMic,
  loadConfig,
  detectPeaksConfigured,
  matchChordConfigured,
} from '../lib/micDetect';
import { hzToMidi } from '../lib/pitchDetect';

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

  const [listening, setListening] = useState(false);
  const [permDenied, setPermDenied] = useState(false);
  const [detected, setDetected] = useState(null);   // trusted chord name, or null
  const [why, setWhy] = useState(null);             // why we're not showing one
  const [scaleId, setScaleId] = useState(null);     // which scale the user picked

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    mic.current.close();
    setListening(false);
    setDetected(null);
    setWhy(null);
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
        // Distinct pitch classes — a triad needs 3; fewer means we're hearing a
        // string or two, not a chord (the case a raw score of 1.000 can't catch).
        const noteCount = new Set(
          hzList.map((hz) => ((Math.round(hzToMidi(hz)) % 12) + 12) % 12),
        ).size;
        const verdict = trustDetection(match, { noteCount, rms });
        if (verdict.trust) {
          setDetected(match.chord.name);
          setWhy(null);
        } else {
          // Deliberately clear the chord rather than holding the last one: a
          // stale scale lit over a chord you've already left is a lie that looks
          // exactly like a correct reading.
          setDetected(null);
          setWhy(verdict.reason);
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
  // the grid below.
  const map = detected ? improvMap(detected, { minFret: 0, maxFret: FRETS }) : null;

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
  const toneAt = new Map();
  const scaleAt = new Map();
  const key = (s, f) => `${s}:${f}`;
  if (map) {
    for (const t of map.tones) toneAt.set(key(t.string, t.fret), t);
    if (activeScale) {
      for (const p of activeScale.positions) scaleAt.set(key(p.string, p.fret), p);
    }
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
        <button onClick={listening ? stop : start}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold"
          style={listening
            ? { background: 'var(--color-danger, #ef4444)', color: '#fff' }
            : { background: 'var(--color-brand)', color: '#0b0b0b' }}>
          {listening ? (tr.improvStop || '⏹ Stop') : (tr.improvListen || '🎤 Listen & improvise')}
        </button>
      </div>

      {/* Live improv status. Shows what we HEARD, or plainly says we're not
          confident — never a stale chord and never a guess. */}
      {listening && (
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)', background: 'var(--color-surface-800)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
              {map ? (tr.improvPlaying || 'Playing') : (tr.improvWaiting || 'Listening')}
            </div>
            {map ? (
              <>
                <div className="text-lg font-bold" style={{ color: 'var(--color-brand)' }}>
                  {map.chord.name}
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
                {why === 'silence' ? (tr.improvSilence || 'Play a chord…')
                  : why === 'not enough notes' ? (tr.improvFewNotes || 'Strum the whole chord')
                  : why === 'unsupported chord' ? (tr.improvUnsupported || 'Heard a chord I can’t map scales for yet')
                  : (tr.improvUnclear || 'Not a clear chord yet')}
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

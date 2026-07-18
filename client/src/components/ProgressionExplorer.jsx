import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ROOT_NOTES, getDiatonicChords } from '../lib/scales';
import { MAJOR_PROGRESSIONS, MINOR_PROGRESSIONS } from '../lib/progressions';
import { fingerGapUsage, GAP_REF_MAX, transitionDifficulty, scoreTransition } from '../lib/fretboard';
import { DEFAULT_PROFILE, gapStrain } from '../lib/handProfile';
import { suggestEasierProgression } from '../lib/substitutions';
import { suggestUpperProgression } from '../lib/upperVoicings';
import { suggestTriadProgression } from '../lib/triadVoicings';
import { alignChordsToLyrics, suggestCapo, enrichChords } from '../lib/lyricChords';
import { lyrics as lyricsApi } from '../lib/api';
import { playProgression, stopAudio } from '../lib/audio';
import { SONGS_BY_PROGRESSION, songBpm } from '../lib/songs';
import { loadCustomSongs, addCustomSong, updateCustomSong, songToText } from '../lib/customSongs';
import { loadCatalogSongs } from '../lib/catalogSongs';
import { parseChordSheet } from '../lib/chordSheetParser';
import { lookupVoicings } from '../lib/voicingLookup';
import { resolveChordCells } from '../lib/songTimeline';
import { filterSongsByReach } from '../lib/songReach';
import { filterSongsByLevel } from '../lib/levelFilter';
import { currentLevelCeiling, loadManual } from '../lib/levelPlan';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';
import ChordTip from './ChordTip';
import SongEditor from './SongEditor';
import SoloTabView from './SoloTabView';
import SongAutoTab from './SongAutoTab';
import { buildSimplifiedAutoTab } from '../lib/autoTab';
import { useT } from '../lib/i18n';
import { useHandProfile, useAIFingers, useReachLimit, useLevelLimit } from '../App';

// Shared empty degree set for song-search results (no progression context, so no
// out-of-progression chord flagging). Module-scoped so its identity is stable.
const EMPTY_DEGREE_SET = new Set();

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
        const barColor = over ? 'var(--color-danger)' : p.userFraction > 0.9 ? 'var(--color-warning)' : p.userFraction > 0.7 ? '#eab308' : 'var(--color-success)';
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

// ─── Transition badge (difficulty of switching between two chords) ─────────────

function transitionColor(score) {
  if (score <= 3) return 'var(--color-success)';
  if (score <= 6) return '#eab308';
  if (score <= 8) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function TransitionBadge({ fromName, toName, score, tr }) {
  return (
    <div
      className="flex flex-col items-center justify-center shrink-0 px-1 self-stretch select-none"
      title={`${tr.changeLabel || 'Change'} ${fromName} → ${toName}: ${score.toFixed(1)}/10`}
    >
      <span className="text-[10px] leading-none" style={{ color: 'var(--color-ink-ghost)' }}>→</span>
      <span className="text-[10px] font-bold tabular-nums leading-tight mt-0.5"
        style={{ color: transitionColor(score) }}>
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
    <div className="px-3 sm:px-4 py-3"
      style={{ borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
      <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-ink-ghost)' }}>
        Chord-change difficulty
      </div>

      <div className="flex flex-wrap items-center gap-y-2 font-mono">
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
        <div className="text-[11px] mt-2" style={{ color: 'var(--color-ink-faint)' }}>
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
          className="flex items-center gap-2 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all"
          style={playing
            ? { background: 'rgba(239,68,68,0.14)', color: 'var(--color-danger)' }
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

// ─── Lyrics fetch ────────────────────────────────────────────────────────────

function LyricsSection({ song, title, artist, bpm, lineChords, customLyricLines, tabBlocks, progChordsWithVoicings }) {
  // Imported songs carry their own pasted lyrics+chords → render those directly,
  // no fetch. Otherwise fetch the real lyrics from a public lyrics database.
  const isCustom = Array.isArray(customLyricLines) && customLyricLines.length > 0;
  const soloProfile = useHandProfile();
  const [status, setStatus] = useState(isCustom ? 'done' : 'loading');
  const [lyrics, setLyrics]  = useState('');
  const [active, setActive] = useState(null); // { lineIdx, segIdx } currently sounding
  const [simplified, setSimplified] = useState(false); // "Simplify all" — eases chords in tab + lyrics

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
  // Custom (pasted) songs display exactly as saved — no capo relabeling. The
  // capo "easy shapes" suggestion is only for the app's own derived songs.
  const capo = useMemo(
    () => (isCustom ? null : suggestCapo(progChordsWithVoicings.map(c => c.chordName))),
    [progChordsWithVoicings, isCustom],
  );

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
    const easyShape = easyName ? lookupVoicings(easyName)[0] : null;
    if (!easyShape) return base; // no easy shape on file → fall back to real voicing
    // Shift the easy shape up by the capo fret so it sounds at the original
    // pitch — a capo presses ALL strings, so open (0) strings move to the capo
    // fret and fretted notes move up by the same amount. The synth reads .tab,
    // so emit a tab; capo (1–5) + easy open shapes keep every fret single-digit.
    const shiftedTab = easyShape.tab.split('').map(ch => {
      if (ch === 'x') return 'x';                 // muted stays muted
      const f = Math.min(9, parseInt(ch, 10) + capo.fret); // 0 (open) → capo fret too
      return String(f);
    }).join('');
    return { ...easyShape, name: easyName, tab: shiftedTab };
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
          const voicing = playVoicing(progChordsWithVoicings[seg.chordIndex]);
          if (voicing) seq.push({ voicing, lineIdx, segIdx });
        });
      });
      if (seq.length) return seq;
    }
    return progChordsWithVoicings
      .map((c, i) => ({ voicing: playVoicing(c), lineIdx: -1, segIdx: i }))
      .filter(s => s.voicing);
  }, [annotatedLines, progChordsWithVoicings, playVoicing]);

  return (
    <div className="px-3 sm:px-4 py-3 font-mono text-xs"
      style={{ borderTop: '1px solid var(--color-surface-750)', background: 'var(--color-surface-base)' }}>

      {/* Song controls row — play + one "Simplify all" toggle that eases every
          chord across BOTH the auto-tab AND the lyrics view below, in place. */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <SongPlayer sequence={playSequence} bpm={bpm} onActive={setActive} />
        {song && (
          <button
            onClick={() => setSimplified(v => !v)}
            className="text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all shrink-0"
            style={simplified
              ? { background: 'rgba(74,222,128,0.15)', color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.35)' }
              : { background: 'var(--color-surface-700)', color: 'var(--color-ink-subtle)', border: '1px solid var(--color-surface-550)' }}
            title="Rewrite every chord as the easiest shape for your hand — updates the tab and the lyrics chords"
          >
            {simplified ? '✓ Simplified' : '✨ Simplify all'}
          </button>
        )}
      </div>

      {/* Auto tab — the WHOLE song as ONE tab staff generated from its chords;
          "Simplify all" swaps it (and the lyrics) to the eased chords in place. */}
      {song && <SongAutoTab song={song} simplified={simplified} profile={soloProfile} />}

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
      <div className="max-h-72 overflow-y-auto">

      {/* Capo banner — easy open shapes for a hard-key song */}
      {capo && (
        <div className="mb-3 px-2.5 py-1.5 rounded-lg text-[11px] leading-snug"
          style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', color: 'var(--color-success)' }}>
          <span className="font-semibold">Capo {capo.fret}</span>
          <span style={{ color: '#3a7a3a' }}> — play easy open shapes: </span>
          {Object.entries(capo.map).map(([orig, easy], k) => (
            <span key={orig}>
              {k > 0 && <span style={{ color: '#2f5f2f' }}>, </span>}
              <span style={{ color: 'var(--color-ink-faint)' }}>{orig}</span>
              <span style={{ color: '#3a7a3a' }}>→</span>
              <span className="font-semibold">{easy}</span>
            </span>
          ))}
        </div>
      )}

      {annotatedLines.map((line, i) => {
        if (line.blank) return <div key={i} className="mt-2" />;
        return (
          <div key={i}
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
                  <span style={{ color: isActive ? '#b8a88a' : (line.problem ? '#facc15' : 'var(--color-ink-subtle)') }}>{seg.text}</span>
                </span>
              );
            })}
            {line.problem && (
              <span className="ml-1 text-[10px] font-semibold self-center" style={{ color: '#facc15' }}>
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

function SongRow({ song, progDegreeSet, tr, customSongs = [], currentProgName, onEdited, onMoved }) {
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
        <div className="min-w-0 flex-1">
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
        </div>
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
              ? { background: 'rgba(99,102,241,0.12)', color: 'var(--color-accent)' }
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
            style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--color-accent)' }}
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
                <ul className="mt-1.5 list-disc list-inside" style={{ color: '#facc15' }}>
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
      {lyricsOpen && <LyricsSection song={song} title={song.title} artist={song.artist} bpm={song.bpm ?? songBpm(song.title)} lineChords={song.lineChords} customLyricLines={song.lyricLines} tabBlocks={song.tabBlocks} progChordsWithVoicings={songChordsWithVoicings} />}
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

function SongsPanel({ progressionName, progDegrees, progScaleType, targetRoot, customSongs, catalogSongs, tr, reach, onSongEdited, onSongMoved }) {
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
          <SongRow key={song.id || i} song={song} progDegreeSet={progDegreeSet} tr={tr} customSongs={customSongs} currentProgName={progressionName} onEdited={onSongEdited} onMoved={onSongMoved} />
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
    <div style={{ borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
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
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#152015', color: '#6a9a6a' }}>
                {SUB_KIND_LABEL[sub.substitute.kind]}
              </span>
              <span className="text-[9px] tabular-nums" style={{ color: '#3a7a3a' }}>
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
    <div style={{ borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: '#c084fc' }}>
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
              style={{ background: 'rgba(192,132,252,0.05)', border: '1px solid rgba(192,132,252,0.18)' }}>
              <span
                className="text-xs font-mono font-bold cursor-default"
                style={{ color: '#c084fc' }}
                onMouseEnter={e => onTooltip(e, v)}
                onMouseLeave={onTooltipLeave}
              >{chord.chordName}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#1d1726', color: '#9a7ab8' }}>
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
    <div style={{ borderTop: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
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
              ? { background: 'rgba(99,102,241,0.15)', color: 'var(--color-accent)', border: '1px solid rgba(99,102,241,0.3)' }
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
                  customSongs={customSongs}
                  currentProgName={song.__progName}
                  onEdited={() => setCustomSongs(loadCustomSongs())}
                  onMoved={(n) => { setMoveNotice(n); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* noop */ } }}
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

              {/* Card header */}
              <div className="flex items-center justify-between px-3 sm:px-4 py-2"
                style={{ background: 'var(--color-surface-750)', borderBottom: '1px solid var(--color-surface-700)' }}>
                <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  {multiKey && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: 'var(--color-surface-600)', color: 'var(--color-ink-subtle)' }}>
                      {prog.root} {prog.scaleType === 'major' ? 'maj' : 'min'}
                    </span>
                  )}
                  <span className="font-semibold text-sm truncate" style={{ color: 'var(--color-ink)' }}>{prog.name}</span>
                  <span className="text-xs hidden sm:inline" style={{ color: 'var(--color-ink-ghost)' }}>{prog.genre}</span>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
                  <span className="hidden sm:flex items-center gap-1 text-xs" style={{ color: 'var(--color-ink-ghost)' }}>
                    max <DifficultyBadge score={prog.maxScore} />
                  </span>

                  <button
                    onClick={() => toggleEasier(key)}
                    title={limitToReach ? 'Shown automatically — “limit to my reach” is on (Account settings)' : 'Suggest easier chords that fit your hand'}
                    data-explain="The easier button suggests simpler chord shapes that fit your hand, with the same sound — so you can play this progression even with short fingers."
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={easierOpen
                      ? { background: 'rgba(74,222,128,0.14)', color: 'var(--color-success)' }
                      : { background: 'var(--color-surface-600)', color: 'var(--color-ink-faint)' }}
                  >
                    ✋ easier{limitToReach && ' ✓'}
                  </button>

                  <button
                    onClick={() => toggleUpper(key)}
                    title="Play this progression higher up the neck (movable barre shapes)"
                    data-explain="The up the neck button shows movable barre shapes for the same chords played higher on the fretboard."
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={upperOpen
                      ? { background: 'rgba(192,132,252,0.14)', color: '#c084fc' }
                      : { background: 'var(--color-surface-600)', color: 'var(--color-ink-faint)' }}
                  >
                    ▲ up the neck
                  </button>

                  <button
                    onClick={() => toggleChanges(key)}
                    title="Score how hard it is to SWITCH between each pair of chords, personalized to your hand"
                    data-explain="The changes button scores how hard it is to switch between each pair of chords in the progression — the real difficulty of playing it, personalized to your hand."
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={changesOpen
                      ? { background: 'rgba(99,102,241,0.14)', color: 'var(--color-accent)' }
                      : { background: 'var(--color-surface-600)', color: 'var(--color-ink-faint)' }}
                  >
                    ⇄ changes
                  </button>

                  <button
                    onClick={() => toggleTriad(key)}
                    title="Up the neck without barre chords — 3-note triad grips using the same notes"
                    data-explain="The triads button gives small three-note shapes higher up the neck, using the same notes but with no barre — easier grips for small hands."
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={triadOpen
                      ? { background: 'rgba(251,191,36,0.14)', color: 'var(--color-warning)' }
                      : { background: 'var(--color-surface-600)', color: 'var(--color-ink-faint)' }}
                  >
                    ♦ triads
                  </button>

                  <button
                    onClick={() => toggleSongs(key)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={songsOpen
                      ? { background: 'rgba(56,189,248,0.12)', color: 'var(--color-info)' }
                      : { background: 'var(--color-surface-600)', color: 'var(--color-ink-faint)' }}
                  >
                    ♪{songCount > 0 ? ` ${songCount}` : ''}
                  </button>

                  <button
                    onClick={() => handlePlay(prog, key)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all"
                    style={isPlaying
                      ? { background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)' }
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
                        className="flex-1 px-2 sm:px-3 py-2.5 transition-colors duration-100"
                        style={{
                          minWidth: 72,
                          background: activeChord === j ? 'rgba(201,169,110,0.07)' : 'transparent',
                        }}
                      >
                        <div className="text-xs mb-0.5" style={{ color: 'var(--color-ink-ghost)' }}>{chord.roman}</div>
                        <div className="font-bold text-sm mb-1.5 transition-colors"
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
                            <span key={k} className="cursor-default"
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

              {/* Chord-change difficulty strip (collapsible) — per-transition
                  scores across the whole progression, personalized to the hand. */}
              {changesOpen && (
                <TransitionStrip
                  chordNames={prog.chords.map(c => c.chordName)}
                  profile={activeProfile}
                />
              )}

              {/* Easier-alternatives panel (collapsible) */}
              {easierOpen && (
                <EasierChordsPanel
                  prog={prog}
                  profile={activeProfile}
                  onTooltip={showTooltip}
                  onTooltipLeave={hideTooltip}
                />
              )}

              {/* Up-the-neck voicings panel (collapsible) */}
              {upperOpen && (
                <UpperVoicingsPanel
                  prog={prog}
                  onTooltip={showTooltip}
                  onTooltipLeave={hideTooltip}
                />
              )}

              {/* Up-the-neck triads panel — no barre (collapsible) */}
              {triadOpen && (
                <TriadVoicingsPanel
                  prog={prog}
                  onTooltip={showTooltip}
                  onTooltipLeave={hideTooltip}
                />
              )}

              {/* Songs panel (collapsible) */}
              {songsOpen && <SongsPanel progressionName={prog.name} progDegrees={prog.degrees} progScaleType={prog.scaleType} targetRoot={prog.root} customSongs={customSongs} catalogSongs={catalogSongs} tr={tr} reach={reach} onSongEdited={() => setCustomSongs(loadCustomSongs())} onSongMoved={(n) => { setMoveNotice(n); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }} />}

            </div>
          );
        })}
      </div>
      </>
      )}

      {/* ── Fretboard tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-50 rounded-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <div className="text-xs mb-1 text-center" style={{ color: 'var(--color-ink-faint)' }}>{tooltip.voicing.type}</div>
          <FretboardDiagram chord={tooltip.voicing} />
        </div>
      )}

    </div>
  );
}

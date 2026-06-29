import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ROOT_NOTES, getDiatonicChords } from '../lib/scales';
import { MAJOR_PROGRESSIONS, MINOR_PROGRESSIONS } from '../lib/progressions';
import { CHORDS } from '../lib/chords';
import { calcDifficulty, fingerGapUsage, GAP_REF_MAX, transitionDifficulty } from '../lib/fretboard';
import { DEFAULT_PROFILE } from '../lib/handProfile';
import { suggestEasierProgression } from '../lib/substitutions';
import { suggestUpperProgression } from '../lib/upperVoicings';
import { suggestTriadProgression } from '../lib/triadVoicings';
import { alignChordsToLyrics, suggestCapo, enrichChords } from '../lib/lyricChords';
import { lyrics as lyricsApi } from '../lib/api';
import { playProgression, stopAudio } from '../lib/audio';
import { SONGS_BY_PROGRESSION, songBpm } from '../lib/songs';
import { loadCustomSongs, addCustomSong, updateCustomSong, songToText } from '../lib/customSongs';
import { parseChordSheet } from '../lib/chordSheetParser';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';
import { useT } from '../lib/i18n';
import { useHandProfile, useAIFingers } from '../App';

const ENHARMONIC = {
  'C#': 'Db', Db: 'C#', 'D#': 'Eb', Eb: 'D#',
  'F#': 'Gb', Gb: 'F#', 'G#': 'Ab', Ab: 'G#',
  'A#': 'Bb', Bb: 'A#',
};

const CHORD_MAP = (() => {
  const map = new Map();
  for (const chord of CHORDS) {
    const score = calcDifficulty(chord.notes);
    if (!map.has(chord.name)) map.set(chord.name, []);
    map.get(chord.name).push({ ...chord, score });
  }
  return map;
})();

function lookupVoicings(chordName) {
  const exact = CHORD_MAP.get(chordName);
  if (exact?.length) return exact;
  const m = chordName.match(/^([A-G][#b]?)(.*)$/);
  if (m) {
    const alt = ENHARMONIC[m[1]];
    if (alt) return CHORD_MAP.get(alt + m[2]) || [];
  }
  return [];
}

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
  { key: 'thumbToIndex',  label: 'T→I', color: '#a78bfa' },
  { key: 'indexToMiddle', label: 'I→M', color: '#60a5fa' },
  { key: 'middleToRing',  label: 'M→R', color: '#34d399' },
  { key: 'ringToLittle',  label: 'R→P', color: '#f97316' },
];

function FingerGapBars({ notes, profile }) {
  const usage = fingerGapUsage(notes);
  if (!usage) return null;

  const pairs = PAIR_META.map(p => {
    const rawFraction = usage[p.key];
    const refMax = GAP_REF_MAX[p.key];
    const requiredCm = rawFraction * refMax;
    const userCm = profile[p.key];
    const userFraction = userCm > 0 ? requiredCm / userCm : requiredCm > 0 ? 2 : 0;
    return { ...p, rawFraction, userFraction, requiredCm, userCm };
  }).filter(p => p.rawFraction > 0.05);

  if (pairs.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 mt-1.5">
      {pairs.map(p => {
        const over = p.userFraction > 1;
        const barColor = over ? '#ef4444' : p.userFraction > 0.9 ? '#f97316' : p.userFraction > 0.7 ? '#eab308' : '#22c55e';
        const tip = `${p.label}: needs ~${p.requiredCm.toFixed(1)} cm — your span ${p.userCm.toFixed(1)} cm (${Math.round(p.userFraction * 100)}%)`;
        return (
          <div key={p.key} className="flex items-center gap-1" title={tip}>
            <span className="text-[8px] w-5 shrink-0" style={{ color: p.color }}>{p.label}</span>
            <div className="relative h-1 rounded-full overflow-hidden" style={{ width: 36, background: '#2a2a2a' }}>
              <div className="absolute left-0 top-0 h-full rounded-full"
                style={{ width: `${Math.min(1, p.userFraction) * 100}%`, background: barColor }} />
            </div>
            <span className="text-[8px] tabular-nums" style={{ color: over ? '#ef4444' : '#555' }}>
              {p.requiredCm.toFixed(1)}<span style={{ color: '#333' }}>/{p.userCm.toFixed(1)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Transition badge (difficulty of switching between two chords) ─────────────

function transitionColor(score) {
  if (score <= 3) return '#22c55e';
  if (score <= 6) return '#eab308';
  if (score <= 8) return '#f97316';
  return '#ef4444';
}

function TransitionBadge({ fromName, toName, score, tr }) {
  return (
    <div
      className="flex flex-col items-center justify-center shrink-0 px-1 self-stretch select-none"
      title={`${tr.changeLabel || 'Change'} ${fromName} → ${toName}: ${score.toFixed(1)}/10`}
    >
      <span className="text-[10px] leading-none" style={{ color: '#3a3a3a' }}>→</span>
      <span className="text-[10px] font-bold tabular-nums leading-tight mt-0.5"
        style={{ color: transitionColor(score) }}>
        {score.toFixed(1)}
      </span>
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
    <div className="mb-3" style={{ borderBottom: '1px solid #1a1a1a', paddingBottom: 10 }}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={playing ? stop : start}
          className="flex items-center gap-2 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all"
          style={playing
            ? { background: 'rgba(239,68,68,0.14)', color: '#f87171' }
            : { background: 'rgba(74,222,128,0.10)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
        >
          <span className="text-sm leading-none">{playing ? '■' : '▶'}</span>
          {playing ? 'Stop' : 'Play the song'}
        </button>
        <span className="text-[10px]" style={{ color: '#3a3a3a' }}>
          synth · {tempo} BPM · plays the chords through the lyrics · loops
        </span>
      </div>
    </div>
  );
}

// ─── Lyrics fetch ────────────────────────────────────────────────────────────

function LyricsSection({ title, artist, bpm, lineChords, customLyricLines, progChordsWithVoicings }) {
  // Imported songs carry their own pasted lyrics+chords → render those directly,
  // no fetch. Otherwise fetch the real lyrics from a public lyrics database.
  const isCustom = Array.isArray(customLyricLines) && customLyricLines.length > 0;
  const [status, setStatus] = useState(isCustom ? 'done' : 'loading');
  const [lyrics, setLyrics]  = useState('');
  const [tooltip, setTooltip] = useState(null);
  const [active, setActive] = useState(null); // { lineIdx, segIdx } currently sounding

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

  // Build a printable chord-over-lyrics sheet for THIS song and hand it to the
  // browser's print engine ("Save as PDF"). We can only auto-download our OWN
  // sheet — the Ultimate Guitar tab is a cross-origin page the browser forbids
  // us from scripting, so its Download-PDF button can't be clicked from here.
  const downloadPdf = useCallback(() => {
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const lines = (annotatedLines || []).map(line => {
      if (line.blank) return '<div class="blank">&nbsp;</div>';
      const cells = (line.segments || []).map(seg => {
        const name = progChordsWithVoicings[seg.chordIndex]?.chordName || '';
        return `<span class="cell"><span class="chord">${esc(name)}</span><span class="lyric">${esc(seg.text) || '&nbsp;'}</span></span>`;
      }).join('');
      return `<div class="line">${cells}</div>`;
    }).join('\n');
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${esc(artist)}</title>
<style>
  body{font-family:'Courier New',monospace;color:#111;margin:32px;}
  h1{font-size:20px;margin:0 0 2px;} .meta{color:#555;font-size:12px;margin:0 0 20px;}
  .line{display:flex;flex-wrap:wrap;margin-bottom:8px;}
  .blank{height:10px;}
  .cell{display:inline-flex;flex-direction:column;margin-right:14px;}
  .chord{font-weight:bold;color:#0b66c3;font-size:13px;line-height:1.1;}
  .lyric{font-size:13px;line-height:1.2;white-space:pre;}
  @media print{@page{margin:14mm;}}
</style></head><body>
  <h1>${esc(title)}</h1>
  <p class="meta">${esc(artist)}${bpm ? ` · ${esc(bpm)} BPM` : ''}</p>
  ${lines}
  <script>window.onload=function(){window.focus();window.print();}<\/script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) return; // pop-up blocked → nothing to do
    w.document.open();
    w.document.write(doc);
    w.document.close();
  }, [annotatedLines, progChordsWithVoicings, title, artist, bpm]);

  return (
    <div className="px-3 sm:px-4 py-3 font-mono text-xs"
      style={{ borderTop: '1px solid #1a1a1a', background: '#0f0f0f' }}>

      {/* Compare the app's inferred chords against a real, human-made chord sheet.
          DuckDuckGo's "!ducky" jumps straight to the top Ultimate Guitar chord
          sheet for this song — no API key, no backend. Clicking ALSO downloads a
          PDF of this app's own chord sheet (we can't script UG's own button). */}
      <div className="mb-2 flex items-center gap-3 flex-wrap">
        <a
          href={`https://duckduckgo.com/?q=${encodeURIComponent(`\\ ${title} ${artist} chords site:ultimate-guitar.com`)}`}
          target="_blank" rel="noopener noreferrer"
          onClick={downloadPdf}
          className="text-[11px] font-semibold px-2 py-1 rounded hover:underline"
          style={{ color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.08)' }}
        >Compare real chords ↗</a>
        <span className="text-[10px]" style={{ color: '#3a3a3a' }}>
          opens the chord sheet to compare, and downloads a PDF of ours
        </span>
      </div>

      {/* Synth song player — plays the chords through the whole lyrics in order */}
      <SongPlayer sequence={playSequence} bpm={bpm} onActive={setActive} />

      {status === 'loading' && (
        <div className="py-1 text-xs italic" style={{ color: '#3a3a3a' }}>Loading lyrics…</div>
      )}
      {status === 'error' && (
        <div className="py-1 text-xs italic" style={{ color: '#3a3a3a' }}>
          Lyrics service is unavailable right now. Try again later.
        </div>
      )}
      {status === 'empty' && (
        <div className="py-1 text-xs italic" style={{ color: '#3a3a3a' }}>No lyrics found for this song.</div>
      )}

      {status === 'done' && (
      <div className="max-h-72 overflow-y-auto">

      {/* Capo banner — easy open shapes for a hard-key song */}
      {capo && (
        <div className="mb-3 px-2.5 py-1.5 rounded-lg text-[11px] leading-snug"
          style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80' }}>
          <span className="font-semibold">Capo {capo.fret}</span>
          <span style={{ color: '#3a7a3a' }}> — play easy open shapes: </span>
          {Object.entries(capo.map).map(([orig, easy], k) => (
            <span key={orig}>
              {k > 0 && <span style={{ color: '#2f5f2f' }}>, </span>}
              <span style={{ color: '#5a5a5a' }}>{orig}</span>
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
              const v = chord?.voicings?.[0];
              const inProg = chord?.inProgression !== false;
              const isActive = active && active.lineIdx === i && active.segIdx === j;
              // Show BOTH: the real (sounding) chord, and — when a capo makes it
              // easier — the easy shape you actually fret, e.g. "Bb→A".
              const real = chord?.chordName;
              const easy = capo ? (capo.map[real] || real) : null;
              const hasEasy = easy && easy !== real;
              return (
                <span key={j}
                  className="inline-flex flex-col rounded transition-colors"
                  style={isActive ? { background: 'rgba(201,169,110,0.18)', padding: '0 3px' } : undefined}>
                  <span
                    className="font-bold cursor-default select-none"
                    style={{ color: isActive ? '#c9a96e' : (inProg ? '#818cf8' : '#f87171') }}
                    title={hasEasy ? `${real} (sounding) — fret the ${easy} shape with capo ${capo.fret}` : real}
                    onMouseEnter={v ? e => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const tipW = 148;
                      setTooltip({
                        voicing: v,
                        x: r.right + 8 + tipW > window.innerWidth ? r.left - tipW - 6 : r.right + 8,
                        y: r.top - 10,
                      });
                    } : undefined}
                    onMouseLeave={v ? () => setTooltip(null) : undefined}
                  >
                    {real}{hasEasy && <span style={{ color: '#4ade80', fontWeight: 600 }}>→{easy}</span>}
                  </span>
                  <span style={{ color: isActive ? '#b8a88a' : (line.problem ? '#facc15' : '#6a6a6a') }}>{seg.text}</span>
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
      {tooltip && (
        <div
          className="fixed z-50 rounded-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, background: '#1e1e1e', border: '1px solid #2a2a2a', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <div className="text-xs mb-1 text-center" style={{ color: '#5a5a5a' }}>{tooltip.voicing.type}</div>
          <FretboardDiagram chord={tooltip.voicing} />
        </div>
      )}
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

  // The Play button walks the WHOLE song — every chord in the order it appears
  // across the lyric lines — not just the bare progression. For a custom song
  // that's its saved lyricLines; otherwise the song's chord sequence repeated
  // once through. Each chord resolves to its easiest voicing.
  const songPlaySequence = useMemo(() => {
    const byName = new Map(songChordsWithVoicings.map(c => [c.chordName, c.voicings[0]]));
    if (song.lyricLines && song.lyricLines.length) {
      const seq = [];
      for (const ln of song.lyricLines) {
        for (const name of (ln.chordNames || [])) {
          const v = byName.get(name) || lookupVoicings(name)[0];
          if (v) seq.push(v);
        }
      }
      if (seq.length) return seq;
    }
    return songChordsWithVoicings.map(c => c.voicings[0]).filter(Boolean);
  }, [song.lyricLines, songChordsWithVoicings]);

  return (
    <div style={{ borderBottom: '1px solid #1a1a1a' }}>
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 pt-2 pb-1">
        <div className="min-w-0 flex-1">
          <a
            href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(song.title + ' ' + song.artist)}`}
            target="_blank" rel="noopener noreferrer"
            className="font-semibold text-sm hover:underline"
            style={{ color: '#d0cdc8' }}
          >{song.title}</a>
          <span className="text-sm" style={{ color: '#5a5a5a' }}> — {song.artist}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs px-1.5 py-0.5 rounded font-medium hidden sm:inline"
            style={{ background: 'rgba(56,189,248,0.1)', color: '#38bdf8' }}>
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
              ? { background: 'rgba(239,68,68,0.15)', color: '#f87171' }
              : { background: '#252525', color: '#7a7a7a' }}
            title="Play the whole song"
          >
            {isPlaying ? '■' : '▶'}
          </button>
          <button
            onClick={() => setLyricsOpen(v => !v)}
            className="text-xs px-2 py-0.5 rounded font-medium transition-all"
            style={lyricsOpen
              ? { background: 'rgba(99,102,241,0.12)', color: '#818cf8' }
              : { background: '#1e1e1e', color: '#5a5a5a' }}
          >
            {lyricsOpen ? tr.hide : tr.lyrics}
          </button>
          <button
            onClick={() => (editing ? setEditing(false) : openEditor())}
            className="text-xs px-2 py-0.5 rounded font-medium transition-all"
            style={editing
              ? { background: 'rgba(201,169,110,0.15)', color: '#c9a96e' }
              : { background: '#1e1e1e', color: '#5a5a5a' }}
            title={isCustom ? 'Edit this saved song and save it back' : 'Edit this song — saves an editable copy to your songs'}
          >
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-0 overflow-x-auto pb-1" style={{ borderTop: '1px solid #1a1a1a' }}>
        {stripChords.map((c, j) => (
          <div key={j} className="px-2 sm:px-3 py-1" style={{ minWidth: 48 }}>
            <a
              href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(c.chordName)}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs font-mono font-semibold hover:underline"
              style={{ color: c.inProgression ? '#7a7a7a' : '#f87171' }}
            >
              {c.chordName}
            </a>
          </div>
        ))}
      </div>
      {editing && (
        <div className="px-3 sm:px-4 py-3" style={{ borderTop: '1px solid #1a1a1a', background: '#0f0f0f' }}>
          <div className="text-[11px] mb-1.5" style={{ color: '#5a5a5a' }}>
            Edit the chord sheet — chord line above each lyric line.{' '}
            {isCustom
              ? 'Saves back to this song.'
              : existingCopy
                ? 'Updates your saved copy of this song.'
                : 'Saves an editable copy to your songs.'}
            {' '}Use <span style={{ color: '#c9a96e' }}>Check</span> to preview before saving.
          </div>
          <textarea
            value={editText}
            onChange={e => { setEditText(e.target.value); setPreview(null); }}
            spellCheck={false}
            className="w-full font-mono text-xs rounded p-2"
            rows={12}
            style={{ background: '#161616', color: '#cfcfcf', border: '1px solid #2a2a2a', resize: 'vertical' }}
          />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button
              onClick={pasteRealChords}
              className="text-xs px-3 py-1 rounded font-semibold"
              style={{ background: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)' }}
              title="Paste a chord sheet copied from the Ultimate Guitar tab — junk is filtered out, then Save to overwrite this song"
            >Paste real chords</button>
            <button
              onClick={checkEdit}
              className="text-xs px-3 py-1 rounded font-semibold"
              style={{ background: 'rgba(201,169,110,0.15)', color: '#c9a96e', border: '1px solid rgba(201,169,110,0.3)' }}
            >Check</button>
            <button
              onClick={saveEdit}
              className="text-xs px-3 py-1 rounded font-semibold"
              style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}
            >Save</button>
            <button
              onClick={() => { setEditing(false); setPreview(null); }}
              className="text-xs px-3 py-1 rounded font-medium"
              style={{ background: '#1e1e1e', color: '#5a5a5a' }}
            >Cancel</button>
            {editMsg && <span className="text-[11px]" style={{ color: '#4ade80' }}>{editMsg}</span>}
          </div>

          {/* Preview of the parsed result, shown by "Check" before you Save. */}
          {preview && (
            <div className="mt-3 rounded p-2.5 text-[11px]"
              style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
              <div className="font-semibold mb-1.5" style={{ color: '#c9a96e' }}>
                Preview — this is what will be saved
              </div>
              <div style={{ color: '#9a9a9a' }}>
                <span style={{ color: '#d0cdc8' }}>{preview.parsed.title || '(no title)'}</span>
                <span style={{ color: '#5a5a5a' }}> — {preview.parsed.artist || '(no artist)'}</span>
              </div>
              <div className="mt-0.5" style={{ color: '#7a7a7a' }}>
                Key {keyLabelFor(preview.parsed)} · {preview.parsed.bpm ? `${preview.parsed.bpm} bpm · ` : ''}
                {(preview.parsed.chords || []).length} chord{(preview.parsed.chords || []).length === 1 ? '' : 's'} · {(preview.parsed.lyricLines || []).length} line{(preview.parsed.lyricLines || []).length === 1 ? '' : 's'}
              </div>
              {(preview.parsed.chords || []).length > 0 && (
                <div className="mt-1 font-mono" style={{ color: '#818cf8' }}>
                  {(preview.parsed.chords || []).join('  ')}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <ul className="mt-1.5 list-disc list-inside" style={{ color: '#facc15' }}>
                  {preview.warnings.map((w, k) => <li key={k}>{w}</li>)}
                </ul>
              )}
              <div className="mt-2 max-h-40 overflow-y-auto font-mono leading-snug"
                style={{ color: '#8a8a8a' }}>
                {(preview.parsed.lyricLines || []).map((ln, k) => (
                  <div key={k}>
                    {(ln.chordNames || []).length > 0 && (
                      <span style={{ color: '#818cf8' }}>[{(ln.chordNames || []).join(' ')}] </span>
                    )}
                    <span>{ln.text || (ln.chordNames?.length ? '' : '·')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {lyricsOpen && <LyricsSection title={song.title} artist={song.artist} bpm={song.bpm ?? songBpm(song.title)} lineChords={song.lineChords} customLyricLines={song.lyricLines} progChordsWithVoicings={songChordsWithVoicings} />}
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
function chordPc(name) {
  const m = (name || '').match(/^([A-G][#b]?)/);
  return m ? KEY_PC[m[1]] : null;
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
function matchingSongs(progName, progDegrees, progScaleType, targetRoot, customSongs = []) {
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
    const diatonic = getDiatonicChords(keyForProg, progScaleType);
    const progChordNames = progDegrees.map(d => diatonic[d]?.chordName).filter(Boolean);
    return chordsContainProgression(song.chords, progChordNames);
  };
  const custom = customSongs.filter(fitsCustom);
  // A custom (user-saved/edited) song with the same name supersedes the built-in,
  // so the same title never shows twice.
  const customTitles = new Set(custom.map(s => (s.title || '').trim().toLowerCase()));
  const builtIn = (SONGS_BY_PROGRESSION[progName] || [])
    .filter(fitsBuiltIn)
    .filter(s => !customTitles.has((s.title || '').trim().toLowerCase()));
  return [...custom, ...builtIn];
}

function SongsPanel({ progressionName, progDegrees, progScaleType, targetRoot, customSongs, tr, onSongEdited, onSongMoved }) {
  // Set of degree indices that belong to this progression — used to flag "outside" chords in red
  const progDegreeSet = useMemo(() => new Set(progDegrees), [progDegrees]);

  const songs = matchingSongs(progressionName, progDegrees, progScaleType, targetRoot, customSongs).slice(0, 10);

  if (!songs.length) {
    const keyed = targetRoot && targetRoot !== 'all';
    return (
      <div className="px-4 py-3 text-sm italic" style={{ color: '#3a3a3a', borderTop: '1px solid #1e1e1e', background: '#111' }}>
        {keyed
          ? `No famous songs on record for this progression in the key of ${targetRoot}. Try another key, or "All roots".`
          : 'No song examples on record for this progression.'}
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid #1e1e1e', background: '#111' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: '#3a3a3a' }}>
        {tr.famousSongs}
      </div>
      <div style={{ borderTop: '1px solid #1a1a1a' }}>
        {songs.map((song, i) => (
          <SongRow key={song.id || i} song={song} progDegreeSet={progDegreeSet} tr={tr} customSongs={customSongs} currentProgName={progressionName} onEdited={onSongEdited} onMoved={onSongMoved} />
        ))}
      </div>
    </div>
  );
}

// ─── Hand filter helpers ──────────────────────────────────────────────────────

const FINGER_COLORS = { thumb: '#a78bfa', index: '#38bdf8', middle: '#34d399', ring: '#c9a96e', pinky: '#f87171' };
const FINGER_LABELS = { thumb: 'T', index: 'I', middle: 'M', ring: 'R', pinky: 'P' };

const LENGTH_ORDER  = { Short: 0, Medium: 1, Long: 2 };
const FLEX_ORDER    = { Low: 0, Medium: 1, High: 2 };
const REACH_ORDER   = { Weak: 0, Moderate: 1, Strong: 2 };
const STRAIGHT_ORDER = { Curved: 0, Straight: 1 };
const INDEP_ORDER   = { Low: 0, Medium: 1, High: 2 };

// ─── Hand Filters Panel ───────────────────────────────────────────────────────

function HandFiltersPanel({ profile, aiFingers, handFilters, setHandFilters, onSaveProfile, onGapsChange }) {
  const GAPS = [
    { key: 'thumbToIndex',  label: 'Thumb → Index',  range: [0, 18],  step: 0.5, color: '#a78bfa' },
    { key: 'indexToMiddle', label: 'Index → Middle', range: [0, 12],  step: 0.5, color: '#38bdf8' },
    { key: 'middleToRing',  label: 'Middle → Ring',  range: [0, 10],  step: 0.5, color: '#34d399' },
    { key: 'ringToLittle',  label: 'Ring → Pinky',   range: [0, 14],  step: 0.5, color: '#c9a96e' },
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
          : { background: '#1a1a1a', color: '#7a7a7a', border: '1px solid #2a2a2a' }}
      >{label}</button>
    );
  }

  return (
    <div className="rounded-xl p-4 mb-4 space-y-4" style={{ background: '#111', border: '1px solid #1e1e1e' }}>
      <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: '#5a5a5a' }}>My Hand Filters</p>

      {/* Gap sliders — editable, saves to profile */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold" style={{ color: '#3a3a3a' }}>Finger Gap Measurements</p>
          <button
            onClick={handleSave}
            className="text-xs px-3 py-1 rounded-lg font-semibold transition-all"
            style={saved
              ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }
              : { background: '#c9a96e', color: '#0f0f0f' }}
          >
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
        <div className="space-y-2">
          {GAPS.map(({ key, label, range, step, color }) => {
            const val = localGaps[key];
            const pct = ((val - range[0]) / (range[1] - range[0])) * 100;
            return (
              <div key={key} className="rounded-lg px-3 py-2" style={{ background: '#0a0a0a', border: `1px solid ${color}18` }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px]" style={{ color: '#4a4a4a' }}>{label}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color }}>{val.toFixed(1)} cm</span>
                </div>
                <input
                  type="range" min={range[0]} max={range[1]} step={step} value={val}
                  onChange={e => handleGapChange(key, parseFloat(e.target.value))}
                  className="w-full"
                  style={{ background: `linear-gradient(to right, ${color} ${pct}%, #2a2a2a ${pct}%)`, color }}
                />
                <div className="flex justify-between text-[9px] mt-0.5" style={{ color: '#2a2a2a' }}>
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
          <p className="text-xs font-semibold mb-2" style={{ color: '#7a7a7a' }}>Finger Attributes (from AI Analysis)</p>
          <div className="space-y-2">
            {['thumb', 'index', 'middle', 'ring', 'pinky'].map(name => {
              const f = fingers[name];
              if (!f) return null;
              const color = FINGER_COLORS[name];
              return (
                <div key={name} className="flex items-start gap-3 rounded-lg px-3 py-2" style={{ background: '#0a0a0a', border: `1px solid ${color}15` }}>
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
                      {f.length && <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: '#1e1e1e', color: '#8a8a8a', border: '1px solid #2a2a2a' }}>{f.length}</span>}
                    </div>
                    {f.note && <p className="text-[10px] mt-1.5" style={{ color: '#7a7a7a' }}>{f.note}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', color: '#7a7a7a' }}>
          Per-finger data not yet available. Use <strong style={{ color: '#818cf8' }}>AI Hand Analysis</strong> on the My Hand tab to unlock finger-level filters.
        </div>
      )}

      {/* Clear filters */}
      {Object.keys(handFilters).length > 0 && (
        <button
          onClick={() => setHandFilters({})}
          className="text-xs px-3 py-1 rounded-lg"
          style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.05)' }}
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
      <div className="px-4 py-3 text-xs italic" style={{ color: '#3a3a3a', borderTop: '1px solid #1e1e1e', background: '#111' }}>
        No easier alternatives found — these shapes are already a good fit for your hand.
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid #1e1e1e', background: '#111' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: '#4ade80' }}>
        Easier alternatives for your hand
      </div>
      <div className="px-3 sm:px-4 pb-3 flex flex-wrap gap-2">
        {prog.chords.map((chord, j) => {
          const sub = perChord[j];
          if (!sub) {
            return (
              <div key={j} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: '#0a0a0a', border: '1px solid #161616' }}>
                <span className="text-xs font-mono font-semibold" style={{ color: '#5a5a5a' }}>{chord.chordName}</span>
                <span className="text-[10px]" style={{ color: '#2f2f2f' }}>ok as-is</span>
              </div>
            );
          }
          const v = sub.substitute.voicing;
          return (
            <div key={j} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.18)' }}>
              <div className="flex items-center gap-1">
                <span className="text-xs font-mono line-through" style={{ color: '#5a5a5a' }}>{chord.chordName}</span>
                <span className="text-[11px]" style={{ color: '#4ade80' }}>→</span>
                <span
                  className="text-xs font-mono font-bold cursor-default"
                  style={{ color: '#4ade80' }}
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
      <p className="px-3 sm:px-4 pb-3 text-[10px] leading-relaxed" style={{ color: '#3a3a3a' }}>
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
      <div className="px-4 py-3 text-xs italic" style={{ color: '#3a3a3a', borderTop: '1px solid #1e1e1e', background: '#111' }}>
        No movable up-the-neck voicings available for these chords.
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid #1e1e1e', background: '#111' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: '#c084fc' }}>
        Play it higher up the neck
      </div>
      <div className="px-3 sm:px-4 pb-3 flex flex-wrap gap-2">
        {prog.chords.map((chord, j) => {
          const up = perChord[j];
          if (!up) {
            return (
              <div key={j} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: '#0a0a0a', border: '1px solid #161616' }}>
                <span className="text-xs font-mono font-semibold" style={{ color: '#5a5a5a' }}>{chord.chordName}</span>
                <span className="text-[10px]" style={{ color: '#2f2f2f' }}>—</span>
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
              <span className="text-[10px] font-mono" style={{ color: '#5a5a5a' }}>{v.tab}</span>
            </div>
          );
        })}
      </div>
      <p className="px-3 sm:px-4 pb-3 text-[10px] leading-relaxed" style={{ color: '#3a3a3a' }}>
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
      <div className="px-4 py-3 text-xs italic" style={{ color: '#3a3a3a', borderTop: '1px solid #1e1e1e', background: '#111' }}>
        No up-the-neck triad voicings available for these chords.
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid #1e1e1e', background: '#111' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: '#fbbf24' }}>
        Up the neck — triads (no barre)
      </div>
      <div className="px-3 sm:px-4 pb-3 flex flex-wrap gap-2">
        {prog.chords.map((chord, j) => {
          const t = perChord[j];
          if (!t) {
            return (
              <div key={j} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: '#0a0a0a', border: '1px solid #161616' }}>
                <span className="text-xs font-mono font-semibold" style={{ color: '#5a5a5a' }}>{chord.chordName}</span>
                <span className="text-[10px]" style={{ color: '#2f2f2f' }}>—</span>
              </div>
            );
          }
          const v = t.voicing;
          return (
            <div key={j} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.18)' }}>
              <span
                className="text-xs font-mono font-bold cursor-default"
                style={{ color: '#fbbf24' }}
                onMouseEnter={e => onTooltip(e, v)}
                onMouseLeave={onTooltipLeave}
              >{chord.chordName}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#241f10', color: '#b89a4a' }}>
                triad · fret {t.baseFret}
              </span>
              <span className="text-[10px] font-mono" style={{ color: '#5a5a5a' }}>{v.tab}</span>
            </div>
          );
        })}
      </div>
      <p className="px-3 sm:px-4 pb-3 text-[10px] leading-relaxed" style={{ color: '#3a3a3a' }}>
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
  // User-imported songs (localStorage) folded into the song matching, so a song
  // you import shows up under its progression + key like the built-ins.
  const [customSongs, setCustomSongs] = useState(loadCustomSongs);
  useEffect(() => {
    // Re-read when returning to this tab (a song may have been imported since).
    const reload = () => setCustomSongs(loadCustomSongs());
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, []);
  const [tooltip,     setTooltip]     = useState(null);  // { voicing, x, y }
  const [moveNotice,  setMoveNotice]  = useState(null);  // banner after a Save moves a song

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
          <span style={{ color: '#38bdf8' }}>↪</span>
          <div className="flex-1">
            {moveNotice.found ? (
              <>
                <span className="font-semibold" style={{ color: '#e0f0fa' }}>{moveNotice.title || 'This song'}</span>
                {"'s chords no longer fit "}
                {moveNotice.from ? <span style={{ color: '#7a9aad' }}>{moveNotice.from}</span> : 'that progression'}
                {'. Moved it to '}
                <span className="font-semibold" style={{ color: '#38bdf8' }}>{moveNotice.to}</span>
                {' in the key of '}
                <span className="font-semibold" style={{ color: '#38bdf8' }}>{moveNotice.key}</span>
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
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5a5a5a' }}>{tr.root}</label>
          <select
            value={root}
            onChange={e => setRoot(e.target.value)}
            className="rounded px-2 py-1.5 text-sm"
            style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f0ede8' }}
          >
            <option value="all">{tr.allRoots}</option>
            {ROOT_NOTES.map(n => <option key={n}>{n}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#5a5a5a' }}>{tr.scale}</label>
          <select
            value={scaleType}
            onChange={e => setScaleType(e.target.value)}
            className="rounded px-2 py-1.5 text-sm"
            style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#f0ede8' }}
          >
            <option value="both">{tr.allScales}</option>
            <option value="major">{tr.major}</option>
            <option value="minor">{tr.minor}</option>
          </select>
        </div>

        {/* My Hand filter toggle */}
        <div className="col-span-2 sm:col-span-1 flex items-end">
          <button
            onClick={() => setShowHandFilters(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={showHandFilters
              ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }
              : { background: '#1a1a1a', color: '#5a5a5a', border: '1px solid #2a2a2a' }}
          >
            ✋ {showHandFilters ? 'Hide Hand Filters' : 'My Hand Filters'}
            {Object.keys(handFilters).length > 0 && (
              <span className="rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold" style={{ background: '#818cf8', color: '#fff' }}>
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
          style={{ background: '#1a1a1a', border: '1px solid #1e1e1e' }}>
          <span className="font-semibold" style={{ color: '#c9a96e' }}>{root} {scaleType}:</span>
          {diatonicChords.map(c => (
            <span key={c.degree} style={{ color: '#5a5a5a' }}>
              <span style={{ color: '#3a3a3a' }}>{c.roman}</span>&thinsp;{c.chordName}
            </span>
          ))}
        </div>
      )}

      {/* ── Result count ── */}
      <p className="text-xs mb-3" style={{ color: '#3a3a3a' }}>
        {filtered.length} progression{filtered.length !== 1 ? 's' : ''}
        {showHandFilters ? ' matching your hand' : ''}
        {filtered.length < resolved.length && <span style={{ color: '#5a5a5a' }}> (filtered from {resolved.length})</span>}
      </p>

      {/* ── Empty state ── */}
      {filtered.length === 0 && (
        <div className="text-center py-16 text-sm" style={{ color: '#3a3a3a' }}>
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
          const easierOpen  = openEasier.has(key);
          const upperOpen   = openUpper.has(key);
          const triadOpen   = openTriad.has(key);
          const songCount   = matchingSongs(prog.name, prog.degrees, prog.scaleType, prog.root, customSongs).length;

          return (
            <div key={i} className="rounded-lg overflow-hidden"
              style={{ border: '1px solid #1e1e1e' }}>

              {/* Card header */}
              <div className="flex items-center justify-between px-3 sm:px-4 py-2"
                style={{ background: '#1a1a1a', borderBottom: '1px solid #1e1e1e' }}>
                <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap min-w-0">
                  {multiKey && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: '#252525', color: '#7a7a7a' }}>
                      {prog.root} {prog.scaleType === 'major' ? 'maj' : 'min'}
                    </span>
                  )}
                  <span className="font-semibold text-sm truncate" style={{ color: '#d0cdc8' }}>{prog.name}</span>
                  <span className="text-xs hidden sm:inline" style={{ color: '#3a3a3a' }}>{prog.genre}</span>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
                  <span className="hidden sm:flex items-center gap-1 text-xs" style={{ color: '#3a3a3a' }}>
                    max <DifficultyBadge score={prog.maxScore} />
                  </span>

                  <button
                    onClick={() => toggleEasier(key)}
                    title="Suggest easier chords that fit your hand"
                    data-explain="The easier button suggests simpler chord shapes that fit your hand, with the same sound — so you can play this progression even with short fingers."
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={easierOpen
                      ? { background: 'rgba(74,222,128,0.14)', color: '#4ade80' }
                      : { background: '#252525', color: '#5a5a5a' }}
                  >
                    ✋ easier
                  </button>

                  <button
                    onClick={() => toggleUpper(key)}
                    title="Play this progression higher up the neck (movable barre shapes)"
                    data-explain="The up the neck button shows movable barre shapes for the same chords played higher on the fretboard."
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={upperOpen
                      ? { background: 'rgba(192,132,252,0.14)', color: '#c084fc' }
                      : { background: '#252525', color: '#5a5a5a' }}
                  >
                    ▲ up the neck
                  </button>

                  <button
                    onClick={() => toggleTriad(key)}
                    title="Up the neck without barre chords — 3-note triad grips using the same notes"
                    data-explain="The triads button gives small three-note shapes higher up the neck, using the same notes but with no barre — easier grips for small hands."
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={triadOpen
                      ? { background: 'rgba(251,191,36,0.14)', color: '#fbbf24' }
                      : { background: '#252525', color: '#5a5a5a' }}
                  >
                    ♦ triads
                  </button>

                  <button
                    onClick={() => toggleSongs(key)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                    style={songsOpen
                      ? { background: 'rgba(56,189,248,0.12)', color: '#38bdf8' }
                      : { background: '#252525', color: '#5a5a5a' }}
                  >
                    ♪{songCount > 0 ? ` ${songCount}` : ''}
                  </button>

                  <button
                    onClick={() => handlePlay(prog, key)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all"
                    style={isPlaying
                      ? { background: 'rgba(239,68,68,0.15)', color: '#f87171' }
                      : { background: '#252525', color: '#7a7a7a' }}
                  >
                    {isPlaying ? '■' : '▶'}
                  </button>
                </div>
              </div>

              {/* Chord cells, with change-difficulty badges between them */}
              <div className="flex overflow-x-auto items-stretch" style={{ background: '#141414' }}>
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
                        <div className="text-xs mb-0.5" style={{ color: '#3a3a3a' }}>{chord.roman}</div>
                        <div className="font-bold text-sm mb-1.5 transition-colors"
                          style={{ color: activeChord === j ? '#c9a96e' : '#d0cdc8' }}>
                          <a
                            href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(chord.chordName)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="hover:underline"
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
                        <div style={{ borderLeft: '1px solid #1e1e1e', borderRight: '1px solid #1e1e1e' }}>
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
              {songsOpen && <SongsPanel progressionName={prog.name} progDegrees={prog.degrees} progScaleType={prog.scaleType} targetRoot={prog.root} customSongs={customSongs} tr={tr} onSongEdited={() => setCustomSongs(loadCustomSongs())} onSongMoved={(n) => { setMoveNotice(n); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }} />}

            </div>
          );
        })}
      </div>

      {/* ── Fretboard tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-50 rounded-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, background: '#1e1e1e', border: '1px solid #2a2a2a', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <div className="text-xs mb-1 text-center" style={{ color: '#5a5a5a' }}>{tooltip.voicing.type}</div>
          <FretboardDiagram chord={tooltip.voicing} />
        </div>
      )}

    </div>
  );
}

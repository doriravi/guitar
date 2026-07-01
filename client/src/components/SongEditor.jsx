// Song Editor — a full-screen overlay for reshaping a marked part of a song.
//
// The user marks a contiguous run of chord cells (tap a start cell, tap an end
// cell), then applies a transform to that section: move chords up the neck, find
// easier voicings, suggest a capo, add a melody, change the rhythm, or re-skin in
// a genre. Reach transforms show a personalized before/after score (the core
// accessibility goal for short-fingered players); musical transforms preview
// audio. Apply writes the chosen result back onto the section.
//
// All transform logic is the pure lib/editorTransforms.js — this file is only the
// screen, the marking UX, and the audio preview wiring (playEvents / playProgression
// / stopAudio / unlockAudio from audio.js).

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { getDiatonicChords } from '../lib/scales';
import { enrichChords, alignChordsToLyrics } from '../lib/lyricChords';
import { lookupVoicings, easiestVoicing, allChordNames } from '../lib/voicingLookup';
import { songBpm } from '../lib/songs';
import { compose as composeApi, lyrics as lyricsApi } from '../lib/api';
import { playProgression, playEvents, stopAudio, unlockAudio } from '../lib/audio';
import {
  buildMarkedSection,
  transformMoveUpFrets,
  transformEasierVoicings,
  transformCapoSuggestion,
  transformRhythm,
  composeWithAI,
  tabToEvents,
  RHYTHM_PATTERNS,
  STYLE_PRESETS,
} from '../lib/editorTransforms';
import { saveCustomSong } from '../lib/customSongs';
import { useAuth } from '../App';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';

// Build the flat per-cell chord timeline for a song (one entry per chord beat-
// cell, NOT deduplicated). Mirrors ProgressionExplorer's chord resolution so the
// editor sees the same chords the song shows.
function buildTimeline(song) {
  // Custom (saved) song: source of truth is its lyricLines, in order.
  if (song.lyricLines && song.lyricLines.length) {
    const seq = [];
    for (const ln of song.lyricLines) {
      for (const name of (ln.chordNames || [])) {
        const voicings = lookupVoicings(name).slice().sort((a, b) => a.score - b.score);
        seq.push({ chordName: name, voicings, degree: null, roman: null });
      }
    }
    if (seq.length) return seq;
  }

  if (!song.degrees || !song.degrees.length) return [];
  const diatonic = getDiatonicChords(song.key, song.scaleType);
  const baseNames = song.degrees.map(d => diatonic[d].chordName);

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
      return /^(m|dim|aug|sus|maj|add|°)/.test(quality) ? root + quality : root + triadSuffix + quality;
    });
  } else if (song.lineChords || song.exact) {
    finalNames = baseNames;
  } else {
    finalNames = enrichChords(song.degrees, baseNames, song.scaleType);
  }

  return song.degrees.map((d, i) => {
    const chordName = finalNames[i];
    const voicings = lookupVoicings(chordName).slice().sort((a, b) => a.score - b.score);
    const dia = diatonic[d];
    return { chordName, voicings, degree: d, roman: dia?.roman ?? null };
  });
}

const TRANSFORMS = [
  { id: 'manual', label: '✎ Edit chords', kind: 'manual' },
  { id: 'moveUp', label: 'Move up frets', kind: 'reach' },
  { id: 'easier', label: 'Easier voicings', kind: 'reach' },
  { id: 'capo', label: 'Capo', kind: 'reach' },
  { id: 'melody', label: '+ Melody', kind: 'musical' },
  { id: 'rhythm', label: 'Rhythm', kind: 'musical' },
  { id: 'style', label: 'Style', kind: 'musical' },
];

const DENSITIES = ['sparse', 'medium', 'busy'];
const CONTOURS = ['arch', 'ascending', 'descending', 'wave', 'static'];

export default function SongEditor({ song, profile, onClose }) {
  const currentUser = useAuth();
  const [saveMsg, setSaveMsg] = useState(null);   // { type: 'ok'|'err', text }
  const [saving, setSaving] = useState(false);
  const timeline = useMemo(() => buildTimeline(song), [song]);
  const chordNames = useMemo(() => allChordNames(), []);
  const bpm = song.bpm ?? songBpm(song.title) ?? 100;
  const meta = useMemo(
    () => ({ bpm, key: song.key, scaleType: song.scaleType }),
    [bpm, song.key, song.scaleType],
  );

  // ─── Song sheet (words + lyrics + chords, read-only) ──────────────────────────
  // The editor copies the full chord-over-lyrics sheet onto its own screen so the
  // player can see the words while marking a section. A custom (saved) song carries
  // its own lyricLines; a built-in fetches lyrics the same way the Lyrics panel does
  // (api.lyrics.fetch) — independent of whether that panel was ever opened.
  const isCustom = !!(song.lyricLines && song.lyricLines.length);
  const [sheetStatus, setSheetStatus] = useState(isCustom ? 'done' : 'loading');
  const [lyricsText, setLyricsText] = useState('');
  const [sheetOpen, setSheetOpen] = useState(true);

  useEffect(() => {
    if (isCustom) { setSheetStatus('done'); return; }
    if (!song.title || !song.artist) { setSheetStatus('empty'); return; }
    setSheetStatus('loading');
    const controller = new AbortController();
    let alive = true;
    lyricsApi.fetch(song.artist, song.title, { signal: controller.signal })
      .then(res => {
        if (!alive) return;
        if (res.status === 'done') { setLyricsText(res.text); setSheetStatus('done'); }
        else setSheetStatus(res.status); // 'empty' | 'error'
      })
      .catch(() => { if (alive) setSheetStatus('error'); });
    return () => { alive = false; controller.abort(); };
  }, [song.title, song.artist, isCustom]);

  // Chord-over-lyrics lines aligned to THIS song's timeline. For a custom song each
  // saved lyricLine maps its own chord names onto the line; otherwise the fetched
  // lyrics are aligned against the timeline chords (same helper the Lyrics panel uses).
  //
  // CRITICAL: marking is per-OCCURRENCE, not per-chord-name. The same chord (e.g. "C")
  // appears many times across the sheet; each appearance gets its own global `pos` so
  // selecting two chords marks exactly the run between them — not every "C" in the song.
  const rawSheetLines = useMemo(() => {
    if (isCustom) {
      const idxByName = new Map(timeline.map((c, i) => [c.chordName, i]));
      let lastIdx = 0;
      return song.lyricLines.map(ln => {
        const names = ln.chordNames || [];
        const text = ln.text || '';
        if (!text && !names.length) return { blank: true };
        if (!names.length) return { segments: [{ chordIndex: lastIdx, text }] };
        const segments = names.map((name, k) => {
          const idx = idxByName.get(name);
          if (idx != null) lastIdx = idx;
          return { chordIndex: idx != null ? idx : lastIdx, text: k === 0 ? text : '' };
        });
        return { segments };
      });
    }
    if (sheetStatus !== 'done' || !lyricsText || !timeline.length) return [];
    return alignChordsToLyrics(lyricsText.split('\n'), timeline, song.lineChords);
  }, [isCustom, song.lyricLines, song.lineChords, sheetStatus, lyricsText, timeline]);

  // Assign a global position to every chord segment, and build the flat per-occurrence
  // cell list. `sheetLines` segments now carry `pos`; `sheetCells[pos]` is the chord
  // there, resolved from the timeline (so it keeps voicings/degree/roman).
  const { sheetLines, sheetCells } = useMemo(() => {
    const cells = [];
    const lines = rawSheetLines.map(line => {
      if (line.blank) return line;
      const segments = line.segments.map(seg => {
        const base = timeline[seg.chordIndex] || { chordName: '', voicings: [], degree: null, roman: null };
        const pos = cells.length;
        cells.push({ ...base, pos });
        return { ...seg, pos };
      });
      return { ...line, segments };
    });
    return { sheetLines: lines, sheetCells: cells };
  }, [rawSheetLines, timeline]);

  // When there are no lyric lines, fall back to marking the bare timeline chords —
  // one cell per timeline entry, still per-occurrence.
  const cells = useMemo(
    () => (sheetCells.length ? sheetCells : timeline.map((c, i) => ({ ...c, pos: i }))),
    [sheetCells, timeline],
  );

  // Marking: tap a cell = start; tap another = end (range). Tap inside clears.
  const [markStart, setMarkStart] = useState(null);
  const [markEnd, setMarkEnd] = useState(null);

  const [transformId, setTransformId] = useState(null);
  const [result, setResult] = useState(null);     // current TransformResult / CapoResult
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState({});       // pos -> { name, tab, notes } overrides
  const [melodyTrack, setMelodyTrack] = useState(null); // applied melody events

  // Transform options.
  const [moveStyle, setMoveStyle] = useState('barre');
  const [allowQuality, setAllowQuality] = useState(true);
  const [density, setDensity] = useState('medium');
  const [contour, setContour] = useState('arch');
  const [seed, setSeed] = useState(1);
  const [patternId, setPatternId] = useState('straight');
  const [feel, setFeel] = useState('straight');
  const [presetId, setPresetId] = useState('folk');
  const [useAI, setUseAI] = useState(false);

  // Preview playback.
  const [playing, setPlaying] = useState(false);
  const loopEnabled = useRef(false);

  // Hover tooltip: the chord shape (fretboard diagram) for the cell under the cursor.
  const [tooltip, setTooltip] = useState(null); // { voicing, x, y }
  const showShape = (e, voicing) => {
    if (!voicing?.tab) return;
    const r = e.currentTarget.getBoundingClientRect();
    const tipW = 150;
    setTooltip({
      voicing,
      x: r.right + 8 + tipW > window.innerWidth ? r.left - tipW - 6 : r.right + 8,
      y: r.top - 10,
    });
  };
  const hideShape = () => setTooltip(null);

  // The voicing to show in the hover diagram for a cell: the applied (transformed)
  // shape if one exists, otherwise the cell's easiest voicing.
  const voicingFor = (pos) => {
    const ov = applied[pos];
    if (ov?.tab) return { tab: ov.tab, notes: ov.notes || [], type: ov.type || 'edited' };
    return cells[pos]?.voicings?.[0] || null;
  };

  useEffect(() => () => { loopEnabled.current = false; stopAudio(); }, []);

  const hasMark = markStart != null && markEnd != null;

  // The current (possibly partially applied) section, sliced from the per-occurrence
  // `cells` by position. Applied overrides (keyed by pos) replace a cell's voicing so
  // the section reflects transforms already landed on those exact chords.
  const section = useMemo(() => {
    if (!hasMark) return null;
    const effective = cells.map((cell, i) => {
      const ov = applied[i];
      if (!ov) return cell;
      const voicing = { name: ov.name, type: ov.type || 'edited', notes: ov.notes || [], tab: ov.tab, score: cell.voicings?.[0]?.score ?? 0 };
      return { ...cell, chordName: ov.name, voicings: [voicing, ...(cell.voicings || [])] };
    });
    return buildMarkedSection(effective, markStart, markEnd, meta);
  }, [cells, markStart, markEnd, meta, applied, hasMark]);

  // Apply a freshly-computed result onto the marked chords immediately. The sheet
  // re-renders the changed chords (green) right away; Play auditions the current
  // applied state. (No separate "Apply" step — transforms land on selection.)
  const applyResult = useCallback((res, sec) => {
    if (!res || !sec) return;
    if (res.kind === 'melody') {
      setMelodyTrack({ start: sec.start, events: res.events });
    } else if (res.kind === 'style' && res.voicings) {
      setApplied(prev => {
        const next = { ...prev };
        res.voicings.forEach((v, i) => {
          const cell = sec.chords[i];
          if (cell) next[cell.index] = { name: v.chordName, tab: v.tab, notes: cell.notes };
        });
        return next;
      });
    } else if (res.chords) {                    // reach transforms / rhythm
      setApplied(prev => {
        const next = { ...prev };
        res.chords.forEach((c) => {
          if (c.changed && c.toVoicing) {
            next[c.index] = { name: c.toName, tab: c.toVoicing.tab, notes: c.toVoicing.notes };
          }
        });
        return next;
      });
    }
  }, []);

  // Run the active transform, apply it onto the selection immediately, and keep
  // the result for the "what changed" summary + audio preview.
  const runTransform = useCallback(async (id, overrides = {}) => {
    if (!section) return;
    const o = {
      moveStyle, allowQuality, density, contour, seed, patternId, feel, presetId, useAI,
      ...overrides,
    };
    setBusy(true);
    try {
      let res;
      switch (id) {
        case 'moveUp':
          res = transformMoveUpFrets(section, profile, { style: o.moveStyle });
          break;
        case 'easier':
          res = transformEasierVoicings(section, profile, { allowQualityChange: o.allowQuality });
          break;
        case 'capo':
          res = transformCapoSuggestion(section, profile);
          break;
        case 'rhythm':
          res = transformRhythm(section, { patternId: o.patternId, feel: o.feel });
          break;
        case 'melody':
          res = await composeWithAI('melody', section, profile,
            { density: o.density, contour: o.contour, seed: o.seed, useAI: o.useAI }, composeApi);
          break;
        case 'style':
          res = await composeWithAI('style', section, profile,
            { presetId: o.presetId, useAI: o.useAI }, composeApi);
          break;
        default:
          res = null;
      }
      setResult(res);
      applyResult(res, section);   // land it on the marked chords immediately
    } finally {
      setBusy(false);
    }
  }, [section, profile, moveStyle, allowQuality, density, contour, seed, patternId, feel, presetId, useAI, applyResult]);

  const selectTransform = (id) => {
    setTransformId(id);
    setResult(null);
    // Manual editing is interactive (the user picks each chord) — it has no one-shot
    // result to compute, so we just open its editor strip.
    if (id !== 'manual') runTransform(id);
  };

  // Re-run when an option changes for the active transform.
  useEffect(() => {
    if (transformId && transformId !== 'manual') runTransform(transformId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveStyle, allowQuality, density, contour, seed, patternId, feel, presetId, useAI]);

  const transformMeta = TRANSFORMS.find(t => t.id === transformId);
  const isMusical = transformMeta?.kind === 'musical';
  const isManual = transformMeta?.kind === 'manual';

  // ─── Manual chord editing ──────────────────────────────────────────────────────
  // Set a marked cell's chord by name (picks the easiest voicing for it) or to a
  // specific voicing. Writes an `applied` override keyed by position, exactly like
  // the auto-transforms, so the sheet, audio, and Save all pick it up uniformly.
  const setChordAt = (pos, chordName) => {
    const v = easiestVoicing(chordName);
    if (!v) return;
    setApplied(prev => ({ ...prev, [pos]: { name: chordName, tab: v.tab, notes: v.notes, type: v.type } }));
  };
  const setVoicingAt = (pos, voicing, chordName) => {
    setApplied(prev => ({ ...prev, [pos]: { name: chordName, tab: voicing.tab, notes: voicing.notes, type: voicing.type } }));
  };
  const clearChordAt = (pos) => {
    setApplied(prev => { const next = { ...prev }; delete next[pos]; return next; });
  };

  // ─── Audio preview ───────────────────────────────────────────────────────────

  const secPerBeat = 60 / (section?.bpm || bpm);

  // Chord bed under a melody (so the melody plays in context).
  const chordBed = useCallback(() => {
    if (!section) return [];
    let beat = 0;
    return section.chords.flatMap((c) => {
      const ev = tabToEvents(c.tab, beat * secPerBeat, (c.beats || 4) * secPerBeat * 0.9);
      beat += c.beats || 4;
      return ev;
    });
  }, [section, secPerBeat]);

  // Play the CURRENT state of the marked section: whatever transforms have been
  // applied (rhythm/style events if the last transform produced them, otherwise the
  // applied chord voicings), with the melody track layered on when present.
  const playCurrent = useCallback(() => {
    if (!section) return;
    stopAudio();
    const done = () => { if (loopEnabled.current) playCurrent(); else setPlaying(false); };

    // Rhythm/style transforms produce a timed event stream — prefer it so the feel
    // is audible. Otherwise strum the current (applied) chord voicings.
    if (result?.events?.length) {
      const melody = melodyTrack ? melodyTrack.events : [];
      playEvents([...result.events, ...melody], done);
    } else if (melodyTrack) {
      playEvents([...chordBed(), ...melodyTrack.events], done);
    } else {
      const voicings = section.chords.map(c => ({ tab: c.tab }));
      playProgression(voicings, section.bpm, () => {}, done);
    }
  }, [section, result, melodyTrack, chordBed]);

  const play = () => {
    unlockAudio();
    setPlaying(true);
    setPlayScope('selection');
    playCurrent();
  };

  // Play the WHOLE song, top to bottom, with every applied transform baked in
  // (a transformed chord plays its new voicing; the rest play as written). The
  // applied melody track is layered over its own region.
  const playFullSong = useCallback(() => {
    if (!cells.length) return;
    stopAudio();
    const done = () => { if (loopEnabled.current) playFullSong(); else setPlaying(false); };
    const songBeats = 4;
    const spb = 60 / bpm;

    // Chord bed across the entire song from the applied/original voicings.
    const events = [];
    cells.forEach((cell, i) => {
      const ov = applied[i];
      const tab = ov?.tab || cell.voicings?.[0]?.tab;
      if (tab) events.push(...tabToEvents(tab, i * songBeats * spb, songBeats * spb * 0.9));
    });
    // Layer the applied melody (its event times are relative to the marked region's
    // start cell — offset them onto the full-song timeline).
    if (melodyTrack) {
      const offset = (melodyTrack.start || 0) * songBeats * spb;
      melodyTrack.events.forEach(e => events.push({ ...e, time: (e.time || 0) + offset }));
    }
    playEvents(events, done);
  }, [cells, applied, melodyTrack, bpm]);

  const playSong = () => {
    unlockAudio();
    setPlaying(true);
    setPlayScope('song');
    playFullSong();
  };

  const stop = () => { loopEnabled.current = false; stopAudio(); setPlaying(false); };
  const [playScope, setPlayScope] = useState('selection'); // which Play button is active

  const toggleLoop = () => { loopEnabled.current = !loopEnabled.current; setLoopTick(t => t + 1); };
  const [, setLoopTick] = useState(0);

  // ─── Marking handlers ──────────────────────────────────────────────────────────

  const tapCell = (i) => {
    if (markStart == null) { setMarkStart(i); setMarkEnd(null); resetResult(); return; }
    if (markEnd == null) {
      const lo = Math.min(markStart, i), hi = Math.max(markStart, i);
      setMarkStart(lo); setMarkEnd(hi); resetResult(); return;
    }
    // Range already set → tapping clears and starts over from this cell.
    setMarkStart(i); setMarkEnd(null); resetResult();
  };

  const clearMarks = () => { setMarkStart(null); setMarkEnd(null); resetResult(); };
  const resetResult = () => { setTransformId(null); setResult(null); stop(); };

  const inSection = (i) => hasMark && i >= markStart && i <= markEnd;

  // Revert every transform applied to the marked section back to the original.
  const revertSection = () => {
    if (!hasMark) return;
    setApplied(prev => {
      const next = { ...prev };
      for (let i = markStart; i <= markEnd; i++) delete next[i];
      return next;
    });
    if (melodyTrack) setMelodyTrack(null);
    setResult(null);
    setTransformId(null);
  };

  // ─── Save (per user, to the DB when logged in) ────────────────────────────────
  // Bake every applied transform into a standalone song object: rebuild the lyric
  // lines from the sheet with the transformed chord NAMES substituted per position,
  // tag it as a user edit, and persist (localStorage always; DB when logged in).
  const saveEditedSong = async () => {
    setSaving(true);
    setSaveMsg(null);

    // Group the per-occurrence cells back into lyric lines, using applied names.
    const lyricLines = [];
    if (sheetLines.length) {
      for (const line of sheetLines) {
        if (line.blank) { lyricLines.push({ text: '', chordNames: [] }); continue; }
        const chordNames = line.segments.map(s => applied[s.pos]?.name || cells[s.pos]?.chordName).filter(Boolean);
        const text = line.segments.map(s => s.text).filter(Boolean).join(' ');
        lyricLines.push({ text, chordNames });
      }
    } else {
      // No lyrics → one line carrying the (possibly transformed) chord sequence.
      lyricLines.push({ text: '', chordNames: cells.map(c => applied[c.pos]?.name || c.chordName) });
    }

    // Title handling: an edit of an already-edited song must NOT re-append
    // "(my edit)". Track the clean original in `editedFrom`; the edit title is
    // "<original> (my edit)" exactly once. Strip any accidental stacked suffixes.
    const stripEditSuffix = (t) => (t || '').replace(/(\s*\(my edit\))+$/i, '').trim();
    const originalTitle = song.editedFrom || stripEditSuffix(song.title);
    const editTitle = `${originalTitle} (my edit)`;

    const edited = {
      ...song,
      id: song.id || undefined,                 // keep id if this was already a saved song
      title: editTitle,
      artist: song.artist || '',
      key: song.key, scaleType: song.scaleType, bpm,
      lyricLines,
      custom: true,
      editedFrom: originalTitle,                 // stable clean origin, never re-suffixed
    };

    try {
      await saveCustomSong(edited, !!currentUser);
      setSaveMsg({
        type: 'ok',
        text: currentUser ? 'Saved to your account ✓' : 'Saved on this device (sign in to sync) ✓',
      });
    } catch {
      setSaveMsg({ type: 'err', text: 'Save failed — try again.' });
    } finally {
      setSaving(false);
    }
  };

  // Headline before/after reach badge (reach transforms only).
  const reachHeadline = result && result.chords
    ? { before: result.beforeMax, after: result.afterMax }
    : null;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0b0b0b' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid #1e1e1e', background: '#111' }}>
        <button onClick={() => { stop(); onClose(); }}
          className="text-sm font-medium px-2 py-1 rounded" style={{ color: '#9a9a9a' }}>
          ‹ Back
        </button>
        <div className="text-sm min-w-0 flex-1 text-center truncate" style={{ color: '#d0cdc8' }}>
          Editing: <span className="font-semibold">{song.title}</span>
          <span style={{ color: '#5a5a5a' }}> — {song.artist}</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded mr-2" style={{ background: 'rgba(56,189,248,0.1)', color: '#38bdf8' }}>
          {song.key}{song.scaleType === 'minor' ? 'm' : ''} · {bpm}bpm
        </span>
        <button onClick={saveEditedSong} disabled={saving || !timeline.length}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ background: '#c9a96e', color: '#0f0f0f', opacity: (saving || !timeline.length) ? 0.5 : 1 }}
          title={currentUser ? 'Save this edited song to your account' : 'Save on this device — sign in to sync across devices'}>
          {saving ? 'Saving…' : '💾 Save song'}
        </button>
      </div>
      {saveMsg && (
        <div className="px-4 py-1.5 text-xs text-center shrink-0"
          style={{ background: saveMsg.type === 'ok' ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.12)',
                   color: saveMsg.type === 'ok' ? '#4ade80' : '#f87171' }}>
          {saveMsg.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Song sheet — the words + lyrics + chords, copied onto the editor screen */}
        <div className="rounded-lg" style={{ background: '#111', border: '1px solid #1e1e1e' }}>
          <button
            onClick={() => setSheetOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest font-semibold"
            style={{ color: '#5a5a5a' }}
          >
            <span>Song sheet — tap chords to mark a section</span>
            <span style={{ color: '#444' }}>{sheetOpen ? '▾' : '▸'}</span>
          </button>
          {sheetOpen && (
            <div className="px-3 pb-3">
              <p className="text-[11px] mb-2" style={{ color: hasMark ? '#c9a96e' : '#5a5a5a' }}>
                {hasMark
                  ? `Marked ${markStart + 1}–${markEnd + 1} — tap any chord to start over`
                  : markStart != null
                    ? 'Tap the chord that ends your section'
                    : 'Tap a chord to start marking'}
              </p>

              {sheetStatus === 'loading' && (
                <p className="text-xs italic" style={{ color: '#5a5a5a' }}>Loading lyrics…</p>
              )}
              {(sheetStatus === 'error' || sheetStatus === 'empty' || (sheetStatus === 'done' && !sheetLines.length)) && (
                <p className="text-xs italic mb-2" style={{ color: sheetStatus === 'error' ? '#f87171' : '#5a5a5a' }}>
                  {sheetStatus === 'error'
                    ? 'Couldn’t load lyrics — mark the chords directly below.'
                    : 'No lyrics found — mark the chords directly below.'}
                </p>
              )}

              <div className="max-h-72 overflow-y-auto">
                {/* Chord-over-lyrics: tap a chord to mark. */}
                {sheetStatus === 'done' && sheetLines.length > 0 && sheetLines.map((line, i) => {
                  if (line.blank) return <div key={i} className="mt-2" />;
                  return (
                    <div key={i} className="mb-1.5 flex flex-wrap items-end gap-x-1 leading-tight">
                      {line.segments.map((seg, j) => (
                        <ChordCell key={j}
                          name={applied[seg.pos]?.name || cells[seg.pos]?.chordName || ''}
                          text={seg.text}
                          marked={inSection(seg.pos)}
                          pendingStart={markStart === seg.pos && markEnd == null}
                          changed={!!applied[seg.pos]}
                          onTap={() => tapCell(seg.pos)}
                          onHover={(e) => showShape(e, voicingFor(seg.pos))}
                          onLeave={hideShape} />
                      ))}
                    </div>
                  );
                })}

                {/* No lyric lines → mark the bare chords (per-occurrence cells). */}
                {!(sheetStatus === 'done' && sheetLines.length > 0) && sheetStatus !== 'loading' && (
                  <div className="flex flex-wrap gap-x-1 gap-y-1.5">
                    {cells.map((cell) => (
                      <ChordCell key={cell.pos}
                        name={applied[cell.pos]?.name || cell.chordName}
                        text=""
                        marked={inSection(cell.pos)}
                        pendingStart={markStart === cell.pos && markEnd == null}
                        changed={!!applied[cell.pos]}
                        onTap={() => tapCell(cell.pos)}
                        onHover={(e) => showShape(e, voicingFor(cell.pos))}
                        onLeave={hideShape} />
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <button onClick={clearMarks} className="text-[11px] px-2.5 py-1 rounded" style={{ background: '#1a1a1a', color: '#7a7a7a' }}>
                  Clear marks
                </button>
                {melodyTrack && (
                  <span className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>
                    ♪ melody applied ({melodyTrack.events.length} notes)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Transform buttons */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: '#5a5a5a' }}>
            Transforms {!hasMark && <span style={{ color: '#444' }}>— mark a section first</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {TRANSFORMS.map(t => (
              <button key={t.id}
                disabled={!hasMark || busy}
                onClick={() => selectTransform(t.id)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={transformId === t.id
                  ? { background: 'rgba(201,169,110,0.18)', color: '#c9a96e', border: '1px solid rgba(201,169,110,0.4)' }
                  : { background: '#1a1a1a', color: hasMark ? '#9a9a9a' : '#444', border: '1px solid #2a2a2a' }}
              >{t.label}</button>
            ))}
          </div>

          {/* Options strip (per active transform) */}
          {transformId && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: '#7a7a7a' }}>
              {transformId === 'moveUp' && (
                <Seg label="shape" value={moveStyle} options={[['barre', 'Barre'], ['triad', 'Triad']]} onPick={setMoveStyle} />
              )}
              {transformId === 'easier' && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={allowQuality} onChange={e => setAllowQuality(e.target.checked)} />
                  allow substitutions (changes the sound)
                </label>
              )}
              {transformId === 'melody' && (
                <>
                  <Seg label="density" value={density} options={DENSITIES.map(d => [d, d])} onPick={setDensity} />
                  <SelectStrip label="contour" value={contour} options={CONTOURS} onPick={setContour} />
                  <button onClick={() => setSeed(s => s + 1)} className="px-2 py-0.5 rounded" style={{ background: '#1a1a1a', color: '#9a9a9a' }}>↻ Reroll</button>
                </>
              )}
              {transformId === 'rhythm' && (
                <>
                  <SelectStrip label="pattern" value={patternId} options={Object.keys(RHYTHM_PATTERNS)} onPick={setPatternId} />
                  <Seg label="feel" value={feel} options={[['straight', 'Straight'], ['swing', 'Swing']]} onPick={setFeel} />
                </>
              )}
              {transformId === 'style' && (
                <SelectStrip label="preset" value={presetId} options={Object.keys(STYLE_PRESETS)} onPick={setPresetId} />
              )}
              {isMusical && (
                <label className="flex items-center gap-1.5 ml-1" title="When the /api/compose backend exists, enrich with AI; otherwise stays local.">
                  <input type="checkbox" checked={useAI} onChange={e => setUseAI(e.target.checked)} />
                  ✨ AI ideas
                </label>
              )}
            </div>
          )}
        </div>

        {/* Manual chord editor — pick a new chord (and voicing) for each marked cell. */}
        {isManual && hasMark && section && (
          <div className="rounded-xl p-3" style={{ background: '#111', border: '1px solid #1e1e1e' }}>
            <p className="text-[11px] mb-3" style={{ color: '#9a9a9a' }}>
              Change each chord by hand — pick a chord name, then an optional shape. The change lands on the song immediately.
            </p>
            <div className="flex flex-col gap-3">
              {section.chords.map((c) => (
                <ManualChordRow key={c.index}
                  pos={c.index}
                  original={cells[c.index]?.chordName}
                  currentName={applied[c.index]?.name || c.chordName}
                  edited={!!applied[c.index]}
                  chordNames={chordNames}
                  onPickName={(name) => setChordAt(c.index, name)}
                  onPickVoicing={(v, name) => setVoicingAt(c.index, v, name)}
                  onReset={() => clearChordAt(c.index)}
                  onHoverVoicing={showShape}
                  onLeaveVoicing={hideShape} />
              ))}
            </div>
          </div>
        )}

        {/* What changed — the transform is already applied to the selection. */}
        {result && (
          <div className="rounded-xl p-3" style={{ background: '#111', border: '1px solid #1e1e1e' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>
                ✓ Applied to selection
              </span>
              {busy && <span className="text-[11px]" style={{ color: '#7a7a7a' }}>working…</span>}
            </div>
            {/* Headline reach badge for reach transforms */}
            {reachHeadline && (
              <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: '#9a9a9a' }}>
                <span>Hardest reach:</span>
                <DifficultyBadge score={reachHeadline.before} />
                <span>→</span>
                <DifficultyBadge score={reachHeadline.after} />
                {result.fret != null && (
                  <span className="ml-1 px-2 py-0.5 rounded" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>
                    Capo {result.fret}
                  </span>
                )}
              </div>
            )}
            {result.meta?.label && (
              <div className="text-xs mb-2" style={{ color: '#9a9a9a' }}>
                {result.meta.label} <span style={{ color: '#4a4a4a' }}>· {result.meta.source}</span>
              </div>
            )}

            {/* Per-chord before/after for reach transforms */}
            {result.chords && result.chords.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-3">
                {result.chords.map((c) => (
                  <div key={c.index} className="flex flex-col items-center gap-1 rounded-lg p-2" style={{ background: '#0c0c0c', border: '1px solid #1e1e1e' }}>
                    <div className="flex items-center gap-1 text-[11px]">
                      <span style={{ color: '#7a7a7a' }}>{c.fromName}</span>
                      {c.changed && <><span style={{ color: '#4a4a4a' }}>→</span><span style={{ color: '#4ade80' }}>{c.toName}</span></>}
                    </div>
                    <div className="flex items-center gap-1">
                      {c.fromScore != null && <DifficultyBadge score={c.fromScore} />}
                      {c.toScore != null && <><span style={{ color: '#4a4a4a' }}>→</span><DifficultyBadge score={c.toScore} /></>}
                    </div>
                    {(c.toVoicing || c.fromVoicing) && (
                      <FretboardDiagram chord={c.toVoicing || c.fromVoicing} />
                    )}
                    {c.warnings?.length > 0 && (
                      <span className="text-[9px] text-center max-w-[120px]" style={{ color: '#facc15' }}>{c.warnings[0]}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Selection warnings */}
            {result.warnings?.length > 0 && (
              <ul className="mb-2 text-[11px] list-disc list-inside" style={{ color: '#facc15' }}>
                {result.warnings.map((w, k) => <li key={k}>{w}</li>)}
              </ul>
            )}

          </div>
        )}

        {/* Play bar — always available. Play full song plays the whole sheet with
            every applied transform baked in; Play selection (when a section is marked)
            plays just that run so you hear each transform as you tap it. */}
        {timeline.length > 0 && (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 py-2 px-1"
            style={{ background: '#0b0b0b', borderTop: '1px solid #1e1e1e' }}>
            {/* Play full song */}
            <button onClick={(playing && playScope === 'song') ? stop : playSong}
              className="text-sm font-semibold px-4 py-2 rounded-lg"
              style={(playing && playScope === 'song')
                ? { background: 'rgba(239,68,68,0.14)', color: '#f87171' }
                : { background: 'rgba(129,140,248,0.12)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.3)' }}>
              {(playing && playScope === 'song') ? '■ Stop' : '▶ Play full song'}
            </button>

            {/* Play selection (only when a section is marked) */}
            {hasMark && (
              <button onClick={(playing && playScope === 'selection') ? stop : play}
                className="text-sm font-semibold px-4 py-2 rounded-lg"
                style={(playing && playScope === 'selection')
                  ? { background: 'rgba(239,68,68,0.14)', color: '#f87171' }
                  : { background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
                {(playing && playScope === 'selection') ? '■ Stop' : '▶ Play selection'}
              </button>
            )}

            <button onClick={toggleLoop}
              className="text-xs px-3 py-2 rounded-lg"
              style={loopEnabled.current
                ? { background: 'rgba(56,189,248,0.12)', color: '#38bdf8' }
                : { background: '#1a1a1a', color: '#7a7a7a' }}>
              ⟲ Loop
            </button>
            <div className="flex-1" />
            {hasMark && (
              <button onClick={revertSection}
                className="text-xs font-medium px-3 py-2 rounded-lg"
                style={{ background: '#1a1a1a', color: '#9a9a9a' }}>
                ↶ Revert selection
              </button>
            )}
          </div>
        )}

        {!timeline.length && (
          <div className="text-sm italic py-6 text-center" style={{ color: '#4a4a4a' }}>
            This song has no resolvable chords to edit.
          </div>
        )}
      </div>

      {/* Hover diagram — the chord shape (with suggested fingers) for the chord
          under the cursor. Mirrors the Progression Explorer tooltip. */}
      {tooltip && (
        <div className="fixed z-50 rounded-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, background: '#1e1e1e', border: '1px solid #2a2a2a', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {tooltip.voicing.type && (
            <div className="text-xs mb-1 text-center" style={{ color: '#5a5a5a' }}>{tooltip.voicing.type}</div>
          )}
          <FretboardDiagram chord={tooltip.voicing} showFingers />
        </div>
      )}
    </div>
  );
}

// One row in the manual chord editor: pick a chord NAME, then optionally a specific
// shape from that chord's catalogued voicings (each chip previews on hover).
function ManualChordRow({ pos, original, currentName, edited, chordNames, onPickName, onPickVoicing, onReset, onHoverVoicing, onLeaveVoicing }) {
  const voicings = lookupVoicings(currentName).slice().sort((a, b) => a.score - b.score);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg p-2" style={{ background: '#0c0c0c', border: '1px solid #1e1e1e' }}>
      <span className="text-[10px] w-8 shrink-0" style={{ color: '#4a4a4a' }}>#{pos + 1}</span>

      {/* Chord name picker */}
      <select value={chordNames.includes(currentName) ? currentName : ''}
        onChange={(e) => onPickName(e.target.value)}
        className="text-xs rounded px-2 py-1"
        style={{ background: '#1a1a1a', color: edited ? '#4ade80' : '#e6dcc8', border: '1px solid #2a2a2a' }}>
        {!chordNames.includes(currentName) && <option value="">{currentName || '—'}</option>}
        {chordNames.map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      {original && original !== currentName && (
        <span className="text-[10px]" style={{ color: '#5a5a5a' }}>was {original}</span>
      )}

      {/* Voicing chips for the chosen chord */}
      <div className="flex flex-wrap items-center gap-1">
        {voicings.slice(0, 6).map((v, k) => (
          <button key={k}
            onClick={() => onPickVoicing(v, currentName)}
            onMouseEnter={(e) => onHoverVoicing(e, v)} onMouseLeave={onLeaveVoicing}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: '#161616', color: '#9a9a9a', border: '1px solid #262626' }}
            title={`${v.type} — ${v.tab}`}>
            {v.tab}
          </button>
        ))}
        {!voicings.length && <span className="text-[10px] italic" style={{ color: '#6a6a6a' }}>no shape on file</span>}
      </div>

      <div className="flex-1" />
      {edited && (
        <button onClick={onReset} className="text-[10px] px-2 py-0.5 rounded" style={{ background: '#1a1a1a', color: '#7a7a7a' }}>
          reset
        </button>
      )}
    </div>
  );
}

// A single tappable chord-over-lyric cell on the song sheet. Marking a section
// is done by tapping these directly (no separate timeline). `marked` highlights
// cells inside the selection; `changed` shows a chord a transform has rewritten.
function ChordCell({ name, text, marked, pendingStart, changed, onTap, onHover, onLeave }) {
  return (
    <button type="button" onClick={onTap}
      onMouseEnter={onHover} onMouseLeave={onLeave} onFocus={onHover} onBlur={onLeave}
      className="inline-flex flex-col items-start rounded text-left transition-colors select-none cursor-pointer"
      style={{
        background: marked ? 'rgba(201,169,110,0.15)' : 'transparent',
        outline: pendingStart ? '1px dashed rgba(201,169,110,0.7)' : 'none',
        padding: '0 3px',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}>
      <span className="font-bold select-none leading-tight"
        style={{ color: changed ? '#4ade80' : marked ? '#c9a96e' : '#818cf8' }}>{name || '·'}</span>
      <span className="leading-tight" style={{ color: marked ? '#b8a88a' : '#6a6a6a' }}>{text || ' '}</span>
    </button>
  );
}

// ─── Small option controls ──────────────────────────────────────────────────────

function Seg({ label, value, options, onPick }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label && <span style={{ color: '#5a5a5a' }}>{label}:</span>}
      <span className="inline-flex rounded-md overflow-hidden" style={{ border: '1px solid #2a2a2a' }}>
        {options.map(([val, lbl]) => (
          <button key={val} onClick={() => onPick(val)}
            className="px-2 py-0.5"
            style={value === val
              ? { background: 'rgba(201,169,110,0.2)', color: '#c9a96e' }
              : { background: '#161616', color: '#7a7a7a' }}>
            {lbl}
          </button>
        ))}
      </span>
    </span>
  );
}

function SelectStrip({ label, value, options, onPick }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span style={{ color: '#5a5a5a' }}>{label}:</span>
      <select value={value} onChange={e => onPick(e.target.value)}
        className="rounded-md px-1.5 py-0.5"
        style={{ background: '#161616', color: '#c9a96e', border: '1px solid #2a2a2a' }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </span>
  );
}

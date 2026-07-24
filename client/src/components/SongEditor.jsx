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

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { alignChordsToLyrics } from '../lib/lyricChords';
import { resolveChordCells } from '../lib/songTimeline';
import { lookupVoicings, easiestVoicing, allChordNames } from '../lib/voicingLookup';
import { isWithinReach } from '../lib/handProfile';
import { songBpm } from '../lib/songs';
import { compose as composeApi, lyrics as lyricsApi } from '../lib/api';
import { playProgression, playEvents, playBacking, stopAudio, unlockAudio } from '../lib/audio';
import { singLines, stopSinging, listVoices, onVoicesReady, vocalsSupported } from '../lib/vocals';
import {
  buildMarkedSection,
  transformMoveUpFrets,
  transformEasierVoicings,
  transformCapoSuggestion,
  transformCadence,
  transformRhythm,
  composeWithAI,
  tabToEvents,
  RHYTHM_PATTERNS,
  STYLE_PRESETS,
  CADENCES,
} from '../lib/editorTransforms';
import { saveCustomSong, songToText } from '../lib/customSongs';
import { parseChordSheet } from '../lib/chordSheetParser';
import { useAuth, useReachLimit, useLang } from '../App';
import { useT } from '../lib/i18n';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';
import CapoSuggestion from './CapoSuggestion';
import NoteStaff from './NoteStaff';
import { chordToneNames } from '../lib/notation';

const TRANSFORMS = [
  { id: 'manual', label: '✎ Edit chords', kind: 'manual' },
  { id: 'moveUp', label: 'Move up frets', kind: 'reach' },
  { id: 'easier', label: 'Easier voicings', kind: 'reach' },
  { id: 'capo', label: 'Capo', kind: 'reach' },
  { id: 'cadence', label: 'Cadence', kind: 'harmony' },
  { id: 'melody', label: '+ Melody', kind: 'musical' },
  { id: 'rhythm', label: 'Rhythm', kind: 'musical' },
  { id: 'style', label: 'Style', kind: 'musical' },
];

const DENSITIES = ['sparse', 'medium', 'busy'];
const CONTOURS = ['arch', 'ascending', 'descending', 'wave', 'static'];

export default function SongEditor({ song: initialSong, profile, onClose }) {
  const currentUser = useAuth();
  const limitToReach = useReachLimit();
  const lang = useLang();
  const tr = useT(lang);
  const [saveMsg, setSaveMsg] = useState(null);   // { type: 'ok'|'err', text }
  const [saving, setSaving] = useState(false);

  // The editable working copy. Everything downstream (timeline, sheet, transforms,
  // audio, save) reads `song` — so pointing it at a state copy means the plain-text
  // "Notepad" editor can rewrite the whole song (lyrics + chords) by parsing the
  // edited text back into this object, and every existing feature keeps working on
  // the new content with no other change.
  const [song, setSong] = useState(initialSong);
  // Re-seed if the parent opens a different song.
  useEffect(() => { setSong(initialSong); }, [initialSong]);

  const timeline = useMemo(() => resolveChordCells(song), [song]);
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

  // ─── Plain-text ("Notepad") editing ──────────────────────────────────────────
  // A full free-text editor for the whole song — chords AND lyrics as one editable
  // chord-sheet (the same format Import uses). Toggling it on serializes the current
  // working song to text; applying re-parses that text back into the working song,
  // so every other feature (marking, transforms, sing, play, save) then operates on
  // the edited content. Live overrides can't survive an arbitrary text rewrite, so
  // applying text clears them.
  const [textMode, setTextMode] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [textWarnings, setTextWarnings] = useState([]);

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
  const baseCells = useMemo(
    () => (sheetCells.length ? sheetCells : timeline.map((c, i) => ({ ...c, pos: i }))),
    [sheetCells, timeline],
  );

  // With "limit to my reach" on, promote each chord's easiest IN-REACH voicing to
  // the front so the default shape shown/played/notated everywhere in the editor
  // is one the user can comfortably play. Falls back to the overall easiest when
  // no catalogued shape qualifies, so every chord stays playable.
  const cells = useMemo(() => {
    if (!limitToReach) return baseCells;
    return baseCells.map(cell => {
      const vs = cell.voicings;
      if (!vs || vs.length < 2) return cell;
      if (isWithinReach(vs[0].score, profile)) return cell; // already easiest & in reach
      const idx = vs.findIndex(v => isWithinReach(v.score, profile));
      if (idx <= 0) return cell;                             // none in reach → leave as is
      const reordered = [vs[idx], ...vs.slice(0, idx), ...vs.slice(idx + 1)];
      return { ...cell, voicings: reordered };
    });
  }, [baseCells, limitToReach, profile]);

  // Marking: tap a cell = start; tap another = end (range). Tap inside clears.
  const [markStart, setMarkStart] = useState(null);
  const [markEnd, setMarkEnd] = useState(null);

  const [transformId, setTransformId] = useState(null);
  const [result, setResult] = useState(null);     // current TransformResult / CapoResult
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState({});       // pos -> { name, tab, notes } overrides
  const [melodyTrack, setMelodyTrack] = useState(null); // applied melody events
  // Chords ADDED to the song (cadence "add" mode): pos -> [{ name, tab, notes }]
  // inserted right after that cell. They render as green "+chord" chips, play in
  // both Play paths, and are baked into the saved lyric lines.
  const [insertions, setInsertions] = useState({});

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
  const [cadenceId, setCadenceId] = useState('perfect');
  const [cadenceMode, setCadenceMode] = useState('replace'); // 'replace' ending | 'add' after selection

  // Preview playback.
  const [playing, setPlaying] = useState(false);
  // The cell position currently sounding — highlighted live in the sheet so you
  // can follow along, karaoke-style, with whatever chord is playing right now.
  const [playingPos, setPlayingPos] = useState(null);
  const highlightTimers = useRef([]);
  const loopEnabled = useRef(false);

  // Schedule the live chord highlight to track playback: `marks` is a list of
  // { pos, at } (seconds from now) telling us when each cell starts sounding.
  // Clears any prior schedule first so loops and re-plays don't stack.
  const scheduleHighlight = useCallback((marks) => {
    highlightTimers.current.forEach(clearTimeout);
    highlightTimers.current = [];
    for (const m of marks) {
      highlightTimers.current.push(
        setTimeout(() => setPlayingPos(m.pos), Math.max(0, m.at * 1000)),
      );
    }
  }, []);
  const clearHighlight = useCallback(() => {
    highlightTimers.current.forEach(clearTimeout);
    highlightTimers.current = [];
    setPlayingPos(null);
  }, []);

  // Keep the currently-playing chord scrolled into view inside the song sheet so
  // you can follow along without hunting for it.
  const sheetScrollRef = useRef(null);
  useEffect(() => {
    if (playingPos == null || !sheetScrollRef.current) return;
    const el = sheetScrollRef.current.querySelector(`[data-cell-pos="${playingPos}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [playingPos]);
  // Backing band: play drums/bass under the guitar (applies on the next Play).
  const [drumsOn, setDrumsOn] = useState(false);
  const [bassOn, setBassOn] = useState(false);

  // Vocals: a human voice that "sings" the lyrics along with the guitar (browser
  // TTS, paced to the beat). The user picks from the installed system voices —
  // different types/genders/accents. Off by default.
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceId, setVoiceId] = useState('');
  const [voices, setVoices] = useState([]);
  const stopVocalsRef = useRef(null);
  useEffect(() => {
    if (!vocalsSupported()) return;
    const unsub = onVoicesReady((list) => {
      setVoices(list);
      // Default to the first English voice (or the first voice) once loaded.
      setVoiceId(prev => prev || (list.find(v => /^en/i.test(v.lang)) || list[0])?.id || '');
    });
    return unsub;
  }, []);
  const stopVocals = useCallback(() => {
    if (stopVocalsRef.current) { stopVocalsRef.current(); stopVocalsRef.current = null; }
    stopSinging();
  }, []);

  // Build timed lyric lines to sing over playback. Each sheet line becomes one
  // sung phrase, started at the beat where its FIRST chord sounds and paced to
  // last until the next line's chord. `beatAtPos` maps a cell position → its beat
  // offset in the current play scope; `spb` = seconds per beat; `lead` matches the
  // audio scheduler's start offset so the voice lands with the guitar. `melody`
  // gently rises/falls per line so the delivery lilts instead of monotone.
  const buildSungLines = useCallback((beatAtPos, spb, lead, songBeats, { onlyKnownBeats = false } = {}) => {
    if (!sheetLines.length) return [];
    // First-chord beat + text for every non-blank line. When onlyKnownBeats is set
    // (selection playback), skip lines whose first chord isn't in this scope's
    // beat map so we sing only the marked run, not the whole sheet.
    const raw = [];
    for (const line of sheetLines) {
      if (line.blank || !line.segments?.length) continue;
      const text = line.segments.map(s => s.text).filter(Boolean).join(' ').trim();
      if (!text) continue;
      const firstPos = line.segments[0].pos;
      if (onlyKnownBeats && beatAtPos[firstPos] == null) continue;
      const beat = beatAtPos[firstPos] ?? (firstPos * songBeats);
      raw.push({ text, beat });
    }
    raw.sort((a, b) => a.beat - b.beat);
    return raw.map((r, i) => {
      const nextBeat = i + 1 < raw.length ? raw[i + 1].beat : r.beat + songBeats;
      const durBeats = Math.max(1, nextBeat - r.beat);
      return {
        text: r.text,
        at: lead + r.beat * spb,
        dur: durBeats * spb,
        melody: Math.sin(i * 0.9),   // -1..1 lilt across successive lines
      };
    });
  }, [sheetLines]);

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

  // ─── Note sheet ──────────────────────────────────────────────────────────────
  // A treble-clef staff of the song's chords (the actual notes each voicing plays),
  // rendered from the SAME per-cell chord sequence the sheet uses (applied edits
  // included). Consecutive repeats of the same chord+shape collapse to one column;
  // each column remembers the cell positions it covers so it lights up in sync with
  // the live play highlight.
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);
  const noteColumns = useMemo(() => {
    const cols = [];
    cells.forEach((cell, pos) => {
      const ov = applied[pos];
      const name = ov?.name || cell.chordName || '';
      const tab = ov?.tab || cell.voicings?.[0]?.tab || '';
      if (!tab) return;
      const prev = cols[cols.length - 1];
      if (prev && prev.name === name && prev.tab === tab) {
        prev.positions.push(pos);           // extend the run
      } else {
        cols.push({ name, tab, positions: [pos] });
      }
    });
    return cols;
  }, [cells, applied]);
  // Which note-sheet column is sounding now (maps the live playingPos onto a column).
  const activeNoteCol = useMemo(() => {
    if (playingPos == null) return null;
    const i = noteColumns.findIndex(c => c.positions.includes(playingPos));
    return i === -1 ? null : i;
  }, [noteColumns, playingPos]);

  useEffect(() => () => {
    loopEnabled.current = false;
    stopAudio();
    stopSinging();
    highlightTimers.current.forEach(clearTimeout);
  }, []);

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

  // The marked section's chord names — fed to the shared <CapoSuggestion> banner so
  // it recomputes the same reach-driven capo the transform used. Memoized on the
  // section so the banner doesn't re-run bestCapo on unrelated re-renders.
  const capoNames = useMemo(
    () => (section ? section.chords.map(c => c.chordName) : []),
    [section],
  );

  // Apply a freshly-computed result onto the marked chords immediately. The sheet
  // re-renders the changed chords (green) right away; Play auditions the current
  // applied state. (No separate "Apply" step — transforms land on selection.)
  const applyResult = useCallback((res, sec) => {
    if (!res || !sec) return;
    if (res.kind === 'melody') {
      setMelodyTrack({ start: sec.start, events: res.events });
    } else if (res.kind === 'cadenceAdd') {
      if (res.added?.length) {
        setInsertions(prev => ({ ...prev, [sec.end]: res.added.map(a => ({ name: a.name, tab: a.tab, notes: a.notes })) }));
      }
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
      moveStyle, allowQuality, density, contour, seed, patternId, feel, presetId, useAI, cadenceId, cadenceMode,
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
        case 'cadence':
          res = transformCadence(section, profile, { cadenceId: o.cadenceId, mode: o.cadenceMode });
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
  }, [section, profile, moveStyle, allowQuality, density, contour, seed, patternId, feel, presetId, useAI, cadenceId, cadenceMode, applyResult]);

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
  }, [moveStyle, allowQuality, density, contour, seed, patternId, feel, presetId, useAI, cadenceId, cadenceMode]);

  const transformMeta = TRANSFORMS.find(t => t.id === transformId);
  const isMusical = transformMeta?.kind === 'musical';
  const isManual = transformMeta?.kind === 'manual';

  // ─── Manual chord editing ──────────────────────────────────────────────────────
  // Set a marked cell's chord by name (picks the easiest voicing for it) or to a
  // specific voicing. Writes an `applied` override keyed by position, exactly like
  // the auto-transforms, so the sheet, audio, and Save all pick it up uniformly.
  const setChordAt = (pos, chordName) => {
    const v = easiestVoicing(chordName, { profile, limitToReach });
    if (!v) return;
    setApplied(prev => ({ ...prev, [pos]: { name: chordName, tab: v.tab, notes: v.notes, type: v.type } }));
  };
  const setVoicingAt = (pos, voicing, chordName) => {
    setApplied(prev => ({ ...prev, [pos]: { name: chordName, tab: voicing.tab, notes: voicing.notes, type: voicing.type } }));
  };
  const clearChordAt = (pos) => {
    setApplied(prev => { const next = { ...prev }; delete next[pos]; return next; });
  };
  // Remove a run of added (inserted) chords hanging off a cell.
  const removeInsertionAt = (pos) => {
    setInsertions(prev => { const next = { ...prev }; delete next[pos]; return next; });
  };

  // ─── Reconcile the suggestion with the song's metadata capo ──────────────────
  // The song carries its own `capo` field (from an imported sheet, or the plain-text
  // header "Capo: N"). When the user applies the reach-driven Capo transform we
  // offer to set that metadata to the SAME fret, so the imported-sheet capo and the
  // suggestion agree and the value is serialized/saved with the song. Additive —
  // the chord-shape transform already landed on the selection; this only writes the
  // number into the song object.
  const setMetaCapo = (fret) => {
    if (fret == null) return;
    setSong(prev => ({ ...prev, capo: fret }));
    setSaveMsg({
      type: 'ok',
      text: (tr.capoMetaSet || 'Song capo set to fret {n} — save to keep it')
        .replace(/\{n\}/g, fret),
    });
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
    const done = () => { if (loopEnabled.current) playCurrent(); else { setPlaying(false); clearHighlight(); } };

    // Live chord highlight: walk the section's cells at their beat offsets so the
    // sheet lights up the chord that's sounding right now (plus any inserted chords).
    const lead = 0.15;
    const spb = 60 / section.bpm;
    const marks = [];
    const beatAtPos = {};
    let beat = 0;
    section.chords.forEach(c => {
      beatAtPos[c.index] = beat;
      marks.push({ pos: c.index, at: lead + beat * spb });
      beat += c.beats || 4;
      for (const ins of (insertions[c.index] || [])) beat += 4;
    });
    scheduleHighlight(marks);

    // Rhythm/style transforms produce a timed event stream — prefer it so the feel
    // is audible. Otherwise strum the current (applied) chord voicings.
    if (result?.events?.length) {
      const melody = melodyTrack ? melodyTrack.events : [];
      playEvents([...result.events, ...melody], done);
    } else if (melodyTrack) {
      playEvents([...chordBed(), ...melodyTrack.events], done);
    } else {
      // Strum the applied voicings, with any inserted (added-cadence) chords
      // played right after the cell they follow.
      const voicings = [];
      section.chords.forEach(c => {
        voicings.push({ tab: c.tab });
        for (const ins of (insertions[c.index] || [])) {
          if (ins.tab) voicings.push({ tab: ins.tab });
        }
      });
      playProgression(voicings, section.bpm, () => {}, done);
    }
    // Backing band under whichever guitar path played (same grid, same stop).
    if (drumsOn || bassOn) {
      const bandChords = [];
      section.chords.forEach(c => {
        bandChords.push({ name: c.chordName, beats: c.beats || 4 });
        for (const ins of (insertions[c.index] || [])) bandChords.push({ name: ins.name, beats: 4 });
      });
      playBacking(bandChords, section.bpm, { drums: drumsOn, bass: bassOn });
    }
    // Human voice singing the marked section's lyrics, in time.
    stopVocals();
    if (voiceOn) {
      const sung = buildSungLines(beatAtPos, spb, lead, 4, { onlyKnownBeats: true });
      if (sung.length) stopVocalsRef.current = singLines(sung, { voiceId });
    }
  }, [section, result, melodyTrack, chordBed, drumsOn, bassOn, insertions, scheduleHighlight, clearHighlight, voiceOn, voiceId, buildSungLines, stopVocals]);

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
    const done = () => { if (loopEnabled.current) playFullSong(); else { setPlaying(false); clearHighlight(); } };
    const songBeats = 4;
    const spb = 60 / bpm;
    const lead = 0.15;
    const marks = [];

    // Chord bed across the entire song from the applied/original voicings, with
    // inserted (added-cadence) chords woven in after the cell they follow. Track
    // each cell's actual beat offset so the melody still lands on its region.
    const events = [];
    const bandChords = [];
    const beatAtPos = {};
    let beatPos = 0;
    cells.forEach((cell, i) => {
      beatAtPos[i] = beatPos;
      marks.push({ pos: i, at: lead + beatPos * spb });
      const ov = applied[i];
      const tab = ov?.tab || cell.voicings?.[0]?.tab;
      if (tab) events.push(...tabToEvents(tab, beatPos * spb, songBeats * spb * 0.9));
      bandChords.push({ name: ov?.name || cell.chordName, beats: songBeats });
      beatPos += songBeats;
      for (const ins of (insertions[i] || [])) {
        if (ins.tab) events.push(...tabToEvents(ins.tab, beatPos * spb, songBeats * spb * 0.9));
        bandChords.push({ name: ins.name, beats: songBeats });
        beatPos += songBeats;
      }
    });
    // Layer the applied melody (its event times are relative to the marked region's
    // start cell — offset them onto the full-song timeline).
    if (melodyTrack) {
      const offset = (beatAtPos[melodyTrack.start] ?? (melodyTrack.start || 0) * songBeats) * spb;
      melodyTrack.events.forEach(e => events.push({ ...e, time: (e.time || 0) + offset }));
    }
    playEvents(events, done);
    scheduleHighlight(marks);
    // Backing band across the whole song (applied names + inserted chords).
    if (drumsOn || bassOn) {
      playBacking(bandChords, bpm, { drums: drumsOn, bass: bassOn });
    }
    // Human voice singing the lyrics over the whole song, in time.
    stopVocals();
    if (voiceOn) {
      const sung = buildSungLines(beatAtPos, spb, lead, songBeats);
      if (sung.length) stopVocalsRef.current = singLines(sung, { voiceId });
    }
  }, [cells, applied, melodyTrack, bpm, drumsOn, bassOn, insertions, scheduleHighlight, clearHighlight, voiceOn, voiceId, buildSungLines, stopVocals]);

  const playSong = () => {
    unlockAudio();
    setPlaying(true);
    setPlayScope('song');
    playFullSong();
  };

  const stop = () => { loopEnabled.current = false; stopAudio(); setPlaying(false); clearHighlight(); stopVocals(); };
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

  // ─── Plain-text editor open / apply / cancel ─────────────────────────────────
  // Open: stop playback and seed the textarea with the current song serialized to
  // the chord-sheet format — but bake any live edits (applied voicings / added
  // chords) into the text first, so what you see in Notepad matches the sheet.
  const openTextMode = () => {
    stop();
    const baked = {
      ...song,
      lyricLines: currentLyricLines(),
    };
    setDraftText(songToText(baked));
    setTextWarnings([]);
    setTextMode(true);
  };
  // Apply: parse the edited text back into the working song. Keep the identity
  // fields (id/title/artist/key) unless the text overrides them, clear live
  // overrides (they can't map onto rewritten text), and drop the marks.
  const applyTextMode = () => {
    const { song: parsed, warnings } = parseChordSheet(draftText);
    if (!parsed.lyricLines?.length && !parsed.chords?.length) {
      setTextWarnings(['Nothing to read — add chords over lyrics, e.g. a line “C  G  Am  F” above the words.']);
      return;
    }
    setSong(prev => ({
      ...prev,
      // parsed header wins when present; otherwise keep the original identity
      title: parsed.title && parsed.title !== 'Untitled' ? parsed.title : prev.title,
      artist: parsed.artist && parsed.artist !== 'Unknown' ? parsed.artist : prev.artist,
      key: parsed.key || prev.key,
      scaleType: parsed.scaleType || prev.scaleType,
      capo: parsed.capo ?? prev.capo,
      bpm: parsed.bpm ?? prev.bpm,
      degrees: parsed.degrees,
      chords: parsed.chords,
      lineChords: undefined,           // the text is authoritative now
      lyricLines: parsed.lyricLines,
      custom: true,
    }));
    // Reset everything that was keyed to the OLD positions.
    setApplied({});
    setInsertions({});
    setMelodyTrack(null);
    setMarkStart(null); setMarkEnd(null);
    setTransformId(null); setResult(null);
    setTextWarnings(warnings || []);
    setTextMode(false);
  };
  const cancelTextMode = () => { setTextMode(false); setTextWarnings([]); };

  // Revert every transform applied to the marked section back to the original.
  const revertSection = () => {
    if (!hasMark) return;
    setApplied(prev => {
      const next = { ...prev };
      for (let i = markStart; i <= markEnd; i++) delete next[i];
      return next;
    });
    setInsertions(prev => {
      const next = { ...prev };
      for (let i = markStart; i <= markEnd; i++) delete next[i];
      return next;
    });
    if (melodyTrack) setMelodyTrack(null);
    setResult(null);
    setTransformId(null);
  };

  // ─── Save (per user, to the DB when logged in) ────────────────────────────────

  // Group the per-occurrence cells back into lyric lines with every live edit baked
  // in (applied chord NAMES substituted per position; added cadence chords woven in).
  // Shared by Save and by the plain-text editor's "open" (so Notepad shows edits).
  const currentLyricLines = useCallback(() => {
    const lyricLines = [];
    if (sheetLines.length) {
      for (const line of sheetLines) {
        if (line.blank) { lyricLines.push({ text: '', chordNames: [] }); continue; }
        const chordNames = [];
        for (const s of line.segments) {
          const nm = applied[s.pos]?.name || cells[s.pos]?.chordName;
          if (nm) chordNames.push(nm);
          for (const ins of (insertions[s.pos] || [])) chordNames.push(ins.name);  // added cadence chords
        }
        const text = line.segments.map(s => s.text).filter(Boolean).join(' ');
        lyricLines.push({ text, chordNames });
      }
    } else {
      // No lyrics → one line carrying the (possibly transformed) chord sequence
      // with any added cadence chords woven in.
      const chordNames = [];
      for (const c of cells) {
        chordNames.push(applied[c.pos]?.name || c.chordName);
        for (const ins of (insertions[c.pos] || [])) chordNames.push(ins.name);
      }
      lyricLines.push({ text: '', chordNames });
    }
    return lyricLines;
  }, [sheetLines, applied, insertions, cells]);

  // Bake every applied transform into a standalone song object, tag it as a user
  // edit, and persist (localStorage always; DB when logged in).
  const saveEditedSong = async () => {
    setSaving(true);
    setSaveMsg(null);

    const lyricLines = currentLyricLines();

    // Keep the song's own name — saving edits in place, not under a new title.
    // Strip any leftover "(my edit)" suffixes from earlier builds so old copies heal.
    const cleanTitle = (song.editedFrom || song.title || 'Untitled')
      .replace(/(\s*\(my edit\))+$/i, '').trim();

    // Stable id so re-saving the same song updates the same row (local + DB)
    // instead of creating a duplicate. A built-in has no id, so derive one from
    // its identity (title|artist); an already-saved song keeps its id.
    const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const stableId = song.id || `edit_${slug(cleanTitle)}_${slug(song.artist)}`;

    const edited = {
      ...song,
      id: stableId,
      title: cleanTitle,
      artist: song.artist || '',
      key: song.key, scaleType: song.scaleType, bpm,
      lyricLines,
      custom: true,
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
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--color-surface-base)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--color-surface-700)', background: 'var(--color-surface-900)' }}>
        <button onClick={() => { stop(); onClose(); }}
          className="text-sm font-medium px-2 py-1 rounded" style={{ color: 'var(--color-ink-muted)' }}>
          ‹ Back
        </button>
        <div className="text-sm min-w-0 flex-1 text-center truncate" style={{ color: 'var(--color-ink)' }}>
          Editing: <span className="font-semibold">{song.title}</span>
          <span style={{ color: 'var(--color-ink-faint)' }}> — {song.artist}</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded mr-2" style={{ background: 'rgba(56,189,248,0.1)', color: 'var(--color-info)' }}>
          {song.key}{song.scaleType === 'minor' ? 'm' : ''} · {bpm}bpm
        </span>
        <button onClick={textMode ? cancelTextMode : openTextMode}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg mr-2"
          title="Edit the whole song (chords + lyrics) as plain text"
          style={textMode
            ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
            : { background: 'var(--color-surface-750)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
          📝 {textMode ? 'Close text' : 'Edit as text'}
        </button>
        <button onClick={saveEditedSong} disabled={saving || !timeline.length}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)', opacity: (saving || !timeline.length) ? 0.5 : 1 }}
          title={currentUser ? 'Save this edited song to your account' : 'Save on this device — sign in to sync across devices'}>
          {saving ? 'Saving…' : '💾 Save song'}
        </button>
      </div>
      {saveMsg && (
        <div className="px-4 py-1.5 text-xs text-center shrink-0"
          style={{ background: saveMsg.type === 'ok' ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.12)',
                   color: saveMsg.type === 'ok' ? 'var(--color-success)' : 'var(--color-danger)' }}>
          {saveMsg.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Plain-text ("Notepad") editor — the whole song as one editable chord
            sheet. Replaces the visual editor while open; Apply re-parses it back
            into the song so every other feature works on the edited content. */}
        {textMode && (
          <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--color-ink-faint)' }}>
                Edit song as text — chords on their own line above each lyric
              </span>
            </div>
            <textarea
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              spellCheck={false}
              rows={18}
              className="w-full font-mono text-xs rounded-lg p-3 outline-none resize-y"
              style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)', lineHeight: 1.5, whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto' }}
            />
            {textWarnings.length > 0 && (
              <div className="px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: 'var(--color-warning)' }}>
                {textWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
            <p className="text-[10px]" style={{ color: 'var(--color-ink-ghost)' }}>
              Format: a line of chords (e.g. <span className="font-mono">C  G  Am  F</span>) directly above its lyric line.
              Blank lines separate sections. Header lines like <span className="font-mono">Key: G</span>, <span className="font-mono">Capo: 2</span>, <span className="font-mono">120 bpm</span> set the song’s metadata.
              Applying replaces the song’s chords and lyrics and clears any marks or transforms.
            </p>
            <div className="flex items-center gap-2">
              <button onClick={applyTextMode}
                className="text-sm font-semibold px-4 py-2 rounded-lg"
                style={{ background: 'var(--color-success)', color: 'var(--color-surface-base)' }}>
                ✓ Apply changes
              </button>
              <button onClick={cancelTextMode}
                className="text-sm px-4 py-2 rounded-lg"
                style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {!textMode && <>
        {/* Song sheet — the words + lyrics + chords, copied onto the editor screen */}
        <div className="rounded-lg" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
          <button
            onClick={() => setSheetOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest font-semibold"
            style={{ color: 'var(--color-ink-faint)' }}
          >
            <span>Song sheet — tap chords to mark a section</span>
            <span style={{ color: 'var(--color-ink-ghost)' }}>{sheetOpen ? '▾' : '▸'}</span>
          </button>
          {sheetOpen && (
            <div className="px-3 pb-3">
              <p className="text-[11px] mb-2" style={{ color: hasMark ? 'var(--color-brand)' : 'var(--color-ink-faint)' }}>
                {hasMark
                  ? `Marked ${markStart + 1}–${markEnd + 1} — tap any chord to start over`
                  : markStart != null
                    ? 'Tap the chord that ends your section'
                    : 'Tap a chord to start marking'}
              </p>

              {sheetStatus === 'loading' && (
                <p className="text-xs italic" style={{ color: 'var(--color-ink-faint)' }}>Loading lyrics…</p>
              )}
              {(sheetStatus === 'error' || sheetStatus === 'empty' || (sheetStatus === 'done' && !sheetLines.length)) && (
                <p className="text-xs italic mb-2" style={{ color: sheetStatus === 'error' ? 'var(--color-danger)' : 'var(--color-ink-faint)' }}>
                  {sheetStatus === 'error'
                    ? 'Couldn’t load lyrics — mark the chords directly below.'
                    : 'No lyrics found — mark the chords directly below.'}
                </p>
              )}

              <div ref={sheetScrollRef} className="max-h-72 overflow-y-auto">
                {/* Chord-over-lyrics: tap a chord to mark. */}
                {sheetStatus === 'done' && sheetLines.length > 0 && sheetLines.map((line, i) => {
                  if (line.blank) return <div key={i} className="mt-2" />;
                  return (
                    <div key={i} className="mb-1.5 flex flex-wrap items-end gap-x-1 leading-tight">
                      {line.segments.map((seg, j) => (
                        <Fragment key={j}>
                          <ChordCell
                            name={applied[seg.pos]?.name || cells[seg.pos]?.chordName || ''}
                            text={seg.text}
                            pos={seg.pos}
                            marked={inSection(seg.pos)}
                            pendingStart={markStart === seg.pos && markEnd == null}
                            changed={!!applied[seg.pos]}
                            nowPlaying={playingPos === seg.pos}
                            onTap={() => tapCell(seg.pos)}
                            onHover={(e) => showShape(e, voicingFor(seg.pos))}
                            onLeave={hideShape} />
                          {insertions[seg.pos] && (
                            <InsertedChips list={insertions[seg.pos]} onRemove={() => removeInsertionAt(seg.pos)} />
                          )}
                        </Fragment>
                      ))}
                    </div>
                  );
                })}

                {/* No lyric lines → mark the bare chords (per-occurrence cells). */}
                {!(sheetStatus === 'done' && sheetLines.length > 0) && sheetStatus !== 'loading' && (
                  <div className="flex flex-wrap gap-x-1 gap-y-1.5">
                    {cells.map((cell) => (
                      <Fragment key={cell.pos}>
                        <ChordCell
                          name={applied[cell.pos]?.name || cell.chordName}
                          text=""
                          pos={cell.pos}
                          marked={inSection(cell.pos)}
                          pendingStart={markStart === cell.pos && markEnd == null}
                          changed={!!applied[cell.pos]}
                          nowPlaying={playingPos === cell.pos}
                          onTap={() => tapCell(cell.pos)}
                          onHover={(e) => showShape(e, voicingFor(cell.pos))}
                          onLeave={hideShape} />
                        {insertions[cell.pos] && (
                          <InsertedChips list={insertions[cell.pos]} onRemove={() => removeInsertionAt(cell.pos)} />
                        )}
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <button onClick={clearMarks} className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'var(--color-surface-750)', color: 'var(--color-ink-subtle)' }}>
                  Clear marks
                </button>
                {melodyTrack && (
                  <span className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'rgba(74,222,128,0.1)', color: 'var(--color-success)' }}>
                    ♪ melody applied ({melodyTrack.events.length} notes)
                  </span>
                )}
                {Object.keys(insertions).length > 0 && (
                  <span className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'rgba(74,222,128,0.1)', color: 'var(--color-success)' }}>
                    ＋ {Object.values(insertions).reduce((n, l) => n + l.length, 0)} chords added
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Note sheet — a treble-clef staff of the song's chords (the notes each
            shape actually plays). Collapsible; the sounding chord's column glows
            in time with playback. */}
        <div className="rounded-lg" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
          <button
            onClick={() => setNoteSheetOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest font-semibold"
            style={{ color: 'var(--color-ink-faint)' }}
          >
            <span>🎼 Note sheet — the chords as staff notation</span>
            <span style={{ color: 'var(--color-ink-ghost)' }}>{noteSheetOpen ? '▾' : '▸'}</span>
          </button>
          {noteSheetOpen && (
            <div className="px-3 pb-3">
              {noteColumns.length ? (
                <>
                  <div className="overflow-x-auto rounded-lg py-2" style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-700)' }}>
                    <NoteStaff chords={noteColumns} activeIndex={activeNoteCol} />
                  </div>
                  {/* Per-chord note names, e.g. "C = C·E·G". */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]" style={{ color: 'var(--color-ink-subtle)' }}>
                    {noteColumns.map((c, i) => (
                      <span key={i} className="inline-flex items-baseline gap-1">
                        <span className="font-semibold" style={{ color: 'var(--color-brand)' }}>{c.name}</span>
                        <span style={{ color: 'var(--color-ink-ghost)' }}>=</span>
                        <span className="font-mono">{chordToneNames(c.tab).join('·') || '—'}</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: 'var(--color-ink-ghost)' }}>
                    Written at the pitches each shape frets (guitar sounds one octave lower). Applied transforms are reflected here; Play highlights the sounding chord.
                  </p>
                </>
              ) : (
                <p className="text-xs italic" style={{ color: 'var(--color-ink-ghost)' }}>
                  No chord shapes to notate yet.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Transform buttons */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--color-ink-faint)' }}>
            Transforms {!hasMark && <span style={{ color: 'var(--color-ink-ghost)' }}>— mark a section first</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {TRANSFORMS.map(t => (
              <button key={t.id}
                disabled={!hasMark || busy}
                onClick={() => selectTransform(t.id)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={transformId === t.id
                  ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                  : { background: 'var(--color-surface-750)', color: hasMark ? 'var(--color-ink-muted)' : 'var(--color-ink-ghost)', border: '1px solid var(--color-surface-550)' }}
              >{t.label}</button>
            ))}
          </div>

          {/* Options strip (per active transform) */}
          {transformId && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--color-ink-subtle)' }}>
              {transformId === 'moveUp' && (
                <Seg label="shape" value={moveStyle} options={[['barre', 'Barre'], ['triad', 'Triad']]} onPick={setMoveStyle} />
              )}
              {transformId === 'easier' && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={allowQuality} onChange={e => setAllowQuality(e.target.checked)} />
                  allow substitutions (changes the sound)
                </label>
              )}
              {transformId === 'cadence' && (
                <>
                  <span className="inline-flex items-center gap-1">
                    <span style={{ color: 'var(--color-ink-faint)' }}>cadence:</span>
                    <select value={cadenceId} onChange={e => setCadenceId(e.target.value)}
                      className="rounded-md px-1.5 py-0.5"
                      style={{ background: 'var(--color-surface-800)', color: 'var(--color-brand)', border: '1px solid var(--color-surface-550)' }}>
                      {Object.entries(CADENCES).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
                    </select>
                  </span>
                  <Seg label="mode" value={cadenceMode}
                    options={[['replace', 'Replace ending'], ['add', 'Add to song']]}
                    onPick={setCadenceMode} />
                  <span style={{ color: 'var(--color-ink-ghost)' }}>
                    {cadenceMode === 'add' ? '— inserts the cadence chords after the selection' : '— rewrites the end of the selection'}
                  </span>
                </>
              )}
              {transformId === 'melody' && (
                <>
                  <Seg label="density" value={density} options={DENSITIES.map(d => [d, d])} onPick={setDensity} />
                  <SelectStrip label="contour" value={contour} options={CONTOURS} onPick={setContour} />
                  <button onClick={() => setSeed(s => s + 1)} className="px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-750)', color: 'var(--color-ink-muted)' }}>↻ Reroll</button>
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
          <div className="rounded-xl p-3" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
            <p className="text-[11px] mb-3" style={{ color: 'var(--color-ink-muted)' }}>
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
          <div className="rounded-xl p-3" style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-700)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(74,222,128,0.12)', color: 'var(--color-success)' }}>
                ✓ Applied to selection
              </span>
              {busy && <span className="text-[11px]" style={{ color: 'var(--color-ink-subtle)' }}>working…</span>}
            </div>
            {/* Headline reach badge for reach transforms */}
            {reachHeadline && (
              <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
                <span>Hardest reach:</span>
                <DifficultyBadge score={reachHeadline.before} />
                <span>→</span>
                <DifficultyBadge score={reachHeadline.after} />
                {result.fret != null && (
                  <span className="ml-1 px-2 py-0.5 rounded" style={{ background: 'rgba(74,222,128,0.1)', color: 'var(--color-success)' }}>
                    {(tr.capoSuggestFret || 'Capo {n}').replace(/\{n\}/g, result.fret)}
                    {song.capo === result.fret && (
                      <span className="ml-1" title={tr.capoMetaMatches || 'Matches the song’s capo setting'}>✓</span>
                    )}
                  </span>
                )}
              </div>
            )}

            {/* Shared capo banner — the SAME reach-driven copy/i18n and transposed
                open-shape diagrams the rest of the app shows (Progressions, Play-Along,
                Chord table). Its "Apply capo" button reconciles the song's metadata
                capo field with the suggested fret, so an imported-sheet capo and this
                suggestion agree. Every chord name inside is wrapped in <ChordTip>. */}
            {transformId === 'capo' && result.fret != null && (
              <>
                <CapoSuggestion
                  chordNames={capoNames}
                  profile={profile}
                  lang={lang}
                  onApply={setMetaCapo}
                />
                {song.capo != null && song.capo !== result.fret && (
                  <p className="text-[11px] mb-2" style={{ color: 'var(--color-ink-faint)' }}>
                    {(tr.capoMetaCurrent || 'This song is currently marked Capo {n}.')
                      .replace(/\{n\}/g, song.capo)}
                  </p>
                )}
              </>
            )}
            {result.meta?.label && (
              <div className="text-xs mb-2" style={{ color: 'var(--color-ink-muted)' }}>
                {result.meta.label} <span style={{ color: 'var(--color-ink-ghost)' }}>· {result.meta.source}</span>
              </div>
            )}

            {/* Per-chord before/after for reach transforms */}
            {result.chords && result.chords.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-3">
                {result.chords.map((c) => (
                  <div key={c.index} className="flex flex-col items-center gap-1 rounded-lg p-2" style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-700)' }}>
                    <div className="flex items-center gap-1 text-[11px]">
                      <span style={{ color: 'var(--color-ink-subtle)' }}>{c.fromName}</span>
                      {c.changed && <><span style={{ color: 'var(--color-ink-ghost)' }}>→</span><span style={{ color: 'var(--color-success)' }}>{c.toName}</span></>}
                    </div>
                    <div className="flex items-center gap-1">
                      {c.fromScore != null && <DifficultyBadge score={c.fromScore} />}
                      {c.toScore != null && <><span style={{ color: 'var(--color-ink-ghost)' }}>→</span><DifficultyBadge score={c.toScore} /></>}
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
            style={{ background: 'var(--color-surface-base)', borderTop: '1px solid var(--color-surface-700)' }}>
            {/* Play full song */}
            <button onClick={(playing && playScope === 'song') ? stop : playSong}
              className="text-sm font-semibold px-4 py-2 rounded-lg"
              style={(playing && playScope === 'song')
                ? { background: 'rgba(239,68,68,0.14)', color: 'var(--color-danger)' }
                : { background: 'rgba(129,140,248,0.12)', color: 'var(--color-accent)', border: '1px solid rgba(129,140,248,0.3)' }}>
              {(playing && playScope === 'song') ? '■ Stop' : '▶ Play full song'}
            </button>

            {/* Play selection (only when a section is marked) */}
            {hasMark && (
              <button onClick={(playing && playScope === 'selection') ? stop : play}
                className="text-sm font-semibold px-4 py-2 rounded-lg"
                style={(playing && playScope === 'selection')
                  ? { background: 'rgba(239,68,68,0.14)', color: 'var(--color-danger)' }
                  : { background: 'rgba(74,222,128,0.12)', color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.3)' }}>
                {(playing && playScope === 'selection') ? '■ Stop' : '▶ Play selection'}
              </button>
            )}

            <button onClick={toggleLoop}
              className="text-xs px-3 py-2 rounded-lg"
              style={loopEnabled.current
                ? { background: 'rgba(56,189,248,0.12)', color: 'var(--color-info)' }
                : { background: 'var(--color-surface-750)', color: 'var(--color-ink-subtle)' }}>
              ⟲ Loop
            </button>

            {/* Backing band — synthesized drums/bass under the guitar. Toggles
                take effect on the next Play (or the next loop pass). */}
            <span className="text-[10px] uppercase tracking-widest font-semibold ml-1" style={{ color: 'var(--color-ink-ghost)' }}>
              Band:
            </span>
            <button onClick={() => setDrumsOn(v => !v)}
              className="text-xs px-3 py-2 rounded-lg"
              title="Kick, snare and hats in a 4/4 groove under the chords"
              style={drumsOn
                ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                : { background: 'var(--color-surface-750)', color: 'var(--color-ink-subtle)' }}>
              🥁 Drums
            </button>
            <button onClick={() => setBassOn(v => !v)}
              className="text-xs px-3 py-2 rounded-lg"
              title="Bass walking root and fifth of each chord"
              style={bassOn
                ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                : { background: 'var(--color-surface-750)', color: 'var(--color-ink-subtle)' }}>
              🎸 Bass
            </button>

            {/* Voice — a human voice that sings the lyrics along with the song.
                Toggle it on and pick a voice type; takes effect on the next Play.
                Hidden entirely if the browser has no speech synthesis. */}
            {vocalsSupported() && (
              <>
                <span className="text-[10px] uppercase tracking-widest font-semibold ml-1" style={{ color: 'var(--color-ink-ghost)' }}>
                  Voice:
                </span>
                <button onClick={() => setVoiceOn(v => !v)}
                  className="text-xs px-3 py-2 rounded-lg"
                  title="A human voice sings the lyrics in time with the song"
                  style={voiceOn
                    ? { background: 'rgba(201,169,110,0.18)', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }
                    : { background: 'var(--color-surface-750)', color: 'var(--color-ink-subtle)' }}>
                  🎤 Sing
                </button>
                {voiceOn && (
                  <select
                    value={voiceId}
                    onChange={e => setVoiceId(e.target.value)}
                    title="Choose the singing voice"
                    className="text-xs rounded-lg px-2 py-2 max-w-[190px]"
                    style={{ background: 'var(--color-surface-800)', color: 'var(--color-brand)', border: '1px solid var(--color-surface-550)' }}>
                    {!voices.length && <option value="">Loading voices…</option>}
                    {voices.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.name}{v.gender !== 'neutral' ? ` · ${v.gender}` : ''} ({v.lang})
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}

            <div className="flex-1" />
            {hasMark && (
              <button onClick={revertSection}
                className="text-xs font-medium px-3 py-2 rounded-lg"
                style={{ background: 'var(--color-surface-750)', color: 'var(--color-ink-muted)' }}>
                ↶ Revert selection
              </button>
            )}
          </div>
        )}

        {!timeline.length && (
          <div className="text-sm italic py-6 text-center" style={{ color: 'var(--color-ink-ghost)' }}>
            This song has no resolvable chords to edit.
          </div>
        )}
        </>}
      </div>

      {/* Hover diagram — the chord shape (with suggested fingers) for the chord
          under the cursor. Mirrors the Progression Explorer tooltip. */}
      {tooltip && (
        <div className="fixed z-50 rounded-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, background: 'var(--color-surface-700)', border: '1px solid var(--color-surface-550)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {tooltip.voicing.type && (
            <div className="text-xs mb-1 text-center" style={{ color: 'var(--color-ink-faint)' }}>{tooltip.voicing.type}</div>
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg p-2" style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-700)' }}>
      <span className="text-[10px] w-8 shrink-0" style={{ color: 'var(--color-ink-ghost)' }}>#{pos + 1}</span>

      {/* Chord name picker */}
      <select value={chordNames.includes(currentName) ? currentName : ''}
        onChange={(e) => onPickName(e.target.value)}
        className="text-xs rounded px-2 py-1"
        style={{ background: 'var(--color-surface-750)', color: edited ? 'var(--color-success)' : '#e6dcc8', border: '1px solid var(--color-surface-550)' }}>
        {!chordNames.includes(currentName) && <option value="">{currentName || '—'}</option>}
        {chordNames.map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      {original && original !== currentName && (
        <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>was {original}</span>
      )}

      {/* Voicing chips for the chosen chord */}
      <div className="flex flex-wrap items-center gap-1">
        {voicings.slice(0, 6).map((v, k) => (
          <button key={k}
            onClick={() => onPickVoicing(v, currentName)}
            onMouseEnter={(e) => onHoverVoicing(e, v)} onMouseLeave={onLeaveVoicing}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: 'var(--color-surface-800)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-600)' }}
            title={`${v.type} — ${v.tab}`}>
            {v.tab}
          </button>
        ))}
        {!voicings.length && <span className="text-[10px] italic" style={{ color: 'var(--color-ink-subtle)' }}>no shape on file</span>}
      </div>

      <div className="flex-1" />
      {edited && (
        <button onClick={onReset} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-750)', color: 'var(--color-ink-subtle)' }}>
          reset
        </button>
      )}
    </div>
  );
}

// Green "+chord" chips for a run of chords ADDED to the song (cadence "add"
// mode), rendered right after the cell they follow. The ✕ removes the run.
function InsertedChips({ list, onRemove }) {
  return (
    <span className="inline-flex items-end gap-0.5">
      {list.map((ins, k) => (
        <span key={k} className="text-[11px] font-bold rounded px-1 leading-tight self-start"
          style={{ background: 'rgba(74,222,128,0.12)', color: 'var(--color-success)', border: '1px dashed rgba(74,222,128,0.5)' }}
          title="Chord added to the song (cadence)">
          +{ins.name}
        </span>
      ))}
      <button onClick={onRemove} className="text-[10px] px-0.5 self-start"
        style={{ color: 'var(--color-ink-faint)' }} title="Remove the added chords">✕</button>
    </span>
  );
}

// A single tappable chord-over-lyric cell on the song sheet. Marking a section
// is done by tapping these directly (no separate timeline). `marked` highlights
// cells inside the selection; `changed` shows a chord a transform has rewritten.
function ChordCell({ name, text, pos, marked, pendingStart, changed, nowPlaying, onTap, onHover, onLeave }) {
  // The currently-sounding chord glows so you can follow the song live — it wins
  // over the marked/changed styling while it's playing.
  return (
    <button type="button" onClick={onTap} data-cell-pos={pos}
      onMouseEnter={onHover} onMouseLeave={onLeave} onFocus={onHover} onBlur={onLeave}
      className="inline-flex flex-col items-start rounded text-left transition-colors select-none cursor-pointer"
      style={{
        background: nowPlaying ? 'rgba(129,140,248,0.28)' : marked ? 'rgba(201,169,110,0.15)' : 'transparent',
        outline: nowPlaying ? '1px solid var(--color-accent)' : pendingStart ? '1px dashed rgba(201,169,110,0.7)' : 'none',
        boxShadow: nowPlaying ? '0 0 8px rgba(129,140,248,0.5)' : 'none',
        padding: '0 3px',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}>
      <span className="font-bold select-none leading-tight"
        style={{ color: nowPlaying ? 'var(--color-accent)' : changed ? 'var(--color-success)' : marked ? 'var(--color-brand)' : 'var(--color-accent)' }}>{name || '·'}</span>
      <span className="leading-tight" style={{ color: marked ? '#b8a88a' : 'var(--color-ink-subtle)' }}>{text || ' '}</span>
    </button>
  );
}

// ─── Small option controls ──────────────────────────────────────────────────────

function Seg({ label, value, options, onPick }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label && <span style={{ color: 'var(--color-ink-faint)' }}>{label}:</span>}
      <span className="inline-flex rounded-md overflow-hidden" style={{ border: '1px solid var(--color-surface-550)' }}>
        {options.map(([val, lbl]) => (
          <button key={val} onClick={() => onPick(val)}
            className="px-2 py-0.5"
            style={value === val
              ? { background: 'rgba(201,169,110,0.2)', color: 'var(--color-brand)' }
              : { background: 'var(--color-surface-800)', color: 'var(--color-ink-subtle)' }}>
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
      <span style={{ color: 'var(--color-ink-faint)' }}>{label}:</span>
      <select value={value} onChange={e => onPick(e.target.value)}
        className="rounded-md px-1.5 py-0.5"
        style={{ background: 'var(--color-surface-800)', color: 'var(--color-brand)', border: '1px solid var(--color-surface-550)' }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </span>
  );
}

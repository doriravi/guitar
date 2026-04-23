import { useState, useMemo, useCallback, useEffect } from 'react';
import { ROOT_NOTES, getDiatonicChords } from '../lib/scales';
import { MAJOR_PROGRESSIONS, MINOR_PROGRESSIONS } from '../lib/progressions';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import { playProgression, stopAudio } from '../lib/audio';
import { SONGS_BY_PROGRESSION } from '../lib/songs';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';

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

// ─── Lyrics fetch ────────────────────────────────────────────────────────────

function LyricsSection({ title, artist, progChordsWithVoicings }) {
  const [status, setStatus] = useState('loading');
  const [lyrics, setLyrics]  = useState('');
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    setStatus('loading');
    fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`)
      .then(r => r.json())
      .then(data => {
        if (data.lyrics) { setLyrics(data.lyrics); setStatus('done'); }
        else setStatus('empty');
      })
      .catch(() => setStatus('error'));
  }, [title, artist]);

  // Build per-word chord annotations distributed evenly across the song
  const annotatedLines = useMemo(() => {
    if (status !== 'done' || !lyrics) return [];
    const rawLines = lyrics.split('\n');
    const n = progChordsWithVoicings.length;

    // Count total words to compute spacing
    let totalWords = 0;
    rawLines.forEach(l => { if (l.trim()) totalWords += l.trim().split(/\s+/).length; });

    // Estimate how many times the progression repeats through the song
    const nonBlankLines = rawLines.filter(l => l.trim()).length;
    const repetitions = Math.max(1, Math.round(nonBlankLines / 8));
    const wordsPerChord = Math.max(2, Math.floor(totalWords / (n * repetitions)));

    let globalWordIdx = 0;
    return rawLines.map(line => {
      if (!line.trim()) return { blank: true };
      const words = line.trim().split(/\s+/);
      const annotated = words.map(word => {
        const isChange = globalWordIdx % wordsPerChord === 0;
        const chord = isChange ? progChordsWithVoicings[Math.floor(globalWordIdx / wordsPerChord) % n] : null;
        globalWordIdx++;
        return { word, chord };
      });
      return { blank: false, annotated };
    });
  }, [lyrics, status, progChordsWithVoicings]);

  if (status === 'loading') return (
    <div className="px-4 py-3 text-xs text-gray-400 italic">Loading lyrics…</div>
  );
  if (status === 'error' || status === 'empty') return (
    <div className="px-4 py-3 text-xs text-gray-400 italic">Lyrics not available for this song.</div>
  );

  return (
    <div className="border-t border-gray-100 bg-white px-4 py-3 max-h-80 overflow-y-auto font-mono">
      {annotatedLines.map((line, i) => {
        if (line.blank) return <div key={i} className="mt-3" />;
        return (
          <div key={i} className="mb-2 flex flex-wrap gap-x-2 gap-y-0 leading-none">
            {line.annotated.map(({ word, chord }, j) => (
              <span key={j} className="inline-flex flex-col items-start">
                <span
                  className={`text-xs font-bold h-4 leading-none ${
                    chord ? 'text-indigo-600 cursor-default hover:text-indigo-800' : 'text-transparent select-none'
                  }`}
                  onMouseEnter={chord ? e => {
                    const v = chord.voicings[0];
                    if (!v) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    const tipW = 148;
                    setTooltip({
                      voicing: v,
                      x: r.right + 8 + tipW > window.innerWidth ? r.left - tipW - 6 : r.right + 8,
                      y: r.top - 10,
                    });
                  } : undefined}
                  onMouseLeave={chord ? () => setTooltip(null) : undefined}
                >
                  {chord ? chord.chordName : '·'}
                </span>
                <span className="text-xs text-gray-700">{word}</span>
              </span>
            ))}
          </div>
        );
      })}
      {tooltip && (
        <div
          className="fixed z-50 bg-white border border-gray-300 rounded-lg shadow-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="text-xs text-gray-400 mb-1 text-center">{tooltip.voicing.type}</div>
          <FretboardDiagram chord={tooltip.voicing} />
        </div>
      )}
    </div>
  );
}

// ─── Song row ─────────────────────────────────────────────────────────────────

function SongRow({ song, cardChordNames }) {
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Unique chords the song actually uses, in order of first appearance
  const songChordsWithVoicings = useMemo(() => {
    const diatonic = getDiatonicChords(song.key, song.scaleType);
    const seen = new Set();
    return song.degrees
      .filter(d => { if (seen.has(d)) return false; seen.add(d); return true; })
      .map(d => {
        const { chordName } = diatonic[d];
        const voicings = lookupVoicings(chordName).slice().sort((a, b) => a.score - b.score);
        return { chordName, voicings };
      });
  }, [song.key, song.scaleType, song.degrees]);

  return (
    <div className="hover:bg-white transition-colors">
      {/* Song metadata row */}
      <div className="flex items-center justify-between gap-3 px-4 pt-2.5 pb-1">
        <div className="min-w-0">
          <a
            href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(song.title + ' ' + song.artist)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-gray-900 text-sm hover:underline"
          >{song.title}</a>
          <span className="text-gray-500 text-sm"> — {song.artist}</span>
          {song.year > 0 && (
            <span className="text-gray-400 text-xs ml-1">({song.year})</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
            {song.key}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
            {song.section}
          </span>
          <button
            onClick={() => {
              if (isPlaying) {
                stopAudio();
                setIsPlaying(false);
              } else {
                const voicings = songChordsWithVoicings.map(c => c.voicings[0]).filter(Boolean);
                if (!voicings.length) return;
                setIsPlaying(true);
                playProgression(voicings, 72, () => {}, () => setIsPlaying(false));
              }
            }}
            title={isPlaying ? 'Stop' : 'Play song chords'}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs transition-colors shrink-0 ${
              isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-500'
            }`}
          >
            {isPlaying ? '■' : '▶'}
          </button>
          <button
            onClick={() => setLyricsOpen(v => !v)}
            className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
              lyricsOpen ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {lyricsOpen ? 'Hide' : 'Lyrics'}
          </button>
        </div>
      </div>
      {/* Chord row aligned to progression columns */}
      <div className="flex divide-x divide-gray-100 overflow-x-auto pb-2">
        {cardChordNames.map((chord, j) => (
          <div key={j} className="flex-1 min-w-[80px] px-3 py-1">
            <a
              href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(chord)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 rounded bg-white border border-gray-200 text-xs font-mono font-semibold text-gray-700 hover:border-gray-400 hover:text-gray-900"
            >
              {chord}
            </a>
          </div>
        ))}
      </div>
      {lyricsOpen && <LyricsSection title={song.title} artist={song.artist} progChordsWithVoicings={songChordsWithVoicings} />}
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

function SongsPanel({ progressionName, progDegrees, progScaleType, targetRoot }) {
  // Chord names + voicings for the card's current key — same for every matching song
  const progChordsWithVoicings = useMemo(() => {
    const diatonic = getDiatonicChords(targetRoot, progScaleType);
    return progDegrees.map(d => {
      const { chordName } = diatonic[d];
      const voicings = lookupVoicings(chordName).slice().sort((a, b) => a.score - b.score);
      return { chordName, voicings };
    });
  }, [targetRoot, progScaleType, progDegrees]);

  const cardChordNames = progChordsWithVoicings.map(c => c.chordName);

  const songs = (SONGS_BY_PROGRESSION[progressionName] || [])
    .filter(song => {
      if (song.scaleType !== progScaleType) return false;
      if (!containsProgression(song.degrees, progDegrees)) return false;
      const songRoot = song.key.match(/^([A-G][#b]?)/)?.[1] ?? song.key;
      return songRoot === targetRoot;
    })
    .slice(0, 10);

  if (!songs.length) {
    return (
      <div className="px-4 py-3 text-sm text-gray-400 italic border-t border-gray-100">
        No song examples on record for this progression.
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <div className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Famous songs using this progression
      </div>
      <div className="divide-y divide-gray-100">
        {songs.map((song, i) => (
          <SongRow key={i} song={song} cardChordNames={cardChordNames} />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProgressionExplorer() {
  const [root,        setRoot]        = useState('C');
  const [scaleType,   setScaleType]   = useState('major');
  const [maxDiff,     setMaxDiff]     = useState(7);
  const [playState,   setPlayState]   = useState(null);  // { key, chordIdx }
  const [openSongs,   setOpenSongs]   = useState(new Set()); // Set of card keys
  const [tooltip,     setTooltip]     = useState(null);  // { voicing, x, y }

  const allRoots   = root === 'all';
  const bothScales = scaleType === 'both';
  const multiKey   = allRoots || bothScales;

  const diatonicChords = useMemo(
    () => (!multiKey ? getDiatonicChords(root, scaleType) : null),
    [root, scaleType, multiKey],
  );

  const resolved = useMemo(() => {
    setOpenSongs(new Set());
    const roots  = allRoots   ? ROOT_NOTES         : [root];
    const scales = bothScales ? ['major', 'minor'] : [scaleType];
    const all = [];
    for (const r of roots)
      for (const st of scales)
        all.push(...resolveForKey(r, st, maxDiff));
    return all.sort((a, b) => a.maxScore - b.maxScore);
  }, [root, scaleType, maxDiff, allRoots, bothScales]);

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
    <div className="p-4">

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-4 items-end mb-5">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Root</label>
          <select
            value={root}
            onChange={e => setRoot(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="all">All roots</option>
            {ROOT_NOTES.map(n => <option key={n}>{n}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Scale</label>
          <select
            value={scaleType}
            onChange={e => setScaleType(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="both">All scales</option>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Max difficulty: <span className="text-gray-900 font-bold">{maxDiff}</span>
          </label>
          <input
            type="range" min={1} max={10} step={0.5} value={maxDiff}
            onChange={e => setMaxDiff(Number(e.target.value))}
            className="w-full accent-gray-800"
          />
        </div>
      </div>

      {/* ── Scale summary (single key only) ── */}
      {!multiKey && diatonicChords && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-5 px-3 py-2 bg-gray-50 border border-gray-200 rounded text-xs">
          <span className="font-semibold text-gray-700">{root} {scaleType}:</span>
          {diatonicChords.map(c => (
            <span key={c.degree} className="text-gray-600">
              <span className="text-gray-400">{c.roman}</span>&thinsp;{c.chordName}
            </span>
          ))}
        </div>
      )}

      {/* ── Result count ── */}
      <p className="text-sm text-gray-500 mb-3">
        {resolved.length} progression{resolved.length !== 1 ? 's' : ''} within difficulty {maxDiff}
      </p>

      {/* ── Empty state ── */}
      {resolved.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          No progressions match — try raising the max difficulty.
        </div>
      )}

      {/* ── Progression cards ── */}
      <div className="space-y-3">
        {resolved.map((prog, i) => {
          const key         = cardKey(prog);
          const isPlaying   = playState?.key === key;
          const activeChord = isPlaying ? playState.chordIdx : -1;
          const songsOpen   = openSongs.has(key);
          const songCount   = (SONGS_BY_PROGRESSION[prog.name] || []).length;

          return (
            <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">

              {/* Card header */}
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {multiKey && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                      {prog.root} {prog.scaleType === 'major' ? 'maj' : 'min'}
                    </span>
                  )}
                  <span className="font-semibold text-gray-800 text-sm">{prog.name}</span>
                  <span className="text-xs text-gray-400">{prog.genre}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    max <DifficultyBadge score={prog.maxScore} />
                  </span>

                  {/* Songs button */}
                  <button
                    onClick={() => toggleSongs(key)}
                    title={songsOpen ? 'Hide songs' : `Show famous songs (${songCount})`}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                      songsOpen
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    ♪ {songCount > 0 ? songCount : ''}
                  </button>

                  {/* Play button */}
                  <button
                    onClick={() => handlePlay(prog, key)}
                    title={isPlaying ? 'Stop' : 'Play progression'}
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs transition-colors ${
                      isPlaying
                        ? 'bg-red-500 hover:bg-red-600'
                        : 'bg-gray-800 hover:bg-gray-600'
                    }`}
                  >
                    {isPlaying ? '■' : '▶'}
                  </button>
                </div>
              </div>

              {/* Chord cells */}
              <div className="flex divide-x divide-gray-100 overflow-x-auto">
                {prog.chords.map((chord, j) => (
                  <div
                    key={j}
                    className={`flex-1 min-w-[80px] px-3 py-2.5 transition-colors duration-100 ${
                      activeChord === j ? 'bg-amber-50' : ''
                    }`}
                  >
                    <div className="text-xs text-gray-400 mb-0.5">{chord.roman}</div>
                    <div className={`font-bold text-sm mb-1.5 transition-colors ${
                      activeChord === j ? 'text-amber-700' : 'text-gray-900'
                    }`}>
                      <a
                        href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(chord.chordName)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {chord.chordName}
                      </a>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {chord.voicings.map((v, k) => (
                        <span
                          key={k}
                          className="cursor-default"
                          onMouseEnter={e => showTooltip(e, v)}
                          onMouseLeave={hideTooltip}
                        >
                          <DifficultyBadge score={v.score} />
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Songs panel (collapsible) */}
              {songsOpen && <SongsPanel progressionName={prog.name} progDegrees={prog.degrees} progScaleType={prog.scaleType} targetRoot={prog.root} />}

            </div>
          );
        })}
      </div>

      {/* ── Fretboard tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-50 bg-white border border-gray-300 rounded-lg shadow-xl p-3 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="text-xs text-gray-400 mb-1 text-center">{tooltip.voicing.type}</div>
          <FretboardDiagram chord={tooltip.voicing} />
        </div>
      )}

    </div>
  );
}

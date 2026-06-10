import { useState, useMemo, useCallback, useEffect } from 'react';
import { ROOT_NOTES, getDiatonicChords } from '../lib/scales';
import { MAJOR_PROGRESSIONS, MINOR_PROGRESSIONS } from '../lib/progressions';
import { CHORDS } from '../lib/chords';
import { calcDifficulty, fingerGapUsage, GAP_REF_MAX } from '../lib/fretboard';
import { DEFAULT_PROFILE } from '../lib/handProfile';
import { playProgression, stopAudio } from '../lib/audio';
import { SONGS_BY_PROGRESSION } from '../lib/songs';
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

  // Split lyrics into non-blank lines, then assign one chord per line cycling through the full progression
  const annotatedLines = useMemo(() => {
    if (status !== 'done' || !lyrics || !progChordsWithVoicings.length) return [];
    const n = progChordsWithVoicings.length;
    const result = [];
    let chordIdx = 0;
    for (const raw of lyrics.split('\n')) {
      if (!raw.trim()) {
        result.push({ blank: true });
        continue;
      }
      // Each lyric line gets the next chord; split the line into n segments if the progression
      // has multiple chords so every chord appears at least once per "verse block".
      // Simplest correct approach: one chord per line, cycling.
      const chord = progChordsWithVoicings[chordIdx % n];
      chordIdx++;
      result.push({ blank: false, text: raw.trim(), chord });
    }
    return result;
  }, [lyrics, status, progChordsWithVoicings]);

  if (status === 'loading') return (
    <div className="px-4 py-3 text-xs italic" style={{ color: '#3a3a3a' }}>Loading lyrics…</div>
  );
  if (status === 'error' || status === 'empty') return (
    <div className="px-4 py-3 text-xs italic" style={{ color: '#3a3a3a' }}>Lyrics not available.</div>
  );

  return (
    <div className="px-3 sm:px-4 py-3 max-h-72 overflow-y-auto font-mono text-xs"
      style={{ borderTop: '1px solid #1a1a1a', background: '#0f0f0f' }}>
      {annotatedLines.map((line, i) => {
        if (line.blank) return <div key={i} className="mt-2" />;
        const { chord, text } = line;
        const v = chord?.voicings?.[0];
        const inProg = chord?.inProgression !== false;
        return (
          <div key={i} className="mb-0.5 flex items-baseline gap-2 leading-snug">
            <span
              className="font-bold shrink-0 w-10 text-right cursor-default select-none"
              style={{ color: inProg ? '#818cf8' : '#f87171' }}
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
              {chord?.chordName}
            </span>
            <span style={{ color: '#6a6a6a' }}>{text}</span>
          </div>
        );
      })}
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

function SongRow({ song, progDegreeSet, tr }) {
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Full chord sequence from the song's own key, with inProgression flag
  const songChordsWithVoicings = useMemo(() => {
    const diatonic = getDiatonicChords(song.key, song.scaleType);
    return song.degrees.map(d => {
      const { chordName } = diatonic[d];
      const voicings = lookupVoicings(chordName).slice().sort((a, b) => a.score - b.score);
      return { chordName, voicings, inProgression: progDegreeSet.has(d) };
    });
  }, [song.key, song.scaleType, song.degrees, progDegreeSet]);

  // Deduplicated unique chords for strip display
  const stripChords = useMemo(() => {
    const seen = new Set();
    return songChordsWithVoicings.filter(c => {
      if (seen.has(c.chordName)) return false;
      seen.add(c.chordName);
      return true;
    });
  }, [songChordsWithVoicings]);

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
                const voicings = songChordsWithVoicings.map(c => c.voicings[0]).filter(Boolean);
                if (!voicings.length) return;
                setIsPlaying(true);
                playProgression(voicings, 72, () => {}, () => setIsPlaying(false));
              }
            }}
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all"
            style={isPlaying
              ? { background: 'rgba(239,68,68,0.15)', color: '#f87171' }
              : { background: '#252525', color: '#7a7a7a' }}
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

function SongsPanel({ progressionName, progDegrees, progScaleType, targetRoot, tr }) {
  // Set of degree indices that belong to this progression — used to flag "outside" chords in red
  const progDegreeSet = useMemo(() => new Set(progDegrees), [progDegrees]);

  const songs = (SONGS_BY_PROGRESSION[progressionName] || [])
    .filter(song => {
      if (song.scaleType !== progScaleType) return false;
      return containsProgression(song.degrees, progDegrees);
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
    <div style={{ borderTop: '1px solid #1e1e1e', background: '#111' }}>
      <div className="px-3 sm:px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: '#3a3a3a' }}>
        {tr.famousSongs}
      </div>
      <div style={{ borderTop: '1px solid #1a1a1a' }}>
        {songs.map((song, i) => (
          <SongRow key={i} song={song} progDegreeSet={progDegreeSet} tr={tr} />
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
          const songCount   = (SONGS_BY_PROGRESSION[prog.name] || []).length;

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

              {/* Chord cells */}
              <div className="flex overflow-x-auto" style={{ background: '#141414' }}>
                {prog.chords.map((chord, j) => (
                  <div
                    key={j}
                    className="flex-1 px-2 sm:px-3 py-2.5 transition-colors duration-100"
                    style={{
                      minWidth: 72,
                      borderRight: j < prog.chords.length - 1 ? '1px solid #1e1e1e' : 'none',
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
                    {chord.voicings[0] && (
                      <FingerGapBars notes={chord.voicings[0].notes} profile={activeProfile} />
                    )}
                  </div>
                ))}
              </div>

              {/* Songs panel (collapsible) */}
              {songsOpen && <SongsPanel progressionName={prog.name} progDegrees={prog.degrees} progScaleType={prog.scaleType} targetRoot={prog.root} tr={tr} />}

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

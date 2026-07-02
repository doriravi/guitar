import { useMemo, useState, useCallback } from 'react';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import { personalDifficulty, abilityLabel, DEFAULT_PROFILE } from '../lib/handProfile';
import { playProgression, stopAudio, audioDebug } from '../lib/audio';
import { useHandProfile } from '../App';
import DifficultyBadge from './DifficultyBadge';
import FretboardDiagram from './FretboardDiagram';
import { useT } from '../lib/i18n';

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

// First chords worth learning: simple, common, open shapes a beginner actually
// uses in real songs. We pick from these (filtered/ranked by the user's hand)
// rather than from the whole 300+ library so the shortlist stays approachable.
const BEGINNER_CANDIDATES = [
  'Em', 'E', 'A', 'Am', 'D', 'Dm', 'G', 'C',
  'A7', 'E7', 'D7', 'Em7', 'Am7', 'Cmaj7', 'G7',
];

const HOW_MANY = 5;

function fingerHint(notes) {
  // Plain-language placement: "string E, fret 2" style, low → high
  return notes
    .slice()
    .sort((a, b) => a.string - b.string)
    .map(n => `${STRING_NAMES[n.string]}${n.fret}`)
    .join('  ');
}

function isDefaultProfile(p) {
  return Object.keys(DEFAULT_PROFILE).every(k => p[k] === DEFAULT_PROFILE[k]);
}

export default function StartHere({ lang, onGoToHand }) {
  const tr = useT(lang);
  const handProfile = useHandProfile();
  const [playing, setPlaying] = useState(null); // chord name currently sounding
  const [audioDbg, setAudioDbg] = useState(null); // temp: on-screen audio diagnostics

  const usingDefault = isDefaultProfile(handProfile);
  const ability = abilityLabel(handProfile);

  const shortlist = useMemo(() => {
    const byName = new Map();
    for (const c of CHORDS) {
      if (!byName.has(c.name)) byName.set(c.name, c); // first/simplest voicing
    }
    return BEGINNER_CANDIDATES
      .map(name => byName.get(name))
      .filter(Boolean)
      .map(chord => {
        const raw = calcDifficulty(chord.notes);
        return { ...chord, score: raw, personalScore: personalDifficulty(raw, handProfile) };
      })
      .sort((a, b) => a.personalScore - b.personalScore)
      .slice(0, HOW_MANY);
  }, [handProfile]);

  const playChord = useCallback((chord) => {
    if (playing === chord.name) { stopAudio(); setPlaying(null); return; }
    stopAudio();
    setPlaying(chord.name);
    // Single chord = a one-item progression; clears the highlight when done.
    playProgression([chord], 60, () => {}, () => setPlaying(null));
    // temp diagnostics: read the audio state right after kicking off playback
    setTimeout(() => setAudioDbg(audioDebug()), 50);
  }, [playing]);

  return (
    <div className="p-4 sm:p-6">
      {/* Welcome */}
      <div className="mb-5">
        <h2 className="text-lg sm:text-xl font-bold mb-1 text-ink">
          {tr.startHereTitle || 'Start here 👋'}
        </h2>
        <p className="text-sm leading-relaxed text-ink-subtle">
          {tr.startHereIntro ||
            "These are the easiest chords for your hand — perfect first ones to learn. Tap ▶ to hear how each sounds, and follow the picture to place your fingers."}
        </p>
      </div>

      {/* TEMP audio diagnostics — remove once iOS sound is confirmed working */}
      {audioDbg && (
        <div className="mb-4 rounded-lg px-3 py-2 font-mono text-xs bg-surface-700 text-brand"
          style={{ border: '1px solid var(--color-brand)' }}>
          audio: state={audioDbg.state} · last={audioDbg.last} · rate={audioDbg.sampleRate} · t={audioDbg.currentTime}
        </div>
      )}

      {/* Hand summary / CTA */}
      <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-5"
        style={{ background: 'rgba(201,169,110,0.06)', border: '1px solid rgba(201,169,110,0.15)' }}>
        <div className="text-xs">
          <span className="text-ink-subtle">{tr.startHereYourHand || 'Your hand:'} </span>
          <span className={`font-semibold ${ability.color}`}>{ability.label}</span>
          <span className="hidden sm:inline text-ink-faint"> — {ability.desc}</span>
        </div>
        {usingDefault && onGoToHand && (
          <button
            onClick={onGoToHand}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold shrink-0 bg-brand text-surface-base"
          >
            {tr.startHereMeasure || 'Measure my hand'}
          </button>
        )}
      </div>

      {usingDefault && (
        <p className="text-xs mb-4 italic text-ink-faint">
          {tr.startHereDefaultNote ||
            'Showing results for an average hand. Measure your hand for a list tuned to you.'}
        </p>
      )}

      {/* Chord cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shortlist.map((chord, i) => {
          const isPlaying = playing === chord.name;
          return (
            <div key={chord.name} className="rounded-2xl p-4 flex flex-col items-center bg-surface-800 border border-surface-700">
              <div className="flex items-center justify-between w-full mb-2">
                <span className="text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center bg-surface-600 text-ink-subtle">{i + 1}</span>
                <DifficultyBadge score={chord.personalScore} />
              </div>

              <div className="text-2xl font-bold mb-2 text-brand">{chord.name}</div>

              <FretboardDiagram chord={chord} showFingers />

              <div className="font-mono text-xs mt-2 mb-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>
                {fingerHint(chord.notes)}
              </div>

              <button
                onClick={() => playChord(chord)}
                className={`w-full text-sm font-semibold py-2 rounded-lg transition-all ${isPlaying ? 'text-danger' : 'bg-surface-600 text-brand'}`}
                style={isPlaying ? { background: 'rgba(239,68,68,0.15)' } : undefined}
              >
                {isPlaying ? `■ ${tr.startHereStop || 'Stop'}` : `▶ ${tr.startHerePlay || 'Hear it'}`}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs mt-5 text-center text-ink-ghost">
        {tr.startHereFooter ||
          'Got these? Explore more on the Chords and Progressions tabs.'}
      </p>
    </div>
  );
}

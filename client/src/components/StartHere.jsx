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
        <h2 className="text-lg sm:text-xl font-bold mb-1" style={{ color: '#f0ede8' }}>
          {tr.startHereTitle || 'Start here 👋'}
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: '#7a7a7a' }}>
          {tr.startHereIntro ||
            "These are the easiest chords for your hand — perfect first ones to learn. Tap ▶ to hear how each sounds, and follow the picture to place your fingers."}
        </p>
      </div>

      {/* TEMP audio diagnostics — remove once iOS sound is confirmed working */}
      {audioDbg && (
        <div className="mb-4 rounded-lg px-3 py-2 font-mono text-xs"
          style={{ background: '#1e1e1e', border: '1px solid #c9a96e', color: '#c9a96e' }}>
          audio: state={audioDbg.state} · last={audioDbg.last} · rate={audioDbg.sampleRate} · t={audioDbg.currentTime}
        </div>
      )}

      {/* Hand summary / CTA */}
      <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-5"
        style={{ background: 'rgba(201,169,110,0.06)', border: '1px solid rgba(201,169,110,0.15)' }}>
        <div className="text-xs">
          <span style={{ color: '#7a7a7a' }}>{tr.startHereYourHand || 'Your hand:'} </span>
          <span className={`font-semibold ${ability.color}`}>{ability.label}</span>
          <span className="hidden sm:inline" style={{ color: '#5a5a5a' }}> — {ability.desc}</span>
        </div>
        {usingDefault && onGoToHand && (
          <button
            onClick={onGoToHand}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold shrink-0"
            style={{ background: '#c9a96e', color: '#0f0f0f' }}
          >
            {tr.startHereMeasure || 'Measure my hand'}
          </button>
        )}
      </div>

      {usingDefault && (
        <p className="text-xs mb-4 italic" style={{ color: '#5a5a5a' }}>
          {tr.startHereDefaultNote ||
            'Showing results for an average hand. Measure your hand for a list tuned to you.'}
        </p>
      )}

      {/* Chord cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shortlist.map((chord, i) => {
          const isPlaying = playing === chord.name;
          return (
            <div key={chord.name} className="rounded-2xl p-4 flex flex-col items-center"
              style={{ background: '#161616', border: '1px solid #1f1f1f' }}>
              <div className="flex items-center justify-between w-full mb-2">
                <span className="text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: '#252525', color: '#7a7a7a' }}>{i + 1}</span>
                <DifficultyBadge score={chord.personalScore} />
              </div>

              <div className="text-2xl font-bold mb-2" style={{ color: '#c9a96e' }}>{chord.name}</div>

              <FretboardDiagram chord={chord} showFingers />

              <div className="font-mono text-xs mt-2 mb-3 text-center" style={{ color: '#6a6a6a' }}>
                {fingerHint(chord.notes)}
              </div>

              <button
                onClick={() => playChord(chord)}
                className="w-full text-sm font-semibold py-2 rounded-lg transition-all"
                style={isPlaying
                  ? { background: 'rgba(239,68,68,0.15)', color: '#f87171' }
                  : { background: '#252525', color: '#c9a96e' }}
              >
                {isPlaying ? `■ ${tr.startHereStop || 'Stop'}` : `▶ ${tr.startHerePlay || 'Hear it'}`}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs mt-5 text-center" style={{ color: '#3a3a3a' }}>
        {tr.startHereFooter ||
          'Got these? Explore more on the Chords and Progressions tabs.'}
      </p>
    </div>
  );
}

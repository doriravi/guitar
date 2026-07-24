import { useMemo, useState, useCallback, useEffect } from 'react';
import { CHORDS } from '../lib/chords';
import { calcDifficulty } from '../lib/fretboard';
import { personalDifficulty, abilityLabel } from '../lib/handProfile';
import { playProgression, stopAudio } from '../lib/audio';
import { useT } from '../lib/i18n';
import FretboardDiagram from './FretboardDiagram';
import DifficultyBadge from './DifficultyBadge';
import ChordTip from './ChordTip';

// "Start here — your very first chord."
//
// The plain-words hand-off from the hand scan into actually playing (idea #1,
// Absolute Beginner). Shown ONCE, right after onboarding saves a real profile:
// instead of dumping a brand-new player into a wall of tabs, it says — in plain
// language — "your hand is best at these, here's the easiest one" and drops them
// straight onto a single chord they can play, with a picture and a Hear-it button.
//
// It picks THE one easiest open chord for the measured hand (same candidate pool
// and personalized scoring as the Start tab's shortlist), so the choice is honest
// to that hand — a smaller hand gets a genuinely easier first chord. Nothing here
// changes scoring or completes a milestone; "Let's play →" just lands the user in
// the app on the Start tab, where the full shortlist lives.
//
// Props: { lang, profile, onDone }. onDone() dismisses the welcome for good.

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

// The friendliest, most common open shapes — the ones a first-day player actually
// starts on. We pick the single easiest of these FOR THIS HAND rather than off the
// whole 300+ library, so the first chord is always approachable.
const FIRST_CANDIDATES = ['Em', 'Am', 'E', 'A', 'D', 'G', 'C', 'Dm'];

function fingerHint(notes) {
  // Plain "string + fret" placement, low string → high.
  return notes
    .slice()
    .sort((a, b) => a.string - b.string)
    .map(n => `${STRING_NAMES[n.string]}${n.fret}`)
    .join('   ');
}

export default function FirstChordWelcome({ lang, profile, onDone }) {
  const tr = useT(lang);
  const ability = abilityLabel(profile);
  const [playing, setPlaying] = useState(false);

  // The single easiest first chord for this hand.
  const chord = useMemo(() => {
    const byName = new Map();
    for (const c of CHORDS) {
      if (!byName.has(c.name)) byName.set(c.name, c); // first/simplest voicing
    }
    const ranked = FIRST_CANDIDATES
      .map(name => byName.get(name))
      .filter(Boolean)
      .map(c => {
        const raw = calcDifficulty(c.notes);
        return { ...c, score: raw, personalScore: personalDifficulty(raw, profile) };
      })
      .sort((a, b) => a.personalScore - b.personalScore);
    return ranked[0] || null;
  }, [profile]);

  // Stop any lingering sound if the welcome unmounts mid-strum.
  useEffect(() => () => { stopAudio(); }, []);

  const hearIt = useCallback(() => {
    if (!chord) return;
    if (playing) { stopAudio(); setPlaying(false); return; }
    stopAudio();
    setPlaying(true);
    playProgression([chord], 60, () => {}, () => setPlaying(false));
  }, [chord, playing]);

  const finish = useCallback(() => { stopAudio(); onDone(); }, [onDone]);

  return (
    <div className="min-h-screen bg-surface-base">
      <main className="max-w-md mx-auto px-4 py-10 sm:py-14">
        <div className="mb-6 text-center">
          <div className="text-4xl mb-3" aria-hidden="true">🎸</div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink mb-2">
            {tr.firstChordTitle || "You're ready — here's your first chord"}
          </h1>
          <p className="text-sm leading-relaxed text-ink-subtle">
            {/* Plain-words framing tuned to the measured hand. */}
            {(tr.firstChordIntro ||
              'Based on your hand, this is the easiest chord for you to start with. Follow the picture, then tap to hear how it should sound.')}
          </p>
        </div>

        {/* Hand summary in plain language — "the app cares whether MY hand can do it". */}
        <div className="rounded-xl px-4 py-3 mb-5 text-center text-xs"
          style={{ background: 'rgba(201,169,110,0.06)', border: '1px solid rgba(201,169,110,0.15)' }}>
          <span className="text-ink-subtle">{tr.startHereYourHand || 'Your hand:'} </span>
          <span className={`font-semibold ${ability.color}`}>{ability.label}</span>
          <span className="block mt-0.5 text-ink-faint">{ability.desc}</span>
        </div>

        {chord ? (
          <div className="rounded-2xl p-5 flex flex-col items-center bg-surface-800 border border-surface-700">
            <div className="flex items-center gap-3 mb-3">
              {/* CLAUDE.md rule: the chord name shows its shape on hover/focus too. */}
              <ChordTip name={chord.name}>
                <span className="text-3xl font-bold text-brand cursor-help">{chord.name}</span>
              </ChordTip>
              <DifficultyBadge score={chord.personalScore} />
            </div>

            <FretboardDiagram chord={chord} showFingers />

            <div className="font-mono text-xs mt-3 mb-4 text-center" style={{ color: 'var(--color-ink-faint)' }}>
              {fingerHint(chord.notes)}
            </div>

            <button
              onClick={hearIt}
              className={`w-full text-sm font-semibold py-2.5 rounded-lg transition-all ${playing ? 'text-danger' : 'bg-surface-600 text-brand'}`}
              style={playing ? { background: 'rgba(239,68,68,0.15)' } : undefined}
            >
              {playing ? `■ ${tr.startHereStop || 'Stop'}` : `▶ ${tr.startHerePlay || 'Hear it'}`}
            </button>
          </div>
        ) : (
          // The candidate pool always has shapes on file, so this is defensive only.
          <p className="text-sm text-center text-ink-subtle">
            {tr.firstChordFallback || "Let's find your first chord together — jump in below."}
          </p>
        )}

        <button
          onClick={finish}
          className="mt-6 w-full text-base font-bold py-3 rounded-xl bg-brand text-surface-base
            transition-transform active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {tr.firstChordGo || "Let's play →"}
        </button>

        <p className="text-xs mt-4 text-center text-ink-ghost">
          {tr.firstChordFooter ||
            'You can always come back to your easy chords on the Start tab.'}
        </p>
      </main>
    </div>
  );
}

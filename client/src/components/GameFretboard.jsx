// GameFretboard — the Scale Quest play + review surface.
//
// A windowed fretboard (just the box's frets, high-e on top → low-E on the
// bottom, matching FretboardNoteMap's tab-view convention), purpose-built for the
// game. It reuses that grid's cell model and cyan-scale / white-ring visual
// language, but adds the two layers the game needs — and holds the line the whole
// design rests on:
//
//   PROMPT  (solid, pulsing gold ⟦⟧) = "play THIS" — a certain instruction.
//   DETECTION (soft dashed indigo rings) = "we heard this pitch, here are ALL its
//              positions" — because audio can't see your finger, so it must show
//              the ambiguity honestly, never a single guessed fret.
//
// The two are drawn deliberately unalike so a player never mistakes what the app
// KNOWS (the pitch it heard) for what it's ASKING (the position it wants).
//
// mode 'play'   — live: the current target pulses, the heard pitch class rings.
// mode 'review' — the results board: each target shown as hit/miss "where the
//                 note we asked for LIVED", never "where you played" (unknowable).

import { OPEN_STRING_MIDI, NOTE_NAMES } from '../lib/chordAnalyzer';

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']; // 0 = low E … 5 = high e

const noteName = (s, f) => NOTE_NAMES[(OPEN_STRING_MIDI[s] + f) % 12];
const cellKey = (s, f) => `${s}:${f}`;

export default function GameFretboard({
  box,                 // { minFret, maxFret }
  scaleCells = [],     // [{string,fret,pc,degree}] — the box's scale notes (cyan)
  targetCell = null,   // {string,fret} — the one the game is asking for NOW (play)
  twinCells = [],      // [{string,fret}] — same-pitch twins of the target (dashed)
  liveSet = null,      // Set<pc> currently sounding (soft rings), or null
  mode = 'play',       // 'play' | 'review'
  reviewResults = [],  // [{string,fret,degree,hit}] — for mode 'review'
  showLabels = true,   // Note-Hunt fades labels; play/scale mode shows them
  lang,                // reserved for future i18n of the empty-state
}) {
  const minF = box?.minFret ?? 0;
  const maxF = box?.maxFret ?? 12;
  const frets = [];
  for (let f = minF; f <= maxF; f++) frets.push(f);

  const scaleAt = new Map(scaleCells.map((c) => [cellKey(c.string, c.fret), c]));
  const twinAt = new Set(twinCells.map((c) => cellKey(c.string, c.fret)));
  const reviewAt = new Map(reviewResults.map((r) => [cellKey(r.string, r.fret), r]));
  const targetK = targetCell ? cellKey(targetCell.string, targetCell.fret) : null;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${Math.max(18, frets.length * 3)}rem` }}>
        {/* Fret-number header */}
        <div className="flex items-center mb-1">
          <div style={{ width: '2rem' }} />
          {frets.map((f) => (
            <div key={f} className="flex-1 text-center text-[10px] tabular-nums"
              style={{ color: 'var(--color-ink-faint)' }}>{f}</div>
          ))}
        </div>

        {/* high-e (5) on top → low-E (0) on the bottom */}
        {[5, 4, 3, 2, 1, 0].map((s) => (
          <div key={s} className="flex items-center mb-1">
            <div className="text-xs font-bold text-center" style={{ width: '2rem', color: 'var(--color-ink-muted)' }}>
              {STRING_LABELS[s]}
            </div>
            {frets.map((f) => {
              const k = cellKey(s, f);
              const scaleNote = scaleAt.get(k);
              const isTarget = k === targetK;
              const isTwin = twinAt.has(k);
              const pc = (OPEN_STRING_MIDI[s] + f) % 12;
              const nowPlaying = liveSet && liveSet.has(pc);
              const review = reviewAt.get(k);

              let style;
              let badge = null;
              let ariaExtra = '';

              if (mode === 'review' && review) {
                // Review: mark where the asked-for note LIVED, hit or missed.
                const ok = review.hit;
                style = {
                  background: ok ? 'rgba(47,125,107,0.85)' : 'rgba(178,59,59,0.85)',
                  color: '#fff',
                  border: `1px solid ${ok ? '#5fbfa6' : '#e06868'}`,
                };
                badge = ok ? '✓' : '✗';
                ariaExtra = ok ? ' — you hit this' : ' — target you missed';
              } else if (isTarget) {
                // PROMPT — solid, pulsing gold. "Play THIS."
                style = {
                  background: 'var(--color-brand, #e0a93a)',
                  color: '#3a2708',
                  border: '2px solid #fff3cf',
                  boxShadow: '0 0 12px 2px rgba(224,169,58,0.65)',
                  animation: 'sq-pulse 900ms ease-in-out infinite',
                };
                ariaExtra = ' — play this now';
              } else if (isTwin) {
                // A twin of the target: same pitch, a different fret. Dashed so the
                // player sees the app knows this spot ALSO makes the target note.
                style = {
                  background: 'transparent',
                  color: 'var(--color-ink-faint)',
                  border: '1.5px dashed var(--color-ink-faint)',
                };
                badge = '( )';
                ariaExtra = ' — same note, also counts';
              } else if (nowPlaying) {
                // DETECTION — soft dashed indigo ring at EVERY position of the
                // heard pitch. Deliberately unlike the solid prompt.
                style = {
                  background: 'rgba(91,91,214,0.16)',
                  color: '#9a9af0',
                  border: '2px dashed #5b5bd6',
                };
                ariaExtra = ' — heard now';
              } else if (scaleNote) {
                style = {
                  background: 'rgba(56,189,248,0.16)',
                  color: '#7dd3fc',
                  border: '1px solid rgba(56,189,248,0.4)',
                };
              } else {
                style = {
                  background: 'var(--color-surface-800, #1e1a12)',
                  color: 'var(--color-ink-faint)',
                  border: '1px solid var(--color-surface-650, #2c2619)',
                  opacity: 0.4,
                };
              }

              const label = scaleNote?.degree || review?.degree;
              return (
                <div key={f} className="flex-1 px-0.5">
                  <div className="text-center rounded text-[11px] font-semibold py-1 select-none"
                    style={style}
                    aria-label={`${noteName(s, f)}${ariaExtra}`}
                    title={`${noteName(s, f)}${label ? ` · ${label}` : ''}`}>
                    {showLabels || isTarget || badge ? (badge || noteName(s, f)) : '·'}
                    {label && showLabels && !badge && (
                      <span className="ml-0.5 text-[8px] font-bold" style={{ opacity: 0.7 }}>{label}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* The pulse keyframes, scoped here so the component is self-contained.
          Respects reduced-motion by holding the lit state instead of animating. */}
      <style>{`
        @keyframes sq-pulse {
          0%, 100% { box-shadow: 0 0 8px 1px rgba(224,169,58,0.5); }
          50%      { box-shadow: 0 0 16px 4px rgba(224,169,58,0.85); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="sq-pulse"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

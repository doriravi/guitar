// FretboardNoteMap — a "learn the neck" reference chart.
//
// Every note from the nut to the 12th fret (a full octave — notes repeat at 12),
// laid out like a tab view: high-e on top, low-E at the bottom.
//
// This is PURE DATA derived from geometry.js/chordAnalyzer.js, so it is always
// correct and always available — no camera, no calibration, nothing to fail.
//
// History: this screen used to carry a camera half that projected note labels
// onto the real fretboard, which depended on detecting the physical neck. That
// detection proved unreliable (clutter won the dominant axis, lighting moved the
// band, the board drifted while playing) and has been removed from the app; the
// camera work now lives in the Virtual Neck tab, which draws its own board and
// tracks only the hand. The grid stayed because its value never depended on the
// camera in the first place.

import { useT } from '../lib/i18n';
import { OPEN_STRING_MIDI, NOTE_NAMES } from '../lib/chordAnalyzer';

const FRETS = 12;                                     // nut → 12th = one octave
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']; // 0 = low E … 5 = high e
const IS_SHARP = (pc) => NOTE_NAMES[pc].includes('#');

// Note name at (string, fret) — open-string MIDI + fret semitones.
function noteAt(string, fret) {
  return NOTE_NAMES[(OPEN_STRING_MIDI[string] + fret) % 12];
}

export default function FretboardNoteMap({ lang }) {
  const tr = useT(lang);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <span className="text-base">🎼</span>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
          {tr.noteMapTitle || 'Fretboard Note Map'}
        </span>
      </div>

      <div className="p-4 overflow-x-auto">
        <p className="text-sm mb-4" style={{ color: 'var(--color-ink-muted)' }}>
          {tr.noteMapIntro2 ||
            'Every note from the nut to the 12th fret. At the 12th the notes repeat — it’s the same as the open string, one octave up.'}
        </p>

        <div style={{ minWidth: '34rem' }}>
          {/* Fret-number header */}
          <div className="flex items-center mb-1">
            <div style={{ width: '2rem' }} />
            {Array.from({ length: FRETS + 1 }, (_, f) => (
              <div key={f} className="flex-1 text-center text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                {f}
              </div>
            ))}
          </div>

          {/* high-e (5) at top → low-E (0) at the bottom, like a tab view */}
          {[5, 4, 3, 2, 1, 0].map((s) => (
            <div key={s} className="flex items-center mb-1">
              <div className="text-xs font-bold text-center" style={{ width: '2rem', color: 'var(--color-ink-muted)' }}>
                {STRING_LABELS[s]}
              </div>
              {Array.from({ length: FRETS + 1 }, (_, f) => {
                const pc = (OPEN_STRING_MIDI[s] + f) % 12;
                const open = f === 0;
                return (
                  <div key={f} className="flex-1 px-0.5">
                    <div
                      className="text-center rounded text-[11px] font-semibold py-1"
                      style={{
                        background: open
                          ? 'var(--color-surface-650)'
                          : IS_SHARP(pc) ? 'var(--color-surface-800)' : 'var(--color-surface-700)',
                        color: IS_SHARP(pc) ? 'var(--color-ink-faint)' : 'var(--color-ink)',
                        border: '1px solid var(--color-surface-650)',
                      }}
                    >
                      {noteAt(s, f)}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <p className="text-[11px] mt-3" style={{ color: 'var(--color-ink-faint)' }}>
          {tr.noteMapLegend2 ||
            'Fret 0 = the open string. Naturals are bright, sharps/flats dimmed.'}
        </p>
      </div>
    </div>
  );
}

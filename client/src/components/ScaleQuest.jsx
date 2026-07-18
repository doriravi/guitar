// ScaleQuest — the scale-practice game: pick a scale, the app prompts one spot
// at a time, hears the note you play, and scores three honest things — accuracy,
// speed, and (in a collision-free box) fretboard memory.
//
// This is the shell that composes the three screens (setup → play → results)
// around useScaleQuest (the mic + game state) and GameFretboard (the surface).
// All the hard logic lives elsewhere and is unit-tested: scoring and box math in
// scaleGame.js, the ring-over capture in makeNoteCapture, the mic loop in
// useScaleQuest. This file is presentation + flow.

import { useState, useMemo } from 'react';
import { useT } from '../lib/i18n';
import { useScaleQuest } from '../lib/useScaleQuest';
import GameFretboard from './GameFretboard';
import Celebration from './Celebration';
import { NOTE_NAMES } from '../lib/chordAnalyzer';
import {
  SCALE_LABELS, scalePositions,
} from '../lib/improvEngine';
import {
  scaleBoxes, buildTargetSequence, SCALE_UNLOCK_ORDER,
} from '../lib/scaleGame';
import { scaleMastery, GRADE_COLOR } from '../lib/scalePractice';

const MODES = [
  { id: 'run', labelKey: 'sqModeRun', label: 'Run ↑↓', tip: 'Play the scale up and down. Scores accuracy + speed.' },
  { id: 'hunt', labelKey: 'sqModeHunt', label: 'Note-Hunt', tip: 'Find prompted notes from memory. Scores fretboard memory.' },
];

function Stars({ n }) {
  return (
    <span aria-label={`${n} of 5 stars`} style={{ letterSpacing: '1px' }}>
      {'★'.repeat(n)}<span style={{ opacity: 0.3 }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export default function ScaleQuest({ lang, onClose }) {
  const tr = useT(lang);
  const game = useScaleQuest();

  // Setup selections.
  const [root, setRoot] = useState(9);                 // A
  const [scaleId, setScaleId] = useState('minorPentatonic');
  const [mode, setMode] = useState('run');
  const [bpm, setBpm] = useState(80);
  const [boxIdx, setBoxIdx] = useState(0);

  // Only offer boxes that are collision-free (position scoring is honest only
  // there). The setup screen shows just the clean ones.
  const boxes = useMemo(() => {
    const all = scaleBoxes(root, scaleId) || [];
    return all.filter((b) => b.clean);
  }, [root, scaleId]);

  const box = boxes[Math.min(boxIdx, Math.max(0, boxes.length - 1))] || null;
  const scaleLabel = `${NOTE_NAMES[root]} ${SCALE_LABELS[scaleId] || scaleId}`;
  const mastery = useMemo(() => scaleMastery(scaleLabel), [scaleLabel, game.result]);

  // The box's scale cells, for the board underlay.
  const scaleCells = useMemo(
    () => (box ? scalePositions(root, scaleId, { minFret: box.minFret, maxFret: box.maxFret }) || [] : []),
    [root, scaleId, box],
  );

  const begin = () => {
    if (!box) return;
    game.start({ root, scaleId, box, mode, bpm, labelsOff: mode === 'hunt' });
  };

  // ── SETUP ──────────────────────────────────────────────────────────────────
  if (game.phase === 'select') {
    return (
      <Shell onClose={onClose} tr={tr}>
        <div className="p-5 space-y-5">
          {/* Key + scale */}
          <div className="flex flex-wrap items-center gap-3">
            <Field label={tr.sqKey || 'Key'}>
              <select value={root} onChange={(e) => setRoot(Number(e.target.value))} style={selectStyle}>
                {NOTE_NAMES.map((n, pc) => <option key={pc} value={pc}>{n}</option>)}
              </select>
            </Field>
            <Field label={tr.sqScale || 'Scale'}>
              <select value={scaleId} onChange={(e) => { setScaleId(e.target.value); setBoxIdx(0); }} style={selectStyle}>
                {SCALE_UNLOCK_ORDER.map((id) => <option key={id} value={id}>{SCALE_LABELS[id]}</option>)}
              </select>
            </Field>
          </div>

          {/* Box — clean boxes only */}
          <Field label={tr.sqBox || 'Position box'}>
            {boxes.length ? (
              <div className="flex flex-wrap gap-2">
                {boxes.map((b, i) => (
                  <button key={b.id} onClick={() => setBoxIdx(i)}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={i === boxIdx
                      ? { background: 'var(--color-brand)', color: '#0b0b0b', fontWeight: 600 }
                      : { border: '1px solid var(--color-surface-550)', color: 'var(--color-ink-muted)' }}>
                    {b.label} <span style={{ color: i === boxIdx ? '#0b0b0b' : 'var(--color-ok, #34d399)' }}>✓</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                {tr.sqNoCleanBox || 'No collision-free box for this scale yet — try a pentatonic (position scoring needs a box where every note has a unique pitch).'}
              </p>
            )}
          </Field>

          {/* Mode */}
          <Field label={tr.sqMode || 'Mode'}>
            <div className="flex gap-2">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => setMode(m.id)} title={m.tip}
                  className="text-xs px-3 py-1.5 rounded-lg"
                  style={mode === m.id
                    ? { background: 'var(--color-brand)', color: '#0b0b0b', fontWeight: 600 }
                    : { border: '1px solid var(--color-surface-550)', color: 'var(--color-ink-muted)' }}>
                  {tr[m.labelKey] || m.label}
                </button>
              ))}
            </div>
          </Field>

          {/* Tempo */}
          <Field label={`${tr.sqTempo || 'Tempo'} · ${bpm} BPM`}>
            <input type="range" min="50" max="120" step="4" value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))} style={{ width: '14rem' }} />
            <span className="text-[10px] ml-2" style={{ color: 'var(--color-ink-faint)' }}>
              {tr.sqTempoCap || 'capped at 120 — the honest pitch-scoring ceiling'}
            </span>
          </Field>

          {/* The honesty line — always visible on setup */}
          <div className="text-xs rounded-lg p-3" style={{ background: 'var(--color-surface-800)', border: '1px solid var(--color-surface-650)', color: 'var(--color-ink-muted)' }}>
            {tr.sqHonesty ||
              'The mic hears the NOTE and its octave, not your finger. Note-Hunt scores WHERE (in a clean box); Run scores the notes you play. Some notes share a pitch — either counts, marked ( ).'}
          </div>

          {/* Best + start */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
              {mastery.crown > 0
                ? <>{tr.sqCrown || 'Mastery'}: <Stars n={mastery.crown} /></>
                : (tr.sqNoCrown || 'Not yet mastered — play both Run and Note-Hunt to earn a crown.')}
            </div>
            <button onClick={begin} disabled={!box}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold"
              style={box
                ? { background: 'var(--color-brand)', color: '#0b0b0b' }
                : { background: 'var(--color-surface-700)', color: 'var(--color-ink-faint)' }}>
              {tr.sqStart || '▶ Start Quest'}
            </button>
          </div>
          {game.error && <p className="text-xs" style={{ color: 'var(--color-danger, #ef4444)' }}>{game.error}</p>}
        </div>
      </Shell>
    );
  }

  // ── COUNT-IN + PLAY ──────────────────────────────────────────────────────────
  if (game.phase === 'countin' || game.phase === 'play') {
    const t = game.currentTarget;
    const twins = t?.twins || [];
    const inCount = game.phase === 'countin';
    return (
      <Shell onClose={game.abort} tr={tr} closeLabel={tr.sqQuit || '✕ Quit'}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
              {scaleLabel} · {box?.label} · {mode === 'run' ? '▲ Run' : '🎯 Note-Hunt'}
            </div>
            <div className="flex items-center gap-4 text-xs tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>
              <span>{bpm} BPM</span>
              <span>{tr.sqScore || 'Score'} <b style={{ color: 'var(--color-ink)' }}>{game.score}</b></span>
              <span style={{ color: game.combo >= 5 ? 'var(--color-brand)' : 'inherit' }}>🔥 {game.combo}</span>
            </div>
          </div>

          {inCount ? (
            <div className="text-center py-6">
              <div style={{ fontSize: '3rem', fontWeight: 700, color: 'var(--color-brand)' }}>{game.countdown}</div>
              <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
                {tr.sqGetReady || 'Get ready — play the highlighted note on each beat.'}
              </p>
            </div>
          ) : (
            <GameFretboard
              box={box}
              scaleCells={scaleCells}
              targetCell={t ? { string: t.string, fret: t.fret } : null}
              twinCells={twins}
              liveSet={game.liveNote ? new Set([game.liveNote.pc]) : null}
              mode="play"
              showLabels={mode !== 'hunt'}
              lang={lang}
            />
          )}

          <div className="mt-3 text-xs flex items-center justify-between" style={{ color: 'var(--color-ink-faint)' }}>
            <span>
              {t
                ? (mode === 'hunt'
                    ? `${tr.sqFind || 'Find the'} ${t.degree} (${NOTE_NAMES[t.pc]}) ${tr.sqOnString || 'on the'} ${['low E', 'A', 'D', 'G', 'B', 'high e'][t.string]} ${tr.sqString || 'string'}`
                    : `${tr.sqPlay || 'Play'} ${NOTE_NAMES[t.pc]} · ${t.degree}`)
                : ''}
            </span>
            {game.liveNote && (
              <span style={{ color: 'var(--color-ink-muted)' }}>
                ♪ {NOTE_NAMES[game.liveNote.pc]}{game.liveNote.cents ? ` ${game.liveNote.cents > 0 ? '+' : ''}${game.liveNote.cents}¢` : ''}
              </span>
            )}
          </div>
          {game.micOk === false && (
            <p className="text-xs mt-2" style={{ color: 'var(--color-danger, #ef4444)' }}>
              {tr.sqMicQuiet || 'I couldn’t hear you during the count-in — play louder or move the mic closer.'}
            </p>
          )}
        </div>
      </Shell>
    );
  }

  // ── RESULTS ──────────────────────────────────────────────────────────────────
  const r = game.result;
  if (game.phase === 'score' && r) {
    const bars = [
      { key: 'accuracy', label: tr.sqAccuracy || 'Accuracy', sub: tr.sqAccuracySub || 'in-scale, in order', track: r.accuracy },
      { key: 'speed', label: tr.sqSpeed || 'Speed', sub: tr.sqSpeedSub || 'kept to tempo', track: r.speed },
      { key: 'memory', label: tr.sqMemory || 'Memory', sub: tr.sqMemorySub || 'right octave, right box', track: r.memory },
    ];
    return (
      <Shell onClose={onClose} tr={tr}>
        <div className="p-5 space-y-4">
          {/* Celebration — only renders when this take actually advanced the
              player (new best / crown / cleared tempo / milestone). */}
          {r.advancement?.advanced && <Celebration advancement={r.advancement} tr={tr} />}

          <div className="text-center">
            <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>{scaleLabel} · {box?.label}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--color-ink-faint)' }}>
              {mode === 'run' ? (tr.sqModeRun || 'Run ↑↓') : (tr.sqModeHunt || 'Note-Hunt')}
            </div>
          </div>

          {/* Three SEPARATE goal bars — never one blended number. */}
          <div className="space-y-3">
            {bars.map((b) => (
              <div key={b.key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: 'var(--color-ink)' }}>
                    {b.label} <Stars n={b.track.stars} />
                    <span style={{ color: GRADE_COLOR?.[b.track.grade] || 'var(--color-ink-faint)', marginLeft: 6, fontWeight: 700 }}>{b.track.grade}</span>
                  </span>
                  <span className="tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>{b.track.score}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--color-surface-700)', overflow: 'hidden' }}>
                  <div style={{ width: `${b.track.score}%`, height: '100%', background: 'var(--color-brand)' }} />
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-ink-faint)' }}>
                  {b.sub}{b.track.capped ? ` · ${tr.sqCapped || 'capped'}: ${b.track.capped}` : ''}
                </div>
              </div>
            ))}
          </div>

          {/* Misses on the neck — PROMPT truth ("where the target lived"). */}
          <div>
            <p className="text-xs mb-2" style={{ color: 'var(--color-ink-muted)' }}>
              {tr.sqWhereLived || 'Where the target notes lived — ✓ hit, ✗ missed:'}
            </p>
            <GameFretboard box={box} mode="review" reviewResults={r.targetResults} showLabels />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <button onClick={() => game.retry()} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-brand)', color: '#0b0b0b' }}>
                {tr.sqRetry || '↻ Retry'}
              </button>
              {bpm < 120 && mode === 'run' && (
                <button onClick={() => { setBpm(Math.min(120, bpm + 8)); game.abort(); }} className="px-4 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}>
                  {tr.sqFaster || '⏩ +8 BPM'}
                </button>
              )}
            </div>
            <button onClick={game.abort} className="px-4 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--color-surface-550)', color: 'var(--color-ink-muted)' }}>
              {tr.sqChange || '⚙ Change'}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return <Shell onClose={onClose} tr={tr}><div className="p-8 text-center text-sm" style={{ color: 'var(--color-ink-muted)' }}>{tr.loading || 'Loading…'}</div></Shell>;
}

// ── Small presentational helpers ──────────────────────────────────────────────
const selectStyle = {
  background: 'var(--color-surface-700)', color: 'var(--color-ink)',
  border: '1px solid var(--color-surface-550)', borderRadius: 8, padding: '4px 8px', fontSize: 13,
};

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-faint)', letterSpacing: '0.08em' }}>{label}</span>
      <div className="flex items-center flex-wrap gap-2">{children}</div>
    </label>
  );
}

function Shell({ children, onClose, tr, closeLabel }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface-750)', border: '1px solid var(--color-surface-650)' }}>
      <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-surface-650)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">🎯</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{tr.sqTitle || 'Scale Quest'}</span>
        </div>
        <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg"
          style={{ color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-550)' }}>
          {closeLabel || (tr.sqExit || '✕ Close')}
        </button>
      </div>
      {children}
    </div>
  );
}

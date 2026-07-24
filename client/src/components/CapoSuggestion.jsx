// CapoSuggestion — the ONE reusable capo banner shared by every surface
// (Progressions, Play-Along, Chord table/finder, Song editor). Centralizing it
// means the capo helper looks and behaves identically everywhere.
//
// It calls bestCapo(chordNames, profile) — the reach-driven optimizer in
// lib/capo.js — and renders nothing when no capo helps. When one does, it shows
// an on-brand green banner (matching ProgressionExplorer's existing capo banner
// style) explaining, in plain language, "Capo N → play these easy open shapes
// instead of barre chords", the reach savings, and each transposed-down OPEN
// shape as a small FretboardDiagram with its capoName. Every chord name shown is
// wrapped in <ChordTip> so hovering reveals the shape (CLAUDE.md rule).
//
// Props:
//   chordNames : string[]  — the chords used in the song/section
//   profile?               — active hand profile; omit for the population average
//   lang                   — current language code (for useT)
//   onApply?   : (fret) => void — when present, renders an "Apply capo" button
//                                 that fires with the chosen capo fret (e.g. the
//                                 Song Importer sets its metadata capo field).
//                                 Absent ⇒ the banner is display-only.
//   compact?   : boolean   — slimmer inline version (title + fret only), for the
//                            Chord table's per-chord hint.
//   enabled?   : boolean   — with onToggle, the on/off state of the capo. When
//                            false the banner collapses to the "why + turn on"
//                            state (the surface shows the real chords). Defaults
//                            to true. Ignored when onToggle is absent.
//   onToggle?  : (on:boolean) => void — when present, renders an on/off switch so
//                            the user can turn the capo restatement off (see the
//                            song's real chords) and back on.

import { useMemo } from 'react';
import { bestCapo } from '../lib/capo';
import { useT } from '../lib/i18n';
import ChordTip from './ChordTip';
import FretboardDiagram from './FretboardDiagram';

// Green capo-banner palette — lifted verbatim from ProgressionExplorer's banner
// so every surface matches to the pixel.
const BG = 'rgba(74,222,128,0.06)';
const BORDER = '1px solid rgba(74,222,128,0.2)';
const INK = 'var(--color-success)';
const INK_DIM = 'color-mix(in srgb, var(--color-success) 52%, #000)';
const INK_ARROW = 'color-mix(in srgb, var(--color-success) 52%, #000)';

export default function CapoSuggestion({ chordNames, profile, lang, onApply, compact = false, enabled = true, onToggle }) {
  const tr = useT(lang);

  // The reach-driven suggestion. Recomputed only when the chords or hand change.
  const capo = useMemo(
    () => bestCapo(chordNames, profile),
    [chordNames, profile],
  );

  // Nothing forces a barre, or no capo beats "no capo" → render nothing.
  if (!capo) return null;

  const fret = capo.fret;
  const fill = (s, ...vals) => {
    let i = 0;
    return String(s).replace(/\{[a-z]\}/g, () => (vals[i++] ?? ''));
  };

  const fretLabel = (tr.capoSuggestFret || 'Capo {n}').replace(/\{n\}/g, fret);

  // WHY a capo helps: name the actual barre chords the song's key forces. This is
  // the plain-language reason the user asked for ("this song needs Bb, Eb… — hard
  // barre chords; a capo lets you play easy open shapes instead").
  const hard = (capo.hardChords || []).slice(0, 4);
  const hardList = hard.join(', ');
  const whyText = hard.length
    ? (tr.capoSuggestWhy || 'This song’s key needs barre chords ({c}) that are hard to reach. A capo lets you play easy open shapes instead.')
        .replace(/\{c\}/g, hardList)
    : (tr.capoSuggestWhyGeneric || 'This song uses barre chords that are hard to reach. A capo lets you play easy open shapes instead.');

  // The on/off switch (only when the surface passes onToggle). A small pill button
  // that reads the current state and flips it.
  const toggle = onToggle && (
    <button type="button"
      onClick={() => onToggle(!enabled)}
      role="switch"
      aria-checked={enabled}
      className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors"
      style={{
        background: enabled ? 'color-mix(in srgb, var(--color-success) 22%, transparent)' : 'transparent',
        border: BORDER, color: INK,
      }}
      title={enabled ? (tr.capoSuggestTurnOff || 'Turn capo off — show the real chords')
                     : (tr.capoSuggestTurnOn || 'Turn capo on — show easy open shapes')}>
      {enabled ? `🎸 ${tr.capoSuggestOn || 'Capo on'}` : (tr.capoSuggestTurnOn || 'Use a capo')}
    </button>
  );

  // ── Toggled OFF: collapse to just the reason + the switch, so the surface shows
  // the real chords but the user can turn the capo back on any time. ─────────────
  if (onToggle && !enabled && !compact) {
    return (
      <div className="mb-3 px-2.5 py-2 rounded-lg text-[11px] leading-snug flex items-start justify-between gap-2"
        style={{ background: 'rgba(74,222,128,0.04)', border: BORDER, color: INK_DIM }}>
        <span>{whyText}</span>
        {toggle}
      </div>
    );
  }

  // ── Compact: title + fret only, for the Chord table's per-chord hint. ──────
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold leading-none"
        style={{ background: BG, border: BORDER, color: INK }}
        title={tr.capoSuggestTitle || 'Easy capo option'}>
        <span aria-hidden="true">🎸</span>
        {fretLabel}
      </span>
    );
  }

  // ── Full banner. ───────────────────────────────────────────────────────────
  const body = (tr.capoSuggestBody
    || 'Capo {n} → play these easy open shapes instead of barre chords')
    .replace(/\{n\}/g, fret);

  return (
    <div className="mb-3 px-2.5 py-2 rounded-lg text-[11px] leading-snug"
      style={{ background: BG, border: BORDER, color: INK }}>

      {/* Headline: title + plain-language body, plus the on/off switch (and/or an
          Apply button when a surface wants to persist the capo). */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-semibold">{fretLabel}</span>
          <span style={{ color: INK_DIM }}> — {body}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {toggle}
          {onApply && (
            <button type="button"
              onClick={() => onApply(fret)}
              className="px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors"
              style={{ background: 'color-mix(in srgb, var(--color-success) 22%, transparent)', border: BORDER, color: INK }}>
              {tr.capoSuggestApply || 'Apply capo'}
            </button>
          )}
        </div>
      </div>

      {/* WHY — name the actual barre chords this key forces, so the suggestion is
          explained, not just asserted. The hard chords render as ChordTip chips so
          hovering shows their (hard) shape — the thing the capo lets you avoid. */}
      <div className="mt-1" style={{ color: INK_DIM }}>
        {hard.length ? (
          <>
            {(tr.capoSuggestWhyLead || 'This song’s key needs barre chords that are hard to reach:')}{' '}
            {hard.map((c, k) => (
              <span key={c}>
                {k > 0 && ', '}
                <ChordTip name={c} className="font-semibold cursor-help" style={{ color: INK }}>{c}</ChordTip>
              </span>
            ))}
            {'. '}
            {(tr.capoSuggestWhyTail || 'A capo lets you play easy open shapes instead.')}
          </>
        ) : whyText}
      </div>

      {/* Reach savings, when the optimizer measured a real reduction. */}
      {capo.savings > 0 && (
        <div className="mt-0.5" style={{ color: INK_DIM }}>
          {tr.capoSuggestSavings || 'Less hand stretch overall'}
        </div>
      )}

      {/* Each transposed-down OPEN shape: the origName → capoName mapping, the
          small fretboard diagram, and the "fret X, sounds as Y" caption. Every
          chord name is wrapped in <ChordTip> so its shape shows on hover. */}
      <div className="mt-2 flex flex-wrap gap-2.5">
        {capo.shapes.map((s, k) => (
          <div key={`${s.orig}-${k}`}
            className="flex flex-col items-center gap-1 px-1.5 py-1 rounded-md"
            style={{ background: 'rgba(74,222,128,0.05)' }}>

            {/* origName → capoName */}
            <div className="flex items-center gap-1 text-[11px]">
              <ChordTip name={s.orig} className="cursor-help"
                style={{ color: 'var(--color-ink-faint)' }}>
                {s.orig}
              </ChordTip>
              <span aria-hidden="true" style={{ color: INK_ARROW }}>→</span>
              <ChordTip name={s.capoName} className="cursor-help font-semibold">
                {s.capoName}
              </ChordTip>
            </div>

            {/* The open shape you actually fret behind the capo. When the chord
                has no catalogued voicing we still show the mapping (above), just
                no diagram. */}
            {s.voicing && (
              <FretboardDiagram chord={s.voicing} />
            )}

            {/* "Fret {capoName}, sounds as {origName}" — the physics made plain:
                you finger the transposed-down shape, the capo raises it back. */}
            <div className="text-[9px] text-center" style={{ color: INK_DIM }}>
              {fill(
                tr.capoSuggestPlayShape || 'Fret {a}, sounds as {b}',
                s.capoName, s.orig,
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

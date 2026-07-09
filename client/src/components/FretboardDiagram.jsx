// SVG chord diagram. tab is a 6-char string like "x32010" (EADGBe order).
// 'x' = muted, '0' = open, digit = fret number.
// When `showFingers` is set and the chord has note data, each fretted dot is
// labelled with the suggested finger (1=index … 4=pinky) from optimalFingering.
// `marks` ({ [stringIndex]: 'missing' | 'weak' }) paints per-string diagnosis
// onto the diagram — used by the Play-Along practice report: red = the note
// didn't sound (muted), amber = it rang weak (buzzing / half-pressed).
//
// Rendering is "realistic": a warm rosewood neck, metallic frets and nut, and
// glossy gold note markers with a highlight + halo (matching the app's lit-brass
// look). All of the diagram's structure/props are unchanged — only the paint.

import { useId } from 'react';
import { optimalFingering } from '../lib/fretboard';

const MARK_COLOR = { missing: '#ef4444', weak: '#f59e0b' };

const CELL_W = 18;   // px between strings
const CELL_H = 17;   // px between frets
const MARGIN_X = 22; // left margin (room for fret label)
const MARGIN_Y = 30; // top margin (room for X/O indicators)
const NUM_FRETS = 4;

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

export default function FretboardDiagram({ chord, showFingers = false, marks = null }) {
  const uid = useId().replace(/[:]/g, ''); // stable, unique gradient-id namespace
  const tabArr = chord.tab.split(''); // always 6 chars
  const markFor = (s) => (marks && marks[s] ? MARK_COLOR[marks[s]] : null);

  // Suggested finger per string (1-4), keyed by string index, when requested
  // and note data is available. Barre notes share finger 1.
  const fingerByString = {};
  if (showFingers && Array.isArray(chord.notes)) {
    const fing = optimalFingering(chord.notes);
    if (fing) for (const a of fing.assignment) fingerByString[a.string] = a.finger;
  }

  // Determine fret range to display
  const frettedValues = tabArr
    .map(v => (v !== 'x' && v !== '0' ? parseInt(v) : null))
    .filter(v => v !== null);

  const minFret = frettedValues.length ? Math.min(...frettedValues) : 1;
  const maxFret = frettedValues.length ? Math.max(...frettedValues) : 4;

  // If chord fits in frets 1-4, show from 1. Otherwise start at minFret.
  const startFret = maxFret <= NUM_FRETS ? 1 : minFret;
  const isAtNut = startFret === 1;

  const svgW = MARGIN_X + 5 * CELL_W + 14;
  const svgH = MARGIN_Y + NUM_FRETS * CELL_H + 8;

  // Grid geometry helpers
  const sx = (strIdx) => MARGIN_X + strIdx * CELL_W;      // x for string index
  const fy = (relFret) => MARGIN_Y + relFret * CELL_H;    // y for relative fret (0 = top/nut)

  const neckX = sx(0) - CELL_W * 0.55;
  const neckW = 5 * CELL_W + CELL_W * 1.1;
  const neckY = fy(0);
  const neckH = NUM_FRETS * CELL_H;

  // String gauge: bass strings are thicker than treble.
  const stringGauge = (s) => 2 - s * 0.22;

  return (
    <div>
      <div className="text-center text-xs font-semibold mb-1" style={{ color: 'var(--color-ink-muted, #9a9a9a)' }}>{chord.name}</div>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        <defs>
          {/* Rosewood neck — warm, subtly graded top→bottom */}
          <linearGradient id={`wood-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a3222" />
            <stop offset="0.5" stopColor="#3a2517" />
            <stop offset="1" stopColor="#2a1a10" />
          </linearGradient>
          {/* Metallic fret wire (nickel-silver): bright edge → shadow */}
          <linearGradient id={`fret-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e8e8ea" />
            <stop offset="0.45" stopColor="#a9abb0" />
            <stop offset="1" stopColor="#6b6d72" />
          </linearGradient>
          {/* Bone nut */}
          <linearGradient id={`nut-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f3ead6" />
            <stop offset="1" stopColor="#c7b48c" />
          </linearGradient>
          {/* Glossy gold note marker: lit highlight top-left → deep base */}
          <radialGradient id={`dot-${uid}`} cx="0.35" cy="0.3" r="0.85">
            <stop offset="0" stopColor="#fff3cf" />
            <stop offset="0.35" stopColor="#f0cf7a" />
            <stop offset="0.75" stopColor="#d4a63c" />
            <stop offset="1" stopColor="#a97d24" />
          </radialGradient>
          {/* Soft halo behind lit markers */}
          <radialGradient id={`glow-${uid}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#e9c46a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#e9c46a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Neck body */}
        <rect x={neckX} y={neckY} width={neckW} height={neckH} rx={3}
              fill={`url(#wood-${uid})`} />

        {/* String name labels at bottom */}
        {STRING_LABELS.map((label, s) => (
          <text key={s} x={sx(s)} y={svgH - 1} textAnchor="middle"
                fontSize="9" fill="#8a8a8a">{label}</text>
        ))}

        {/* Nut (bone bar) or position indicator */}
        {isAtNut ? (
          <rect x={neckX} y={fy(0) - 3} width={neckW} height={5} rx={1.5}
                fill={`url(#nut-${uid})`} stroke="#8a7a55" strokeWidth="0.4" />
        ) : (
          <>
            <line x1={sx(0)} y1={fy(0)} x2={sx(5)} y2={fy(0)}
                  stroke="#8a8c90" strokeWidth="1" />
            <text x={MARGIN_X - 6} y={fy(0) + CELL_H * 0.65}
                  textAnchor="end" fontSize="10" fill="var(--color-brand, #e9c46a)"
                  fontWeight="bold">{startFret}</text>
          </>
        )}

        {/* Fret wires (metallic, with a hairline top highlight) */}
        {Array.from({ length: NUM_FRETS }, (_, i) => (
          <g key={i}>
            <rect x={neckX} y={fy(i + 1) - 1} width={neckW} height={2}
                  fill={`url(#fret-${uid})`} />
            <line x1={neckX} y1={fy(i + 1) - 1} x2={neckX + neckW} y2={fy(i + 1) - 1}
                  stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.5" />
          </g>
        ))}

        {/* Strings (steel, thicker toward the bass) */}
        {Array.from({ length: 6 }, (_, s) => (
          <g key={s}>
            <line x1={sx(s)} y1={fy(0)} x2={sx(s)} y2={fy(NUM_FRETS)}
                  stroke="#0c0a08" strokeOpacity="0.5" strokeWidth={stringGauge(s) + 1} />
            <line x1={sx(s)} y1={fy(0)} x2={sx(s)} y2={fy(NUM_FRETS)}
                  stroke="#d8d4cc" strokeWidth={stringGauge(s)} />
          </g>
        ))}

        {/* X / O indicators above nut */}
        {tabArr.map((val, s) => {
          if (val === 'x') {
            return (
              <text key={s} x={sx(s)} y={MARGIN_Y - 12}
                    textAnchor="middle" fontSize="12" fill="#8a8a8a" fontWeight="bold">✕</text>
            );
          }
          if (val === '0') {
            const mc = markFor(s);
            return (
              <g key={s}>
                <circle cx={sx(s)} cy={MARGIN_Y - 12} r={5}
                        fill="none" stroke={mc || '#c9b28a'} strokeWidth={mc ? 2.2 : 1.5} />
                {mc && marks[s] === 'missing' && (
                  <line x1={sx(s) - 4} y1={MARGIN_Y - 8} x2={sx(s) + 4} y2={MARGIN_Y - 16}
                        stroke={mc} strokeWidth="1.8" />
                )}
              </g>
            );
          }
          return null;
        })}

        {/* Fretted note dots — glossy gold pearls with a highlight + halo */}
        {tabArr.map((val, s) => {
          if (val === 'x' || val === '0') return null;
          const fret = parseInt(val);
          const relFret = fret - startFret; // 0-indexed from startFret
          if (relFret < 0 || relFret >= NUM_FRETS) return null;
          const cx = sx(s);
          const cy = fy(relFret) + CELL_H / 2;
          const finger = fingerByString[s];
          const mc = markFor(s);
          const r = CELL_H * 0.36;
          return (
            <g key={s} className="fret-dot" style={{ animationDelay: `${s * 45}ms` }}>
              {/* diagnosis ring, if marked */}
              {mc && <circle cx={cx} cy={cy} r={r + 2.5} fill="none" stroke={mc} strokeWidth="1.6" opacity="0.55" />}
              {/* gold halo (only for un-marked / lit markers) */}
              {!mc && <circle cx={cx} cy={cy} r={r + 4.5} fill={`url(#glow-${uid})`} />}
              {/* the pearl */}
              <circle cx={cx} cy={cy} r={r}
                      fill={mc || `url(#dot-${uid})`}
                      stroke={mc ? 'none' : '#7a5a14'} strokeWidth={mc ? 0 : 0.6} />
              {/* specular highlight */}
              {!mc && (
                <ellipse cx={cx - r * 0.28} cy={cy - r * 0.32} rx={r * 0.34} ry={r * 0.24}
                         fill="#fff" opacity="0.65" />
              )}
              {finger != null && (
                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                      fontSize="9" fontWeight="bold"
                      fill={mc ? '#fff' : '#3a2708'}>{finger}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

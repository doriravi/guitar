// GameFretboard — the Scale Quest play + review surface.
//
// A windowed fretboard (just the box's frets, high-e on top → low-E on the
// bottom, matching FretboardNoteMap's tab-view convention), purpose-built for the
// game. It shares that screen's REALISTIC SVG NECK look (wood grain, coloured
// strings + letters, fret wires, inlays) so the two surfaces match, and adds the
// two layers the game needs — holding the line the whole design rests on:
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
// Per-string colours (index = string 0..5 = low-E..high-e), matching the
// FretboardNoteMap look so the two surfaces read as the same instrument.
const STRING_COLORS = ['#a78bfa', '#38bdf8', '#34d399', '#e8e2d4', '#f0a860', '#f47272'];
const STRING_GAUGE = [3.0, 2.6, 2.2, 1.8, 1.5, 1.2];
const INLAY_FRETS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_INLAY = new Set([12, 24]);
const MARKER_FRETS = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);

const NECK = {
  padL: 40, padR: 10, padT: 20, padB: 20,
  fretW: 60, stringGap: 34, dotR: 13,
};

const noteName = (s, f) => NOTE_NAMES[(OPEN_STRING_MIDI[s] + f) % 12];
const cellKey = (s, f) => `${s}:${f}`;

export default function GameFretboard({
  box,                 // { minFret, maxFret } — the scored practice position
  viewMin,             // first drawn fret (defaults to the box) — widen to show the whole neck
  viewMax,             // last drawn fret (defaults to the box)
  scaleCells = [],     // [{string,fret,pc,degree,inBox?}] — scale notes (cyan; faint when inBox===false)
  targetCell = null,   // {string,fret} — the one the game is asking for NOW (play)
  twinCells = [],      // [{string,fret}] — same-pitch twins of the target (dashed)
  liveSet = null,      // Set<pc> currently sounding (soft rings), or null
  mode = 'play',       // 'play' | 'review'
  reviewResults = [],  // [{string,fret,degree,hit}] — for mode 'review'
  showLabels = true,   // Note-Hunt fades labels; play/scale mode shows them
  lang,                // reserved for future i18n of the empty-state
}) {
  // Drawn range: the whole neck when viewMin/Max are given, else just the box.
  const minF = viewMin ?? box?.minFret ?? 0;
  const maxF = viewMax ?? box?.maxFret ?? 12;
  const frets = [];
  for (let f = minF; f <= maxF; f++) frets.push(f);

  const scaleAt = new Map(scaleCells.map((c) => [cellKey(c.string, c.fret), c]));
  const twinAt = new Set(twinCells.map((c) => cellKey(c.string, c.fret)));
  const reviewAt = new Map(reviewResults.map((r) => [cellKey(r.string, r.fret), r]));
  const targetK = targetCell ? cellKey(targetCell.string, targetCell.fret) : null;

  const rows = [5, 4, 3, 2, 1, 0];       // high-e top → low-E bottom
  const showOpen = minF === 0;           // draw the gutter open circles only if 0 is in view
  const fretted = frets.filter((f) => f > 0);       // columns ON the board
  const nCols = fretted.length;
  const nutX = NECK.padL;
  const W = NECK.padL + NECK.padR + nCols * NECK.fretW;
  const boardH = rows.length * NECK.stringGap;
  const boardTop = NECK.padT;
  const boardBot = boardTop + boardH;
  const H = boardTop + boardH + NECK.padB;
  const midY = boardTop + boardH / 2;

  // Fret cell f spans [nutX+(pos-1)·fretW , nutX+pos·fretW] where pos is its
  // 1-based index among the fretted columns (so a window that starts at fret 5
  // still packs tightly against the nut area).
  const posOf = (f) => fretted.indexOf(f) + 1;      // 1..nCols
  const colX = (f) => nutX + (posOf(f) - 0.5) * NECK.fretW;
  const wireRightX = (f) => nutX + posOf(f) * NECK.fretW;
  const rowY = (i) => boardTop + i * NECK.stringGap + NECK.stringGap / 2;

  const planks = [];
  for (let x = nutX + 5; x < W - NECK.padR; x += 9) planks.push(x);

  // The practice-box outline (only worth drawing when the view is wider than the
  // box — i.e. we're showing the whole neck around it).
  const boxOutline = (() => {
    if (!box) return null;
    const wider = minF < box.minFret || maxF > box.maxFret;
    if (!wider) return null;
    // left edge = the wire just before the box's first fret (nut if box starts at 1)
    const leftX = box.minFret <= 1 ? nutX : wireRightX(box.minFret - 1);
    const rightX = wireRightX(Math.min(box.maxFret, maxF));
    return { x: leftX, w: rightX - leftX };
  })();

  // Map a cell to its dot style + badge for the current mode/state.
  function cellStyle(s, f) {
    const k = cellKey(s, f);
    const scaleNote = scaleAt.get(k);
    const isTarget = k === targetK;
    const isTwin = twinAt.has(k);
    const pc = (OPEN_STRING_MIDI[s] + f) % 12;
    const nowPlaying = liveSet && liveSet.has(pc);
    const review = reviewAt.get(k);

    let fill = 'transparent', stroke = 'transparent', textFill = 'var(--color-ink-faint)';
    let strokeW = 1, dash = null, glow = null, pulse = false, badge = null, show = false, label = null, faint = false;

    if (mode === 'review' && review) {
      const ok = review.hit;
      fill = ok ? 'rgba(47,125,107,0.9)' : 'rgba(178,59,59,0.9)';
      stroke = ok ? '#5fbfa6' : '#e06868'; textFill = '#fff'; badge = ok ? '✓' : '✗';
      show = true; label = review.degree;
    } else if (isTarget) {
      fill = 'var(--color-brand, #e0a93a)'; stroke = '#fff3cf'; strokeW = 2.5;
      textFill = '#3a2708'; glow = 'rgba(224,169,58,0.65)'; pulse = true; show = true;
      label = scaleNote?.degree;
    } else if (isTwin) {
      fill = 'transparent'; stroke = 'var(--color-ink-faint)'; strokeW = 1.5; dash = '4 3';
      textFill = 'var(--color-ink-faint)'; badge = '( )'; show = true;
    } else if (nowPlaying) {
      fill = 'rgba(91,91,214,0.18)'; stroke = '#5b5bd6'; strokeW = 2.5; dash = '3 3';
      textFill = '#9a9af0'; show = true;
    } else if (scaleNote) {
      // In-box scale notes are bright cyan; out-of-box ones are faint context
      // pips so the whole neck reads without competing with the practice box.
      const outOfBox = scaleNote.inBox === false;
      fill = outOfBox ? 'rgba(56,189,248,0.06)' : 'rgba(56,189,248,0.2)';
      stroke = outOfBox ? 'rgba(56,189,248,0.22)' : 'rgba(56,189,248,0.5)';
      textFill = outOfBox ? 'rgba(125,211,252,0.45)' : '#7dd3fc';
      show = true; label = scaleNote.degree; faint = outOfBox;
    }
    return { fill, stroke, textFill, strokeW, dash, glow, pulse, badge, show, label, faint,
      name: noteName(s, f) };
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }}
        role="img" aria-label="Scale Quest fretboard">
        <defs>
          <linearGradient id="gfb-wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a331d" />
            <stop offset="0.5" stopColor="#3a2817" />
            <stop offset="1" stopColor="#2a1c0e" />
          </linearGradient>
          <clipPath id="gfb-board">
            <rect x={nutX} y={boardTop} width={W - NECK.padR - nutX} height={boardH} rx="5" />
          </clipPath>
        </defs>

        {/* fingerboard */}
        <rect x={nutX} y={boardTop} width={W - NECK.padR - nutX} height={boardH}
          rx="5" fill="url(#gfb-wood)" stroke="#5a4326" strokeWidth="1.2" />

        {/* wood grain */}
        <g clipPath="url(#gfb-board)" opacity="0.5">
          {planks.map((x, i) => (
            <line key={`pk${i}`} x1={x} y1={boardTop} x2={x + (i % 3) - 1} y2={boardBot}
              stroke={i % 2 ? 'rgba(90,64,38,0.5)' : 'rgba(20,12,4,0.5)'} strokeWidth={i % 4 === 0 ? 1.4 : 0.7} />
          ))}
        </g>

        {/* fret numbers (top) */}
        {showOpen && (
          <text x={nutX - 12} y={boardTop - 6} fontSize="11" textAnchor="middle"
            fill="var(--color-ink-faint)">0</text>
        )}
        {fretted.map((f) => (
          <text key={`fn${f}`} x={colX(f)} y={boardTop - 6} fontSize="11"
            fontWeight={MARKER_FRETS.has(f) ? '700' : '400'} textAnchor="middle"
            fill={MARKER_FRETS.has(f) ? 'var(--color-brand, #e0a93a)' : 'var(--color-ink-faint)'}>
            {f}
          </text>
        ))}

        {/* inlays ON the board */}
        {fretted.filter((f) => INLAY_FRETS.has(f) || DOUBLE_INLAY.has(f)).map((f) => (
          DOUBLE_INLAY.has(f) ? (
            <g key={`in${f}`} fill="#d8c39a" opacity="0.4">
              <circle cx={colX(f)} cy={midY - NECK.stringGap} r="4.5" />
              <circle cx={colX(f)} cy={midY + NECK.stringGap} r="4.5" />
            </g>
          ) : (
            <circle key={`in${f}`} cx={colX(f)} cy={midY} r="4.5" fill="#d8c39a" opacity="0.35" />
          )
        ))}

        {/* nut (only when fret 0 is in the window) + fret wires */}
        {showOpen && (
          <line x1={nutX} y1={boardTop} x2={nutX} y2={boardBot}
            stroke="#e8dcc8" strokeWidth="3.5" strokeLinecap="round" />
        )}
        {fretted.map((f) => {
          const x = wireRightX(f);
          return (
            <line key={`w${f}`} x1={x} y1={boardTop} x2={x} y2={boardBot}
              stroke="#b0b0b0" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
          );
        })}

        {/* coloured strings */}
        {rows.map((s, i) => (
          <line key={`s${s}`} x1={nutX} y1={rowY(i)} x2={W - NECK.padR} y2={rowY(i)}
            stroke={STRING_COLORS[s]} strokeWidth={STRING_GAUGE[s]} strokeLinecap="round" opacity="0.92" />
        ))}

        {/* practice-box outline — highlights the scored position on the full neck */}
        {boxOutline && (
          <rect x={boxOutline.x} y={boardTop + 2} width={boxOutline.w} height={boardH - 4}
            rx="5" fill="rgba(224,169,58,0.06)" stroke="rgba(224,169,58,0.5)"
            strokeWidth="1.4" strokeDasharray="5 3" style={{ pointerEvents: 'none' }} />
        )}

        {/* inlay row BELOW the neck */}
        {fretted.filter((f) => INLAY_FRETS.has(f) || DOUBLE_INLAY.has(f)).map((f) => (
          DOUBLE_INLAY.has(f) ? (
            <g key={`bi${f}`} fill="#c9a96e" opacity="0.65">
              <circle cx={colX(f) - 4} cy={boardBot + 8} r="2.2" />
              <circle cx={colX(f) + 4} cy={boardBot + 8} r="2.2" />
            </g>
          ) : (
            <circle key={`bi${f}`} cx={colX(f)} cy={boardBot + 8} r="2.4" fill="#c9a96e" opacity="0.55" />
          )
        ))}

        {/* left gutter: coloured string letter + (open) grey open-note circle */}
        {rows.map((s, i) => (
          <g key={`gl${s}`}>
            <text x={12} y={rowY(i) + 4} fontSize="13" fontWeight="800"
              textAnchor="middle" fill={STRING_COLORS[s]}>{STRING_LABELS[s]}</text>
            {showOpen && (
              <>
                <circle cx={nutX - 12} cy={rowY(i)} r={NECK.dotR - 1}
                  fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
                <text x={nutX - 12} y={rowY(i) + 3.5} fontSize="9.5" fontWeight="600"
                  textAnchor="middle" fill="rgba(233,225,205,0.75)">{noteName(s, 0)}</text>
              </>
            )}
          </g>
        ))}

        {/* note dots — the game layers (prompt / twin / detection / review / scale) */}
        {rows.map((s, i) => fretted.map((f) => {
          const st = cellStyle(s, f);
          if (!st.show) return null;
          const cx = colX(f), cy = rowY(i);
          const r = st.faint ? NECK.dotR - 4 : NECK.dotR;   // context pips are smaller
          return (
            <g key={cellKey(s, f)} className={st.pulse ? 'gfb-pulse' : undefined}
              style={st.pulse ? { transformOrigin: `${cx}px ${cy}px` } : undefined}>
              {st.glow && <circle cx={cx} cy={cy} r={NECK.dotR + 2} fill={st.glow} opacity="0.5" />}
              <circle cx={cx} cy={cy} r={r} fill={st.fill}
                stroke={st.stroke} strokeWidth={st.strokeW} strokeDasharray={st.dash || undefined}>
                <title>{`${st.name}${st.label ? ` · ${st.label}` : ''}`}</title>
              </circle>
              {!st.faint && (showLabels || st.badge || targetK === cellKey(s, f)) && (
                <text x={cx} y={cy + 3.5} fontSize="10" fontWeight="600"
                  textAnchor="middle" fill={st.textFill} style={{ pointerEvents: 'none' }}>
                  {st.badge || st.name}
                </text>
              )}
              {st.label && showLabels && !st.badge && !st.faint && (
                <text x={cx + NECK.dotR - 2} y={cy - NECK.dotR + 5} fontSize="7"
                  fontWeight="700" textAnchor="middle" fill={st.textFill} opacity="0.8"
                  style={{ pointerEvents: 'none' }}>{st.label}</text>
              )}
            </g>
          );
        }))}
      </svg>

      {/* The pulse keyframes, scoped here. Respects reduced-motion by holding
          the lit state instead of animating. */}
      <style>{`
        .gfb-pulse { animation: gfb-pulse 900ms ease-in-out infinite; }
        @keyframes gfb-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.72; }
        }
        @media (prefers-reduced-motion: reduce) {
          .gfb-pulse { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

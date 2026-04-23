// SVG chord diagram. tab is a 6-char string like "x32010" (EADGBe order).
// 'x' = muted, '0' = open, digit = fret number.

const CELL_W = 18;   // px between strings
const CELL_H = 17;   // px between frets
const MARGIN_X = 22; // left margin (room for fret label)
const MARGIN_Y = 30; // top margin (room for X/O indicators)
const NUM_FRETS = 4;

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

export default function FretboardDiagram({ chord }) {
  const tabArr = chord.tab.split(''); // always 6 chars

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

  return (
    <div>
      <div className="text-center text-xs font-semibold text-gray-700 mb-1">{chord.name}</div>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>

        {/* String name labels at bottom */}
        {STRING_LABELS.map((label, s) => (
          <text key={s} x={sx(s)} y={svgH - 1} textAnchor="middle"
                fontSize="9" fill="#aaa">{label}</text>
        ))}

        {/* Nut (thick bar) or position indicator */}
        {isAtNut ? (
          <rect x={sx(0)} y={fy(0)} width={5 * CELL_W} height={4} rx={1} fill="#333" />
        ) : (
          <>
            <line x1={sx(0)} y1={fy(0)} x2={sx(5)} y2={fy(0)}
                  stroke="#aaa" strokeWidth="1" />
            <text x={MARGIN_X - 4} y={fy(0) + CELL_H * 0.65}
                  textAnchor="end" fontSize="10" fill="#666">{startFret}</text>
          </>
        )}

        {/* Fret lines */}
        {Array.from({ length: NUM_FRETS }, (_, i) => (
          <line key={i}
            x1={sx(0)} y1={fy(i + 1)}
            x2={sx(5)} y2={fy(i + 1)}
            stroke="#bbb" strokeWidth="1" />
        ))}

        {/* String lines */}
        {Array.from({ length: 6 }, (_, s) => (
          <line key={s}
            x1={sx(s)} y1={fy(0)}
            x2={sx(s)} y2={fy(NUM_FRETS)}
            stroke="#888" strokeWidth="1.2" />
        ))}

        {/* X / O indicators above nut */}
        {tabArr.map((val, s) => {
          if (val === 'x') {
            return (
              <text key={s} x={sx(s)} y={MARGIN_Y - 12}
                    textAnchor="middle" fontSize="12" fill="#999" fontWeight="bold">✕</text>
            );
          }
          if (val === '0') {
            return (
              <circle key={s} cx={sx(s)} cy={MARGIN_Y - 12} r={5}
                      fill="none" stroke="#555" strokeWidth="1.5" />
            );
          }
          return null;
        })}

        {/* Fretted note dots */}
        {tabArr.map((val, s) => {
          if (val === 'x' || val === '0') return null;
          const fret = parseInt(val);
          const relFret = fret - startFret; // 0-indexed from startFret
          if (relFret < 0 || relFret >= NUM_FRETS) return null;
          const cx = sx(s);
          const cy = fy(relFret) + CELL_H / 2;
          return (
            <circle key={s} cx={cx} cy={cy} r={CELL_H * 0.36}
                    fill="#222" />
          );
        })}
      </svg>
    </div>
  );
}

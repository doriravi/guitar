export default function DifficultyBadge({ score }) {
  const [bg, color] =
    score <= 3 ? ['rgba(34,197,94,0.12)', '#4ade80'] :
    score <= 6 ? ['rgba(201,169,110,0.12)', '#c9a96e'] :
    score <= 8 ? ['rgba(249,115,22,0.12)', '#fb923c'] :
                 ['rgba(239,68,68,0.12)', '#f87171'];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold tabular-nums"
      style={{ background: bg, color }}
    >
      {score.toFixed(1)}
    </span>
  );
}

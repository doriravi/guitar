export default function DifficultyBadge({ score }) {
  const color =
    score <= 3 ? 'bg-green-500' :
    score <= 6 ? 'bg-yellow-500' :
    score <= 8 ? 'bg-orange-500' :
                 'bg-red-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-white text-sm font-bold ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

export function Sparkline({
  data,
  color = "hsl(68,96%,58%)",
  width = 120,
  height = 24,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const coords = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  });
  const points = coords.join(" ");
  const area = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polygon points={area} fill={color} style={{ opacity: 0.08 }} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.7 }}
      />
    </svg>
  );
}

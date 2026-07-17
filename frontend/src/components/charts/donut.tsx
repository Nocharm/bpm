// 작은 SVG 도넛 — 세그먼트 클릭 선택. 색은 토큰 var(--color-*) 전달.
"use client";

import { computeDonutArcs, type DonutSegment } from "@/lib/donut-geometry";

interface DonutProps {
  segments: DonutSegment[]; // colorVar 예: "--color-accent"
  size?: number; // px, 기본 120
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
}

export function Donut({ segments, size = 120, selectedKey, onSelect }: DonutProps) {
  const stroke = Math.round(size * 0.16);
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const arcs = computeDonutArcs(segments, C);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx={cx} cy={cx} r={r}
            fill="none"
            stroke={`var(${a.colorVar})`}
            strokeWidth={selectedKey === a.key ? stroke + 3 : stroke}
            strokeDasharray={a.dashArray}
            strokeDashoffset={a.dashOffset}
            className="cursor-pointer transition-[stroke-width] duration-150"
            onClick={() => onSelect?.(a.key)}
            opacity={selectedKey && selectedKey !== a.key ? 0.45 : 1}
          />
        ))}
      </g>
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-ink text-body-strong">
        {total}
      </text>
    </svg>
  );
}

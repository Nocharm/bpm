// 작은 SVG 도넛 — 분절 링 + 옅은 트랙 + 중앙 합계. 세그먼트 클릭 선택. 색은 토큰 var(--color-*) 전달.
"use client";

import { computeDonutArcs, type DonutSegment } from "@/lib/donut-geometry";

interface DonutProps {
  segments: DonutSegment[]; // colorVar 예: "--color-accent"
  size?: number; // px, 기본 120
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  label?: string; // a11y — svg aria-label
  centerCaption?: string; // 중앙 합계 아래 작은 라벨(예: "total")
}

// 선택 세그먼트가 굵어지는 양(px) — 반지름에서 이만큼 여유를 빼 두어야 호버 시 링이 viewBox 밖으로 잘리지 않는다.
const SELECT_GROW = 3;
const EDGE_PAD = 2; // viewBox 가장자리와의 최소 여백(px)

export function Donut({ segments, size = 120, selectedKey, onSelect, label, centerCaption }: DonutProps) {
  const stroke = Math.round(size * 0.15);
  // 굵어진 stroke의 바깥 끝까지 포함해 (size/2 - EDGE_PAD) 안에 들어오도록 반지름 축소 — 잘림 방지.
  const r = (size - stroke - SELECT_GROW) / 2 - EDGE_PAD;
  const C = 2 * Math.PI * r;
  const nonZeroCount = segments.filter((s) => s.value > 0).length;
  const gap = nonZeroCount > 1 ? size * 0.035 : 0; // 다중 세그먼트만 얇은 분절(단일은 매끈한 완전 링)
  const arcs = computeDonutArcs(segments, C, gap);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const cx = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="origin-center motion-safe:animate-[donut-in_450ms_var(--ease-smooth)]"
    >
      {/* 옅은 트랙 — 부분 링이 surface 위에서 형태로 읽히게 하는 바닥 고리 */}
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-hairline)" strokeWidth={stroke} opacity={0.6} />
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx={cx} cy={cx} r={r}
            fill="none"
            stroke={`var(${a.colorVar})`}
            strokeWidth={selectedKey === a.key ? stroke + SELECT_GROW : stroke}
            strokeDasharray={a.dashArray}
            strokeDashoffset={a.dashOffset}
            className="cursor-pointer transition-[stroke-width,opacity] duration-150"
            onClick={() => onSelect?.(a.key)}
            opacity={selectedKey && selectedKey !== a.key ? 0.3 : 1}
          />
        ))}
      </g>
      <text
        x="50%"
        y={centerCaption ? "45%" : "50%"}
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-ink text-body-strong"
      >
        {total}
      </text>
      {centerCaption && (
        <text x="50%" y="62%" dominantBaseline="central" textAnchor="middle" className="fill-ink-tertiary text-fine">
          {centerCaption}
        </text>
      )}
    </svg>
  );
}

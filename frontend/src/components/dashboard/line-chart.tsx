// 누적 성장 라인 — 자체 SVG. viewBox 100×40 정규화 좌표로 그리고 CSS가 늘린다.

import { buildScale } from "@/lib/dashboard-chart";

export interface LineSeries {
  label: string;
  color: string; // "var(--color-accent)" 같은 토큰 참조
  values: number[];
}

const VIEW_W = 100;
const VIEW_H = 40;

function toPath(values: number[], max: number): string {
  if (values.length === 0) return "";
  const step = values.length > 1 ? VIEW_W / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = index * step;
      const y = VIEW_H - (value / max) * VIEW_H;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function LineChart({
  series,
  labels,
}: {
  series: LineSeries[];
  labels: string[];
}) {
  const scale = buildScale(series.flatMap((line) => line.values));

  return (
    <div data-id="dashboard-line-chart" className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
        role="img"
        aria-label={series.map((line) => line.label).join(", ")}
      >
        {series.map((line) => (
          <path
            key={line.label}
            d={toPath(line.values, scale.max)}
            fill="none"
            stroke={line.color}
            strokeWidth={0.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex items-center justify-between text-fine text-ink-tertiary">
        <span>{labels[0] ?? ""}</span>
        <span className="flex gap-3">
          {series.map((line) => (
            <span key={line.label} className="flex items-center gap-1">
              <span
                className="inline-block h-0.5 w-3 rounded-sm"
                style={{ backgroundColor: line.color }}
              />
              {line.label}
            </span>
          ))}
        </span>
        <span>{labels[labels.length - 1] ?? ""}</span>
      </div>
    </div>
  );
}

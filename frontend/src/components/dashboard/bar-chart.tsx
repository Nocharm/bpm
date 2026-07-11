// 시계열 세로 막대 — 값 비례 높이, 최댓값 막대만 액센트. SVG 없이 flex + 높이 %로 그린다.

import { buildScale } from "@/lib/dashboard-chart";

export interface BarPoint {
  label: string; // 툴팁·접근성용 (예: 2026-07-11)
  value: number;
}

export function BarChart({ points }: { points: BarPoint[] }) {
  const scale = buildScale(points.map((point) => point.value));
  const peak = Math.max(0, ...points.map((point) => point.value));

  return (
    <div data-id="dashboard-bar-chart" className="flex h-40 items-end gap-1.5">
      {points.map((point) => {
        const ratio = point.value / scale.max;
        return (
          <div
            key={point.label}
            title={`${point.label} · ${point.value}`}
            className="flex flex-1 items-end"
            style={{ height: "100%" }}
          >
            <div
              className="w-full rounded-sm transition-[height] duration-350 ease-smooth"
              style={{
                // 0건도 흔적을 남겨야 "빈 날"이 읽힌다 — 최소 2%
                height: `${Math.max(ratio * 100, 2)}%`,
                backgroundColor:
                  point.value === peak && peak > 0
                    ? "var(--color-accent)"
                    : "var(--color-accent-tint)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

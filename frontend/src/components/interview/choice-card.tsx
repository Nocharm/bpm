"use client";

// 선택지 카드 — dagre 배치 좌표로 그리는 정적 SVG 미니 프리뷰 (ReactFlow 미사용: 경량)

import { useMemo } from "react";

import type { ChoiceOption } from "@/lib/api";
import { layoutWorkingGraph } from "@/lib/interview";

interface ChoiceCardProps {
  option: ChoiceOption;
  disabled: boolean;
  onChoose: (id: string) => void;
}

export function ChoiceCard({ option, disabled, onChoose }: ChoiceCardProps) {
  const laid = useMemo(() => layoutWorkingGraph(option.graph, new Set()), [option.graph]);
  const box = useMemo(() => {
    if (laid.nodes.length === 0) return { x: 0, y: 0, w: 100, h: 60 };
    const xs = laid.nodes.map((n) => n.position.x);
    const ys = laid.nodes.map((n) => n.position.y);
    const pad = 30;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      x: minX, y: minY,
      w: Math.max(...laid.nodes.map((n) => n.position.x + (n.width ?? 120))) - minX + pad,
      h: Math.max(...laid.nodes.map((n) => n.position.y + (n.height ?? 48))) - minY + pad,
    };
  }, [laid]);
  const centers = useMemo(
    () => new Map(laid.nodes.map((n) => [
      n.id,
      { cx: n.position.x + (n.width ?? 120) / 2, cy: n.position.y + (n.height ?? 48) / 2 },
    ])),
    [laid],
  );

  return (
    <div className="rounded-md border border-hairline bg-surface p-2 shadow-sm" data-id="iv-choice-card">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-caption-strong">{option.title}</span>
        <span className="truncate text-fine text-ink-tertiary">{option.summary}</span>
      </div>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="h-28 w-full rounded-xs bg-canvas">
        {laid.edges.map((e) => {
          const s = centers.get(e.source);
          const t = centers.get(e.target);
          if (!s || !t) return null;
          return (
            <line key={e.id} x1={s.cx} y1={s.cy} x2={t.cx} y2={t.cy}
              stroke="var(--color-border-strong)" strokeWidth={2} />
          );
        })}
        {laid.nodes.map((n) => (
          <g key={n.id}>
            <rect x={n.position.x} y={n.position.y} width={n.width ?? 120} height={n.height ?? 48}
              rx={8} fill="var(--color-surface)" stroke="var(--color-border-strong)" strokeWidth={1.5} />
            <text x={n.position.x + (n.width ?? 120) / 2} y={n.position.y + (n.height ?? 48) / 2}
              textAnchor="middle" dominantBaseline="central"
              style={{ fontSize: 12, fill: "var(--color-ink-secondary)" }}>
              {n.data.label.slice(0, 12)}
            </text>
          </g>
        ))}
      </svg>
      <button
        className="mt-1.5 w-full rounded-sm bg-accent-tint py-1 text-caption-strong text-accent hover:bg-accent-tint/70 disabled:opacity-40"
        disabled={disabled}
        onClick={() => onChoose(option.id)}
        data-id="iv-choice-pick"
      >
        Use this option
      </button>
    </div>
  );
}

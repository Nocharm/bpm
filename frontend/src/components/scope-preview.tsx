"use client";

// 비활성(조상) 창의 정적 프리뷰 — ReactFlow 없이 SVG로 노드 박스+엣지선을 그려
// viewBox로 창 크기에 자동 맞춤. 라이브 인스턴스 N개의 부하를 피하는 경량 렌더(시각 전용).

import type { VersionGraph } from "@/lib/api";
import { nodeSizeOf, normalizeNodeType } from "@/lib/canvas";

export function ScopePreview({
  fullGraph,
  scopeParentId,
  interactive = false,
}: {
  fullGraph: VersionGraph | null;
  scopeParentId: string | null;
  // true면 노드에 호버 효과 + 포인터 이벤트 허용(요약 모달 미리보기용). 기본은 정적(조상 창)
  interactive?: boolean;
}) {
  const scopeNodes = (fullGraph?.nodes ?? []).filter(
    (node) => node.parent_node_id === scopeParentId,
  );
  if (scopeNodes.length === 0) {
    return <div className="h-full w-full bg-canvas" />;
  }

  const boxes = scopeNodes.map((node) => {
    const size = nodeSizeOf(normalizeNodeType(node.node_type));
    return {
      id: node.id,
      x: node.pos_x,
      y: node.pos_y,
      w: size.w,
      h: size.h,
      cx: node.pos_x + size.w / 2,
      cy: node.pos_y + size.h / 2,
      color: node.color || "var(--color-border-strong)",
      title: node.title,
    };
  });
  const centerById = new Map(boxes.map((box) => [box.id, box]));
  const ids = new Set(boxes.map((box) => box.id));
  const edges = (fullGraph?.edges ?? []).filter(
    (edge) => ids.has(edge.source_node_id) && ids.has(edge.target_node_id),
  );

  const pad = 40;
  const minX = Math.min(...boxes.map((box) => box.x)) - pad;
  const minY = Math.min(...boxes.map((box) => box.y)) - pad;
  const maxX = Math.max(...boxes.map((box) => box.x + box.w)) + pad;
  const maxY = Math.max(...boxes.map((box) => box.y + box.h)) + pad;
  const viewBox = `${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}`;

  return (
    <div
      className={`${interactive ? "pointer-events-auto" : "pointer-events-none"} h-full w-full bg-canvas`}
    >
      <svg className="h-full w-full" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {edges.map((edge) => {
          const source = centerById.get(edge.source_node_id);
          const target = centerById.get(edge.target_node_id);
          if (!source || !target) {
            return null;
          }
          return (
            <line
              key={edge.id}
              x1={source.cx}
              y1={source.cy}
              x2={target.cx}
              y2={target.cy}
              strokeWidth={1.5}
              style={{ stroke: "var(--color-border-strong)" }}
            />
          );
        })}
        {boxes.map((box) => (
          <g key={box.id}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={8}
              strokeWidth={1.5}
              className={
                interactive
                  ? "cursor-pointer [transition:all_.15s] hover:[stroke-width:3px] hover:[filter:brightness(0.92)]"
                  : undefined
              }
              style={{
                fill: `color-mix(in srgb, ${box.color} 18%, white)`,
                stroke: box.color,
              }}
            />
            <text
              x={box.cx}
              y={box.cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              style={{ fill: "var(--color-ink)" }}
            >
              {box.title}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

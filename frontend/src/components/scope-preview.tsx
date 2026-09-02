"use client";

// 비활성(조상) 창의 정적 프리뷰 — ReactFlow 없이 SVG로 노드 박스+엣지선을 그려
// viewBox로 창 크기에 자동 맞춤. 라이브 인스턴스 N개의 부하를 피하는 경량 렌더(시각 전용).

import { useEffect, useLayoutEffect, useRef } from "react";

import type { VersionGraph } from "@/lib/api";
import { resolveNodeStroke } from "@/components/process-node";
import { nodeSizeOf, normalizeNodeType } from "@/lib/canvas";

export function ScopePreview({
  fullGraph,
  scopeParentId,
  interactive = false,
  zoom = 1,
  charcoal = false,
  onZoom,
}: {
  fullGraph: VersionGraph | null;
  scopeParentId: string | null;
  // true면 노드에 호버 효과 + 포인터 이벤트 허용(요약 모달 미리보기용). 기본은 정적(조상 창)
  interactive?: boolean;
  // true면 배경을 L5 차콜로 — 프레임워크 루트 창의 비활성 프리뷰가 라이트로 번쩍이지 않게
  charcoal?: boolean;
  // 1=창에 맞춤(기본). >1이면 SVG 자체를 키워 넘치는 만큼을 드래그(그랩)로 이동한다.
  // 스크롤바를 띄우면 좁은 피크 안에서 조준이 어렵고 클릭도 안 먹어 숨기고 드래그만 남겼다
  // (사용자 요청 2026-08-31). 이동은 overflow:hidden 상태에서도 동작하는 scrollLeft/Top로.
  zoom?: number;
  // 넘기면 프리뷰 위 휠이 줌 스텝이 된다(방향 +1/-1 → 적용된 배율 반환, 클램프는 호출측).
  // 미지정이면 리스너를 안 붙여 정적 프리뷰의 휠은 평소대로 흘러간다.
  onZoom?: (direction: 1 | -1) => number;
}) {
  const panRef = useRef<HTMLDivElement>(null);
  // 드래그 시작 시점의 커서·스크롤 위치 — 이동량을 절대 좌표로 환산해 드리프트를 막는다
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // 줌 후 시선 고정 기준점(컨테이너 상대) — 휠은 커서 지점, 그 외(버튼)는 화면 중앙
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const prevZoomRef = useRef(zoom);
  const pannable = zoom > 1;
  const scopeNodes = (fullGraph?.nodes ?? []).filter(
    (node) => node.parent_node_id === scopeParentId,
  );
  // 빈 스코프는 팬 컨테이너 없이 조기 반환한다 — 그래프가 늦게 채워지면 리스너를 그때 붙여야 한다
  const hasNodes = scopeNodes.length > 0;

  // 휠 줌 — 피크 위 휠은 프리뷰가 전부 소비한다(뒤 캔버스·패널 스크롤과 동시 입력 금지).
  // React onWheel은 루트에 passive로 붙어 preventDefault가 무시되므로 네이티브 리스너로 단다.
  useEffect(() => {
    const el = panRef.current;
    if (el === null || onZoom === undefined) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const next = onZoom(event.deltaY < 0 ? 1 : -1);
      // 클램프 한계면 앵커를 남기지 않는다 — 다음 버튼 줌이 엉뚱한 지점을 잡는다
      if (next === prevZoomRef.current) return;
      const rect = el.getBoundingClientRect();
      anchorRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onZoom, hasNodes]);

  // 배율이 바뀌면 기준점이 제자리에 남도록 스크롤을 재계산 — SVG는 컨테이너 대비 zoom배라 배율비로 환산된다
  useLayoutEffect(() => {
    const el = panRef.current;
    const prev = prevZoomRef.current;
    prevZoomRef.current = zoom;
    if (el === null || prev === zoom) return;
    const anchor = anchorRef.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    anchorRef.current = null;
    const ratio = zoom / prev;
    el.scrollLeft = (el.scrollLeft + anchor.x) * ratio - anchor.x;
    el.scrollTop = (el.scrollTop + anchor.y) * ratio - anchor.y;
  }, [zoom]);

  if (!hasNodes) {
    return <div className={`h-full w-full ${charcoal ? "bpm-l5-sky rounded-md" : "bg-canvas"}`} />;
  }

  const boxes = scopeNodes.map((node) => {
    const type = normalizeNodeType(node.node_type);
    const size = nodeSizeOf(type);
    return {
      id: node.id,
      x: node.pos_x,
      y: node.pos_y,
      w: size.w,
      h: size.h,
      cx: node.pos_x + size.w / 2,
      cy: node.pos_y + size.h / 2,
      // 캔버스 정본 색 해석(resolveNodeStroke) — 무지정 노드도 타입 기본색으로 실캔버스와 동일하게
      color: resolveNodeStroke(node.color, type),
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
      ref={panRef}
      data-id="scope-preview-pane"
      // 확대 중 드래그·휠 줌을 받아야 하므로 포인터 이벤트를 연다(정적 프리뷰라도).
      // 휠 줌은 1배에서 시작하므로 onZoom이 있으면 pannable 이전부터 열려 있어야 한다
      className={`${interactive || pannable || onZoom !== undefined ? "pointer-events-auto" : "pointer-events-none"} h-full w-full ${charcoal ? "bpm-l5-sky overflow-hidden rounded-md" : "bg-canvas"} ${
        pannable ? "cursor-grab overflow-hidden active:cursor-grabbing" : ""
      }`}
      onPointerDown={
        pannable
          ? (event) => {
              const el = panRef.current;
              if (el === null) return;
              el.setPointerCapture(event.pointerId);
              dragRef.current = {
                x: event.clientX,
                y: event.clientY,
                left: el.scrollLeft,
                top: el.scrollTop,
              };
            }
          : undefined
      }
      onPointerMove={
        pannable
          ? (event) => {
              const el = panRef.current;
              const drag = dragRef.current;
              if (el === null || drag === null) return;
              el.scrollLeft = drag.left - (event.clientX - drag.x);
              el.scrollTop = drag.top - (event.clientY - drag.y);
            }
          : undefined
      }
      onPointerUp={
        pannable
          ? (event) => {
              dragRef.current = null;
              panRef.current?.releasePointerCapture(event.pointerId);
            }
          : undefined
      }
      onPointerCancel={pannable ? () => { dragRef.current = null; } : undefined}
    >
      <svg
        style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
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

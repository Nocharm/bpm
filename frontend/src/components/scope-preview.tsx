"use client";

// 비활성(조상) 창의 정적 프리뷰 — ReactFlow 없이 SVG로 노드 박스+엣지선을 그려
// viewBox로 창 크기에 자동 맞춤. 라이브 인스턴스 N개의 부하를 피하는 경량 렌더(시각 전용).
// 엣지는 화살표로 방향을 보이고, 흐름을 거슬러 되돌아가는 엣지(타겟이 왼쪽)는 노드 위로 돌아가는 직각 경로로 그린다 —
// 중심점 직선이면 앞 노드들을 가로질러 순환이 안 보였다(사용자 지적 2026-09-28).

import { useEffect, useLayoutEffect, useRef } from "react";

import type { VersionGraph } from "@/lib/api";
import { resolveNodeStroke } from "@/components/process-node";
import { nodeSizeOf, normalizeNodeType } from "@/lib/canvas";
import { buildRoundedOrthPath } from "@/lib/edge-detour";

const ARROW_MARKER_ID = "scope-preview-arrow";
const BACK_EDGE_MIN_DX = 40;   // 타겟 중심이 소스보다 이만큼 왼쪽이면 역행(flow-layout isBackEdge와 같은 문턱)
const BACK_EDGE_CLEARANCE = 24; // 역행 경로가 두 노드 위로 띄우는 높이

export interface PreviewBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

// 중심→중심 직선이 타겟 박스 테두리와 만나는 점 — 화살촉이 박스 밑에 묻히지 않게 거기서 끊는다
function clipToBox(from: { cx: number; cy: number }, target: PreviewBox): { x: number; y: number } {
  const dx = target.cx - from.cx;
  const dy = target.cy - from.cy;
  const kx = dx !== 0 ? target.w / 2 / Math.abs(dx) : Infinity;
  const ky = dy !== 0 ? target.h / 2 / Math.abs(dy) : Infinity;
  const k = Math.min(kx, ky, 1);
  return { x: target.cx - dx * k, y: target.cy - dy * k };
}

/** 역행 엣지가 같은 노드 위에서 출발·도착할 때 통로를 레인별로 띄우는 간격(px) — 에디터 팬아웃 FAN_GAP과 동일 */
const BACK_EDGE_LANE_GAP = 10;

interface PreviewEdgeRef {
  id: string;
  source_node_id: string;
  target_node_id: string;
}

/**
 * 역행 엣지 레인 — 같은 타깃(또는 같은 소스)의 역행 엣지끼리 가까운 상대가 안쪽(무지개 중첩, 교차 없는 유일한
 * 순서). 두 그룹에 모두 속하면 큰 레인. 정방향 엣지는 중심→중심 직선이라 이미 갈라져 대상 아님(맵에 없음).
 */
export function assignPreviewBackLanes(
  edges: readonly PreviewEdgeRef[],
  centerById: ReadonlyMap<string, { cx: number }>,
): Map<string, number> {
  const back = edges.filter((edge) => {
    const source = centerById.get(edge.source_node_id);
    const target = centerById.get(edge.target_node_id);
    return !!source && !!target && target.cx < source.cx - BACK_EDGE_MIN_DX;
  });
  const lanes = new Map<string, number>();
  const span = (e: PreviewEdgeRef) =>
    (centerById.get(e.source_node_id)?.cx ?? 0) - (centerById.get(e.target_node_id)?.cx ?? 0);
  const byId = (a: PreviewEdgeRef, b: PreviewEdgeRef) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const groupsBy = (key: (edge: PreviewEdgeRef) => string) => {
    const groups = new Map<string, PreviewEdgeRef[]>();
    for (const edge of back) {
      const k = key(edge);
      groups.set(k, [...(groups.get(k) ?? []), edge]);
    }
    return [...groups.values()];
  };
  const groups = [...groupsBy((edge) => `t:${edge.target_node_id}`), ...groupsBy((edge) => `s:${edge.source_node_id}`)];
  for (const group of groups) {
    group.sort((a, b) => span(a) - span(b) || byId(a, b)).forEach((edge, k) => lanes.set(edge.id, Math.max(lanes.get(edge.id) ?? 0, k)));
  }
  // 두 그룹(같은 타깃·같은 소스)에 걸친 엣지가 같은 레인에 겹치면 긴 쪽을 한 칸 올린다 — 수렴할 때까지(역행 엣지는 소수)
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const group of groups) {
      let prev = -1;
      for (const edge of [...group].sort((a, b) => (lanes.get(a.id) ?? 0) - (lanes.get(b.id) ?? 0) || span(a) - span(b) || byId(a, b))) {
        const lane = lanes.get(edge.id) ?? 0;
        if (lane <= prev) {
          lanes.set(edge.id, prev + 1);
          changed = true;
          prev += 1;
        } else {
          prev = lane;
        }
      }
    }
    if (!changed) break;
  }
  return lanes;
}

/** 프리뷰 viewBox 위쪽 여백 — 가장 바깥 역행 레인의 통로가 잘리지 않게 레인만큼 더 띄운다 */
export function previewPadTop(lanes: ReadonlyMap<string, number>): number {
  let maxLane = 0;
  for (const lane of lanes.values()) {
    maxLane = Math.max(maxLane, lane);
  }
  return 40 + maxLane * BACK_EDGE_LANE_GAP;
}

/** 프리뷰 엣지 경로 — 앞으로 가는 엣지는 직선(타겟 테두리에서 끝), 역행 엣지는 소스 위→두 노드 위 통로→타겟 위로 도는 직각 경로.
 *  lane(assignPreviewBackLanes)만큼 통로를 더 띄워 같은 노드의 역행 엣지가 포개지지 않게 한다. */
export function buildPreviewEdgePath(source: PreviewBox, target: PreviewBox, lane = 0): { d: string; back: boolean } {
  if (target.cx < source.cx - BACK_EDGE_MIN_DX) {
    const yTop = Math.min(source.y, target.y) - BACK_EDGE_CLEARANCE - lane * BACK_EDGE_LANE_GAP;
    const [d] = buildRoundedOrthPath([
      { x: source.cx, y: source.y },
      { x: source.cx, y: yTop },
      { x: target.cx, y: yTop },
      { x: target.cx, y: target.y },
    ]);
    return { d, back: true };
  }
  const end = clipToBox(source, target);
  return { d: `M ${source.cx},${source.cy} L ${end.x},${end.y}`, back: false };
}

// 분기 노드는 실캔버스처럼 마름모 — 박스에 내접하는 네 꼭짓점(상·우·하·좌) (2026-09-23)
export function buildDiamondPoints(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
}

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
      type,
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
  // 같은 노드 위로 도는 역행 엣지 레인(무지개 중첩) — 에디터 팬아웃과 같은 규칙의 SVG 판
  const backLanes = assignPreviewBackLanes(edges, centerById);

  const pad = 40;  // 역행 경로 통로(BACK_EDGE_CLEARANCE)보다 넉넉해 위로 도는 선이 잘리지 않는다
  const minX = Math.min(...boxes.map((box) => box.x)) - pad;
  const minY = Math.min(...boxes.map((box) => box.y)) - previewPadTop(backLanes); // 바깥 레인만큼 위 여백 추가
  const maxX = Math.max(...boxes.map((box) => box.x + box.w)) + pad;
  const maxY = Math.max(...boxes.map((box) => box.y + box.h)) + pad;
  const viewBox = `${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}`;

  return (
    <div
      ref={panRef}
      data-id="scope-preview-pane"
      // 확대 중 드래그·휠 줌을 받아야 하므로 포인터 이벤트를 연다(정적 프리뷰라도).
      // 휠 줌은 1배에서 시작하므로 onZoom이 있으면 pannable 이전부터 열려 있어야 한다
      // select-none — SVG 라벨이 드래그로 선택되면 그 상태에서 팬(초점 이동)이 겉돈다 (사용자 요청 2026-09-03)
      className={`${interactive || pannable || onZoom !== undefined ? "pointer-events-auto" : "pointer-events-none"} h-full w-full select-none ${charcoal ? "bpm-l5-sky overflow-hidden rounded-md" : "bg-canvas"} ${
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
        <defs>
          <marker id={ARROW_MARKER_ID} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L8,4 L0,8 z" style={{ fill: "var(--color-border-strong)" }} />
          </marker>
        </defs>
        {edges.map((edge) => {
          const source = centerById.get(edge.source_node_id);
          const target = centerById.get(edge.target_node_id);
          if (!source || !target) {
            return null;
          }
          const { d, back } = buildPreviewEdgePath(source, target, backLanes.get(edge.id) ?? 0);
          return (
            <path
              key={edge.id}
              d={d}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray={back ? "4 3" : undefined}
              markerEnd={`url(#${ARROW_MARKER_ID})`}
              data-back={back || undefined}
              style={{ stroke: "var(--color-border-strong)" }}
            />
          );
        })}
        {boxes.map((box) => {
          const shapeClass = interactive
            ? "cursor-pointer [transition:all_.15s] hover:[stroke-width:3px] hover:[filter:brightness(0.92)]"
            : undefined;
          const shapeStyle = { fill: `color-mix(in srgb, ${box.color} 18%, white)`, stroke: box.color };
          return (
          <g key={box.id}>
            {box.type === "decision" ? (
              <polygon
                points={buildDiamondPoints(box.x, box.y, box.w, box.h)}
                strokeWidth={1.5}
                strokeLinejoin="round"
                className={shapeClass}
                style={shapeStyle}
              />
            ) : (
              <rect
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                rx={8}
                strokeWidth={1.5}
                className={shapeClass}
                style={shapeStyle}
              />
            )}
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
          );
        })}
      </svg>
    </div>
  );
}

"use client";

// 비활성(조상) 창·요약 모달·라이브러리 피크·임포트 리포트가 공유하는 정적 프리뷰 — ReactFlow 없이 SVG로 노드 박스+엣지를 그려
// viewBox로 창 크기에 자동 맞춤. 라이브 인스턴스 N개의 부하를 피하는 경량 렌더(시각 전용).
// 기하(노드 크기·저장된 변·선 모양·우회·역행 통로·라벨)는 lib/preview-geometry 한 곳 — 역행 엣지는 노드 위(아래)
// 통로로, 같은 줄을 건너뛰는 엣지는 노드 아래 통로로 돌려 순차 흐름처럼 묻히지 않게 한다(사용자 지적 2026-09-28).

import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { Link2 } from "lucide-react";

import type { VersionGraph } from "@/lib/api";
import { EDGE_LABEL_MAX_WIDTH, EDGE_LABEL_PAD_X } from "@/lib/canvas";
import { buildDiamondPoints, buildPreviewScene, PREVIEW_TITLE_MAX_LINES } from "@/lib/preview-geometry";
import { resolveNodeStroke } from "@/components/process-node";

const EDGE_STROKE = "var(--color-border-strong)";
// 라벨 foreignObject 상자 — 알약은 그 안 중앙에 놓이고 최대폭에서 줄바꿈(에디터 HTML 라벨과 같은 폭)
const LABEL_BOX_W = EDGE_LABEL_MAX_WIDTH + EDGE_LABEL_PAD_X;
const LABEL_BOX_H = 64;

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
  const scene = useMemo(() => buildPreviewScene(fullGraph, scopeParentId), [fullGraph, scopeParentId]);
  // 빈 스코프는 팬 컨테이너 없이 조기 반환한다 — 그래프가 늦게 채워지면 리스너를 그때 붙여야 한다
  const hasNodes = scene !== null;
  // 화살촉 마커 id — 조상 창 N개·요약 모달·피크가 동시에 마운트되므로 인스턴스마다 유일해야 한다
  // (같은 id면 첫 SVG를 참조하고, 그 SVG가 display:none이면 Chrome이 화살촉을 버린다)
  const instanceId = useId();
  const markerBase = `scope-preview-arrow-${instanceId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

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

  if (scene === null) {
    return <div className={`h-full w-full ${charcoal ? "bpm-l5-sky rounded-md" : "bg-canvas"}`} />;
  }

  const { boxes, edges, viewBox: vb } = scene;
  const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  // 선 색별 화살촉(기본·분기 Yes/No) — marker는 선 색을 상속하지 못해 색마다 하나
  const strokes = [EDGE_STROKE, ...new Set(edges.map((edge) => edge.stroke).filter((stroke): stroke is string => stroke !== null))];
  const markerIdOf = (stroke: string | null) => `${markerBase}-${strokes.indexOf(stroke ?? EDGE_STROKE)}`;

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
          {strokes.map((stroke, i) => (
            <marker key={stroke} id={`${markerBase}-${i}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L8,4 L0,8 z" style={{ fill: stroke }} />
            </marker>
          ))}
        </defs>
        {edges.map((edge) => (
          <path
            key={edge.id}
            d={edge.d}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray={edge.back ? "4 3" : undefined}
            markerEnd={`url(#${markerIdOf(edge.stroke)})`}
            data-back={edge.back || undefined}
            style={{ stroke: edge.stroke ?? EDGE_STROKE }}
          />
        ))}
        {boxes.map((box) => {
          const shapeClass = interactive
            ? "cursor-pointer [transition:all_.15s] hover:[stroke-width:3px] hover:[filter:brightness(0.92)]"
            : undefined;
          // 캔버스 정본 색 해석(resolveNodeStroke) — 무지정 노드도 타입 기본색으로 실캔버스와 동일하게
          const color = resolveNodeStroke(box.color, box.type);
          const shapeStyle = { fill: `color-mix(in srgb, ${color} 18%, white)`, stroke: color };
          const isDecision = box.type === "decision";
          return (
            <g key={box.id}>
              {isDecision ? (
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
              {/* 제목 — 노드 폭 안에서 줄바꿈(\n 존중), 최대 줄 수를 넘으면 말줄임. 에디터 노드처럼 HTML 텍스트라
                  긴 한글 제목이 이웃 노드로 넘치지 않는다. pointer-events-none — 호버는 도형이 받는다 */}
              <foreignObject x={box.x} y={box.y} width={box.w} height={box.h} className="pointer-events-none">
                <div
                  className={`flex h-full w-full items-center justify-center text-center ${isDecision ? "px-5" : "px-3"}`}
                  style={{ color: "var(--color-ink)", fontSize: isDecision ? 12 : 14, lineHeight: isDecision ? "16px" : "20px" }}
                >
                  <span
                    className="overflow-hidden whitespace-pre-line [overflow-wrap:anywhere]"
                    style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: PREVIEW_TITLE_MAX_LINES }}
                  >
                    {box.title}
                  </span>
                </div>
              </foreignObject>
            </g>
          );
        })}
        {/* 엣지 라벨 — 노드 위에 그려 가려지지 않게(에디터 EdgeLabelRenderer와 같은 층). 알약 스타일은 에디터와 같은 출처 */}
        {edges.map((edge) =>
          edge.label && edge.labelStyle ? (
            <foreignObject
              key={`label-${edge.id}`}
              x={edge.labelX - LABEL_BOX_W / 2}
              y={edge.labelY - LABEL_BOX_H / 2}
              width={LABEL_BOX_W}
              height={LABEL_BOX_H}
              className="pointer-events-none overflow-visible"
            >
              <div className="flex h-full w-full items-center justify-center">
                <span
                  data-id={`scope-preview-edge-label-${edge.id}`}
                  data-mirrored={edge.mirrored || undefined}
                  className="whitespace-pre-wrap text-center leading-tight [overflow-wrap:break-word]"
                  style={{ ...edge.labelStyle, maxWidth: EDGE_LABEL_MAX_WIDTH }}
                >
                  {edge.mirrored ? (
                    <span className="inline-flex items-center gap-1">
                      <Link2 size={11} strokeWidth={1.5} className="shrink-0" aria-hidden />
                      <span>{edge.label}</span>
                    </span>
                  ) : (
                    edge.label
                  )}
                </span>
              </div>
            </foreignObject>
          ) : null,
        )}
      </svg>
    </div>
  );
}

"use client";

// 에디터 엣지 — 선 모양 3종(곡선/꺾은선/직선) 경로 + HTML 라벨(EdgeLabelRenderer).
// React Flow 기본 라벨은 SVG <text>라 줄바꿈(\n)을 렌더하지 못한다 → Alt/Shift+Enter 다중행 라벨을 위해
// HTML 라벨로 대체. 빌트인 타입 키(default/smoothstep/straight)를 그대로 덮어 기존 edge.type을 재사용한다.

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useNodes,
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";

import type { AppNode } from "@/lib/canvas";
import {
  buildDetourPoints,
  buildRoundedOrthPath,
  type ObstacleRect,
} from "@/lib/edge-detour";

type LineVariant = "default" | "smoothstep" | "straight";

/** 선 모양별 경로 + 라벨 앵커 좌표. */
function buildPath(variant: LineVariant, props: EdgeProps): [string, number, number] {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  if (variant === "straight") {
    const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
    return [path, labelX, labelY];
  }
  const params = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
  const [path, labelX, labelY] =
    variant === "default" ? getBezierPath(params) : getSmoothStepPath(params);
  return [path, labelX, labelY];
}

// 꺾은선 전용 장애물 회피 — 렌더된 노드(표시 좌표·실측 크기)를 장애물로 보고, 기본 3구간 경로가
// 관통하면 빈 회랑으로 우회(lib/edge-detour). 직선·곡선은 사용자가 고른 모양 유지라 대상 외.
// useNodes 훅 때문에 별도 컴포넌트 — variant 분기 안에서 훅을 조건 호출할 수 없다(Rules of Hooks).
function DetourSmoothstepEdge(props: EdgeProps) {
  const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius } =
    props;
  const nodes = useNodes<AppNode>();
  // section(Word 맵 영역 박스)은 장애물로 치지 않는다 — 배경 성격이라 전 엣지가 우회하게 됨
  const obstacles: ObstacleRect[] = nodes
    .filter(
      (node) =>
        node.id !== props.source &&
        node.id !== props.target &&
        !node.hidden &&
        node.data.nodeType !== "section" &&
        (node.measured?.width ?? 0) > 0 &&
        (node.measured?.height ?? 0) > 0,
    )
    .map((node) => ({
      x: node.position.x,
      y: node.position.y,
      w: node.measured?.width ?? 0,
      h: node.measured?.height ?? 0,
    }));
  const detour = buildDetourPoints({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    obstacles,
  });
  const [path, labelX, labelY] = detour
    ? buildRoundedOrthPath(detour)
    : buildPath("smoothstep", props);
  return renderEdge(
    { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius },
    path,
    labelX,
    labelY,
  );
}

// 경로 + HTML 라벨 공통 렌더 — LineEdge와 DetourSmoothstepEdge가 공유
function renderEdge(
  props: Pick<
    EdgeProps,
    "label" | "markerEnd" | "style" | "labelStyle" | "labelBgStyle" | "labelBgPadding" | "labelBgBorderRadius"
  >,
  path: string,
  labelX: number,
  labelY: number,
) {
  const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius } =
    props;
  const [padX, padY] = labelBgPadding ?? [6, 3];
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          {/* pointer-events-none — 라벨은 경로 중앙에 놓이므로 클릭/더블클릭/우클릭이
              아래 엣지 path로 그대로 통과해야 선택·라벨편집·컨텍스트 메뉴가 유지된다 */}
          <div
            className="nodrag nopan pointer-events-none absolute whitespace-pre-wrap text-center leading-tight"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              // 최대폭 + 자동 줄바꿈 — 긴 라벨이 이웃 노드를 덮지 않게 (사용자 요청 2026-08-23 #6)
              maxWidth: 160,
              overflowWrap: "break-word",
              // labelStyle/labelBgStyle은 SVG 어휘(fill/stroke)로 들어온다 — HTML 속성으로 변환
              color: labelStyle?.fill,
              fontWeight: labelStyle?.fontWeight,
              fontSize: labelStyle?.fontSize,
              background: labelBgStyle?.fill,
              border: labelBgStyle?.stroke ? `1px solid ${labelBgStyle.stroke}` : undefined,
              borderRadius: labelBgBorderRadius,
              padding: `${padY}px ${padX}px`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function createLineEdge(variant: LineVariant) {
  function LineEdge(props: EdgeProps) {
    const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius } =
      props;
    const [path, labelX, labelY] = buildPath(variant, props);
    return renderEdge(
      { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius },
      path,
      labelX,
      labelY,
    );
  }
  LineEdge.displayName = `LineEdge(${variant})`;
  return LineEdge;
}

// 빌트인 키를 덮어쓴다 — edge.type(=저장된 line_style)이 그대로 이 컴포넌트로 라우팅된다.
// 꺾은선만 장애물 회피 배선(DetourSmoothstepEdge) — 직선·곡선은 모양 유지.
export const EDITOR_EDGE_TYPES: EdgeTypes = {
  default: createLineEdge("default"),
  smoothstep: DetourSmoothstepEdge,
  straight: createLineEdge("straight"),
};

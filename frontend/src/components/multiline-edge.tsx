"use client";

// 에디터 엣지 — 선 모양 3종(곡선/꺾은선/직선) 경로 + HTML 라벨(EdgeLabelRenderer).
// React Flow 기본 라벨은 SVG <text>라 줄바꿈(\n)을 렌더하지 못한다 → Alt/Shift+Enter 다중행 라벨을 위해
// HTML 라벨로 대체. 빌트인 타입 키(default/smoothstep/straight)를 그대로 덮어 기존 edge.type을 재사용한다.

import { BaseEdge, EdgeLabelRenderer, useNodes, type EdgeProps, type EdgeTypes } from "@xyflow/react";
import { Link2 } from "lucide-react";

import { EdgePulseDot } from "@/components/edge-pulse-dot";
import { type AppNode, EDGE_LABEL_MAX_WIDTH } from "@/lib/canvas";
import { type EdgeObstacle } from "@/lib/edge-detour";
import { isEdgeFan, type EdgeFan } from "@/lib/edge-fanout";
import { getEdgeObstacles, resolveEdgePath, type EdgeLineVariant, type EdgePathResult } from "@/lib/edge-path";
import { getDecisionTravel, isEdgePulse } from "@/lib/edge-pulse";

/** 같은 핸들 형제 팬 레인 — 표면(styledEdges·비교 appEdges)이 edge.data.fan으로 넘긴다. 없으면 undefined */
function fanOf(props: Pick<EdgeProps, "data">): EdgeFan | undefined {
  const fan = props.data?.fan;
  return isEdgeFan(fan) ? fan : undefined;
}

/** 하위 호환 — 노드 배열 → 우회 장애물(lib/edge-path getEdgeObstacles, 배열 identity별 WeakMap 캐시) */
export function getObstacles(nodes: AppNode[]): EdgeObstacle[] {
  return getEdgeObstacles(nodes);
}

/**
 * 현재 RF 인스턴스의 렌더 노드 → 우회 장애물. 꺾은선 엣지만 구독해야 한다 — 직선·곡선까지 useNodes를 걸면
 * 노드가 움직일 때마다 전 엣지가 다시 그려진다. 여러 RF 인스턴스가 동시에 떠도 캐시가 인스턴스별로 갈린다.
 */
export function useEdgeObstacles(): EdgeObstacle[] {
  return getEdgeObstacles(useNodes());
}

/** EdgeProps → 경로 해석(lib/edge-path). obstacles는 꺾은선에서만 넘긴다 */
function resolvePropsPath(variant: EdgeLineVariant, props: EdgeProps, obstacles?: readonly EdgeObstacle[]): EdgePathResult {
  return resolveEdgePath({
    variant,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    fan: fanOf(props),
    obstacles,
    sourceId: props.source,
    targetId: props.target,
  });
}

// 꺾은선 — 렌더된 노드(표시 좌표·실측 크기)를 장애물로 팬 → 우회 → RF 경로(lib/edge-path).
// useNodes 구독 때문에 별도 컴포넌트 — 직선·곡선(LineEdge)은 노드를 구독하지 않는다.
function DetourSmoothstepEdge(props: EdgeProps) {
  const obstacles = useEdgeObstacles();
  return renderEdge(props, resolvePropsPath("smoothstep", props, obstacles));
}

// 경로 + HTML 라벨 공통 렌더 — LineEdge와 DetourSmoothstepEdge가 공유
function renderEdge(props: EdgeProps, resolved: EdgePathResult) {
  const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data } =
    props;
  const { path, labelX, labelY } = resolved;
  const pulseTravel = getDecisionTravel(props.sourceX, props.sourceY, props.targetX, props.targetY);
  // 흐름 펄스(병렬 동시·분기 택일) — 표면이 edge.data.pulse로 넘긴다(lib/edge-pulse, 렌더 전용)
  const pulse = isEdgePulse(data?.pulse) ? data.pulse : null;
  const [padX, padY] = labelBgPadding ?? [6, 3];
  // 미러 라벨(하위프로세스 끝 제목 기본값, 저장 안 됨) — 점선 테두리 + 링크 아이콘으로 직접 라벨과 구분
  const mirrored = data?.labelMirrored === true;
  const borderStyle = labelBgStyle?.strokeDasharray ? "dashed" : "solid";
  return (
    <>
      {/* data-label-x/y — 해석기 라벨 앵커(플로우 좌표). 라벨이 없어도 실려 인라인 라벨 편집기가 같은 점에 붙는다 */}
      <BaseEdge path={path} markerEnd={markerEnd} style={style} data-label-x={labelX} data-label-y={labelY} />
      {pulse ? <EdgePulseDot path={path} pulse={pulse} travel={pulseTravel} /> : null}
      {label ? (
        <EdgeLabelRenderer>
          {/* pointer-events-none — 라벨은 경로 중앙에 놓이므로 클릭/더블클릭/우클릭이
              아래 엣지 path로 그대로 통과해야 선택·라벨편집·컨텍스트 메뉴가 유지된다 */}
          <div
            className="nodrag nopan pointer-events-none absolute whitespace-pre-wrap text-center leading-tight"
            data-mirrored={mirrored ? "true" : undefined}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              // 최대폭 + 자동 줄바꿈 — 긴 라벨이 이웃 노드를 덮지 않게 (사용자 요청 2026-08-23 #6).
              // 임포트 자동배치가 이 값으로 랭크 간격을 잡는다 — canvas.ts 주석 참조
              maxWidth: EDGE_LABEL_MAX_WIDTH,
              overflowWrap: "break-word",
              // labelStyle/labelBgStyle은 SVG 어휘(fill/stroke)로 들어온다 — HTML 속성으로 변환
              color: labelStyle?.fill,
              fontWeight: labelStyle?.fontWeight,
              fontSize: labelStyle?.fontSize,
              background: labelBgStyle?.fill,
              border: labelBgStyle?.stroke ? `1px ${borderStyle} ${labelBgStyle.stroke}` : undefined,
              // 선택 라벨 링 — 선의 글로우와 짝(lib/canvas highlightEdgeLabel)
              boxShadow: labelBgStyle?.boxShadow,
              borderRadius: labelBgBorderRadius,
              padding: `${padY}px ${padX}px`,
            }}
          >
            {mirrored ? (
              <span className="inline-flex items-center gap-1">
                <Link2 size={11} strokeWidth={1.5} className="shrink-0" aria-hidden />
                <span>{label}</span>
              </span>
            ) : (
              label
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function createLineEdge(variant: EdgeLineVariant) {
  function LineEdge(props: EdgeProps) {
    return renderEdge(props, resolvePropsPath(variant, props));
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

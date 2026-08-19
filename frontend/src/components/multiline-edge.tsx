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
  type EdgeProps,
  type EdgeTypes,
} from "@xyflow/react";

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

function createLineEdge(variant: LineVariant) {
  function LineEdge(props: EdgeProps) {
    const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius } =
      props;
    const [path, labelX, labelY] = buildPath(variant, props);
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
  LineEdge.displayName = `LineEdge(${variant})`;
  return LineEdge;
}

// 빌트인 키를 덮어쓴다 — edge.type(=저장된 line_style)이 그대로 이 컴포넌트로 라우팅된다.
export const EDITOR_EDGE_TYPES: EdgeTypes = {
  default: createLineEdge("default"),
  smoothstep: createLineEdge("smoothstep"),
  straight: createLineEdge("straight"),
};

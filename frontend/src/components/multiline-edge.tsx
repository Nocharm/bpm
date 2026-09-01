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

import { type AppNode, EDGE_LABEL_MAX_WIDTH } from "@/lib/canvas";
import {
  buildDetourPoints,
  buildRoundedOrthPath,
  toEdgeObstacle,
  type EdgeObstacle,
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

// 장애물 목록 캐시 — RF 스토어 nodes 배열 identity당 1회 산출해 모든 꺾은선 엣지가 공유한다.
// 종전엔 엣지마다 filter+map+inflate로 노드 수만큼 새 객체를 만들어(엣지×노드/프레임) 드래그 중
// GC·crossesV가 프레임 예산을 다 먹었다(352노드×351엣지 실측 avg 120ms/frame). 렌더 중 모듈
// 상태지만 입력 identity 기반 멱등 메모라 호출 순서와 무관하게 결과가 같다(에디터 RF 단일 인스턴스).
let obstacleSrc: unknown = null;
let obstacleList: EdgeObstacle[] = [];
function getObstacles(nodes: AppNode[]): EdgeObstacle[] {
  if (nodes !== obstacleSrc) {
    const list: EdgeObstacle[] = [];
    for (const node of nodes) {
      const w = node.measured?.width ?? 0;
      const h = node.measured?.height ?? 0;
      // section(Word 맵 영역 박스)은 장애물로 치지 않는다 — 배경 성격이라 전 엣지가 우회하게 됨
      if (node.hidden || node.data.nodeType === "section" || w <= 0 || h <= 0) continue;
      list.push(toEdgeObstacle(node.id, { x: node.position.x, y: node.position.y, w, h }));
    }
    obstacleSrc = nodes;
    obstacleList = list;
  }
  return obstacleList;
}

// 꺾은선 전용 장애물 회피 — 렌더된 노드(표시 좌표·실측 크기)를 장애물로 보고, 기본 3구간 경로가
// 관통하면 빈 회랑으로 우회(lib/edge-detour). 직선·곡선은 사용자가 고른 모양 유지라 대상 외.
// useNodes 훅 때문에 별도 컴포넌트 — variant 분기 안에서 훅을 조건 호출할 수 없다(Rules of Hooks).
function DetourSmoothstepEdge(props: EdgeProps) {
  const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius } =
    props;
  const nodes = useNodes<AppNode>();
  const obstacles = getObstacles(nodes);
  const detour = buildDetourPoints({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    obstacles,
    skipA: props.source,
    skipB: props.target,
  });
  const [path, labelX, labelY] = detour
    ? buildRoundedOrthPath(
        detour,
        // 라벨 가림 판정도 양끝 노드 제외 — 우회가 실제로 잡힌 엣지에서만 재구성(희귀 경로)
        obstacles.filter((o) => o.id !== props.source && o.id !== props.target),
      )
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
              // 최대폭 + 자동 줄바꿈 — 긴 라벨이 이웃 노드를 덮지 않게 (사용자 요청 2026-08-23 #6).
              // 임포트 자동배치가 이 값으로 랭크 간격을 잡는다 — canvas.ts 주석 참조
              maxWidth: EDGE_LABEL_MAX_WIDTH,
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

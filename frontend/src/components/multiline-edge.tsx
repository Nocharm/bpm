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
import { Link2 } from "lucide-react";

import { type AppNode, EDGE_LABEL_MAX_WIDTH } from "@/lib/canvas";
import {
  buildDetourPoints,
  buildRoundedOrthPath,
  isPolylineBlocked,
  toEdgeObstacle,
  type EdgeObstacle,
} from "@/lib/edge-detour";
import {
  buildFanBezierPath,
  buildFanStepPath,
  isEdgeFan,
  spreadStraightEndpoints,
  type EdgeFan,
} from "@/lib/edge-fanout";

type LineVariant = "default" | "smoothstep" | "straight";

/** 같은 핸들 형제 팬 레인 — 표면(styledEdges·비교 appEdges)이 edge.data.fan으로 넘긴다. 없으면 undefined */
function fanOf(props: Pick<EdgeProps, "data">): EdgeFan | undefined {
  const fan = props.data?.fan;
  return isEdgeFan(fan) ? fan : undefined;
}

/** 선 모양별 경로 + 라벨 앵커 좌표. 팬 레인이 있으면 곡선은 제어점 중첩, 직선은 끝점 분산(lib/edge-fanout). */
function buildPath(variant: LineVariant, props: EdgeProps): [string, number, number] {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  const params = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
  const fan = fanOf(props);
  if (variant === "straight") {
    const spread = fan ? spreadStraightEndpoints(params, fan) : params;
    const [path, labelX, labelY] = getStraightPath(spread);
    return [path, labelX, labelY];
  }
  if (variant === "default") {
    const fanned = fan ? buildFanBezierPath(params, fan) : null;
    if (fanned) {
      return fanned;
    }
  }
  const [path, labelX, labelY] =
    variant === "default" ? getBezierPath(params) : getSmoothStepPath(params);
  return [path, labelX, labelY];
}

// 장애물 목록 캐시 — RF 스토어 nodes 배열 identity당 1회 산출해 모든 꺾은선 엣지가 공유한다.
// 종전엔 엣지마다 filter+map+inflate로 노드 수만큼 새 객체를 만들어(엣지×노드/프레임) 드래그 중
// GC·crossesV가 프레임 예산을 다 먹었다(352노드×351엣지 실측 avg 120ms/frame). 렌더 중 모듈
// 상태지만 입력 identity 기반 멱등 메모라 호출 순서와 무관하게 결과가 같다(RF 단일 인스턴스 전제 —
// 에디터와 비교 화면은 다른 라우트라 동시에 마운트되지 않는다. 미리보기처럼 N개 인스턴스인 표면엔 쓰지 말 것).
let obstacleSrc: unknown = null;
let obstacleList: EdgeObstacle[] = [];
export function getObstacles(nodes: AppNode[]): EdgeObstacle[] {
  if (nodes !== obstacleSrc) {
    const list: EdgeObstacle[] = [];
    for (const node of nodes) {
      const w = node.measured?.width ?? 0;
      const h = node.measured?.height ?? 0;
      if (node.hidden || w <= 0 || h <= 0) continue;
      list.push(toEdgeObstacle(node.id, { x: node.position.x, y: node.position.y, w, h }));
    }
    obstacleSrc = nodes;
    obstacleList = list;
  }
  return obstacleList;
}

// 꺾은선 전용 장애물 회피 — 렌더된 노드(표시 좌표·실측 크기)를 장애물로 보고, 기본 3구간 경로가
// 관통하면 빈 회랑으로 우회(lib/edge-detour). 직선·곡선은 사용자가 고른 모양 유지라 대상 외.
// 같은 핸들 형제(data.fan)가 있으면 먼저 팬 경로(게이트 포인트+원호)를 시도하고, 그 경로가 다른 노드를
// 관통하면 이 엣지만 현행(우회/RF) 경로로 돌아간다 — 겹침 최소화는 장애물 회피보다 우선순위가 낮다.
// useNodes 훅 때문에 별도 컴포넌트 — variant 분기 안에서 훅을 조건 호출할 수 없다(Rules of Hooks).
function DetourSmoothstepEdge(props: EdgeProps) {
  const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data } =
    props;
  const nodes = useNodes<AppNode>();
  const obstacles = getObstacles(nodes);
  const fan = fanOf(props);
  if (fan) {
    const others = obstacles.filter((o) => o.id !== props.source && o.id !== props.target);
    const fanned = buildFanStepPath(
      {
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetX: props.targetX,
        targetY: props.targetY,
        sourcePosition: props.sourcePosition,
        targetPosition: props.targetPosition,
      },
      fan,
      others,
    );
    if (fanned && !isPolylineBlocked(fanned.points, obstacles, props.source, props.target)) {
      return renderEdge(
        { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data },
        fanned.d,
        fanned.labelX,
        fanned.labelY,
      );
    }
  }
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
    { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data },
    path,
    labelX,
    labelY,
  );
}

// 경로 + HTML 라벨 공통 렌더 — LineEdge와 DetourSmoothstepEdge가 공유
function renderEdge(
  props: Pick<
    EdgeProps,
    "label" | "markerEnd" | "style" | "labelStyle" | "labelBgStyle" | "labelBgPadding" | "labelBgBorderRadius" | "data"
  >,
  path: string,
  labelX: number,
  labelY: number,
) {
  const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data } =
    props;
  const [padX, padY] = labelBgPadding ?? [6, 3];
  // 미러 라벨(하위프로세스 끝 제목 기본값, 저장 안 됨) — 점선 테두리 + 링크 아이콘으로 직접 라벨과 구분
  const mirrored = data?.labelMirrored === true;
  const borderStyle = labelBgStyle?.strokeDasharray ? "dashed" : "solid";
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
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

function createLineEdge(variant: LineVariant) {
  function LineEdge(props: EdgeProps) {
    const { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data } =
      props;
    const [path, labelX, labelY] = buildPath(variant, props);
    return renderEdge(
      { label, markerEnd, style, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data },
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

// 엣지 경로 단일 해석기 — 선 모양별 경로와 라벨 앵커를 한 곳에서 정한다(순수).
// 꺾은선은 팬(lib/edge-fanout) → 장애물 우회(lib/edge-detour) → RF+최소 높이(lib/edge-stub) 순으로 시도한다.
// 에디터·L5(multiline-edge)와 비교(LabeledSmoothEdge)가 공유 — 표면마다 체인을 따로 두면 비교만 우회가 빠지는
// 식으로 갈라진다(2026-10-06 감사). 라벨 위치도 여기서 나온다: 우회는 가리지 않는 구간 중앙, 팬은 팬 경로 규칙,
// 곡선은 t=0.5.
import { getStraightPath, type Node } from "@xyflow/react";

import {
  buildDetourPoints,
  buildRoundedOrthPath,
  isPolylineBlocked,
  toEdgeObstacle,
  type EdgeObstacle,
} from "@/lib/edge-detour";
import { buildFanBezierPath, buildFanStepPath, spreadStraightEndpoints, type EdgeFan } from "@/lib/edge-fanout";
import { getBezierPathWithStub, getSmoothStepPathWithStub, type EdgeEndsArgs } from "@/lib/edge-stub";

/** 저장 선 모양(edge.type = line_style) — default=곡선, smoothstep=꺾은선, straight=직선 */
export type EdgeLineVariant = "default" | "smoothstep" | "straight";

/** 어떤 규칙으로 경로가 정해졌는지 — straight/bezier/step은 RF(+최소 높이) 기본, fan·detour는 대체 경로 */
export type EdgePathRoute = "straight" | "bezier" | "step" | "fan" | "detour";

export interface EdgePathArgs extends EdgeEndsArgs {
  variant: EdgeLineVariant;
  /** 같은 핸들 형제 레인(edge.data.fan). 없으면 팬 없음 */
  fan?: EdgeFan;
  /** 꺾은선 전용 — 렌더 노드 장애물(getEdgeObstacles). 없으면 우회·팬 관통 검사 없이 그린다 */
  obstacles?: readonly EdgeObstacle[];
  /** 엣지 양끝 노드 id — 장애물·라벨 가림 판정에서 뺀다 */
  sourceId?: string;
  targetId?: string;
}

export interface EdgePathResult {
  path: string;
  /** 라벨 앵커(플로우 좌표) — 렌더 라벨과 인라인 라벨 편집기가 같은 점을 쓴다 */
  labelX: number;
  labelY: number;
  route: EdgePathRoute;
}

/** 엣지 경로 + 라벨 앵커. 꺾은선만 obstacles를 쓴다(직선·곡선은 사용자가 고른 모양 유지). */
export function resolveEdgePath(args: EdgePathArgs): EdgePathResult {
  const { variant, fan, obstacles = [], sourceId, targetId } = args;
  const ends: EdgeEndsArgs = {
    sourceX: args.sourceX,
    sourceY: args.sourceY,
    sourcePosition: args.sourcePosition,
    targetX: args.targetX,
    targetY: args.targetY,
    targetPosition: args.targetPosition,
  };
  if (variant === "straight") {
    const [path, labelX, labelY] = getStraightPath(fan ? spreadStraightEndpoints(ends, fan) : ends);
    return { path, labelX, labelY, route: "straight" };
  }
  if (variant === "default") {
    const fanned = fan ? buildFanBezierPath(ends, fan) : null;
    const [path, labelX, labelY] = fanned ?? getBezierPathWithStub(ends);
    return { path, labelX, labelY, route: fanned ? "fan" : "bezier" };
  }
  // 팬 경로가 다른 노드를 관통하면 이 엣지만 우회/RF 경로로 — 겹침 최소화는 장애물 회피보다 우선순위가 낮다
  if (fan) {
    const fanned = buildFanStepPath(ends, fan, obstacles, sourceId, targetId);
    if (fanned && !isPolylineBlocked(fanned.points, obstacles, sourceId, targetId)) {
      return { path: fanned.d, labelX: fanned.labelX, labelY: fanned.labelY, route: "fan" };
    }
  }
  const detour = buildDetourPoints({ ...ends, obstacles, skipA: sourceId, skipB: targetId });
  if (detour) {
    const [path, labelX, labelY] = buildRoundedOrthPath(detour, obstacles, sourceId, targetId);
    return { path, labelX, labelY, route: "detour" };
  }
  const [path, labelX, labelY] = getSmoothStepPathWithStub(ends);
  return { path, labelX, labelY, route: "step" };
}

// 장애물 목록 캐시 — 노드 배열 identity당 1회 산출해 그 배열을 그리는 모든 꺾은선 엣지가 공유한다(엣지마다
// inflate하면 드래그 중 엣지×노드 할당이 프레임 예산을 먹는다). WeakMap이라 RF 인스턴스가 여럿(미리보기·선택 카드)이어도
// 배열끼리 서로 캐시를 밀어내지 않고, 버려진 배열은 GC가 회수한다.
const obstacleCache = new WeakMap<readonly Node[], EdgeObstacle[]>();

/** 렌더 노드(표시 좌표·실측 크기) → 우회 장애물. 숨김·미측정 노드는 제외 */
export function getEdgeObstacles(nodes: readonly Node[]): EdgeObstacle[] {
  const cached = obstacleCache.get(nodes);
  if (cached) {
    return cached;
  }
  const list: EdgeObstacle[] = [];
  for (const node of nodes) {
    const w = node.measured?.width ?? 0;
    const h = node.measured?.height ?? 0;
    if (node.hidden || w <= 0 || h <= 0) continue;
    list.push(toEdgeObstacle(node.id, { x: node.position.x, y: node.position.y, w, h }));
  }
  obstacleCache.set(nodes, list);
  return list;
}

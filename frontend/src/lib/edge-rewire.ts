// 엣지 재배선 판정(순수 함수) — 연결·드롭 삽입·삽입/교체·끝점 재연결·변 다시 고르기가 같은 규칙을 쓴다.
// 출력 규칙(lib/output-rules)·A↔B 1:1 회귀 차단·하위프로세스 핸들 계약(CLAUDE.md)을 한 곳에서 판정해
// 경로마다 규칙이 갈라지던 문제(드롭 삽입의 병렬 출구 무시·삽입 재연결의 역행 쌍 생성)를 막는다.

import type { Edge } from "@xyflow/react";

import {
  type AppNode,
  type HandleSide,
  nodeSizeOf,
  sourceHandleId,
  targetHandleId,
  withSubprocessHandles,
} from "@/lib/canvas";
import { type FlowDir, isBackEdge, pickHandleSide } from "@/lib/flow-layout";
import {
  getOutputGroups,
  getOutputKey,
  type OutputRuleEdge,
  type OutputRuleNode,
} from "@/lib/output-rules";
import { subprocessInHandle } from "@/lib/subprocess-embed";

export type ExitConnectKind =
  // 병렬 출구에 같은 대상 갈래가 이미 있음 — 토스트로 막는다
  | "duplicate"
  // 병렬 출구 — 삽입/교체 모달 없이 갈래를 더한다
  | "branch"
  // 단일 출구에 이미 출력이 있음 — 삽입/교체(또는 출력선 선택) 모달
  | "conflict"
  // 출력 없음 — 바로 연결
  | "free";

export interface ExitConnectEdge extends OutputRuleEdge {
  id: string;
  target: string;
}

export interface ExitConnectOptions {
  // 같은 대상으로 이미 가는 출력도 충돌로 셀지 — 핸들 연결은 셈(다른 변에서 다시 그으면 교체 모달),
  // 드롭 삽입은 안 셈(이미 이어진 노드를 옆에 다시 놓는 건 무변경)
  countSameTarget: boolean;
  // 끝점 재연결 — 옮기는 엣지 자신은 개수에서 뺀다(병렬 여부 판정엔 그대로 둔다)
  excludeEdgeId?: string;
}

/**
 * 노드의 한 출구(exitHandle → 출구 키)에서 target으로 새 연결을 낼 때의 처리. 병렬 판정은 출력 규칙과 같은
 * 소스(getOutputGroups: 속성 ∪ 시작 ∪ 레거시 gateway 도출). decision 분기 모달은 호출부가 먼저 처리한다.
 */
export function decideExitConnection(
  node: OutputRuleNode,
  edges: readonly ExitConnectEdge[],
  exitHandle: string | null | undefined,
  target: string,
  options: ExitConnectOptions,
): ExitConnectKind {
  const exitKey = getOutputKey(node.nodeType, exitHandle);
  const parallel =
    (node.parallelOutputs?.includes(exitKey) ?? false) ||
    getOutputGroups(node, edges).some((group) => group.key === exitKey && group.parallel);
  const onExit = edges.filter(
    (edge) =>
      edge.id !== options.excludeEdgeId &&
      edge.source === node.id &&
      getOutputKey(node.nodeType, edge.sourceHandle) === exitKey,
  );
  const toTarget = onExit.some((edge) => edge.target === target);
  if (parallel) {
    return toTarget ? "duplicate" : "branch";
  }
  const toOthers = onExit.some((edge) => edge.target !== target);
  return toOthers || (options.countSameTarget && toTarget) ? "conflict" : "free";
}

/** 연결 쌍 [출발, 도착] — 재배선 문제 보고용 */
export type EdgePair = [string, string];

/**
 * 삽입·재연결 결과 검증 — before에 없던 A↔B 역행 쌍이 생겼거나, 꼭 있어야 할 연결(required)이 빠졌으면
 * (withEdge가 역행이라 조용히 거부) 그 쌍을 돌려준다. 이미 있던 역행 쌍(레거시 데이터)은 문제로 보지 않는다.
 */
export function findRewireProblem(
  before: readonly Edge[],
  after: readonly Edge[],
  required: readonly EdgePair[],
): EdgePair | null {
  const keyOf = (source: string, target: string): string => `${source}\u0000${target}`;
  const beforeKeys = new Set(before.map((edge) => keyOf(edge.source, edge.target)));
  const afterKeys = new Set(after.map((edge) => keyOf(edge.source, edge.target)));
  for (const [source, target] of required) {
    if (!afterKeys.has(keyOf(source, target))) {
      return [source, target];
    }
  }
  for (const edge of after) {
    if (edge.source === edge.target || !afterKeys.has(keyOf(edge.target, edge.source))) continue;
    const existed =
      beforeKeys.has(keyOf(edge.source, edge.target)) && beforeKeys.has(keyOf(edge.target, edge.source));
    if (!existed) {
      return [edge.source, edge.target];
    }
  }
  return null;
}

export type ReconnectBlock = "selfLoop" | "reciprocal" | "duplicate" | "outputConflict";

export interface ReconnectTarget {
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}

/**
 * 엣지 끝점 재연결(RF onReconnect) 판정 — 새 연결과 같은 규칙: 자기루프·A↔B 역행·같은 출구 같은 대상 중복·
 * 출력 규칙(단일 출구에 다른 출력이 이미 있음). decision 소스는 다중 출력이 정상이라 출력 규칙 밖(완전 중복만 막음).
 * sourceNode는 새 출발 노드. 막히지 않으면 null.
 */
export function checkReconnect(
  edges: readonly ExitConnectEdge[],
  oldEdgeId: string,
  next: ReconnectTarget,
  sourceNode: OutputRuleNode,
): ReconnectBlock | null {
  if (next.source === next.target) {
    return "selfLoop";
  }
  const rest = edges.filter((edge) => edge.id !== oldEdgeId);
  if (rest.some((edge) => edge.source === next.target && edge.target === next.source)) {
    return "reciprocal";
  }
  if (sourceNode.nodeType === "decision") {
    const exact = rest.some(
      (edge) =>
        edge.source === next.source &&
        edge.target === next.target &&
        (edge.sourceHandle ?? null) === next.sourceHandle,
    );
    return exact ? "duplicate" : null;
  }
  const kind = decideExitConnection(sourceNode, edges, next.sourceHandle, next.target, {
    countSameTarget: true,
    excludeEdgeId: oldEdgeId,
  });
  if (kind === "duplicate") return "duplicate";
  if (kind === "conflict") {
    // 같은 대상 중복(다른 변 핸들)도 단일 출구에선 중복으로 안내 — 교체 모달이 없는 경로라서
    const sameTarget = rest.some(
      (edge) =>
        edge.source === next.source &&
        edge.target === next.target &&
        getOutputKey(sourceNode.nodeType, edge.sourceHandle) === getOutputKey(sourceNode.nodeType, next.sourceHandle),
    );
    return sameTarget ? "duplicate" : "outputConflict";
  }
  return null;
}

/** 재연결 적용 — 같은 id·라벨·선 모양·data(gateway)를 유지하고 끝점·핸들만 바꾼 뒤 하위프로세스 핸들 정규화. */
export function applyReconnect(
  edge: Edge,
  next: ReconnectTarget,
  isSubprocess: (nodeId: string) => boolean,
): Edge {
  return withSubprocessHandles(
    {
      ...edge,
      source: next.source,
      target: next.target,
      sourceHandle: next.sourceHandle,
      targetHandle: next.targetHandle,
    },
    isSubprocess,
  );
}

interface Center {
  cx: number;
  cy: number;
}

function getCenter(node: AppNode): Center {
  const size = nodeSizeOf(node.data.nodeType);
  const w = node.measured?.width ?? size.w;
  const h = node.measured?.height ?? size.h;
  return { cx: node.position.x + w / 2, cy: node.position.y + h / 2 };
}

/**
 * 맵 흐름 방향 추정(위치 기준) — 핸들 기준 flow-layout inferFlowDir과 달리 낡은 변을 고치는 명령이라 위치를 본다. 에디터는 마지막 자동정렬 방향을 기억하지 않으므로 엣지 끝점 중심 거리의 축별 합으로
 * 정한다(세로 합이 더 크면 TB, 같거나 작으면 LR — 기본 LR).
 */
export function inferFlowDirFromPositions(nodes: readonly AppNode[], edges: readonly Edge[]): FlowDir {
  const centers = new Map(nodes.map((node) => [node.id, getCenter(node)]));
  let sumX = 0;
  let sumY = 0;
  for (const edge of edges) {
    const s = centers.get(edge.source);
    const t = centers.get(edge.target);
    if (!s || !t) continue;
    sumX += Math.abs(t.cx - s.cx);
    sumY += Math.abs(t.cy - s.cy);
  }
  return sumY > sumX ? "TB" : "LR";
}

/**
 * 연결 변 다시 고르기(수동 명령) — edgeIds 엣지의 출발·도착 변을 현재 표시 위치로 다시 고른다.
 * 자동정렬(flow-layout autoLayoutFlow)과 같은 pickHandleSide/isBackEdge를 쓰되, 척추(주 흐름) 대신
 * "교차축 거리가 흐름축 거리보다 큰 연결"을 교차측 진입으로 본다 — 사용자가 손으로 둔 배치엔 척추가 없어서.
 * 하위프로세스 출발은 끝 키 핸들 유지, 도착은 고른 변의 들어오는 문(in / in:<변>). 바뀌지 않은 엣지는 같은 객체.
 * nodes는 표시 좌표(height-shift 오프셋 포함)여야 화면에 보이는 위치로 고른다.
 */
export function repickEdgeSides(
  nodes: readonly AppNode[],
  edges: readonly Edge[],
  edgeIds: ReadonlySet<string>,
  dir: FlowDir,
): Edge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    if (!edgeIds.has(edge.id)) return edge;
    const sourceNode = byId.get(edge.source);
    const targetNode = byId.get(edge.target);
    if (!sourceNode || !targetNode || edge.source === edge.target) return edge;
    const s = getCenter(sourceNode);
    const t = getCenter(targetNode);
    const back = isBackEdge(dir, s, t);
    const flowDist = dir === "LR" ? Math.abs(t.cx - s.cx) : Math.abs(t.cy - s.cy);
    const crossDist = dir === "LR" ? Math.abs(t.cy - s.cy) : Math.abs(t.cx - s.cx);
    const cross = crossDist > flowDist;
    const sourceSide: HandleSide = pickHandleSide(dir, s, t, cross, false, back);
    const targetSide: HandleSide = pickHandleSide(dir, t, s, cross, false, back);
    const sourceHandle =
      sourceNode.data.nodeType === "subprocess" ? edge.sourceHandle : sourceHandleId(sourceSide);
    const targetHandle =
      targetNode.data.nodeType === "subprocess" ? subprocessInHandle(targetSide) : targetHandleId(targetSide);
    if (sourceHandle === edge.sourceHandle && targetHandle === edge.targetHandle) return edge;
    return { ...edge, sourceHandle, targetHandle };
  });
}

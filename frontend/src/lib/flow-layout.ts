// 흐름 자동정렬 파이프라인 — dagre 방향 배치 + 척추(주 흐름) 직선화 + 곁가지 사슬 직선화 + 방향별 엣지 핸들 재지정.
// 비교 화면(compare)의 배치 로직을 일반화한 공용판: 비교는 seed=유지 노드·실측 상수 크기,
// 에디터는 seed=시작→대표 끝 경로·measured 실측 크기를 주입해 같은 구현을 공유한다.

import type { Edge } from "@xyflow/react";

import {
  type AppNode,
  type HandleSide,
  layoutSubsetWithDagre,
  layoutWithDagre,
  nodeSizeOf,
  pushApartFromBlock,
  sourceHandleId,
  targetHandleId,
} from "@/lib/canvas";
import { findLongestPath, type LayoutEdgeLink, sortLayoutEdges, splitForwardEdges } from "@/lib/layout-graph";
import { subprocessInHandle } from "@/lib/subprocess-embed";

export type FlowDir = "LR" | "TB";

interface Center {
  cx: number;
  cy: number;
}

type EdgeLink = { source: string; target: string };

/** spine(척추) 판정 — seed 노드에서 시작해 "분기 없는 단일 연속" 링크로 이어지는 노드까지 확장.
 *  선행 outDeg==1 → 후행도 spine, 후행 inDeg==1 → 선행도 spine. 분기/합류의 곁가지는 제외. */
export function computeSpine(
  presentIds: Set<string>,
  seedIds: Set<string>,
  edges: EdgeLink[],
): Set<string> {
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const edge of edges) {
    if (!presentIds.has(edge.source) || !presentIds.has(edge.target)) continue;
    outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
    inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
  }
  const spine = new Set<string>();
  for (const id of presentIds) if (seedIds.has(id)) spine.add(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (!presentIds.has(edge.source) || !presentIds.has(edge.target)) continue;
      if (spine.has(edge.source) && (outDeg.get(edge.source) ?? 0) === 1 && !spine.has(edge.target)) {
        spine.add(edge.target);
        grew = true;
      }
      if (spine.has(edge.target) && (inDeg.get(edge.target) ?? 0) === 1 && !spine.has(edge.source)) {
        spine.add(edge.source);
        grew = true;
      }
    }
  }
  return spine;
}

/** 백본(척추) 직선화 — spine을 흐름 수직축(cross) 공통선에 스냅(LR=공통 Y, TB=공통 X).
 *  spine 노드가 있는 열/행은 그 노드를 backbone에 정확히 맞추고, 나머지 열/행은 최근접 spine
 *  shift 적용으로 dagre 상대 배치를 보존. 곁가지는 BRANCH_PUSH만큼 추가 이격(엣지 꺾임 1회화).
 *  노드 크기 함수(renderW/renderH)는 호출측 주입 — 비교=실측 상수, 에디터=measured. */
export function alignBackbone(
  nodes: AppNode[],
  seedIds: Set<string>,
  dir: FlowDir,
  spine: Set<string>,
  renderW: (node: AppNode) => number,
  renderH: (node: AppNode) => number,
): AppNode[] {
  // cross = 흐름에 수직인 축(정렬 대상), flow = 흐름 진행축(열/행 그룹 키). LR: cross=Y·flow=X, TB: 반대.
  const cross = (node: AppNode) =>
    dir === "LR" ? node.position.y + renderH(node) / 2 : node.position.x + renderW(node) / 2;
  const flow = (node: AppNode) =>
    dir === "LR" ? node.position.x + renderW(node) / 2 : node.position.y + renderH(node) / 2;
  const kept = nodes.filter((node) => seedIds.has(node.id));
  if (kept.length === 0) return nodes;
  const backboneCross = kept.reduce((sum, node) => sum + cross(node), 0) / kept.length;

  const flowKey = (node: AppNode) => Math.round(flow(node) / 10);
  const groups = new Map<number, AppNode[]>();
  for (const node of nodes) {
    const key = flowKey(node);
    const list = groups.get(key);
    if (list) list.push(node);
    else groups.set(key, [node]);
  }
  // spine 노드가 있는 열/행의 shift(그 노드를 backbone에 정확히 맞춤).
  const spineShift = new Map<number, number>();
  for (const [key, colNodes] of groups) {
    const anchor = colNodes.find((node) => spine.has(node.id));
    if (anchor) spineShift.set(key, backboneCross - cross(anchor));
  }
  // spine 없는 열/행(순수 곁가지)은 가장 가까운 spine 열의 shift를 적용 — 상대 오프셋 보존.
  const nearestSpineShift = (key: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (const [spineKey, shift] of spineShift) {
      const dist = Math.abs(spineKey - key);
      if (dist < bestDist) {
        bestDist = dist;
        best = shift;
      }
    }
    return best;
  };
  const shiftById = new Map<string, number>();
  for (const [key, colNodes] of groups) {
    const shift = spineShift.has(key) ? (spineShift.get(key) ?? 0) : nearestSpineShift(key);
    for (const node of colNodes) shiftById.set(node.id, shift);
  }
  // 곁가지(off-spine)는 라인에서 더 밀어낸다 — 라인에 붙어 있으면 병합 엣지가 마지막에 한 번 더 꺾인다.
  const BRANCH_PUSH = 60;
  return nodes.map((node) => {
    let shift = shiftById.get(node.id) ?? 0;
    if (!spine.has(node.id)) {
      const resid = cross(node) + shift - backboneCross; // 정렬 후 backbone 기준 편차(부호=위/아래·좌/우)
      shift += resid < 0 ? -BRANCH_PUSH : BRANCH_PUSH;
    }
    return dir === "LR"
      ? { ...node, position: { x: node.position.x, y: node.position.y + shift } }
      : { ...node, position: { x: node.position.x + shift, y: node.position.y } };
  });
}

/** 흐름 역행 루프 판정 — 타겟이 흐름 반대쪽(뒤)이고 수직축 이동이 작을 때만 back측으로 뽑는다. */
export function isBackEdge(dir: FlowDir, source: Center, target: Center): boolean {
  return dir === "LR"
    ? target.cx < source.cx - 40 && Math.abs(target.cy - source.cy) < 150
    : target.cy < source.cy - 40 && Math.abs(target.cx - source.cx) < 150;
}

/** 한 끝의 출입 변 — 역행=back측(상/좌), spine→곁가지 진입=cross측, 그 외=흐름측. */
export function pickHandleSide(
  dir: FlowDir,
  thisC: Center | undefined,
  otherC: Center | undefined,
  thisOnSpine: boolean,
  otherOnSpine: boolean,
  back: boolean,
): HandleSide {
  if (back) return dir === "LR" ? "top" : "left";
  if (!thisC || !otherC) return dir === "LR" ? "right" : "bottom";
  const dx = otherC.cx - thisC.cx;
  const dy = otherC.cy - thisC.cy;
  const flowSide: HandleSide =
    dir === "LR" ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  const crossSide: HandleSide =
    dir === "LR" ? (dy < 0 ? "top" : "bottom") : dx < 0 ? "left" : "right";
  return thisOnSpine && !otherOnSpine ? crossSide : flowSide;
}


/** 시작→대표 끝 주 경로(척추 시드) — 되돌아가는 엣지를 뺀 그래프의 최장 경로, 동점은 예 라벨 우선(lib/layout-graph).
 *  시작/끝이 없거나 미연결이면 빈 집합(직선화 생략). */
export function findMainPath(nodes: AppNode[], edges: LayoutEdgeLink[]): Set<string> {
  const start = nodes.find((node) => node.data.nodeType === "start");
  const end =
    nodes.find((node) => node.data.nodeType === "end" && node.data.isPrimaryEnd) ??
    nodes.find((node) => node.data.nodeType === "end");
  if (!start || !end) return new Set();
  const nodeIds = nodes.map((node) => node.id);
  const { forward } = splitForwardEdges(nodeIds, sortLayoutEdges(nodeIds, edges));
  return findLongestPath(nodeIds, forward, start.id, end.id);
}

// 곁가지 직선화 때 이웃과 띄울 최소 간격(px)
const CHAIN_GAP = 16;

/** 곁가지 사슬 직선화 — 척추 밖에서 1입력·1출력으로 이어지는 사슬(r1→r2→…)을 머리 노드의 수직축 위치에 맞춘다.
 *  열마다 다른 dagre 위치·최근접 척추 열 shift 차용 때문에 생기던 계단을 편다. 옮기면 겹치는 노드에서 사슬을 멈춘다.
 *  consultant_layout.py straighten_side_chains와 동치. */
export function straightenSideChains(
  nodes: AppNode[],
  dir: FlowDir,
  spine: Set<string>,
  edges: EdgeLink[],
  forward: EdgeLink[],
  renderW: (node: AppNode) => number,
  renderH: (node: AppNode) => number,
): AppNode[] {
  const present = new Set(nodes.map((node) => node.id));
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const edge of edges) {
    if (!present.has(edge.source) || !present.has(edge.target)) continue;
    outDeg.set(edge.source, (outDeg.get(edge.source) ?? 0) + 1);
    inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
  }
  const next = new Map<string, string>();
  const linkedIn = new Set<string>();
  for (const edge of forward) {
    if (spine.has(edge.source) || spine.has(edge.target)) continue;
    if (outDeg.get(edge.source) !== 1 || inDeg.get(edge.target) !== 1) continue;
    next.set(edge.source, edge.target);
    linkedIn.add(edge.target);
  }
  if (next.size === 0) return nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const cross = (node: AppNode) =>
    dir === "LR" ? node.position.y + renderH(node) / 2 : node.position.x + renderW(node) / 2;
  const withCross = (node: AppNode, value: number): AppNode =>
    dir === "LR"
      ? { ...node, position: { x: node.position.x, y: value - renderH(node) / 2 } }
      : { ...node, position: { x: value - renderW(node) / 2, y: node.position.y } };
  const collides = (moved: AppNode) => {
    const ax2 = moved.position.x + renderW(moved);
    const ay2 = moved.position.y + renderH(moved);
    for (const other of byId.values()) {
      if (other.id === moved.id) continue;
      if (
        moved.position.x < other.position.x + renderW(other) + CHAIN_GAP &&
        ax2 + CHAIN_GAP > other.position.x &&
        moved.position.y < other.position.y + renderH(other) + CHAIN_GAP &&
        ay2 + CHAIN_GAP > other.position.y
      ) {
        return true;
      }
    }
    return false;
  };
  for (const node of nodes) {
    if (!next.has(node.id) || linkedIn.has(node.id)) continue; // 사슬 머리만
    const line = cross(byId.get(node.id) as AppNode);
    const seen = new Set([node.id]);
    let cursor = next.get(node.id);
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      const moved = withCross(byId.get(cursor) as AppNode, line);
      if (collides(moved)) break;
      byId.set(cursor, moved);
      cursor = next.get(cursor);
    }
  }
  return nodes.map((node) => byId.get(node.id) ?? node);
}

/** 맵의 현재 흐름 방향 추정 — 엣지 핸들이 위→아래(TB)인지 좌→우(LR)인지 다수결, 동률·없음은 LR.
 *  방향 지정이 없는 "자동 정렬"(인스펙터 버튼)이 직전 정렬 방향을 이어 가게 한다. */
export function inferFlowDir(edges: Edge[]): FlowDir {
  let lr = 0;
  let tb = 0;
  for (const edge of edges) {
    for (const handle of [edge.sourceHandle, edge.targetHandle]) {
      if (handle === "s-bottom" || handle === "t-top" || handle === "in:top") tb += 1;
      else if (handle === "s-right" || handle === "t-left" || handle === "in") lr += 1;
    }
  }
  return tb > lr ? "TB" : "LR";
}

export interface AutoLayoutOptions {
  // 영역(그룹) — 멤버를 dagre 클러스터로 묶어 붙여 둔다(멤버십은 node.data.groupIds)
  groups?: ReadonlyArray<{ id: string }>;
  // 엣지 핸들 유지 — L5 캔버스는 임포트가 벌려 둔 분기 출구(위/아래/옆)를 지켜야 한다
  preserveHandles?: boolean;
}

/** 배치가 끝난 좌표로 엣지 핸들 재지정 — scope가 오면 양끝이 그 안인 엣지만.
 *  서브프로세스 소스는 끝 핸들(끝 키)이라 기존 핸들 유지, 타깃은 고른 변의 들어오는 문 변형(in / in:<side>). */
function reassignHandles(
  nodes: AppNode[],
  edges: Edge[],
  dir: FlowDir,
  spine: Set<string>,
  renderW: (node: AppNode) => number,
  renderH: (node: AppNode) => number,
  scope?: ReadonlySet<string>,
): Edge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const centerOf = (id: string): Center | undefined => {
    const node = byId.get(id);
    if (!node) return undefined;
    return { cx: node.position.x + renderW(node) / 2, cy: node.position.y + renderH(node) / 2 };
  };
  return edges.map((edge) => {
    if (scope && (!scope.has(edge.source) || !scope.has(edge.target))) return edge;
    const sourceNode = byId.get(edge.source);
    const targetNode = byId.get(edge.target);
    if (!sourceNode || !targetNode) return edge;
    const { sourceSide, targetSide } = pickEdgeHandleSides(
      nodes, dir, spine, edge, centerOf(edge.source), centerOf(edge.target), renderW, renderH,
    );
    return {
      ...edge,
      sourceHandle:
        sourceNode.data.nodeType === "subprocess" ? edge.sourceHandle : sourceHandleId(sourceSide),
      targetHandle:
        targetNode.data.nodeType === "subprocess"
          ? subprocessInHandle(targetSide)
          : targetHandleId(targetSide),
    };
  });
}

/** 한 엣지의 양끝 변 — 역행·척추·곁가지 규칙(pickHandleSide)에 척추 지름길 우회를 더한 단일 판정.
 *  자동정렬 핸들 재지정과 4변 핸들 표면(deriveFlowSideHandles)이 공유해 두 결과가 같다(파이썬 resolve_handles 동치). */
export function pickEdgeHandleSides(
  nodes: readonly AppNode[],
  dir: FlowDir,
  spine: ReadonlySet<string>,
  edge: EdgeLink,
  s: Center | undefined,
  t: Center | undefined,
  renderW: (node: AppNode) => number,
  renderH: (node: AppNode) => number,
): { sourceSide: HandleSide; targetSide: HandleSide } {
  const back = !!s && !!t && isBackEdge(dir, s, t);
  // 척추 위 두 노드를 건너뛰는 지름길(반려 → 끝 등)은 흐름측으로 그리면 사이 노드를 관통한다 — 양끝을 아래(LR)·오른쪽(TB)으로
  const bypass =
    !back && !!s && !!t && spine.has(edge.source) && spine.has(edge.target) &&
    isStraightRunBlocked(nodes, dir, edge.source, edge.target, s, t, renderW, renderH);
  if (bypass) {
    const bypassSide: HandleSide = dir === "LR" ? "bottom" : "right";
    return { sourceSide: bypassSide, targetSide: bypassSide };
  }
  return {
    sourceSide: pickHandleSide(dir, s, t, spine.has(edge.source), spine.has(edge.target), back),
    targetSide: pickHandleSide(dir, t, s, spine.has(edge.target), spine.has(edge.source), back),
  };
}

/** 두 중심을 잇는 흐름축 직선이 다른 노드를 지나가는지 — 척추 지름길 판정용. */
function isStraightRunBlocked(
  nodes: readonly AppNode[],
  dir: FlowDir,
  sourceId: string,
  targetId: string,
  s: Center,
  t: Center,
  renderW: (node: AppNode) => number,
  renderH: (node: AppNode) => number,
): boolean {
  const line = dir === "LR" ? s.cy : s.cx;
  const from = Math.min(dir === "LR" ? s.cx : s.cy, dir === "LR" ? t.cx : t.cy);
  const to = Math.max(dir === "LR" ? s.cx : s.cy, dir === "LR" ? t.cx : t.cy);
  return nodes.some((node) => {
    if (node.id === sourceId || node.id === targetId) return false;
    const [flowStart, flowEnd, crossStart, crossEnd] =
      dir === "LR"
        ? [node.position.x, node.position.x + renderW(node), node.position.y, node.position.y + renderH(node)]
        : [node.position.y, node.position.y + renderH(node), node.position.x, node.position.x + renderW(node)];
    return flowEnd > from && flowStart < to && crossStart < line && crossEnd > line;
  });
}

export const renderWOf = (node: AppNode) => node.measured?.width ?? nodeSizeOf(node.data.nodeType).w;
export const renderHOf = (node: AppNode) => node.measured?.height ?? nodeSizeOf(node.data.nodeType).h;

/** 에디터 자동정렬 — dagre(dir) → 척추(시작→대표 끝 최장 경로) 직선화 → 곁가지 사슬 직선화 → 방향에 맞춰 엣지 핸들 재지정.
 *  노드와 엣지를 함께 반환 — 호출측이 한 undo 스냅샷으로 반영. */
export function autoLayoutFlow(
  nodes: AppNode[],
  edges: Edge[],
  dir: FlowDir,
  options?: AutoLayoutOptions,
): { nodes: AppNode[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };
  const laid = layoutWithDagre(nodes, edges, dir, undefined, options?.groups);
  const present = new Set(laid.map((node) => node.id));
  const seed = findMainPath(laid, edges);
  const spine = seed.size > 0 ? computeSpine(present, seed, edges) : new Set<string>();
  const aligned = seed.size > 0 ? alignBackbone(laid, seed, dir, spine, renderWOf, renderHOf) : laid;
  const nodeIds = laid.map((node) => node.id);
  const { forward } = splitForwardEdges(nodeIds, sortLayoutEdges(nodeIds, edges));
  const straightened = straightenSideChains(aligned, dir, spine, edges, forward, renderWOf, renderHOf);
  if (options?.preserveHandles) return { nodes: straightened, edges };
  return {
    nodes: straightened,
    edges: reassignHandles(straightened, edges, dir, spine, renderWOf, renderHOf),
  };
}

/** 부분 자동정렬 — 선택(ids, 2개 이상)만 방향 dagre로 제자리 배치 → 겹친 비선택 노드를 흐름 방향으로 비켜 줌
 *  → 양끝이 선택 안인 엣지의 핸들만 재지정(척추 없음 = 흐름측 변). 2개 미만이면 그대로. */
export function autoLayoutSubsetFlow(
  nodes: AppNode[],
  edges: Edge[],
  ids: ReadonlySet<string>,
  dir: FlowDir,
  options?: Pick<AutoLayoutOptions, "preserveHandles">,
): { nodes: AppNode[]; edges: Edge[] } {
  if (nodes.filter((node) => ids.has(node.id)).length < 2) return { nodes, edges };
  const laid = pushApartFromBlock(layoutSubsetWithDagre(nodes, edges, ids, dir), ids, dir);
  if (options?.preserveHandles) return { nodes: laid, edges };
  return { nodes: laid, edges: reassignHandles(laid, edges, dir, new Set(), renderWOf, renderHOf, ids) };
}

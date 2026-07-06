// 흐름 자동정렬 파이프라인 — dagre 방향 배치 + 척추(주 흐름) 직선화 + 방향별 엣지 핸들 재지정.
// 비교 화면(compare)의 배치 로직을 일반화한 공용판: 비교는 seed=유지 노드·실측 상수 크기,
// 에디터는 seed=시작→대표 끝 경로·measured 실측 크기를 주입해 같은 구현을 공유한다.

import type { Edge } from "@xyflow/react";

import {
  type AppNode,
  type HandleSide,
  layoutWithDagre,
  nodeSizeOf,
  sourceHandleId,
  targetHandleId,
} from "@/lib/canvas";

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

/** 시작→대표 끝 BFS 최단 경로 — 에디터 척추 시드. 시작/끝이 없거나 미연결이면 빈 집합(직선화 생략). */
export function findMainPath(nodes: AppNode[], edges: EdgeLink[]): Set<string> {
  const start = nodes.find((node) => node.data.nodeType === "start");
  const end =
    nodes.find((node) => node.data.nodeType === "end" && node.data.isPrimaryEnd) ??
    nodes.find((node) => node.data.nodeType === "end");
  if (!start || !end) return new Set();
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source);
    if (list) list.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
  }
  const prev = new Map<string, string>();
  const seen = new Set([start.id]);
  const queue = [start.id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === end.id) break;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, current);
      queue.push(next);
    }
  }
  if (!seen.has(end.id)) return new Set();
  const path = new Set<string>();
  let cursor: string | undefined = end.id;
  while (cursor !== undefined) {
    path.add(cursor);
    cursor = prev.get(cursor);
  }
  return path;
}

/** 에디터 자동정렬 — dagre(dir) → 척추(시작→대표 끝) 직선화 → 방향에 맞춰 엣지 핸들 재지정.
 *  노드와 엣지를 함께 반환 — 호출측이 한 undo 스냅샷으로 반영. */
export function autoLayoutFlow(
  nodes: AppNode[],
  edges: Edge[],
  dir: FlowDir,
): { nodes: AppNode[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };
  const laid = layoutWithDagre(nodes, edges, dir);
  const renderW = (node: AppNode) => node.measured?.width ?? nodeSizeOf(node.data.nodeType).w;
  const renderH = (node: AppNode) => node.measured?.height ?? nodeSizeOf(node.data.nodeType).h;
  const present = new Set(laid.map((node) => node.id));
  const seed = findMainPath(laid, edges);
  const spine = seed.size > 0 ? computeSpine(present, seed, edges) : new Set<string>();
  const aligned = seed.size > 0 ? alignBackbone(laid, seed, dir, spine, renderW, renderH) : laid;

  const byId = new Map(aligned.map((node) => [node.id, node]));
  const centerOf = (id: string): Center | undefined => {
    const node = byId.get(id);
    if (!node) return undefined;
    return { cx: node.position.x + renderW(node) / 2, cy: node.position.y + renderH(node) / 2 };
  };
  const nextEdges = edges.map((edge) => {
    const sourceNode = byId.get(edge.source);
    const targetNode = byId.get(edge.target);
    if (!sourceNode || !targetNode) return edge;
    const s = centerOf(edge.source);
    const t = centerOf(edge.target);
    const back = !!s && !!t && isBackEdge(dir, s, t);
    const sourceSide = pickHandleSide(dir, s, t, spine.has(edge.source), spine.has(edge.target), back);
    const targetSide = pickHandleSide(dir, t, s, spine.has(edge.target), spine.has(edge.source), back);
    // 서브프로세스 노드는 전용 핸들(좌 in·엔드별 우 out)이라 그 끝만 기존 핸들 유지.
    return {
      ...edge,
      sourceHandle:
        sourceNode.data.nodeType === "subprocess" ? edge.sourceHandle : sourceHandleId(sourceSide),
      targetHandle:
        targetNode.data.nodeType === "subprocess" ? edge.targetHandle : targetHandleId(targetSide),
    };
  });
  return { nodes: aligned, edges: nextEdges };
}

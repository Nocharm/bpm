// 인라인 하위 프로세스 펼침 — 순수 로직(자식 수집·게이트웨이 합성·캡 계산·scope-split·불변식).
// page.tsx 파생 렌더/저장이 사용. 부수효과 없음 → 추후 단위 테스트 1순위.

import type { Edge } from "@xyflow/react";

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import type { AppNode, ProcessNodeType } from "@/lib/canvas";
import { EXPANSION_LIMITS } from "@/lib/expansion-config";

/** expanded에 속한 노드들의 후손(재귀) 노드 + 그 사이 엣지. 중첩 펼침 지원. */
export function collectExpandedDescendants(
  fullGraph: VersionGraph,
  expanded: Set<string>,
): { nodes: FlatNode[]; edges: GraphEdge[] } {
  const childrenByParent = new Map<string, FlatNode[]>();
  for (const node of fullGraph.nodes) {
    if (node.parent_node_id == null) {
      continue;
    }
    const siblings = childrenByParent.get(node.parent_node_id) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parent_node_id, siblings);
  }
  const resultNodes: FlatNode[] = [];
  const resultIds = new Set<string>();
  // BFS — 펼친 노드의 자식을 넣고, 그 자식도 펼쳐졌으면 더 내려간다
  const queue = [...expanded];
  while (queue.length > 0) {
    const parentId = queue.shift();
    if (parentId === undefined) {
      continue;
    }
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (resultIds.has(child.id)) {
        continue;
      }
      resultIds.add(child.id);
      resultNodes.push(child);
      if (expanded.has(child.id)) {
        queue.push(child.id);
      }
    }
  }
  // 수집된 노드들 사이의 엣지(= 자식 스코프 내부 엣지)만
  const edges = fullGraph.edges.filter(
    (edge) => resultIds.has(edge.source_node_id) && resultIds.has(edge.target_node_id),
  );
  return { nodes: resultNodes, edges };
}

const GATEWAY_PREFIX = "gw:";

/** 게이트웨이는 view 전용(저장·state 비포함). dagre 입력 + 렌더용. P→Start, End→후속T. */
export function buildGatewayEdges(
  expanded: Set<string>,
  childNodes: AppNode[],
  scopeEdges: Edge[],
): Edge[] {
  const startsByParent = new Map<string, string[]>();
  const endsByParent = new Map<string, string[]>();
  for (const node of childNodes) {
    const parent = node.data.scopeId ?? null;
    if (parent == null || !expanded.has(parent)) {
      continue;
    }
    if (node.data.nodeType === "start") {
      startsByParent.set(parent, [...(startsByParent.get(parent) ?? []), node.id]);
    } else if (node.data.nodeType === "end") {
      endsByParent.set(parent, [...(endsByParent.get(parent) ?? []), node.id]);
    }
  }
  const gateways: Edge[] = [];
  for (const parent of expanded) {
    for (const start of startsByParent.get(parent) ?? []) {
      gateways.push(makeGateway(parent, start));
    }
    // 후속 T = 현재 스코프에서 P가 출발인 엣지의 타깃(펼침 시 숨기는 A→B의 B)
    const successors = scopeEdges
      .filter((edge) => edge.source === parent)
      .map((edge) => edge.target);
    for (const end of endsByParent.get(parent) ?? []) {
      for (const target of successors) {
        gateways.push(makeGateway(end, target));
      }
    }
  }
  return gateways;
}

function makeGateway(source: string, target: string): Edge {
  return {
    id: `${GATEWAY_PREFIX}${source}->${target}`,
    source,
    target,
    data: { gateway: true },
  };
}

export function isGatewayEdge(edge: Edge): boolean {
  return edge.id.startsWith(GATEWAY_PREFIX);
}

/** expanded 적용 시 인라인 추가 노드수·최대 펼침 깊이를 캡과 비교. */
export function checkExpansionLimits(
  fullGraph: VersionGraph,
  expanded: Set<string>,
): { nodeCount: number; depth: number; exceeds: boolean } {
  const { nodes } = collectExpandedDescendants(fullGraph, expanded);
  const parentOf = new Map(fullGraph.nodes.map((node) => [node.id, node.parent_node_id]));
  const depthOf = (id: string): number => {
    let depth = 0;
    let current: string | null | undefined = parentOf.get(id);
    while (current != null) {
      depth += 1;
      current = parentOf.get(current);
    }
    return depth;
  };
  const depth = nodes.reduce((max, node) => Math.max(max, depthOf(node.id)), 0);
  return {
    nodeCount: nodes.length,
    depth,
    exceeds: nodes.length > EXPANSION_LIMITS.maxNodes || depth > EXPANSION_LIMITS.maxDepth,
  };
}

/** 저장용: scopeId별 노드 묶음. 게이트웨이는 호출 전 제거되어야 함. */
export function splitByScope(nodes: AppNode[]): Map<string | null, AppNode[]> {
  const byScope = new Map<string | null, AppNode[]>();
  for (const node of nodes) {
    const key = node.data.scopeId ?? null;
    byScope.set(key, [...(byScope.get(key) ?? []), node]);
  }
  return byScope;
}

/** 하위 프로세스 불변식: Start≥1, End≥1, 작업(process/decision)≥1. */
export function checkScopeInvariant(scopeNodes: AppNode[]): boolean {
  let starts = 0;
  let ends = 0;
  let works = 0;
  for (const node of scopeNodes) {
    const type: ProcessNodeType = node.data.nodeType;
    if (type === "start") {
      starts += 1;
    } else if (type === "end") {
      ends += 1;
    } else {
      works += 1;
    }
  }
  return starts >= 1 && ends >= 1 && works >= 1;
}

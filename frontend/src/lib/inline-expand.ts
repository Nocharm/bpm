// 인라인 하위 프로세스 펼침 — 순수 로직(자식 수집·게이트웨이 합성·캡 계산·scope-split·불변식).
// page.tsx 파생 렌더/저장이 사용. 부수효과 없음 → 추후 단위 테스트 1순위.

import type { Edge } from "@xyflow/react";

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import { sourceHandleId, targetHandleId, type AppNode } from "@/lib/canvas";
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

/**
 * 게이트웨이는 view 전용(저장·state 비포함). dagre 입력 + 렌더용 — 자식을 P와 후속(A→B의 B) 사이에 끼워 통합 LR 흐름 유지.
 * 진입점 = Start 노드(없으면 자식 스코프 내 진입차수 0인 자식, 그것도 없으면 전체).
 * 진출점 = End 노드(없으면 진출차수 0인 자식, 그것도 없으면 전체).
 * Start/End가 없는 레거시 하위(자동 생성 전)도 끊기지 않고 가운데로 들어오게 한다.
 */
export function buildGatewayEdges(
  expanded: Set<string>,
  childNodes: AppNode[],
  scopeEdges: Edge[],
): Edge[] {
  // 펼친 스코프(P)별 자식 묶기
  const childrenByScope = new Map<string, AppNode[]>();
  for (const node of childNodes) {
    const parent = node.data.scopeId ?? null;
    if (parent == null || !expanded.has(parent)) {
      continue;
    }
    childrenByScope.set(parent, [...(childrenByScope.get(parent) ?? []), node]);
  }
  const gateways: Edge[] = [];
  for (const [parent, children] of childrenByScope) {
    const childIds = new Set(children.map((child) => child.id));
    // 자식 스코프 내부 엣지만으로 진입/진출 차수 판정
    const hasIncoming = new Set<string>();
    const hasOutgoing = new Set<string>();
    for (const edge of scopeEdges) {
      if (childIds.has(edge.source) && childIds.has(edge.target)) {
        hasIncoming.add(edge.target);
        hasOutgoing.add(edge.source);
      }
    }
    const starts = children.filter((child) => child.data.nodeType === "start");
    const ends = children.filter((child) => child.data.nodeType === "end");
    const inferredEntries = children.filter((child) => !hasIncoming.has(child.id));
    const inferredExits = children.filter((child) => !hasOutgoing.has(child.id));
    const entries = starts.length > 0 ? starts : inferredEntries.length > 0 ? inferredEntries : children;
    const exits = ends.length > 0 ? ends : inferredExits.length > 0 ? inferredExits : children;
    // 후속 T = P가 출발인 엣지의 타깃(펼침 시 숨기는 A→B의 B)
    const successors = scopeEdges
      .filter((edge) => edge.source === parent)
      .map((edge) => edge.target);
    for (const entry of entries) {
      // 진입(host→start) — 도착은 좌측 변. 출발 핸들은 host(subprocess) 기본(우측 PRIMARY_END)로 폴백.
      gateways.push(makeGateway(parent, entry.id, undefined, targetHandleId("left")));
    }
    for (const exit of exits) {
      for (const target of successors) {
        // 진출(끝노드→후속) — 출발은 우측 변(기본), 도착은 좌측 변. 핸들 미지정 시 RF가 첫 핸들(좌)에 붙던 버그 수정.
        gateways.push(
          makeGateway(exit.id, target, sourceHandleId("right"), targetHandleId("left")),
        );
      }
    }
  }
  return gateways;
}

function makeGateway(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): Edge {
  return {
    id: `${GATEWAY_PREFIX}${source}->${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
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



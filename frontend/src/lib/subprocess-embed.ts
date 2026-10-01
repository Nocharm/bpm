// 하위프로세스 참조 임베드 — 순수 로직. 링크맵 resolved 그래프를 합성 parent_node_id 트리로 끼워
// 기존 렌더 폴리시(buildScope/ancestorContext)가 그대로 소비하게 한다. 부수효과 없음.

import type { Edge } from "@xyflow/react";

import type { FlatNode, Graph, GraphEdge } from "@/lib/api";

export const PRIMARY_END_HANDLE = "__primary__";
export const SUBPROCESS_IN_HANDLE = "in";
export const EMBED_SEP = "/";

export interface SubEnd {
  key: string; // 핸들 id: 대표끝=PRIMARY_END_HANDLE, 그 외=끝 이름(프로세스 내 유니크)
  title: string;
  isPrimary: boolean;
  nodeId: string;
}

export type SubprocessInSide = "left" | "right" | "top" | "bottom";
const IN_SIDES: readonly string[] = ["left", "right", "top", "bottom"];

/** 들어오는 문 핸들 id — 좌측은 레거시 `in` 그대로(저장 데이터 호환), 나머지 변은 `in:<side>`. */
export function subprocessInHandle(side: SubprocessInSide): string {
  return side === "left" ? SUBPROCESS_IN_HANDLE : `${SUBPROCESS_IN_HANDLE}:${side}`;
}

/** `in`·`in:<side>` → 변. 들어오는 문이 아니면 null. */
export function parseSubprocessInHandle(id: string | null | undefined): SubprocessInSide | null {
  if (!id) return null;
  if (id === SUBPROCESS_IN_HANDLE) return "left";
  const prefix = `${SUBPROCESS_IN_HANDLE}:`;
  if (!id.startsWith(prefix)) return null;
  const side = id.slice(prefix.length);
  return IN_SIDES.includes(side) ? (side as SubprocessInSide) : null;
}

export function isSubprocessInHandle(id: string | null | undefined): boolean {
  return parseSubprocessInHandle(id) !== null;
}

/** 끝 핸들(대표 끝 `__primary__` 또는 끝 제목) — 변 id(`s-*`/`t-*`)·들어오는 문·빈 값은 아니다. */
export function isSubprocessEndHandle(id: string | null | undefined): boolean {
  return !!id && !/^[st]-/.test(id) && !isSubprocessInHandle(id);
}

/** 출구 엣지가 나가는 끝 키 — 끝 핸들이 아니면(레거시 변 id·없음) 대표 끝. */
export function endKeyOfEdge(edge: Pick<Edge, "sourceHandle">): string {
  return isSubprocessEndHandle(edge.sourceHandle) ? (edge.sourceHandle as string) : PRIMARY_END_HANDLE;
}

/**
 * 출구 라벨 기본값 미러링(렌더 전용, 저장 안 함) — 끝이 2개 이상인 SP에서 나가는 엣지에 직접 라벨이 없으면
 * 끝 제목을 표시 라벨로 넣고 `data.labelMirrored`를 켠다. 직접 라벨·끝 1개·일반 노드·모르는 끝은 같은 객체.
 * 호출부(styledEdges)가 edges state가 아닌 렌더 배열에만 적용하므로 buildGraph 직렬화·서명·diff에 섞이지 않는다.
 */
export function applyMirroredEndLabels(edges: readonly Edge[], endsOf: (nodeId: string) => SubEnd[]): Edge[] {
  const cache = new Map<string, Map<string, string> | null>();
  const titlesOf = (nodeId: string): Map<string, string> | null => {
    if (!cache.has(nodeId)) {
      const ends = endsOf(nodeId);
      cache.set(nodeId, ends.length >= 2 ? new Map(ends.map((end) => [end.key, end.title])) : null);
    }
    return cache.get(nodeId) ?? null;
  };
  return edges.map((edge) => {
    if (edge.label) {
      return edge;
    }
    const title = titlesOf(edge.source)?.get(endKeyOfEdge(edge));
    return title ? { ...edge, label: title, data: { ...edge.data, labelMirrored: true } } : edge;
  });
}

/** 임베드 자식 id 네임스페이싱 — 같은 맵을 여러 곳/중첩 임베드해도 React Flow id 충돌 없게. */
export function embedId(hostId: string, originalId: string): string {
  return `${hostId}${EMBED_SEP}${originalId}`;
}

/** 링크된 프로세스의 끝 노드 → 부모가 연결할 출력 핸들. 대표끝 먼저, 고정키. */
export function deriveSubEnds(resolved: Graph): SubEnd[] {
  const ends = resolved.nodes.filter((n) => n.node_type === "end");
  const out: SubEnd[] = [];
  for (const end of ends) {
    const isPrimary = end.is_primary_end;
    out.push({
      key: isPrimary ? PRIMARY_END_HANDLE : end.title,
      title: end.title,
      isPrimary,
      nodeId: end.id,
    });
  }
  // 대표끝을 맨 앞으로
  out.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return out;
}

/**
 * 합성 트리 — 루트 평면 그래프 + hostsToEmbed에 속한 노드의 링크맵 resolved를 자식으로 끼움.
 * 자식 노드/엣지 id는 호스트 id로 네임스페이스, 자식 parent_node_id는 호스트 id로 설정 → 구버전 fullGraph 모양.
 * getEmbed(node): 그 노드(호스트) 아래 끼울 resolved 그래프(캐시), 없으면 null(미로드/비하위).
 */
export function buildCompositeTree(
  rootNodes: FlatNode[],
  rootEdges: GraphEdge[],
  hostsToEmbed: Set<string>,
  getEmbed: (node: FlatNode) => Graph | null,
): { nodes: FlatNode[]; edges: GraphEdge[] } {
  const outNodes: FlatNode[] = [];
  const outEdges: GraphEdge[] = [...rootEdges];

  // toFlat: sub.nodes are GraphNode; stamp id + parent — prefix applied exactly once here.
  const toFlat = (n: Graph["nodes"][number], parent: string | null, prefix: string): FlatNode => ({
    ...n,
    id: prefix ? embedId(prefix, n.id) : n.id,
    parent_node_id: parent,
    source_node_id: null,
  });

  // walk receives already-namespaced FlatNode[] (prefix="" means no further namespacing).
  const walk = (nodes: FlatNode[], parent: string | null, prefix: string): void => {
    for (const raw of nodes) {
      const node: FlatNode = prefix
        ? { ...raw, id: embedId(prefix, raw.id), parent_node_id: parent, source_node_id: null }
        : { ...raw, parent_node_id: parent };
      outNodes.push(node);
      if (!hostsToEmbed.has(node.id)) continue;
      const sub = getEmbed(node);
      if (!sub) continue;
      // Namespace embedded edges — source/target ids also need namespacing.
      for (const e of sub.edges) {
        outEdges.push({
          ...e,
          id: embedId(node.id, e.id),
          source_node_id: embedId(node.id, e.source_node_id),
          target_node_id: embedId(node.id, e.target_node_id),
        });
      }
      // Map sub.nodes to FlatNode with namespaced ids (prefix=node.id applied once in toFlat),
      // then walk with prefix="" so walk does NOT re-apply embedId.
      walk(sub.nodes.map((n) => toFlat(n, node.id, node.id)), node.id, "");
    }
  };

  walk(rootNodes, null, "");
  return { nodes: outNodes, edges: outEdges };
}

/** candidate를 currentMap 아래로 끌어오면 순환이 되는가 — refs 클로저가 currentMap에 닿으면 true(자기참조 포함). */
export function closesCycle(
  candidateMapId: number,
  currentMapId: number,
  refsByMap: Map<number, number[]>,
): boolean {
  if (candidateMapId === currentMapId) return true;
  const seen = new Set<number>();
  const stack = [candidateMapId];
  while (stack.length > 0) {
    const m = stack.pop();
    if (m === undefined) continue;
    if (m === currentMapId) return true;
    if (seen.has(m)) continue;
    seen.add(m);
    for (const r of refsByMap.get(m) ?? []) stack.push(r);
  }
  return false;
}

// 버전 간 그래프를 하나의 합집합(union)으로 병합 — 계보 키로 노드/엣지를 합치고
// added/removed/changed/unchanged 상태 부여. 단일 캔버스 비교 화면이 좌표 무시·연결 기반 diff 렌더에 사용.

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import { FIELD_KEYS, getLineageKey, type ChangedField } from "@/lib/diff";

export type MergedNodeStatus = "unchanged" | "added" | "removed" | "changed";
export type MergedEdgeStatus = "unchanged" | "added" | "removed";

export interface MergedNode {
  id: string; // 계보 키 — union 노드의 안정 id (엣지 endpoint와 동일 공간)
  node: FlatNode; // 대표 데이터 (target 우선, 없으면 base)
  status: MergedNodeStatus;
  changedFields: ChangedField[]; // changed일 때만 채움
}

export interface MergedEdge {
  id: string; // `${sourceKey}->${targetKey}`
  source: string; // 계보 키
  target: string; // 계보 키
  label: string;
  status: MergedEdgeStatus;
}

export interface MergedGraph {
  nodes: MergedNode[];
  edges: MergedEdge[];
}

// 계보 키 → 노드. 같은 키가 여러 노드면 마지막 승리(정상 데이터는 1:1).
function indexByLineage(nodes: FlatNode[]): Map<string, FlatNode> {
  return new Map(nodes.map((node) => [getLineageKey(node), node]));
}

function diffFields(base: FlatNode, target: FlatNode): ChangedField[] {
  return FIELD_KEYS.filter(([field]) => base[field] !== target[field]).map(([, key]) => key);
}

// 엣지 endpoint를 계보 키로 변환 — 노드가 없으면 raw id 폴백(댕글링 엣지는 RF가 드롭).
function edgeEndpoints(
  edge: GraphEdge,
  byId: Map<string, FlatNode>,
): { source: string; target: string } {
  const source = byId.get(edge.source_node_id);
  const target = byId.get(edge.target_node_id);
  return {
    source: source ? getLineageKey(source) : edge.source_node_id,
    target: target ? getLineageKey(target) : edge.target_node_id,
  };
}

export function buildMergedGraph(base: VersionGraph, target: VersionGraph): MergedGraph {
  const baseByLineage = indexByLineage(base.nodes);
  const targetByLineage = indexByLineage(target.nodes);

  // 노드 union — 계보 키 합집합
  const allKeys = new Set<string>([...baseByLineage.keys(), ...targetByLineage.keys()]);
  const nodes: MergedNode[] = [];
  for (const key of allKeys) {
    const b = baseByLineage.get(key) ?? null;
    const t = targetByLineage.get(key) ?? null;
    if (t && b) {
      const changedFields = diffFields(b, t);
      nodes.push({
        id: key,
        node: t,
        status: changedFields.length > 0 ? "changed" : "unchanged",
        changedFields,
      });
    } else if (t) {
      nodes.push({ id: key, node: t, status: "added", changedFields: [] });
    } else if (b) {
      nodes.push({ id: key, node: b, status: "removed", changedFields: [] });
    }
  }

  // 엣지 union — (출발 계보 → 도착 계보)로 합집합. 양쪽=unchanged, target만=added, base만=removed.
  const baseById = new Map(base.nodes.map((n) => [n.id, n]));
  const targetById = new Map(target.nodes.map((n) => [n.id, n]));
  const merged = new Map<string, MergedEdge>();
  for (const edge of base.edges) {
    const { source, target: tgt } = edgeEndpoints(edge, baseById);
    const id = `${source}->${tgt}`;
    merged.set(id, { id, source, target: tgt, label: edge.label, status: "removed" });
  }
  for (const edge of target.edges) {
    const { source, target: tgt } = edgeEndpoints(edge, targetById);
    const id = `${source}->${tgt}`;
    const existing = merged.get(id);
    if (existing) {
      existing.status = "unchanged";
      existing.label = edge.label; // target 라벨 우선
    } else {
      merged.set(id, { id, source, target: tgt, label: edge.label, status: "added" });
    }
  }

  return { nodes, edges: [...merged.values()] };
}

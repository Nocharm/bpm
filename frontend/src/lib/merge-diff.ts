// 버전 간 그래프를 하나의 합집합(union)으로 병합 — 계보 키로 노드/엣지를 합치고
// added/removed/changed/unchanged 상태 부여. 단일 캔버스 비교 화면이 좌표 무시·연결 기반 diff 렌더에 사용.

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import { FIELD_KEYS, getFieldValue, getLineageKey, type ChangedField } from "@/lib/diff";
import { getOutputKey } from "@/lib/output-rules";
import { PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

export type MergedNodeStatus = "unchanged" | "added" | "removed" | "changed";
export type MergedEdgeStatus = "unchanged" | "added" | "removed" | "changed";

// 바뀐 필드 하나 — 라벨 + before/after 원시값(빈값은 "", 표시 계층에서 None으로 변환).
export interface FieldChange {
  field: ChangedField;
  before: string;
  after: string;
}

export interface MergedNode {
  id: string; // 계보 키 — union 노드의 안정 id (엣지 endpoint와 동일 공간)
  node: FlatNode; // 대표 데이터 (target 우선, 없으면 base)
  status: MergedNodeStatus;
  changedFields: ChangedField[]; // 바뀐 필드 라벨 목록 (changed일 때만)
  fieldChanges: FieldChange[]; // 바뀐 필드의 before/after 값 (changed일 때만) — before→after 필 렌더용
}

export interface MergedEdge {
  id: string; // `${sourceKey}->${targetKey}`, 대표 끝이 아닌 SP 출구는 `@${exit}` 접미
  source: string; // 계보 키
  target: string; // 계보 키
  label: string;
  // 출구 키(getOutputKey) — SP는 끝 키(`__primary__`·끝 제목), 그 외는 `__primary__`. target 우선.
  // 변 id·in 변형은 레이아웃이라 정체성에 넣지 않는다(사용자 결정 D4)
  exit: string;
  // 저장된 선 모양 — target 우선(없으면 base). 비교 캔버스가 에디터와 같은 경로로 그린다.
  lineStyle: GraphEdge["line_style"];
  // 임포트 출처 게이트웨이 종별 — line_style과 동일하게 target 우선(없으면 base). 비교 대상 아님:
  // 병렬의 진실은 노드 parallel 필드(출력 규칙 2026-10-01), 여기선 비교 캔버스 병렬 배지의 레거시 도출 입력만
  gateway: GraphEdge["gateway"];
  status: MergedEdgeStatus;
  // 양 버전에 존재하는 엣지의 라벨이 다를 때만 — status는 changed가 된다.
  labelChange?: { before: string; after: string };
  // 같은 (출발, 도착) 쌍에서 SP 출구 끝 키만 바뀐 엣지 — status는 changed가 된다.
  exitChange?: { before: string; after: string };
}

export interface MergedGraph {
  nodes: MergedNode[];
  edges: MergedEdge[];
}

// 계보 키 → 노드. 같은 키가 여러 노드면 마지막 승리(정상 데이터는 1:1).
function indexByLineage(nodes: FlatNode[]): Map<string, FlatNode> {
  return new Map(nodes.map((node) => [getLineageKey(node), node]));
}

// 바뀐 필드의 라벨 + before/after 값. FIELD_KEYS: [FlatNode 키, ChangedField 라벨].
function diffFieldChanges(base: FlatNode, target: FlatNode): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, label] of FIELD_KEYS) {
    const before = getFieldValue(base, field);
    const after = getFieldValue(target, field);
    if (before !== after) {
      changes.push({ field: label, before: String(before ?? ""), after: String(after ?? "") });
    }
  }
  return changes;
}

// 엣지 endpoint를 계보 키로 변환 + 출구 키 — 노드가 없으면 raw id 폴백(댕글링 엣지는 RF가 드롭).
function edgeEndpoints(
  edge: GraphEdge,
  byId: Map<string, FlatNode>,
): { source: string; target: string; exit: string } {
  const source = byId.get(edge.source_node_id);
  const target = byId.get(edge.target_node_id);
  return {
    source: source ? getLineageKey(source) : edge.source_node_id,
    target: target ? getLineageKey(target) : edge.target_node_id,
    exit: getOutputKey(source?.node_type ?? "", edge.source_handle),
  };
}

// 병합 엣지 id — 같은 쌍의 두 끝(SP 보조 끝)이 하나로 합쳐지지 않게 대표 끝이 아닌 출구만 접미를 붙인다.
function buildEdgeId(source: string, target: string, exit: string): string {
  return exit === PRIMARY_END_HANDLE ? `${source}->${target}` : `${source}->${target}@${exit}`;
}

// target 엣지 값을 병합 항목에 반영 — 라벨·출구 변경이 있으면 changed, 없으면 unchanged. target 값 우선.
function applyTargetEdge(entry: MergedEdge, edge: GraphEdge): void {
  if (entry.label !== edge.label) {
    entry.labelChange = { before: entry.label, after: edge.label };
  }
  entry.status = entry.labelChange || entry.exitChange ? "changed" : "unchanged";
  entry.label = edge.label;
  entry.lineStyle = edge.line_style;
  entry.gateway = edge.gateway;
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
      const fieldChanges = diffFieldChanges(b, t);
      nodes.push({
        id: key,
        node: t,
        status: fieldChanges.length > 0 ? "changed" : "unchanged",
        changedFields: fieldChanges.map((c) => c.field),
        fieldChanges,
      });
    } else if (t) {
      nodes.push({ id: key, node: t, status: "added", changedFields: [], fieldChanges: [] });
    } else if (b) {
      nodes.push({ id: key, node: b, status: "removed", changedFields: [], fieldChanges: [] });
    }
  }

  // 엣지 union — (출발 계보 → 도착 계보 + 출구 키)로 합집합. 양쪽=unchanged, target만=added, base만=removed.
  // 같은 쌍에서 출구 끝 키만 바뀐 엣지는 삭제+추가가 아니라 changed(exitChange)로 짝짓는다.
  const baseById = new Map(base.nodes.map((n) => [n.id, n]));
  const targetById = new Map(target.nodes.map((n) => [n.id, n]));
  const merged = new Map<string, MergedEdge>();
  for (const edge of base.edges) {
    const { source, target: tgt, exit } = edgeEndpoints(edge, baseById);
    const id = buildEdgeId(source, tgt, exit);
    merged.set(id, {
      id,
      source,
      target: tgt,
      label: edge.label,
      exit,
      lineStyle: edge.line_style,
      gateway: edge.gateway,
      status: "removed",
    });
  }
  const unmatched: { edge: GraphEdge; source: string; target: string; exit: string }[] = [];
  for (const edge of target.edges) {
    const ends = edgeEndpoints(edge, targetById);
    const existing = merged.get(buildEdgeId(ends.source, ends.target, ends.exit));
    if (existing) {
      applyTargetEdge(existing, edge);
    } else {
      unmatched.push({ edge, ...ends });
    }
  }
  for (const { edge, source, target: tgt, exit } of unmatched) {
    const id = buildEdgeId(source, tgt, exit);
    const existing = merged.get(id);
    if (existing) {
      applyTargetEdge(existing, edge); // 같은 출구의 중복 엣지 — 앞서 짝지은 항목에 합친다
      continue;
    }
    const partner = [...merged.values()].find(
      (e) => e.status === "removed" && e.source === source && e.target === tgt,
    );
    if (partner) {
      merged.delete(partner.id);
      const entry: MergedEdge = { ...partner, id, exit, exitChange: { before: partner.exit, after: exit } };
      applyTargetEdge(entry, edge);
      merged.set(id, entry);
      continue;
    }
    merged.set(id, {
      id,
      source,
      target: tgt,
      label: edge.label,
      exit,
      lineStyle: edge.line_style,
      gateway: edge.gateway,
      status: "added",
    });
  }

  return { nodes, edges: [...merged.values()] };
}

// 비교 화면 AI 요약 페이로드 — 병합 diff(merge-diff.ts)를 백엔드 CompareDiffPayload로 압축한다 (2026-09-18).
// 파이썬에 diff 로직을 복제하지 않기 위해 프론트 계산본을 전송. ref(n1/e1…)→캔버스 id 매핑은 하이라이트 클릭 포커스용.

import type { CompareDiffPayload, CompareDiffTotals } from "@/lib/api";
import type { MergedEdge, MergedGraph, MergedNode } from "@/lib/merge-diff";

// 백엔드 스키마 상한(nodes/edges 각 200) — 초과분은 개수만 알린다
export const COMPARE_SUMMARY_CAP = 200;

export interface CompareSummaryRef {
  kind: "node" | "edge";
  id: string; // MergedNode.id(계보 키) 또는 MergedEdge.id
}

export interface CompareSummaryPayloadResult {
  payload: CompareDiffPayload;
  refs: Map<string, CompareSummaryRef>;
}

// 변경 목록 규칙은 compare 패널(changeItems)과 동일 — 노드 추가/삭제로 딸려온 엣지는 노드 항목으로 드러나므로 제외.
function pickEdges(merged: MergedGraph): MergedEdge[] {
  const bothVersion = new Set(
    merged.nodes.filter((n) => n.status === "unchanged" || n.status === "changed").map((n) => n.id),
  );
  return merged.edges.filter(
    (e) => e.status !== "unchanged" && bothVersion.has(e.source) && bothVersion.has(e.target),
  );
}

function pickNodes(merged: MergedGraph): MergedNode[] {
  const order = { added: 0, removed: 1, changed: 2, unchanged: 3 } as const;
  return merged.nodes
    .filter((n) => n.status !== "unchanged")
    .sort((a, b) => order[a.status] - order[b.status]);
}

export function buildCompareSummaryPayload(
  merged: MergedGraph,
  cap: number = COMPARE_SUMMARY_CAP,
): CompareSummaryPayloadResult {
  const refs = new Map<string, CompareSummaryRef>();
  const titleByKey = new Map(merged.nodes.map((m) => [m.id, m.node.title]));
  const nodes = pickNodes(merged);
  const edges = pickEdges(merged);
  const totals: CompareDiffTotals = {
    nodes_added: nodes.filter((n) => n.status === "added").length,
    nodes_removed: nodes.filter((n) => n.status === "removed").length,
    nodes_changed: nodes.filter((n) => n.status === "changed").length,
    edges_added: edges.filter((e) => e.status === "added").length,
    edges_removed: edges.filter((e) => e.status === "removed").length,
    edges_changed: edges.filter((e) => e.status === "changed").length,
  };
  const payload: CompareDiffPayload = {
    nodes: nodes.slice(0, cap).map((m, i) => {
      const ref = `n${i + 1}`;
      refs.set(ref, { kind: "node", id: m.id });
      return {
        ref,
        status: m.status === "unchanged" ? "changed" : m.status,
        title: m.node.title.slice(0, 200),
        node_type: m.node.node_type,
        changes:
          m.status === "changed"
            ? m.fieldChanges.slice(0, 40).map((fc) => ({
                field: fc.field,
                before: fc.before.slice(0, 500),
                after: fc.after.slice(0, 500),
              }))
            : [],
      };
    }),
    edges: edges.slice(0, cap).map((e, i) => {
      const ref = `e${i + 1}`;
      refs.set(ref, { kind: "edge", id: e.id });
      return {
        ref,
        status: e.status === "unchanged" ? "changed" : e.status,
        source: (titleByKey.get(e.source) ?? "?").slice(0, 200),
        target: (titleByKey.get(e.target) ?? "?").slice(0, 200),
        label: (e.labelChange?.after ?? e.label).slice(0, 200),
        label_before: (e.labelChange?.before ?? "").slice(0, 200),
      };
    }),
    omitted_nodes: Math.max(0, nodes.length - cap),
    omitted_edges: Math.max(0, edges.length - cap),
    totals,
  };
  return { payload, refs };
}

export function hasCompareChanges(totals: CompareDiffTotals): boolean {
  return Object.values(totals).some((n) => n > 0);
}

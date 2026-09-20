// 비교 화면 AI 보고서 페이로드 — 병합 diff(merge-diff.ts)를 백엔드 CompareDiffPayload로 압축한다 (2026-09-18, 2026-09-21 문맥 확장).
// 파이썬에 diff 로직을 복제하지 않기 위해 프론트 계산본을 전송. ref(n1/e1…)→캔버스 id 매핑은 근거 칩 클릭 포커스용.
// 2026-09-21: 흐름 영향 추론 재료로 무변경 이웃 노드·모든 엣지(상한 내), 버전 파라미터 합계, 입출력 변경+소비처를 함께 보낸다.

import type {
  CompareDiffEdge,
  CompareDiffNode,
  CompareDiffPayload,
  CompareDiffTotals,
  CompareIoChange,
  CompareMetric,
  FlatNode,
  VersionGraph,
} from "@/lib/api";
import { getLineageKey } from "@/lib/diff";
import { buildIoDiffSide } from "@/lib/io-diff";
import type { MergedEdge, MergedGraph, MergedNode } from "@/lib/merge-diff";
import { sumVersionParam } from "@/lib/param-sum";
import { PARAM_FIELDS } from "@/lib/params";

// 백엔드 스키마 상한(nodes 200 / edges 400 / io 80) — 초과분은 개수만 알린다
export const COMPARE_SUMMARY_CAP = 200;
export const COMPARE_SUMMARY_EDGE_CAP = 400;
const IO_CHANGE_CAP = 80;

export interface CompareSummaryRef {
  kind: "node" | "edge";
  id: string; // MergedNode.id(계보 키) 또는 MergedEdge.id
}

export interface CompareSummaryPayloadResult {
  payload: CompareDiffPayload;
  refs: Map<string, CompareSummaryRef>;
}

export interface CompareSummaryOptions {
  // 양 버전 그래프 — 주면 파라미터 합계(metrics)와 입출력 변경(io_changes)을 채운다
  base?: VersionGraph;
  target?: VersionGraph;
  cap?: number;
}

// 변경 집계 규칙은 compare 패널(changeItems)과 동일 — 노드 추가/삭제로 딸려온 엣지는 노드 항목으로 드러나므로 제외.
function pickCountedEdges(merged: MergedGraph): MergedEdge[] {
  const bothVersion = new Set(
    merged.nodes.filter((n) => n.status === "unchanged" || n.status === "changed").map((n) => n.id),
  );
  return merged.edges.filter(
    (e) => e.status !== "unchanged" && bothVersion.has(e.source) && bothVersion.has(e.target),
  );
}

// 변경 노드 → 이웃 → 나머지 순. 상한에 걸리면 흐름 문맥에 가까운 것부터 남긴다.
function orderNodes(merged: MergedGraph): MergedNode[] {
  const order = { added: 0, removed: 1, changed: 2 } as const;
  const changed = merged.nodes
    .filter((n) => n.status !== "unchanged")
    .sort((a, b) => order[a.status as keyof typeof order] - order[b.status as keyof typeof order]);
  const adjacency = new Map<string, string[]>();
  for (const e of merged.edges) {
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
    adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e.source]);
  }
  const distance = new Map<string, number>(changed.map((n) => [n.id, 0]));
  const queue = changed.map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const next = distance.get(id)! + 1;
    for (const peer of adjacency.get(id) ?? []) {
      if (!distance.has(peer)) {
        distance.set(peer, next);
        queue.push(peer);
      }
    }
  }
  const context = merged.nodes
    .map((n, index) => ({ n, index }))
    .filter(({ n }) => n.status === "unchanged")
    .sort((a, b) => (distance.get(a.n.id) ?? Infinity) - (distance.get(b.n.id) ?? Infinity) || a.index - b.index)
    .map(({ n }) => n);
  return [...changed, ...context];
}

function splitLines(joined: string | null | undefined): string[] {
  return (joined ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function buildIoChanges(
  included: { merged: MergedNode; ref: string }[],
  base: VersionGraph,
  target: VersionGraph,
): CompareIoChange[] {
  const baseByLineage = new Map(base.nodes.map((n) => [getLineageKey(n), n]));
  const targetByLineage = new Map(target.nodes.map((n) => [getLineageKey(n), n]));
  const changes: CompareIoChange[] = [];
  for (const { merged, ref } of included) {
    if (merged.status === "unchanged") continue;
    const before = baseByLineage.get(merged.id);
    const after = targetByLineage.get(merged.id);
    for (const side of ["input", "output"] as const) {
      // 출력이 바뀌면 그 산출물을 입력으로 쓰는 노드가, 입력이 바뀌면 그 항목을 산출하는 노드가 상대(peer)
      const peerSide: keyof FlatNode = side === "output" ? "input" : "output";
      for (const item of buildIoDiffSide(before?.[side], after?.[side])) {
        if (item.status === "unchanged") continue;
        const peers = target.nodes
          .filter((n) => n !== after && splitLines(n[peerSide]).includes(item.text))
          .map((n) => n.title.slice(0, 200))
          .slice(0, 10);
        changes.push({ ref, side, text: item.text.slice(0, 200), status: item.status, peers });
        if (changes.length >= IO_CHANGE_CAP) return changes;
      }
    }
  }
  return changes;
}

export function buildCompareSummaryPayload(
  merged: MergedGraph,
  options: CompareSummaryOptions = {},
): CompareSummaryPayloadResult {
  const cap = options.cap ?? COMPARE_SUMMARY_CAP;
  const refs = new Map<string, CompareSummaryRef>();
  const titleByKey = new Map(merged.nodes.map((m) => [m.id, m.node.title]));
  const ordered = orderNodes(merged);
  const kept = ordered.slice(0, cap).map((m, i) => ({ merged: m, ref: `n${i + 1}` }));
  const keptIds = new Set(kept.map((k) => k.merged.id));
  const countedEdges = pickCountedEdges(merged);
  const totals: CompareDiffTotals = {
    nodes_added: merged.nodes.filter((n) => n.status === "added").length,
    nodes_removed: merged.nodes.filter((n) => n.status === "removed").length,
    nodes_changed: merged.nodes.filter((n) => n.status === "changed").length,
    edges_added: countedEdges.filter((e) => e.status === "added").length,
    edges_removed: countedEdges.filter((e) => e.status === "removed").length,
    edges_changed: countedEdges.filter((e) => e.status === "changed").length,
  };

  const nodes: CompareDiffNode[] = kept.map(({ merged: m, ref }) => {
    refs.set(ref, { kind: "node", id: m.id });
    const row: CompareDiffNode = {
      ref,
      status: m.status,
      title: m.node.title.slice(0, 200),
      node_type: m.node.node_type,
      changes:
        m.status === "changed"
          ? m.fieldChanges
              // AI 표면엔 담당자 실명(assignee) 없음 — 사람 필드는 assignee_role만 (사용자 결정 2026-09-12)
              .filter((fc) => fc.field !== "assignee")
              .slice(0, 40)
              .map((fc) => ({
                field: fc.field,
                before: fc.before.slice(0, 500),
                after: fc.after.slice(0, 500),
              }))
          : [],
    };
    // 추가 노드만 핵심 속성 동봉 — 보고서가 "무엇을 누가 어디서 하는 단계"인지 서술할 재료.
    // 변경 노드는 changes(before→after)가 이미 드러내므로 중복 전송하지 않는다.
    if (m.status === "added") {
      const attrs = {
        description: m.node.description.slice(0, 300),
        assignee_role: (m.node.assignee_role ?? "").slice(0, 100),
        department: m.node.department.slice(0, 100),
        system: m.node.system.slice(0, 100),
      };
      for (const [key, value] of Object.entries(attrs)) {
        if (value) row[key as keyof typeof attrs] = value;
      }
    }
    return row;
  });

  // 남긴 노드 사이의 모든 엣지(무변경 포함) — 흐름 문맥. 상한 초과분은 개수만.
  const contextEdges = merged.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
  const edges: CompareDiffEdge[] = contextEdges.slice(0, COMPARE_SUMMARY_EDGE_CAP).map((e, i) => {
    const ref = `e${i + 1}`;
    refs.set(ref, { kind: "edge", id: e.id });
    return {
      ref,
      status: e.status,
      source: (titleByKey.get(e.source) ?? "?").slice(0, 200),
      target: (titleByKey.get(e.target) ?? "?").slice(0, 200),
      label: (e.labelChange?.after ?? e.label).slice(0, 200),
      label_before: (e.labelChange?.before ?? "").slice(0, 200),
    };
  });

  const { base, target } = options;
  const metrics: CompareMetric[] =
    base && target
      ? PARAM_FIELDS.map((field) => ({ field, base: sumVersionParam(base, field), target: sumVersionParam(target, field) })).filter(
          (m) => m.base !== "" || m.target !== "",
        )
      : [];

  const payload: CompareDiffPayload = {
    nodes,
    edges,
    omitted_nodes: Math.max(0, ordered.length - cap),
    omitted_edges: Math.max(0, contextEdges.length - COMPARE_SUMMARY_EDGE_CAP),
    totals,
    metrics,
    io_changes: base && target ? buildIoChanges(kept, base, target) : [],
  };
  return { payload, refs };
}

export function hasCompareChanges(totals: CompareDiffTotals): boolean {
  return Object.values(totals).some((n) => n > 0);
}

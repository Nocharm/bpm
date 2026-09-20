// buildCompareSummaryPayload — 병합 diff→백엔드 페이로드(변경+문맥 노드·엣지, 합계, 입출력 변경)·ref 매핑·상한 검증.

import { describe, expect, it } from "vitest";

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import { buildCompareSummaryPayload, hasCompareChanges } from "@/lib/compare-summary-payload";
import { buildMergedGraph } from "@/lib/merge-diff";

function mkNode(over: Partial<FlatNode> & { id: string }): FlatNode {
  return {
    title: "",
    description: "",
    node_type: "process",
    color: "",
    assignee: "",
    department: "",
    system: "",
    duration: "",
    pos_x: 0,
    pos_y: 0,
    sort_order: 0,
    group_ids: [],
    linked_map_id: null,
    follow_latest: false,
    linked_version_id: null,
    is_primary_end: false,
    parent_node_id: null,
    source_node_id: null,
    ...over,
  };
}

function mkEdge(id: string, source: string, target: string, label = ""): GraphEdge {
  return {
    id,
    source_node_id: source,
    target_node_id: target,
    label,
    source_side: "",
    target_side: "",
    source_handle: null,
    target_handle: null,
    line_style: "",
  };
}

// As-Is: A→B→C. To-Be: A 유지, B duration 변경, C 삭제, D 추가; A→B 유지, B→D 추가, A→C(기존 노드 사이) 추가.
function buildFixture(): { base: VersionGraph; target: VersionGraph } {
  const base: VersionGraph = {
    nodes: [
      mkNode({ id: "a", title: "A" }),
      mkNode({ id: "b", title: "B", duration: "1.00" }),
      mkNode({ id: "c", title: "C" }),
    ],
    edges: [mkEdge("e1", "a", "b"), mkEdge("e2", "b", "c")],
  };
  const target: VersionGraph = {
    nodes: [
      mkNode({ id: "a2", source_node_id: "a", title: "A" }),
      mkNode({ id: "b2", source_node_id: "b", title: "B", duration: "2.30" }),
      mkNode({ id: "d", title: "D" }),
    ],
    edges: [mkEdge("e1b", "a2", "b2"), mkEdge("e3", "b2", "d"), mkEdge("e4", "b2", "a2", "loop")],
  };
  return { base, target };
}

describe("buildCompareSummaryPayload", () => {
  it("serializes changed nodes with before/after, orders added→removed→changed→unchanged, maps refs back", () => {
    const { base, target } = buildFixture();
    const merged = buildMergedGraph(base, target);

    const { payload, refs } = buildCompareSummaryPayload(merged);

    expect(payload.nodes.map((n) => [n.ref, n.status, n.title])).toEqual([
      ["n1", "added", "D"],
      ["n2", "removed", "C"],
      ["n3", "changed", "B"],
      ["n4", "unchanged", "A"], // 흐름 문맥 — 변경 노드의 이웃
    ]);
    expect(payload.nodes[2].changes).toEqual([{ field: "duration", before: "1.00", after: "2.30" }]);
    expect(refs.get("n3")).toEqual({ kind: "node", id: "b" });
    expect(refs.get("n4")).toEqual({ kind: "node", id: "a" });
    expect(payload.totals).toEqual({
      nodes_added: 1,
      nodes_removed: 1,
      nodes_changed: 1,
      edges_added: 1,
      edges_removed: 0,
      edges_changed: 0,
    });
  });

  it("carries every edge among included nodes with its status, while totals count only wiring between kept nodes", () => {
    const { base, target } = buildFixture();
    const merged = buildMergedGraph(base, target);

    const { payload, refs } = buildCompareSummaryPayload(merged);

    const edges = payload.edges.map((e) => `${e.status}:${e.source}->${e.target}`).sort();
    expect(edges).toEqual(["added:B->A", "added:B->D", "removed:B->C", "unchanged:A->B"].sort());
    expect(payload.totals.edges_added).toBe(1); // B→A만 (B→D는 추가 노드 딸림, B→C는 삭제 노드 딸림)
    for (const e of payload.edges) expect(refs.get(e.ref)?.kind).toBe("edge");
  });

  it("keeps changed nodes and their nearest neighbours first when the cap trims context", () => {
    // 체인 N0→N1→…→N5, N4만 변경 — cap 3이면 N4 + 이웃(N3, N5)만 남는다
    const chain = Array.from({ length: 6 }, (_, i) => mkNode({ id: `n${i}`, title: `N${i}`, duration: "1.00" }));
    const base: VersionGraph = { nodes: chain, edges: chain.slice(1).map((n, i) => mkEdge(`e${i}`, `n${i}`, n.id)) };
    const target: VersionGraph = {
      nodes: chain.map((n) => mkNode({ ...n, id: `${n.id}t`, source_node_id: n.id, duration: n.id === "n4" ? "3.00" : "1.00" })),
      edges: chain.slice(1).map((n, i) => mkEdge(`e${i}t`, `n${i}t`, `${n.id}t`)),
    };
    const merged = buildMergedGraph(base, target);

    const { payload } = buildCompareSummaryPayload(merged, { cap: 3 });

    expect(payload.nodes.map((n) => n.title).sort()).toEqual(["N3", "N4", "N5"]);
    expect(payload.omitted_nodes).toBe(3);
    expect(payload.totals.nodes_changed).toBe(1);
  });

  it("carries version metric totals when both graphs are given", () => {
    const { base, target } = buildFixture();
    const merged = buildMergedGraph(base, target);

    const { payload } = buildCompareSummaryPayload(merged, { base, target });

    // 합계 표기는 요약 탭(sumVersionParam)과 동일 — 정시는 "1", 분이 있으면 H.MM
    expect(payload.metrics).toEqual([{ field: "duration", base: "1", target: "2.30" }]);
  });

  it("reports io item changes with the peers that consume or produce them", () => {
    // X가 '발주서'를 산출하고 Y가 입력으로 쓴다 → To-Be에서 X 산출물 삭제, Y는 여전히 입력으로 사용(끊김)
    const base: VersionGraph = {
      nodes: [mkNode({ id: "x", title: "X", output: "발주서" }), mkNode({ id: "y", title: "Y", input: "발주서" })],
      edges: [mkEdge("e", "x", "y")],
    };
    const target: VersionGraph = {
      nodes: [
        mkNode({ id: "x2", source_node_id: "x", title: "X", output: "" }),
        mkNode({ id: "y2", source_node_id: "y", title: "Y", input: "발주서\n검수 결과" }),
      ],
      edges: [mkEdge("e2", "x2", "y2")],
    };
    const merged = buildMergedGraph(base, target);

    const { payload, refs } = buildCompareSummaryPayload(merged, { base, target });

    const removed = payload.io_changes.find((c) => c.status === "removed");
    const added = payload.io_changes.find((c) => c.status === "added");
    expect(removed).toMatchObject({ side: "output", text: "발주서", peers: ["Y"] });
    expect(refs.get(removed!.ref)).toEqual({ kind: "node", id: "x" });
    expect(added).toMatchObject({ side: "input", text: "검수 결과", peers: [] });
  });

  it("never sends the assignee real name, only the role (AI surface rule 2026-09-12)", () => {
    const base: VersionGraph = {
      nodes: [mkNode({ id: "a", title: "A", assignee: "kim.cs", assignee_role: "발주 담당" })],
      edges: [],
    };
    const target: VersionGraph = {
      nodes: [mkNode({ id: "a2", source_node_id: "a", title: "A", assignee: "park.jh", assignee_role: "결제 담당" })],
      edges: [],
    };
    const merged = buildMergedGraph(base, target);

    const { payload } = buildCompareSummaryPayload(merged);

    expect(payload.nodes[0].changes.map((c) => c.field)).toEqual(["assignee_role"]);
    expect(JSON.stringify(payload)).not.toContain("park.jh");
  });

  it("carries description/role/department/system for added nodes only", () => {
    const base: VersionGraph = { nodes: [mkNode({ id: "a", title: "A" })], edges: [] };
    const target: VersionGraph = {
      nodes: [
        mkNode({ id: "a2", source_node_id: "a", title: "A", department: "품질팀" }),
        mkNode({
          id: "d",
          title: "D",
          description: "출고 전 품질 서류 확인",
          assignee_role: "QA 담당",
          department: "품질팀",
          system: "LIMS",
        }),
      ],
      edges: [],
    };
    const merged = buildMergedGraph(base, target);

    const { payload } = buildCompareSummaryPayload(merged);

    const added = payload.nodes.find((n) => n.status === "added");
    const changed = payload.nodes.find((n) => n.status === "changed");
    expect(added).toMatchObject({
      title: "D",
      description: "출고 전 품질 서류 확인",
      assignee_role: "QA 담당",
      department: "품질팀",
      system: "LIMS",
    });
    // 변경 노드는 before→after(changes)로 이미 드러나므로 속성 스냅샷을 붙이지 않는다
    expect(changed).toBeDefined();
    expect(changed).not.toHaveProperty("department");
  });

  it("caps lists and reports omitted counts while totals stay complete", () => {
    const base: VersionGraph = { nodes: [], edges: [] };
    const target: VersionGraph = {
      nodes: Array.from({ length: 5 }, (_, i) => mkNode({ id: `n${i}`, title: `N${i}` })),
      edges: [],
    };
    const merged = buildMergedGraph(base, target);

    const { payload } = buildCompareSummaryPayload(merged, { cap: 3 });

    expect(payload.nodes).toHaveLength(3);
    expect(payload.omitted_nodes).toBe(2);
    expect(payload.totals.nodes_added).toBe(5);
    expect(hasCompareChanges(payload.totals)).toBe(true);
  });

  it("reports no changes for identical graphs", () => {
    const { base } = buildFixture();
    const merged = buildMergedGraph(base, base);

    const { payload } = buildCompareSummaryPayload(merged);

    expect(payload.nodes.filter((n) => n.status !== "unchanged")).toHaveLength(0);
    expect(payload.io_changes).toHaveLength(0);
    expect(hasCompareChanges(payload.totals)).toBe(false);
  });
});

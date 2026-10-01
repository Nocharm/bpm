// buildMergedGraph 단위 테스트 — 계보 매칭으로 노드/엣지 union + status 산출 검증.

import { describe, expect, it } from "vitest";

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
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

// As-Is: A→B→C. To-Be(복제): A'(=A), B'(=B, title 변경), C 삭제, D 추가; A'→B' 유지, B'→D 추가.
function buildFixture(): { base: VersionGraph; target: VersionGraph } {
  const base: VersionGraph = {
    nodes: [
      mkNode({ id: "a", title: "A" }),
      mkNode({ id: "b", title: "B" }),
      mkNode({ id: "c", title: "C" }),
    ],
    edges: [mkEdge("e1", "a", "b"), mkEdge("e2", "b", "c")],
  };
  const target: VersionGraph = {
    nodes: [
      mkNode({ id: "a2", source_node_id: "a", title: "A" }),
      mkNode({ id: "b2", source_node_id: "b", title: "B-new" }),
      mkNode({ id: "d", title: "D" }),
    ],
    edges: [mkEdge("e3", "a2", "b2"), mkEdge("e4", "b2", "d")],
  };
  return { base, target };
}

describe("buildMergedGraph", () => {
  it("classifies nodes by lineage as unchanged/changed/added/removed", () => {
    const { base, target } = buildFixture();

    const merged = buildMergedGraph(base, target);
    const byId = new Map(merged.nodes.map((n) => [n.id, n]));

    expect(merged.nodes).toHaveLength(4);
    expect(byId.get("a")?.status).toBe("unchanged");
    expect(byId.get("b")?.status).toBe("changed");
    expect(byId.get("b")?.changedFields).toContain("title");
    expect(byId.get("c")?.status).toBe("removed");
    expect(byId.get("d")?.status).toBe("added");
  });

  it("carries before/after values for changed fields", () => {
    const { base, target } = buildFixture();

    const merged = buildMergedGraph(base, target);
    const b = merged.nodes.find((n) => n.id === "b");

    expect(b?.fieldChanges).toEqual([{ field: "title", before: "B", after: "B-new" }]);
    // unchanged/added/removed 노드는 fieldChanges 비어 있음
    expect(merged.nodes.find((n) => n.id === "a")?.fieldChanges).toEqual([]);
    expect(merged.nodes.find((n) => n.id === "d")?.fieldChanges).toEqual([]);
  });

  it("uses target data for matched nodes (target title wins)", () => {
    const { base, target } = buildFixture();

    const merged = buildMergedGraph(base, target);
    const b = merged.nodes.find((n) => n.id === "b");

    expect(b?.node.title).toBe("B-new");
  });

  it("classifies edges by lineage endpoints as unchanged/added/removed", () => {
    const { base, target } = buildFixture();

    const merged = buildMergedGraph(base, target);
    const byId = new Map(merged.edges.map((e) => [e.id, e]));

    expect(byId.get("a->b")?.status).toBe("unchanged");
    expect(byId.get("b->c")?.status).toBe("removed");
    expect(byId.get("b->d")?.status).toBe("added");
  });

  it("keeps every edge endpoint in the union node id space (no orphans)", () => {
    const { base, target } = buildFixture();

    const merged = buildMergedGraph(base, target);
    const nodeIds = new Set(merged.nodes.map((n) => n.id));

    for (const edge of merged.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("returns empty diff for identical graphs", () => {
    const { base } = buildFixture();

    const merged = buildMergedGraph(base, base);

    expect(merged.nodes.every((n) => n.status === "unchanged")).toBe(true);
    expect(merged.edges.every((e) => e.status === "unchanged")).toBe(true);
  });

  it("flags a label change on a kept edge as changed with before/after", () => {
    const { base, target } = buildFixture();
    base.edges[0] = mkEdge("e1", "a", "b", "yes");
    target.edges[0] = mkEdge("e3", "a2", "b2", "approved");

    const merged = buildMergedGraph(base, target);
    const edge = merged.edges.find((e) => e.id === "a->b");

    expect(edge?.status).toBe("changed");
    expect(edge?.labelChange).toEqual({ before: "yes", after: "approved" });
  });

  it("keeps identical labels unchanged and carries target line style", () => {
    const { base, target } = buildFixture();
    base.edges[0] = { ...mkEdge("e1", "a", "b", "same"), line_style: "straight" };
    target.edges[0] = { ...mkEdge("e3", "a2", "b2", "same"), line_style: "default" };

    const merged = buildMergedGraph(base, target);
    const kept = merged.edges.find((e) => e.id === "a->b");
    const removed = merged.edges.find((e) => e.id === "b->c");

    expect(kept?.status).toBe("unchanged");
    expect(kept?.labelChange).toBeUndefined();
    expect(kept?.lineStyle).toBe("default"); // target 우선
    expect(removed?.lineStyle).toBe(""); // base만 있으면 base 값
  });

  it("reports URL and link identity changes as field changes", () => {
    const base: VersionGraph = {
      nodes: [mkNode({ id: "s", node_type: "subprocess", url: "https://a", linked_map_id: 1, follow_latest: false })],
      edges: [],
    };
    const target: VersionGraph = {
      nodes: [
        mkNode({ id: "s2", source_node_id: "s", node_type: "subprocess", url: "https://b", linked_map_id: 2, follow_latest: true }),
      ],
      edges: [],
    };

    const merged = buildMergedGraph(base, target);

    expect(merged.nodes[0].fieldChanges).toEqual([
      { field: "url", before: "https://a", after: "https://b" },
      { field: "linked_map", before: "1", after: "2" },
      { field: "follow_latest", before: "false", after: "true" },
    ]);
  });
});

describe("buildMergedGraph - 엣지 정체성(D4: SP 출구 끝 키만 내용)", () => {
  // SP s → B. 같은 쌍에 대표 끝·보조 끝 두 엣지가 있을 수 있다.
  function spGraph(suffix: string, edges: GraphEdge[]): VersionGraph {
    const lineage = suffix ? { s: "s", b: "b" } : { s: null, b: null };
    return {
      nodes: [
        mkNode({ id: `s${suffix}`, source_node_id: lineage.s, node_type: "subprocess", title: "Call" }),
        mkNode({ id: `b${suffix}`, source_node_id: lineage.b, title: "B" }),
      ],
      edges,
    };
  }
  function spEdge(id: string, suffix: string, sourceHandle: string | null, targetHandle: string | null = null): GraphEdge {
    return { ...mkEdge(id, `s${suffix}`, `b${suffix}`), source_handle: sourceHandle, target_handle: targetHandle };
  }

  it("keeps two ends of the same pair as two edges", () => {
    const base = spGraph("", [spEdge("e1", "", "__primary__"), spEdge("e2", "", "Rejected")]);

    const merged = buildMergedGraph(base, base);

    expect(merged.edges.map((e) => [e.id, e.exit, e.status])).toEqual([
      ["s->b", "__primary__", "unchanged"],
      ["s->b@Rejected", "Rejected", "unchanged"],
    ]);
  });

  it("flags an end key change on the same pair as changed with before/after", () => {
    const base = spGraph("", [spEdge("e1", "", "Rejected")]);
    const target = spGraph("2", [spEdge("e2", "2", "Approved")]);

    const merged = buildMergedGraph(base, target);

    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]).toMatchObject({
      id: "s->b@Approved",
      status: "changed",
      exit: "Approved",
      exitChange: { before: "Rejected", after: "Approved" },
    });
    expect(merged.edges[0].labelChange).toBeUndefined();
  });

  it("treats side ids, in-handle variants and a null SP handle as layout (unchanged)", () => {
    const base = spGraph("", [spEdge("e1", "", null, "t-left")]);
    const target = spGraph("2", [spEdge("e2", "2", "s-bottom", "t-top")]);

    const merged = buildMergedGraph(base, target);

    expect(merged.edges.map((e) => [e.id, e.status])).toEqual([["s->b", "unchanged"]]);
  });

  it("ignores side ids on normal nodes and SP in-handle variants", () => {
    const { base, target } = buildFixture();
    base.nodes[1] = mkNode({ id: "b", title: "B", node_type: "subprocess" });
    target.nodes[1] = mkNode({ id: "b2", source_node_id: "b", title: "B-new", node_type: "subprocess" });
    base.edges[0] = { ...mkEdge("e1", "a", "b"), source_handle: "s-right", target_handle: "in" };
    target.edges[0] = { ...mkEdge("e3", "a2", "b2"), source_handle: "s-top", target_handle: "in:top" };

    const merged = buildMergedGraph(base, target);

    expect(merged.edges.find((e) => e.id === "a->b")?.status).toBe("unchanged");
  });
});

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
});

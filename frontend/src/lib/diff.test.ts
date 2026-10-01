// 버전 diff 회귀 — CSV 머지 임포트 후 "실제 변경"만 잡히는지. 머지 전(전체 교체)에는 전 엣지가 오탐이었다.
import { describe, expect, it } from "vitest";

import type { FlatNode, GraphEdge, VersionGraph } from "./api";
import { computeVersionDiff } from "./diff";

const FLAT: Omit<FlatNode, "id" | "title" | "node_type" | "source_node_id"> = {
  description: "", color: "", assignee: "", department: "", system: "", duration: "",
  url: "", url_label: "", pos_x: 0, pos_y: 0, sort_order: 0, group_ids: [],
  linked_map_id: null, follow_latest: false, linked_version_id: null,
  is_primary_end: false, parent_node_id: null,
};

const edge = (id: string, source: string, target: string): GraphEdge => ({
  id, source_node_id: source, target_node_id: target, label: "",
  source_side: "right", target_side: "left", source_handle: null, target_handle: null, line_style: "",
});

// v1 — 게시본. 계보 루트이므로 source_node_id는 null.
const v1: VersionGraph = {
  nodes: [
    { ...FLAT, id: "s1", title: "Start", node_type: "start", source_node_id: null },
    { ...FLAT, id: "a1", title: "Review request", node_type: "process", system: "SAP", source_node_id: null },
    { ...FLAT, id: "e1", title: "End", node_type: "end", source_node_id: null, is_primary_end: true },
  ],
  edges: [edge("x1", "s1", "a1"), edge("x2", "a1", "e1")],
};

// v2 — v1의 클론(새 id + source_node_id=원본). 그 위에 CSV 머지: A.system 변경 + B 추가.
const v2: VersionGraph = {
  nodes: [
    { ...FLAT, id: "s2", title: "Start", node_type: "start", source_node_id: "s1" },
    { ...FLAT, id: "a2", title: "Review request", node_type: "process", system: "ERP", source_node_id: "a1" },
    { ...FLAT, id: "b1", title: "Sign contract", node_type: "process", source_node_id: null },
    { ...FLAT, id: "e2", title: "End", node_type: "end", source_node_id: "e1", is_primary_end: true },
  ],
  edges: [edge("y1", "s2", "a2"), edge("y2", "a2", "b1"), edge("y3", "b1", "e2")],
};

describe("computeVersionDiff - CSV 머지 임포트 후", () => {
  it("바뀌지 않은 Start→Review 엣지를 added/removed로 잡지 않는다", () => {
    expect(computeVersionDiff(v1, v2).rightEdgeStatus.get("y1")).toBeUndefined();
  });

  it("실제로 사라진 엣지만 removed로 잡는다", () => {
    // Review→End 는 B 삽입으로 끊겼다
    expect([...computeVersionDiff(v1, v2).leftEdgeStatus.keys()]).toEqual(["x2"]);
  });

  it("실제로 생긴 엣지만 added로 잡는다", () => {
    expect([...computeVersionDiff(v1, v2).rightEdgeStatus.keys()].sort()).toEqual(["y2", "y3"]);
  });

  it("system이 바뀐 노드만 changed로 잡는다", () => {
    const changed = computeVersionDiff(v1, v2).entries.filter((e) => e.status === "changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].title).toBe("Review request");
    expect(changed[0].changedFields).toEqual(["system"]);
  });

  it("신규 노드만 added로 잡는다", () => {
    const added = computeVersionDiff(v1, v2).entries.filter((e) => e.status === "added");
    expect(added.map((e) => e.title)).toEqual(["Sign contract"]);
  });

  it("삭제 노드는 없다", () => {
    expect(computeVersionDiff(v1, v2).entries.filter((e) => e.status === "removed")).toEqual([]);
  });
});

describe("computeVersionDiff - assignee_role", () => {
  it("역할 변경을 changedFields로 잡는다", () => {
    const left: VersionGraph = {
      nodes: [{ ...FLAT, id: "r1", title: "Weigh", node_type: "process", assignee_role: "Operator", source_node_id: null }],
      edges: [],
    };
    const right: VersionGraph = {
      nodes: [{ ...FLAT, id: "r2", title: "Weigh", node_type: "process", assignee_role: "Reviewer", source_node_id: "r1" }],
      edges: [],
    };
    const entry = computeVersionDiff(left, right).entries.find((e) => e.title === "Weigh");
    expect(entry?.status).toBe("changed");
    expect(entry?.changedFields).toContain("assignee_role");
  });
});

describe("computeVersionDiff - 병렬 출구", () => {
  const graphWith = (id: string, sourceId: string | null, parallel: string[]): VersionGraph => ({
    nodes: [{ ...FLAT, id, title: "Fork", node_type: "process", source_node_id: sourceId, parallel_outputs: parallel }],
    edges: [],
  });

  it("compares parallel exits by content, not array identity", () => {
    const diff = computeVersionDiff(graphWith("p1", null, ["b", "a"]), graphWith("p2", "p1", ["a", "b"]));
    expect(diff.entries).toEqual([]);
  });

  it("reports a parallel toggle as a parallel field change", () => {
    const diff = computeVersionDiff(graphWith("p1", null, []), graphWith("p2", "p1", ["__primary__"]));
    expect(diff.entries.map((entry) => entry.changedFields)).toEqual([["parallel"]]);
  });
});

describe("computeVersionDiff - URL·링크 정체성(백엔드 확정 서명과 같은 필드)", () => {
  const pair = (left: Partial<FlatNode>, right: Partial<FlatNode>) =>
    computeVersionDiff(
      { nodes: [{ ...FLAT, id: "n1", title: "Call", node_type: "subprocess", source_node_id: null, ...left }], edges: [] },
      { nodes: [{ ...FLAT, id: "n2", title: "Call", node_type: "subprocess", source_node_id: "n1", ...right }], edges: [] },
    ).entries.map((entry) => entry.changedFields);

  it("reports a URL-only change as url / url_label", () => {
    expect(pair({ url: "https://a" }, { url: "https://b" })).toEqual([["url"]]);
    expect(pair({ url_label: "Old" }, { url_label: "New" })).toEqual([["url_label"]]);
  });

  it("reports each link identity field on its own", () => {
    expect(pair({ linked_map_id: 1 }, { linked_map_id: 2 })).toEqual([["linked_map"]]);
    expect(pair({ placeholder_category_id: 7 }, { placeholder_category_id: 8 })).toEqual([["placeholder"]]);
    expect(pair({ is_primary_end: false }, { is_primary_end: true })).toEqual([["primary_end"]]);
    expect(pair({ follow_latest: false }, { follow_latest: true })).toEqual([["follow_latest"]]);
  });

  it("treats a missing optional field as null (no false change)", () => {
    expect(pair({}, { placeholder_category_id: null })).toEqual([]);
  });
});

describe("computeVersionDiff - 엣지 정체성(D4: SP 출구 끝 키만 내용)", () => {
  const sp = (id: string, sourceId: string | null): FlatNode => ({
    ...FLAT, id, title: "Call", node_type: "subprocess", source_node_id: sourceId,
  });
  const proc = (id: string, sourceId: string | null, title: string): FlatNode => ({
    ...FLAT, id, title, node_type: "process", source_node_id: sourceId,
  });
  const handled = (id: string, source: string, target: string, sh: string | null, th: string | null): GraphEdge => ({
    ...edge(id, source, target), source_handle: sh, target_handle: th,
  });

  it("ignores side ids and SP in-handle variants", () => {
    const left: VersionGraph = {
      nodes: [proc("a", null, "A"), sp("s", null)],
      edges: [handled("x", "a", "s", "s-right", "in")],
    };
    const right: VersionGraph = {
      nodes: [proc("a2", "a", "A"), sp("s2", "s")],
      edges: [handled("y", "a2", "s2", "s-top", "in:top")],
    };

    const diff = computeVersionDiff(left, right);

    expect(diff.leftEdgeStatus.size).toBe(0);
    expect(diff.rightEdgeStatus.size).toBe(0);
  });

  it("keeps two ends of one SP toward the same target apart and sees an end key change", () => {
    const left: VersionGraph = {
      nodes: [sp("s", null), proc("b", null, "B")],
      edges: [handled("x1", "s", "b", null, null), handled("x2", "s", "b", "Rejected", null)],
    };
    const right: VersionGraph = {
      nodes: [sp("s2", "s"), proc("b2", "b", "B")],
      edges: [handled("y1", "s2", "b2", "__primary__", null), handled("y2", "s2", "b2", "Approved", null)],
    };

    const diff = computeVersionDiff(left, right);

    // null 핸들 = 대표 끝이라 x1↔y1은 같은 엣지, 보조 끝만 바뀌었다
    expect([...diff.leftEdgeStatus.keys()]).toEqual(["x2"]);
    expect([...diff.rightEdgeStatus.keys()]).toEqual(["y2"]);
  });
});

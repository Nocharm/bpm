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
  source_side: "right", target_side: "left", source_handle: null, target_handle: null,
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

describe("computeVersionDiff — CSV 머지 임포트 후", () => {
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

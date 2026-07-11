import { describe, expect, it } from "vitest";

import type { Graph, GraphNode } from "./api";
import { sumParamField } from "./param-sum";

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id, title: id, description: "", node_type: "process", color: "",
  assignee: "", department: "", system: "", duration: "",
  pos_x: 0, pos_y: 0, sort_order: 0, group_ids: [],
  linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
  ...over,
});
const graph = (nodes: GraphNode[], refs: Graph["subprocess_refs"] = undefined): Graph =>
  ({ nodes, edges: [], groups: [], subprocess_refs: refs });

describe("sumParamField", () => {
  it("duration은 분 환산 캐리 합", () => {
    const g = graph([node("a", { duration: "0.45" }), node("b", { duration: "0.30" })]);
    expect(sumParamField(g, "duration")).toBe("1.15");
  });
  it("subprocess 노드는 subprocess_refs의 sp값 사용", () => {
    const g = graph(
      [node("a", { duration: "1" }), node("s", { node_type: "subprocess", linked_map_id: 7 })],
      { 7: { designated: true, department: null, assignee: null, system: null, duration: "0.30", url: null, url_label: null, headcount: null, etf: null, cost: null, extra: null } },
    );
    expect(sumParamField(g, "duration")).toBe("1.30");
  });
  it("십진수는 스케일 정수 합산 — 부동소수 오차 없음", () => {
    const g = graph([node("a", { cost: "0.1" }), node("b", { cost: "0.2" })]);
    expect(sumParamField(g, "cost")).toBe("0.3");
  });
  it("빈값·무효는 스킵", () => {
    const g = graph([node("a", { etf: "" }), node("b", { etf: "abc" }), node("c", { etf: "2.5" })]);
    expect(sumParamField(g, "etf")).toBe("2.5");
  });
  it("기여값 0개면 빈 문자열", () => {
    expect(sumParamField(graph([node("a")]), "extra")).toBe("");
  });
  it("ref 없는 subprocess 노드는 스킵", () => {
    const g = graph([node("s", { node_type: "subprocess", linked_map_id: 9 })]);
    expect(sumParamField(g, "duration")).toBe("");
  });
});

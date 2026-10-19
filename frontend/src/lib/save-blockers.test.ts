// 저장 체크리스트 공용 판정 — 설정 버전 패널이 제출 전에 쓰는 그래프 기준 경로 (리뷰 F-4)
import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { listGraphSaveBlockers } from "./save-blockers";

const t = (key: string) => key;
const node = (id: string, node_type: string, title = id): GraphNode =>
  ({ id, title, node_type, parallel_outputs: [] }) as unknown as GraphNode;
const edge = (id: string, source: string, target: string): GraphEdge =>
  ({ id, source_node_id: source, target_node_id: target, source_handle: null, gateway: null }) as unknown as GraphEdge;

describe("listGraphSaveBlockers", () => {
  it("passes a straight start → task → end map", () => {
    const graph = { nodes: [node("s", "start"), node("a", "process"), node("e", "end", "")], edges: [edge("1", "s", "a"), edge("2", "a", "e")], groups: [] } as Graph;
    expect(listGraphSaveBlockers(graph, t)).toEqual([]);
  });

  it("flags a plain fan-out the same way as the editor checklist", () => {
    const graph = {
      nodes: [node("s", "start"), node("a", "process"), node("b", "process"), node("e", "end", "")],
      edges: [edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "a", "e"), edge("4", "b", "e")],
      groups: [],
    } as Graph;
    expect(listGraphSaveBlockers(graph, t)).toEqual(["save.checkSingleOutput"]);
  });
});

// 저장 체크리스트 공용 판정 — 설정 버전 패널이 제출 전에 쓰는 그래프 기준 경로 (리뷰 F-4)
import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { listGraphSaveBlockers } from "./save-blockers";

const t = (key: string) => key;
const node = (id: string, node_type: string, title = id, is_primary_end = false): GraphNode =>
  ({ id, title, node_type, parallel_outputs: [], is_primary_end }) as unknown as GraphNode;
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

  it("asks for a primary end when several ends have none (F-3)", () => {
    const base = [node("s", "start"), node("a", "process"), node("d", "decision")];
    const edges = [edge("1", "s", "a"), edge("2", "a", "d"), edge("3", "d", "ok"), edge("4", "d", "no")];
    const none = { nodes: [...base, node("ok", "end", "승인"), node("no", "end", "반려")], edges, groups: [] } as Graph;
    expect(listGraphSaveBlockers(none, t)).toEqual(["save.checkPrimaryEnd"]);
    const chosen = { nodes: [...base, node("ok", "end", "승인", true), node("no", "end", "반려")], edges, groups: [] } as Graph;
    expect(listGraphSaveBlockers(chosen, t)).toEqual([]);
    // 끝 하나는 저장이 자동 지정 — 플래그가 없어도 막지 않는다
    const single = { nodes: [node("s", "start"), node("e", "end", "")], edges: [edge("1", "s", "e")], groups: [] } as Graph;
    expect(listGraphSaveBlockers(single, t)).toEqual([]);
  });
});

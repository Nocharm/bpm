// lib/layout-graph 테스트 — 되돌아가는 엣지 탐색이 정규 엣지 순서를 따르는지(파이썬 consultant_layout과 짝).
import { describe, expect, it } from "vitest";

import { type LayoutEdgeLink, sortLayoutEdges, splitForwardEdges } from "@/lib/layout-graph";

describe("splitForwardEdges — canonical DFS order", () => {
  it("picks the same back edge whatever the input order (yes branch first)", () => {
    // D ─아니오→ X, D ─예→ Y, X ↔ Y: 예(Y)를 먼저 밟으므로 X→Y가 되돌아가는 엣지.
    // test_consultant_layout_io.py test_back_edge_search_follows_the_canonical_edge_order와 짝.
    const ids = ["s", "D", "X", "Y", "e"];
    const edges: LayoutEdgeLink[] = [
      { id: "sd", source: "s", target: "D" },
      { id: "dx", source: "D", target: "X", label: "No" },
      { id: "dy", source: "D", target: "Y", label: "Yes" },
      { id: "xy", source: "X", target: "Y" },
      { id: "yx", source: "Y", target: "X" },
      { id: "xe", source: "X", target: "e" },
      { id: "ye", source: "Y", target: "e" },
    ];
    for (const ordered of [edges, [...edges].reverse()]) {
      const { back } = splitForwardEdges(ids, sortLayoutEdges(ids, ordered));
      expect(back.map((edge) => edge.id)).toEqual(["xy"]);
    }
  });
});

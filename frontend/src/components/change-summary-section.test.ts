// buildLiveGraph 회귀 — assignee_role 누락 시 서버 스냅샷("")과 항상 달라져 매 노드가 changed로 오탐됐다.
import { describe, expect, it } from "vitest";

import type { AppNode } from "@/lib/canvas";

import { buildLiveGraph } from "./change-summary-section";

const node: AppNode = {
  id: "n1",
  position: { x: 0, y: 0 },
  data: {
    label: "Review",
    description: "",
    nodeType: "process",
    color: "",
    assignee: "",
    department: "",
    system: "",
    duration: "",
    groupIds: [],
    hasChildren: false,
  },
};

describe("buildLiveGraph", () => {
  it("defaults assignee_role to empty string when data omits it", () => {
    const graph = buildLiveGraph([node]);
    expect(graph.nodes[0].assignee_role).toBe("");
  });
});

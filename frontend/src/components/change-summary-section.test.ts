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

  // 저장 직렬화(page.tsx)와 같은 폴백이어야 링크 정체성 diff가 미저장 상태에서 오탐하지 않는다
  it("falls back follow_latest to false like the editor save", () => {
    const graph = buildLiveGraph([node]);
    expect(graph.nodes[0].follow_latest).toBe(false);
  });

  it("keeps an explicit followLatest", () => {
    const graph = buildLiveGraph([{ ...node, data: { ...node.data, followLatest: true } }]);
    expect(graph.nodes[0].follow_latest).toBe(true);
  });

  it("carries placeholder_category_id from data and defaults it to null", () => {
    const placeholder: AppNode = {
      ...node,
      id: "sp1",
      data: { ...node.data, nodeType: "subprocess", placeholderCategoryId: 7 },
    };

    const graph = buildLiveGraph([placeholder, node]);

    expect(graph.nodes[0].placeholder_category_id).toBe(7);
    expect(graph.nodes[1].placeholder_category_id).toBeNull();
  });
});

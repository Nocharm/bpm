import { describe, expect, it } from "vitest";

import type { Graph } from "@/lib/api";

import { toFlowEdges, toFlowNodes } from "./graph-adapters";

const graph: Graph = {
  nodes: [
    {
      id: "n1",
      title: "발주 요청",
      description: "",
      node_type: "process",
      color: "",
      assignee: "",
      department: "",
      system: "",
      duration: "",
      pos_x: 120,
      pos_y: 40,
      sort_order: 0,
      group_ids: [],
      linked_map_id: null,
      follow_latest: false,
      linked_version_id: null,
      is_primary_end: false,
    },
  ],
  edges: [
    {
      id: "e1",
      source_node_id: "n1",
      target_node_id: "n2",
      label: "Yes",
      source_side: "right",
      target_side: "left",
      source_handle: null,
      target_handle: null,
    },
  ],
  groups: [],
};

describe("toFlowNodes", () => {
  it("uses saved position and maps title/type into node data", () => {
    const [node] = toFlowNodes(graph);
    expect(node.id).toBe("n1");
    expect(node.type).toBe("process");
    expect(node.position).toEqual({ x: 120, y: 40 });
    expect(node.data.label).toBe("발주 요청");
    expect(node.data.nodeType).toBe("process");
  });
});

describe("toFlowEdges", () => {
  it("maps node ids, label, and handle ids by side", () => {
    const [edge] = toFlowEdges(graph);
    expect(edge.source).toBe("n1");
    expect(edge.target).toBe("n2");
    expect(edge.label).toBe("Yes");
    expect(edge.sourceHandle).toBe("s-right");
    expect(edge.targetHandle).toBe("t-left");
  });
});

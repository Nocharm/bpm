import { describe, expect, it } from "vitest";

import { addBranchAfter, canvasToFlow, connectNodes, flowToCanvas, removeBranch, removeEdge, setEdgeLabel } from "./relations-canvas";
import type { FwCanvas } from "./api";

const base: FwCanvas = {
  nodes: [
    { id: "__start__", node_type: "start", title: "Start", task_id: null, pos_x: 0, pos_y: 0 },
    { id: "t1", node_type: "subprocess", title: "접수", task_id: "t1", pos_x: 200, pos_y: 0 },
    { id: "t2", node_type: "subprocess", title: "검토", task_id: "t2", pos_x: 400, pos_y: 0 },
    { id: "__end__", node_type: "end", title: "End", task_id: null, pos_x: 600, pos_y: 0 },
  ],
  edges: [
    { id: "e0", source_node_id: "__start__", target_node_id: "t1", label: "" },
    { id: "e1", source_node_id: "t1", target_node_id: "t2", label: "" },
    { id: "e2", source_node_id: "t2", target_node_id: "__end__", label: "" },
  ],
};

describe("relations canvas", () => {
  it("round-trips canvas → flow → canvas keeping task ids and positions", () => {
    const flow = canvasToFlow(base);
    expect(flow.nodes.find((n) => n.id === "t1")?.data.nodeType).toBe("subprocess");
    expect(flow.edges.map((e) => e.id)).toEqual(["e0", "e1", "e2"]);
    expect(flowToCanvas(flow.nodes, flow.edges, base)).toEqual(base);
  });
  it("addBranchAfter moves outgoing edges behind a new decision node", () => {
    const withBranch = addBranchAfter(base, "t1");
    const branch = withBranch.nodes.find((n) => n.node_type === "decision");
    expect(branch?.id).toBe("__branch__t1");
    expect(withBranch.edges.some((e) => e.source_node_id === "t1" && e.target_node_id === "__branch__t1")).toBe(true);
    expect(withBranch.edges.some((e) => e.source_node_id === "__branch__t1" && e.target_node_id === "t2")).toBe(true);
    expect(removeBranch(withBranch, "__branch__t1")).toEqual(base);
  });
  it("connectNodes ignores duplicates, setEdgeLabel and removeEdge are immutable", () => {
    const same = connectNodes(base, "t1", "t2");
    expect(same.edges).toHaveLength(3);
    const labeled = setEdgeLabel(base, "e1", "승인");
    expect(labeled.edges[1].label).toBe("승인");
    expect(base.edges[1].label).toBe("");
    expect(removeEdge(base, "e1").edges.map((e) => e.id)).toEqual(["e0", "e2"]);
  });
  it("preserves gateway through the canvas → flow → canvas round trip", () => {
    const withGateway: FwCanvas = {
      ...base,
      edges: base.edges.map((e) => (e.id === "e1" ? { ...e, gateway: "parallel" as const } : e)),
    };
    const flow = canvasToFlow(withGateway);
    const e1 = flow.edges.find((e) => e.id === "e1");
    expect(e1?.data).toEqual({ gateway: "parallel" });
    const e0 = flow.edges.find((e) => e.id === "e0");
    expect(e0?.data).toBeUndefined();
    const roundTripped = flowToCanvas(flow.nodes, flow.edges, withGateway);
    expect(roundTripped).toEqual(withGateway);
    const roundTrippedE1 = roundTripped.edges.find((e) => e.id === "e1");
    expect(roundTrippedE1?.gateway).toBe("parallel");
    const roundTrippedE0 = roundTripped.edges.find((e) => e.id === "e0");
    expect(roundTrippedE0).not.toHaveProperty("gateway");
  });
});

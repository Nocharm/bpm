import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { type AppNode, buildNodeData, type ProcessNodeType } from "./canvas";
import { autoLayoutFlow } from "./flow-layout";
import { deriveFlowSideHandles, toSideHandleEdges } from "./flow-side-handles";

const node = (id: string, type: ProcessNodeType, x: number, y: number): AppNode => ({
  id,
  type: "process",
  position: { x, y },
  data: { ...buildNodeData(type, id), sideHandles: true },
});
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target });

describe("toSideHandleEdges", () => {
  it("turns subprocess in-door and end-key handles into 4-side ids", () => {
    const [out] = toSideHandleEdges([{ ...edge("e", "a", "b"), sourceHandle: "Reject", targetHandle: "in:top" }]);
    expect(out.sourceHandle).toBe("s-right");
    expect(out.targetHandle).toBe("t-top");
  });
});

describe("deriveFlowSideHandles", () => {
  it("gives a loop-back the top sides instead of the forced right→left", () => {
    const nodes = [node("s", "start", 0, 0), node("a", "process", 200, 0), node("b", "process", 500, 0), node("e", "end", 800, 0)];
    const edges = [edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "b", "a"), edge("4", "b", "e")];
    const byId = new Map(deriveFlowSideHandles(nodes, edges).map((e) => [e.id, e]));
    expect(byId.get("2")).toMatchObject({ sourceHandle: "s-right", targetHandle: "t-left" });
    expect(byId.get("3")).toMatchObject({ sourceHandle: "s-top", targetHandle: "t-top" });
  });

  it("matches the handles autoLayoutFlow picked once the nodes sit at the laid-out positions", () => {
    const nodes = [node("s", "start", 0, 0), node("a", "subprocess", 0, 0), node("b", "subprocess", 0, 0), node("c", "subprocess", 0, 0), node("e", "end", 0, 0)];
    const edges = [edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "a", "c"), edge("4", "b", "e"), edge("5", "c", "e"), edge("6", "b", "a")];
    const laid = autoLayoutFlow(nodes, edges, "LR");
    const derived = deriveFlowSideHandles(laid.nodes, edges);
    expect(derived.map((e) => [e.sourceHandle, e.targetHandle])).toEqual(
      toSideHandleEdges(laid.edges).map((e) => [e.sourceHandle, e.targetHandle]),
    );
  });

  it("keeps a subprocess exit on the right even for a loop-back (one exit point contract)", () => {
    const nodes = [node("s", "start", 0, 0), node("a", "subprocess", 200, 0), node("b", "subprocess", 500, 0), node("e", "end", 800, 0)];
    const edges = [edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "b", "a"), edge("4", "b", "e")];
    const back = deriveFlowSideHandles(nodes, edges).find((e) => e.id === "3");
    expect(back).toMatchObject({ sourceHandle: "s-right", targetHandle: "t-top" });
  });
});

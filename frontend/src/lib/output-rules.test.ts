import { describe, expect, it } from "vitest";

import { applyParallelFlag, getOutputGroups, getOutputViolations } from "./output-rules";

const node = (id: string, nodeType: string, parallelOutputs?: string[]) => ({ id, nodeType, parallelOutputs });

describe("getOutputViolations", () => {
  it("flags a plain node with two outputs and reports the excess", () => {
    const violations = getOutputViolations(
      [node("A", "process")],
      [{ source: "A" }, { source: "A" }, { source: "A" }],
    );
    expect(violations).toEqual([{ nodeId: "A", excess: 2, shortParallel: 0 }]);
  });

  it("allows one output per subprocess end", () => {
    const violations = getOutputViolations(
      [node("S", "subprocess")],
      [
        { source: "S", sourceHandle: "__primary__" },
        { source: "S", sourceHandle: "Rejected" },
      ],
    );
    expect(violations).toEqual([]);
  });

  it("flags two outputs on the same subprocess end, counting legacy side ids as the primary end", () => {
    const violations = getOutputViolations(
      [node("S", "subprocess")],
      [
        { source: "S", sourceHandle: "__primary__" },
        { source: "S", sourceHandle: "s-right" },
        { source: "S", sourceHandle: "Rejected" },
      ],
    );
    expect(violations).toEqual([{ nodeId: "S", excess: 1, shortParallel: 0 }]);
  });

  it("exempts decision nodes", () => {
    expect(getOutputViolations([node("D", "decision")], [{ source: "D" }, { source: "D" }])).toEqual([]);
  });

  it("accepts a parallel output with two or more edges and flags one with a single edge", () => {
    const edges = [{ source: "A" }, { source: "A" }, { source: "B" }];
    const violations = getOutputViolations(
      [node("A", "process", ["__primary__"]), node("B", "process", ["__primary__"])],
      edges,
    );
    expect(violations).toEqual([{ nodeId: "B", excess: 0, shortParallel: 1 }]);
  });

  it("does not flag a parallel output with no edges yet", () => {
    expect(getOutputViolations([node("A", "process", ["__primary__"])], [])).toEqual([]);
  });

  it("applies parallel per subprocess end", () => {
    const violations = getOutputViolations(
      [node("S", "subprocess", ["__primary__"])],
      [
        { source: "S", sourceHandle: "__primary__" },
        { source: "S", sourceHandle: "__primary__" },
        { source: "S", sourceHandle: "Rejected" },
        { source: "S", sourceHandle: "Rejected" },
      ],
    );
    expect(violations).toEqual([{ nodeId: "S", excess: 1, shortParallel: 0 }]);
  });

  it("reads an all-parallel gateway fan-out as a parallel output without the attribute", () => {
    const legacy = [
      { source: "A", gateway: "parallel" },
      { source: "A", gateway: "parallel" },
    ];
    expect(getOutputViolations([node("A", "process")], legacy)).toEqual([]);
    const mixed = [{ source: "A", gateway: "parallel" }, { source: "A" }];
    expect(getOutputViolations([node("A", "process")], mixed)).toEqual([
      { nodeId: "A", excess: 1, shortParallel: 0 },
    ]);
  });
});

describe("getOutputGroups", () => {
  it("groups subprocess outputs by end key", () => {
    const groups = getOutputGroups(node("S", "subprocess"), [
      { source: "S", sourceHandle: "__primary__" },
      { source: "S", sourceHandle: "Hold" },
      { source: "S", sourceHandle: "Hold" },
      { source: "X", sourceHandle: "Hold" },
    ]);
    expect(groups).toEqual([
      { key: "__primary__", count: 1, parallel: false },
      { key: "Hold", count: 2, parallel: false },
    ]);
  });
});

describe("applyParallelFlag", () => {
  it("keeps the current value when the flag is omitted and only touches the main exit", () => {
    expect(applyParallelFlag(["Hold"], undefined)).toBeUndefined();
    expect(applyParallelFlag(["Hold"], true)).toEqual(["Hold", "__primary__"]);
    expect(applyParallelFlag(["Hold", "__primary__"], false)).toEqual(["Hold"]);
  });
});

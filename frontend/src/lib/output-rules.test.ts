import { describe, expect, it } from "vitest";

import {
  applyParallelFlag,
  getOutputGroups,
  getOutputViolations,
  getParallelOutputKeys,
  setOutputParallel,
} from "./output-rules";

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

  it("treats the start node as parallel by default and accepts one or more connections", () => {
    const start = node("S0", "start");
    expect(getOutputViolations([start], [{ source: "S0" }])).toEqual([]);
    expect(getOutputViolations([start], [{ source: "S0" }, { source: "S0" }, { source: "S0" }])).toEqual([]);
    expect(getOutputGroups(start, [{ source: "S0" }, { source: "S0" }])).toEqual([
      { key: "__primary__", count: 2, parallel: true },
    ]);
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

describe("getParallelOutputKeys", () => {
  it("includes flagged exits and exits derived parallel from legacy gateways", () => {
    const edges = [
      { source: "S", sourceHandle: "__primary__", gateway: "parallel" },
      { source: "S", sourceHandle: "__primary__", gateway: "parallel" },
      { source: "S", sourceHandle: "Hold", gateway: null },
    ];

    const keys = getParallelOutputKeys(node("S", "subprocess", ["Done"]), edges);

    expect(keys.sort()).toEqual(["Done", "__primary__"]);
  });
});

describe("setOutputParallel", () => {
  const edges = [
    { id: "e1", source: "A", sourceHandle: "s-right", gateway: "parallel" },
    { id: "e2", source: "A", sourceHandle: "s-bottom", gateway: "parallel" },
    { id: "e3", source: "B", sourceHandle: "s-right", gateway: "parallel" },
  ];

  it("adds the key without touching gateways when turned on", () => {
    const result = setOutputParallel(node("A", "process"), edges, "__primary__", true);

    expect(result).toEqual({ parallelOutputs: ["__primary__"], clearGatewayEdgeIds: [] });
  });

  it("removes the key and clears the exit's parallel gateways when turned off", () => {
    const result = setOutputParallel(node("A", "process", ["__primary__"]), edges, "__primary__", false);

    expect(result).toEqual({ parallelOutputs: [], clearGatewayEdgeIds: ["e1", "e2"] });
    // 소거 후엔 레거시 도출도 병렬이 아니라 출력 규칙 위반으로 잡힌다
    const cleared = edges.map((edge) =>
      result.clearGatewayEdgeIds.includes(edge.id) ? { ...edge, gateway: null } : edge,
    );
    expect(getOutputViolations([node("A", "process", result.parallelOutputs)], cleared)).toEqual([
      { nodeId: "A", excess: 1, shortParallel: 0 },
    ]);
  });

  it("only clears gateways on the toggled subprocess end", () => {
    const spEdges = [
      { id: "p1", source: "S", sourceHandle: "__primary__", gateway: "parallel" },
      { id: "h1", source: "S", sourceHandle: "Hold", gateway: "parallel" },
    ];

    const result = setOutputParallel(node("S", "subprocess", ["Hold"]), spEdges, "Hold", false);

    expect(result).toEqual({ parallelOutputs: [], clearGatewayEdgeIds: ["h1"] });
  });
});

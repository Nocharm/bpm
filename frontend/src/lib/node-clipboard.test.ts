import { beforeEach, describe, expect, it } from "vitest";

import { buildPaste, pickParallelForCopy, readClipboard, writeClipboard, type NodeClipboard } from "@/lib/node-clipboard";
import { getOutputViolations } from "@/lib/output-rules";
import type { NodeData } from "@/lib/canvas";

function mkData(label: string): NodeData {
  return { label, description: "", nodeType: "process", color: "", assignee: "", department: "",
    system: "", duration: "", groupIds: [], hasChildren: false } as NodeData;
}

const sample: NodeClipboard = {
  sourceMapId: 1,
  nodes: [
    { id: "a", position: { x: 0, y: 0 }, data: mkData("A") },
    { id: "b", position: { x: 40, y: 0 }, data: mkData("B") },
  ],
  edges: [{ source: "a", target: "b" }],
};

describe("clipboard read/write (localStorage)", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a payload", () => {
    writeClipboard(sample);
    expect(readClipboard()).toEqual(sample);
  });
  it("returns null when empty or malformed", () => {
    expect(readClipboard()).toBeNull();
    localStorage.setItem("bpm.nodeClipboard", "{not json");
    expect(readClipboard()).toBeNull();
  });
});

describe("buildPaste", () => {
  it("regenerates ids, offsets positions, remaps internal edges, dedups labels", () => {
    let n = 0;
    const out = buildPaste(sample, { newId: () => `new${n++}`, existingLabels: ["A"], offset: { x: 16, y: 16 } });
    expect(out.nodes.map((x) => x.id)).toEqual(["new0", "new1"]);
    expect(out.nodes[0].position).toEqual({ x: 16, y: 16 });
    expect(out.nodes[1].position).toEqual({ x: 56, y: 16 });
    // A collides with existing → "A (2)"; B is free → "B"
    expect(out.nodes[0].data.label).toBe("A (2)");
    expect(out.nodes[1].data.label).toBe("B");
    // edge remapped to new ids
    expect(out.edges[0]).toMatchObject({ source: "new0", target: "new1" });
    expect(out.edges[0].id).toBe("new2");
  });

  it("preserves sourceHandle/targetHandle on the remapped edge", () => {
    const withHandles: NodeClipboard = {
      ...sample,
      edges: [{ source: "a", target: "b", sourceHandle: "s-right", targetHandle: "t-left" }],
    };
    let n = 0;
    const out = buildPaste(withHandles, { newId: () => `new${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    expect(out.edges[0].sourceHandle).toBe("s-right");
    expect(out.edges[0].targetHandle).toBe("t-left");
  });

  it("leaves sourceHandle/targetHandle undefined when the source edge has none", () => {
    let n = 0;
    const out = buildPaste(sample, { newId: () => `new${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    expect(out.edges[0].sourceHandle).toBeUndefined();
    expect(out.edges[0].targetHandle).toBeUndefined();
  });

  it("clears isPrimaryEnd on copies so pasting the representative end doesn't duplicate it", () => {
    const endClip: NodeClipboard = {
      sourceMapId: 1,
      nodes: [
        { id: "e", position: { x: 0, y: 0 }, data: { ...mkData("End"), nodeType: "end", isPrimaryEnd: true } },
      ],
      edges: [],
    };
    let n = 0;
    const out = buildPaste(endClip, { newId: () => `new${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    expect(out.nodes[0].data.isPrimaryEnd).toBe(false);
  });

  it("clears output_ids on copies (itemId dedup) but keeps *_links/input_flags (io-linking §6)", () => {
    const ioClip: NodeClipboard = {
      sourceMapId: 1,
      nodes: [
        { id: "a", position: { x: 0, y: 0 }, data: { ...mkData("A"), output_ids: "itm_1", output_links: "itm_5", input_flags: "optional" } },
      ],
      edges: [],
    };
    let n = 0;
    const out = buildPaste(ioClip, { newId: () => `new${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    expect(out.nodes[0].data.output_ids).toBe("");
    expect(out.nodes[0].data.output_links).toBe("itm_5");
    expect(out.nodes[0].data.input_flags).toBe("optional");
  });
});

describe("buildPaste - 병렬 출구", () => {
  it("clears parallel on a lone copy but keeps it when two branches are copied along", () => {
    const parallel = { ...mkData("P"), parallelOutputs: ["__primary__"] } as NodeData;
    const lone: NodeClipboard = { sourceMapId: 1, nodes: [{ id: "p", position: { x: 0, y: 0 }, data: parallel }], edges: [] };
    let n = 0;
    expect(buildPaste(lone, { newId: () => `n${n++}`, existingLabels: [], offset: { x: 0, y: 0 } }).nodes[0].data.parallelOutputs).toEqual([]);

    const bundle: NodeClipboard = {
      sourceMapId: 1,
      nodes: [
        { id: "p", position: { x: 0, y: 0 }, data: parallel },
        { id: "b", position: { x: 40, y: 0 }, data: mkData("B") },
        { id: "c", position: { x: 40, y: 40 }, data: mkData("C") },
      ],
      edges: [{ source: "p", target: "b" }, { source: "p", target: "c" }],
    };
    const pasted = buildPaste(bundle, { newId: () => `m${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    expect(pasted.nodes.find((node) => node.data.label.startsWith("P"))?.data.parallelOutputs).toEqual(["__primary__"]);
  });
});

describe("buildPaste - 엣지 gateway 이월", () => {
  it("carries gateway onto pasted edges and leaves it undefined for an old clipboard", () => {
    const withGateway: NodeClipboard = { ...sample, edges: [{ source: "a", target: "b", gateway: "parallel" }] };
    let n = 0;
    const out = buildPaste(withGateway, { newId: () => `n${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    expect(out.edges[0].gateway).toBe("parallel");

    const legacyClip = buildPaste(sample, { newId: () => `m${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    expect(legacyClip.edges[0].gateway).toBeUndefined();
  });

  it("promotes a legacy gateway-only parallel exit to the flag when two branches are copied along", () => {
    // Arrange — 속성 없이 엣지 gateway="parallel"로만 병렬인 레거시 출발 노드
    const legacy: NodeClipboard = {
      sourceMapId: 1,
      nodes: [
        { id: "p", position: { x: 0, y: 0 }, data: mkData("P") },
        { id: "b", position: { x: 40, y: 0 }, data: mkData("B") },
        { id: "c", position: { x: 40, y: 40 }, data: mkData("C") },
      ],
      edges: [
        { source: "p", target: "b", gateway: "parallel" },
        { source: "p", target: "c", gateway: "parallel" },
      ],
    };
    let n = 0;
    // Act
    const out = buildPaste(legacy, { newId: () => `n${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    // Assert — 사본 출발 노드가 병렬로 읽혀 출력 규칙 위반이 없다
    const copyP = out.nodes.find((node) => node.data.label === "P");
    expect(copyP?.data.parallelOutputs).toEqual(["__primary__"]);
    const checkNodes = out.nodes.map((node) => ({ id: node.id, nodeType: node.data.nodeType, parallelOutputs: node.data.parallelOutputs }));
    expect(getOutputViolations(checkNodes, out.edges)).toEqual([]);
  });

  it("clears a legacy parallel exit when only one branch is copied along", () => {
    const oneBranch: NodeClipboard = {
      sourceMapId: 1,
      nodes: [
        { id: "p", position: { x: 0, y: 0 }, data: mkData("P") },
        { id: "b", position: { x: 40, y: 0 }, data: mkData("B") },
      ],
      edges: [
        { source: "p", target: "b", gateway: "parallel" },
        { source: "p", target: "c", gateway: "parallel" },
      ],
    };
    let n = 0;
    const out = buildPaste(oneBranch, { newId: () => `n${n++}`, existingLabels: [], offset: { x: 0, y: 0 } });
    expect(out.nodes.find((node) => node.data.label === "P")?.data.parallelOutputs).toEqual([]);
  });
});

describe("pickParallelForCopy", () => {
  const parallel = { ...mkData("P"), parallelOutputs: ["__primary__"] } as NodeData;

  it("returns [] for a lone copy and keeps the exit when two branches are duplicated together", () => {
    // Arrange
    const nodes = [
      { id: "p", data: parallel },
      { id: "b", data: mkData("B") },
      { id: "c", data: mkData("C") },
    ];
    const edges = [{ source: "p", target: "b" }, { source: "p", target: "c" }];
    // Act
    const lone = pickParallelForCopy([nodes[0]], edges);
    const bundle = pickParallelForCopy(nodes, edges);
    // Assert
    expect(lone.get("p")).toEqual([]);
    expect(bundle.get("p")).toEqual(["__primary__"]);
    expect(bundle.get("b")).toEqual([]);
  });

  it("keeps per-end keys of a subprocess only for ends with 2+ copied branches", () => {
    const sp = { ...mkData("SP"), nodeType: "subprocess", parallelOutputs: ["__primary__", "Rejected"] } as NodeData;
    const nodes = [
      { id: "s", data: sp },
      { id: "b", data: mkData("B") },
      { id: "c", data: mkData("C") },
      { id: "d", data: mkData("D") },
    ];
    const edges = [
      { source: "s", target: "b", sourceHandle: "__primary__" },
      { source: "s", target: "c", sourceHandle: "__primary__" },
      { source: "s", target: "d", sourceHandle: "Rejected" },
    ];
    expect(pickParallelForCopy(nodes, edges).get("s")).toEqual(["__primary__"]);
  });

  it("never sets parallel on decision or end copies", () => {
    const decision = { ...mkData("D"), nodeType: "decision", parallelOutputs: ["__primary__"] } as NodeData;
    const nodes = [
      { id: "d", data: decision },
      { id: "b", data: mkData("B") },
      { id: "c", data: mkData("C") },
    ];
    const edges = [
      { source: "d", target: "b", gateway: "parallel" },
      { source: "d", target: "c", gateway: "parallel" },
    ];
    expect(pickParallelForCopy(nodes, edges).get("d")).toEqual([]);
  });
});

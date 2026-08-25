import { beforeEach, describe, expect, it } from "vitest";

import { buildPaste, readClipboard, writeClipboard, type NodeClipboard } from "@/lib/node-clipboard";
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

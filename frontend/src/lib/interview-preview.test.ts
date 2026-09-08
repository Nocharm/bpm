import { describe, expect, it } from "vitest";

import {
  buildPreviewGraph,
  layoutPreviewGraph,
  PREVIEW_EXCEPTION_COLOR,
  PREVIEW_LOOP_BRANCH_NAME,
} from "./interview-preview";

const action = (seq: number, label: string, extra: Record<string, unknown> = {}) => ({
  seq, label, kind: "action", variant: "normal", ...extra,
});

const pairsOf = (graph: { edges: { source_node_id: string; target_node_id: string }[] }) =>
  graph.edges.map((e) => `${e.source_node_id}>${e.target_node_id}`);

describe("buildPreviewGraph", () => {
  it("returns null when the row has no actions", () => {
    expect(buildPreviewGraph(null)).toBeNull();
    expect(buildPreviewGraph({ taskId: "x" })).toBeNull();
    expect(buildPreviewGraph({ actions: [] })).toBeNull();
  });

  it("falls back to a seq chain wrapped in Start/End when relations are missing", () => {
    const graph = buildPreviewGraph({ actions: [action(1, "A"), action(2, "B")] });

    expect(graph?.nodes.map((n) => n.id)).toEqual(["__start__", "a01", "a02", "__end__"]);
    expect(pairsOf(graph!)).toEqual(["a01>a02", "__start__>a01", "a02>__end__"]);
    expect(graph?.nodes.find((n) => n.id === "__end__")?.is_primary_end).toBe(true);
  });

  it("promotes an exclusive branch source to decision and joins label + condition", () => {
    const graph = buildPreviewGraph({
      actions: [action(1, "A"), action(2, "B"), action(3, "C", { variant: "exception" })],
      relations: {
        edges: [
          { src: 1, dst: 2, kind: "branch", gateway: "exclusive", condition: "ok", label: "go" },
          { src: 1, dst: 3, kind: "branch", gateway: "exclusive", condition: "fail" },
        ],
      },
    });

    expect(graph?.nodes.find((n) => n.id === "a01")?.node_type).toBe("decision");
    expect(graph?.nodes.find((n) => n.id === "a03")?.color).toBe(PREVIEW_EXCEPTION_COLOR);
    expect(graph?.edges.find((e) => e.target_node_id === "a02")?.label).toBe("go\nok");
    expect(graph?.edges.find((e) => e.target_node_id === "a03")?.label).toBe("fail");
  });

  it("keeps a parallel fan-out source as a process node", () => {
    const graph = buildPreviewGraph({
      actions: [action(1, "A"), action(2, "B"), action(3, "C")],
      relations: {
        edges: [
          { src: 1, dst: 2, kind: "branch", gateway: "parallel" },
          { src: 1, dst: 3, kind: "branch", gateway: "parallel" },
        ],
      },
    });

    expect(graph?.nodes.find((n) => n.id === "a01")?.node_type).toBe("process");
  });

  it("turns a self edge into a synthesized loop branch right after its anchor", () => {
    const graph = buildPreviewGraph({
      actions: [action(1, "A"), action(2, "B"), action(3, "C")],
      relations: {
        edges: [
          { src: 1, dst: 2, kind: "seq" },
          { src: 2, dst: 3, kind: "seq" },
          { src: 2, dst: 2, kind: "loop", label: "redo" },
        ],
      },
    });

    expect(graph?.nodes.map((n) => n.id)).toEqual(["__start__", "a01", "a02", "a02r", "a03", "__end__"]);
    expect(graph?.nodes.find((n) => n.id === "a02r")).toMatchObject({
      node_type: "decision",
      title: PREVIEW_LOOP_BRANCH_NAME,
    });
    const pairs = pairsOf(graph!);
    expect(pairs).toContain("a02>a02r");
    expect(pairs).toContain("a02r>a02");
    expect(pairs).toContain("a02r>a03"); // B의 진출은 ◇로 이설
    expect(pairs).not.toContain("a02>a03");
    expect(pairs).toContain("a03>__end__");
    expect(graph?.edges.find((e) => e.source_node_id === "a02r" && e.target_node_id === "a02")?.label).toBe("redo");
  });

  it("drops edges to unknown seqs and duplicate pairs, then still wires Start/End", () => {
    const graph = buildPreviewGraph({
      actions: [action(1, "A"), action(2, "B")],
      relations: {
        edges: [
          { src: 1, dst: 2, kind: "seq" },
          { src: 1, dst: 2, kind: "seq" },
          { src: 2, dst: 9, kind: "seq" },
        ],
      },
    });

    expect(pairsOf(graph!)).toEqual(["a01>a02", "__start__>a01", "a02>__end__"]);
  });
});

describe("layoutPreviewGraph", () => {
  it("lays the chain out left to right", () => {
    const graph = layoutPreviewGraph(
      buildPreviewGraph({ actions: [action(1, "A"), action(2, "B"), action(3, "C")] })!,
    );
    const x = (id: string) => graph.nodes.find((n) => n.id === id)!.pos_x;

    expect(x("__start__")).toBeLessThan(x("a01"));
    expect(x("a01")).toBeLessThan(x("a02"));
    expect(x("a02")).toBeLessThan(x("a03"));
    expect(x("a03")).toBeLessThan(x("__end__"));
  });
});

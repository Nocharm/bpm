import { describe, expect, it } from "vitest";

import {
  buildL5PreviewGraph,
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

describe("buildL5PreviewGraph", () => {
  const rows = (...codes: [string, string][]) => codes.map(([taskId, l6]) => ({ taskId, l6 }));

  it("returns null without usable rows", () => {
    expect(buildL5PreviewGraph(null)).toBeNull();
    expect(buildL5PreviewGraph({ rows: [] })).toBeNull();
    expect(buildL5PreviewGraph({ rows: [{ l6: "코드 없음" }] })).toBeNull();
  });

  it("chains rows in order when the file declares no L5 relations", () => {
    const graph = buildL5PreviewGraph({ rows: rows(["t1", "준비"], ["t2", "수행"]) });

    expect(graph?.nodes.map((n) => n.id)).toEqual(["__start__", "t1", "t2", "__end__"]);
    expect(graph?.nodes.find((n) => n.id === "t1")?.node_type).toBe("subprocess");
    expect(pairsOf(graph!)).toEqual(["t1>t2", "__start__>t1", "t2>__end__"]);
  });

  it("names undeclared endpoints by code and declared externals by their L5 label", () => {
    const graph = buildL5PreviewGraph({
      rows: rows(["t1", "준비"]),
      externalTasks: [{ refId: "ext-a", l6: "작업지시 발행", l5: { label: "설비 작업지시 운영" } }],
      relations: { edges: [{ src: "t1", dst: "ext-a" }, { src: "ext-a", dst: "ghost-code" }] },
    });

    const titleOf = (id: string) => graph?.nodes.find((n) => n.id === id)?.title;
    expect(titleOf("ext-a")).toBe("작업지시 발행 (설비 작업지시 운영)");
    expect(titleOf("ghost-code")).toBe("ghost-code"); // 미선언 끝점은 코드 그대로
  });

  it("inserts a branch node before an exclusive fan-out but not a parallel one", () => {
    const fanout = buildL5PreviewGraph({
      rows: rows(["t1", "준비"], ["t2", "수행"], ["t3", "보고"]),
      relations: {
        edges: [
          { src: "t1", dst: "t2", kind: "branch", gateway: "exclusive" },
          { src: "t1", dst: "t3", kind: "bypass" },
        ],
      },
    });
    expect(fanout?.nodes.find((n) => n.id === "t1__b")?.node_type).toBe("decision");
    expect(pairsOf(fanout!)).toContain("t1>t1__b");
    expect(pairsOf(fanout!)).toEqual(expect.arrayContaining(["t1__b>t2", "t1__b>t3"]));
    expect(pairsOf(fanout!)).not.toContain("t1>t2");

    // 병행 팬아웃은 택일이 아니라 마름모를 세우면 오독된다 — 백엔드 expand_linkage_branches와 같은 판단
    const parallel = buildL5PreviewGraph({
      rows: rows(["t1", "준비"], ["t2", "수행"], ["t3", "보고"]),
      relations: {
        edges: [
          { src: "t1", dst: "t2", kind: "branch", gateway: "parallel" },
          { src: "t1", dst: "t3", kind: "branch", gateway: "parallel" },
        ],
      },
    });
    expect(parallel?.nodes.some((n) => n.id === "t1__b")).toBe(false);
    expect(pairsOf(parallel!)).toEqual(expect.arrayContaining(["t1>t2", "t1>t3"]));
  });

  it("labels a fan-out that loops back with the auto-generated branch name", () => {
    const graph = buildL5PreviewGraph({
      rows: rows(["t1", "준비"], ["t2", "수행"]),
      relations: {
        edges: [
          { src: "t2", dst: "t1", kind: "loop", condition: "표준기 교체 후 재수행" },
          { src: "t2", dst: "t1", kind: "loop" },
          { src: "t2", dst: "t3", kind: "branch", gateway: "exclusive" },
        ],
      },
    });

    expect(graph?.nodes.find((n) => n.id === "t2__b")?.title).toBe(PREVIEW_LOOP_BRANCH_NAME);
    // 같은 (src, dst) 쌍은 한 번만 — 중복 선언은 버린다
    expect(pairsOf(graph!).filter((p) => p === "t2__b>t1")).toHaveLength(1);
  });
});

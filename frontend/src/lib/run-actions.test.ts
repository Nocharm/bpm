// 실행 모드 노드 버튼 줄 순수 계산(lib/run-actions) 테스트 — 상태별 버튼(목업 buildBarHtml), 갈래·출구 이름, 이어 밟기,
// 먼저 끝낼 단계의 노드 키, 하위 범위 잠김·기록 판정, 버튼 줄·팝오버 자리(목업 placeBar).

import { describe, expect, it } from "vitest";

import type { RunDetail, RunNodeState } from "@/lib/api";
import {
  buildRunBarButtons,
  findRunBlockerKeys,
  getBranchLabel,
  getExitLabels,
  getRunScopeHostKeys,
  getRunScopeLock,
  hasRunChildProgress,
  pickAutoAdvance,
  placeRunBar,
  placeRunPop,
  type RunBarButton,
  type RunBarInput,
} from "@/lib/run-actions";
import type { RunGraph, RunGraphEdge, RunGraphNode } from "@/lib/run-graph";
import { buildRunView } from "@/lib/run-view";

function makeInput(overrides: Partial<RunBarInput> = {}): RunBarInput {
  return {
    status: "ready",
    nodeType: "process",
    options: { kind: "none" },
    branchLabels: {},
    exitLabels: {},
    runOpen: true,
    canAct: true,
    commentCount: 0,
    parentBlocked: false,
    scopeClosed: false,
    ...overrides,
  };
}

// 버튼을 한눈에 비교할 꼴로 — 동작은 `action:tone[:label]`, 나머지는 종류 이름
function describeButtons(buttons: RunBarButton[]): string[] {
  return buttons.map((button) => {
    if (button.kind === "action") return [button.action, button.tone, button.label].filter(Boolean).join(":");
    if (button.kind === "comments") return `comments:${button.count}`;
    if (button.kind === "note") return `note:${button.messageKey}`;
    return button.kind;
  });
}

function makeNode(id: string, nodeType = "process", title = id): RunGraphNode {
  return { id, nodeType, title, isPrimaryEnd: false, parallelOutputs: [] };
}

function makeEdge(id: string, source: string, target: string, label = "", sourceHandle: string | null = null): RunGraphEdge {
  return { id, source, target, sourceHandle, label, gateway: null };
}

function makeDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: 7,
    map_id: 10,
    map_name: "원자재 입고 검사",
    version_id: 100,
    version_number: 4,
    version_label: "v4",
    version_is_current: true,
    name: "11월 1차 입고",
    scope: "solo",
    starter: "me",
    status: "open",
    end_reason: null,
    keep: false,
    created_at: "2026-11-04T09:00:00+09:00",
    last_activity_at: "2026-11-04T09:00:00+09:00",
    ended_at: null,
    summarize_after: null,
    participants: [],
    progress: { done: 0, total: 0 },
    problem_count: 0,
    summary: null,
    states: [],
    scopes: [],
    comment_counts: [],
    can_act: true,
    can_manage: true,
    can_keep: true,
    ...overrides,
  };
}

function makeState(scopePath: string, nodeId: string, status: RunNodeState["status"]): RunNodeState {
  return {
    scope_path: scopePath,
    node_id: nodeId,
    node_title: nodeId,
    status,
    chosen_edge_id: null,
    exit_key: null,
    updated_by: "me",
    updated_at: "2026-11-04T10:00:00+09:00",
  };
}

describe("buildRunBarButtons", () => {
  it("ready step: complete, start, problem, then comments", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ commentCount: 2 })))).toEqual([
      "complete:go",
      "start:default",
      "problem:bad",
      "comments:2",
    ]);
  });

  it("active step: complete, problem, undo start", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ status: "active" })))).toEqual([
      "complete:go",
      "problem:bad",
      "unstart:quiet",
      "comments:0",
    ]);
  });

  it("problem step: resolve, then complete", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ status: "problem" })))).toEqual([
      "resolve:branch",
      "complete:default",
      "comments:0",
    ]);
  });

  it("done subprocess: view the sub map, undo complete", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ status: "done", nodeType: "subprocess" })))).toEqual([
      "enter",
      "undo:quiet",
      "comments:0",
    ]);
  });

  it("waiting step: the switched-off complete opens why", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ status: "waiting" })))).toEqual(["why", "comments:0"]);
  });

  it("ready decision: one button per branch name instead of complete", () => {
    const buttons = buildRunBarButtons(
      makeInput({
        nodeType: "decision",
        options: { kind: "edge", edgeIds: ["e3", "e4"] },
        branchLabels: { e3: "예", e4: "아니오" },
      }),
    );
    expect(describeButtons(buttons)).toEqual([
      "complete:branch:예",
      "complete:branch:아니오",
      "start:default",
      "problem:bad",
      "comments:0",
    ]);
    expect(buttons[0]).toMatchObject({ kind: "action", edgeId: "e3" });
    expect(buttons[1]).toMatchObject({ kind: "action", edgeId: "e4" });
  });

  it("problem decision keeps the branch buttons after resolve", () => {
    const buttons = buildRunBarButtons(
      makeInput({
        status: "problem",
        nodeType: "decision",
        options: { kind: "edge", edgeIds: ["e3", "e4"] },
        branchLabels: { e3: "예", e4: "아니오" },
      }),
    );
    expect(describeButtons(buttons)).toEqual([
      "resolve:branch",
      "complete:default:예",
      "complete:default:아니오",
      "comments:0",
    ]);
  });

  it("ready subprocess with two exits: one button per exit, then enter", () => {
    const buttons = buildRunBarButtons(
      makeInput({
        nodeType: "subprocess",
        options: { kind: "exit", exitKeys: ["__primary__", "반려"] },
        exitLabels: { __primary__: "적합", 반려: "반려" },
      }),
    );
    expect(describeButtons(buttons)).toEqual([
      "complete:branch:적합",
      "complete:branch:반려",
      "enter",
      "start:default",
      "problem:bad",
      "comments:0",
    ]);
    expect(buttons[1]).toMatchObject({ kind: "action", exitKey: "반려" });
  });

  it("closed run: a note and comments to read", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ runOpen: false, canAct: false })))).toEqual([
      "note:run.act.noteClosed",
      "comments:0",
    ]);
  });

  it("start and end nodes: a note only", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ nodeType: "start", status: "done" })))).toEqual([
      "note:run.act.noteTerminal",
    ]);
    expect(describeButtons(buildRunBarButtons(makeInput({ nodeType: "end", status: "waiting" })))).toEqual([
      "note:run.act.noteTerminal",
    ]);
  });

  it("skipped step: why it was skipped, with comments", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ status: "skipped" })))).toEqual([
      "note:run.act.noteSkipped",
      "comments:0",
    ]);
    expect(
      describeButtons(buildRunBarButtons(makeInput({ status: "skipped", parentBlocked: true, scopeClosed: true }))),
    ).toEqual(["note:run.act.noteSkippedClosed", "comments:0"]);
  });

  it("sub map whose outer step is blocked or closed: a note and comments, no actions (R9)", () => {
    expect(
      describeButtons(buildRunBarButtons(makeInput({ status: "waiting", parentBlocked: true }))),
    ).toEqual(["note:run.act.noteParentBlocked", "comments:0"]);
    expect(
      describeButtons(buildRunBarButtons(makeInput({ status: "done", parentBlocked: true, scopeClosed: true }))),
    ).toEqual(["note:run.act.noteScopeClosed", "comments:0"]);
  });

  it("someone outside the run keeps only the non-action buttons", () => {
    expect(describeButtons(buildRunBarButtons(makeInput({ canAct: false, commentCount: 1 })))).toEqual([
      "comments:1",
    ]);
    expect(describeButtons(buildRunBarButtons(makeInput({ canAct: false, status: "waiting" })))).toEqual([
      "why",
      "comments:0",
    ]);
  });
});

describe("getBranchLabel", () => {
  const graph: RunGraph = {
    nodes: [makeNode("d", "decision"), makeNode("b", "process", "반품 처리"), makeNode("c", "process", "")],
    edges: [makeEdge("e1", "d", "b", "예"), makeEdge("e2", "d", "b"), makeEdge("e3", "d", "c")],
  };

  it("uses the edge label first", () => {
    expect(getBranchLabel(graph.edges[0], graph)).toBe("예");
  });

  it("falls back to the target title when the label is empty", () => {
    expect(getBranchLabel(graph.edges[1], graph)).toBe("반품 처리");
  });

  it("falls back to an arrow when the target has no title either", () => {
    expect(getBranchLabel(graph.edges[2], graph)).toBe("→");
  });
});

describe("getExitLabels", () => {
  const graph: RunGraph = {
    nodes: [makeNode("sp", "subprocess", "품질 시험"), makeNode("x"), makeNode("y"), makeNode("z")],
    edges: [
      makeEdge("ep", "sp", "x", "", "__primary__"),
      makeEdge("er", "sp", "y", "재시험", "반려"),
      makeEdge("eh", "sp", "z", "", "보류"),
    ],
  };

  it("prefers the edge label, then the end title, then the exit key", () => {
    expect(getExitLabels(graph, "sp", ["__primary__", "반려", "보류"], { __primary__: "적합" })).toEqual({
      __primary__: "적합",
      반려: "재시험",
      보류: "보류",
    });
  });

  it("names an untitled primary end End", () => {
    expect(getExitLabels(graph, "sp", ["__primary__"], {})).toEqual({ __primary__: "End" });
  });
});

describe("pickAutoAdvance", () => {
  it("selects the only opened step", () => {
    expect(pickAutoAdvance(["b"])).toEqual({ select: "b", flash: [] });
  });

  it("flashes in place when several steps opened", () => {
    expect(pickAutoAdvance(["a", "b"])).toEqual({ select: null, flash: ["a", "b"] });
  });

  it("does nothing when nothing opened", () => {
    expect(pickAutoAdvance([])).toEqual({ select: null, flash: [] });
  });
});

describe("findRunBlockerKeys", () => {
  // s → f(병렬) → x, y → j — x는 진행 가능, y는 대기(앞 w가 진행 가능)
  const graph: RunGraph = {
    nodes: [makeNode("s", "start"), makeNode("f"), makeNode("x"), makeNode("w"), makeNode("y"), makeNode("j")],
    edges: [
      makeEdge("e1", "s", "f"),
      makeEdge("e2", "f", "x"),
      makeEdge("e3", "f", "w"),
      makeEdge("e4", "w", "y"),
      makeEdge("e5", "x", "j"),
      makeEdge("e6", "y", "j"),
    ],
  };
  const parallelGraph: RunGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === "f" ? { ...node, parallelOutputs: ["__primary__"] } : node)),
  };

  it("climbs past waiting steps to the ones that can move now, in topo order", () => {
    const detail = makeDetail({ states: [makeState("", "f", "done")] });
    const graphs = new Map([["", parallelGraph]]);
    const view = buildRunView(detail, graphs);
    expect(findRunBlockerKeys(detail, graphs, view, "j")).toEqual(["w", "x"]);
  });

  it("returns keys inside a child scope with the scope prefix", () => {
    const detail = makeDetail({
      states: [makeState("", "sp", "active"), makeState("sp", "f", "done")],
      scopes: [{ scope_path: "sp", version_id: 200, closed: false }],
    });
    const root: RunGraph = {
      nodes: [makeNode("rs", "start"), makeNode("sp", "subprocess"), makeNode("re", "end")],
      edges: [makeEdge("r1", "rs", "sp"), makeEdge("r2", "sp", "re")],
    };
    const graphs = new Map([
      ["", root],
      ["sp", parallelGraph],
    ]);
    const view = buildRunView(detail, graphs);
    expect(findRunBlockerKeys(detail, graphs, view, "sp/j")).toEqual(["sp/w", "sp/x"]);
  });

  it("is empty for a scope without a graph", () => {
    const detail = makeDetail();
    expect(findRunBlockerKeys(detail, new Map(), buildRunView(detail, new Map()), "j")).toEqual([]);
  });
});

describe("getRunScopeLock", () => {
  const root: RunGraph = {
    nodes: [makeNode("rs", "start"), makeNode("a"), makeNode("sp", "subprocess"), makeNode("re", "end")],
    edges: [makeEdge("r1", "rs", "a"), makeEdge("r2", "a", "sp"), makeEdge("r3", "sp", "re")],
  };
  const child: RunGraph = {
    nodes: [makeNode("cs", "start"), makeNode("c1"), makeNode("ce", "end")],
    edges: [makeEdge("c1e", "cs", "c1"), makeEdge("c2e", "c1", "ce")],
  };
  const graphs = new Map([
    ["", root],
    ["sp", child],
  ]);

  it("never locks the top scope", () => {
    const detail = makeDetail();
    expect(getRunScopeLock(detail, buildRunView(detail, graphs), "")).toEqual({
      parentBlocked: false,
      scopeClosed: false,
    });
  });

  it("locks a sub map whose host is still waiting", () => {
    const detail = makeDetail();
    expect(getRunScopeLock(detail, buildRunView(detail, graphs), "sp")).toEqual({
      parentBlocked: true,
      scopeClosed: false,
    });
  });

  it("opens a sub map whose host can move", () => {
    const detail = makeDetail({ states: [makeState("", "a", "done")] });
    expect(getRunScopeLock(detail, buildRunView(detail, graphs), "sp")).toEqual({
      parentBlocked: false,
      scopeClosed: false,
    });
  });

  it("locks a closed sub map and one whose host was completed without entering", () => {
    const pinned = makeDetail({
      states: [makeState("", "a", "done"), makeState("", "sp", "done")],
      scopes: [{ scope_path: "sp", version_id: 200, closed: true }],
    });
    expect(getRunScopeLock(pinned, buildRunView(pinned, graphs), "sp")).toEqual({
      parentBlocked: true,
      scopeClosed: true,
    });
    const unpinned = makeDetail({ states: [makeState("", "a", "done"), makeState("", "sp", "done")] });
    expect(getRunScopeLock(unpinned, buildRunView(unpinned, graphs), "sp")).toEqual({
      parentBlocked: true,
      scopeClosed: true,
    });
  });

  it("keeps a finished (not closed) sub map open for undo inside it", () => {
    const finished = makeDetail({
      states: [makeState("", "a", "done"), makeState("", "sp", "done"), makeState("sp", "c1", "done")],
      scopes: [{ scope_path: "sp", version_id: 200, closed: false }],
    });
    expect(getRunScopeLock(finished, buildRunView(finished, graphs), "sp")).toEqual({
      parentBlocked: false,
      scopeClosed: false,
    });
  });
});

describe("getRunScopeHostKeys", () => {
  it("lists the hosts to unfold, outermost first", () => {
    expect(getRunScopeHostKeys("")).toEqual([]);
    expect(getRunScopeHostKeys("h1")).toEqual(["h1"]);
    expect(getRunScopeHostKeys("h1/h2")).toEqual(["h1", "h1/h2"]);
  });
});

describe("hasRunChildProgress", () => {
  it("sees records in the sub map and the maps under it, not in siblings", () => {
    const detail = makeDetail({ states: [makeState("sp/inner", "c1", "done"), makeState("sp2", "c1", "done")] });
    expect(hasRunChildProgress(detail, "sp")).toBe(true);
    expect(hasRunChildProgress(detail, "sp2")).toBe(true);
    expect(hasRunChildProgress(detail, "s")).toBe(false);
    expect(hasRunChildProgress(makeDetail(), "sp")).toBe(false);
  });
});

describe("placeRunBar", () => {
  const pane = { width: 1000, height: 700 };
  const bar = { width: 200, height: 36 };

  it("sits above the node, centered", () => {
    expect(placeRunBar({ left: 400, top: 300, width: 160, height: 60 }, bar, pane)).toEqual({
      left: 380,
      top: 256,
      below: false,
    });
  });

  it("drops below the node when the top margin is under 40px", () => {
    expect(placeRunBar({ left: 400, top: 60, width: 160, height: 60 }, bar, pane)).toEqual({
      left: 380,
      top: 128,
      below: true,
    });
  });

  it("stays inside the pane horizontally", () => {
    expect(placeRunBar({ left: -50, top: 300, width: 100, height: 60 }, bar, pane).left).toBe(6);
    expect(placeRunBar({ left: 950, top: 300, width: 100, height: 60 }, bar, pane).left).toBe(794);
  });
});

describe("placeRunPop", () => {
  const pane = { width: 1000, height: 700 };
  const bar = { width: 200, height: 36 };
  const pop = { width: 300, height: 160 };

  it("goes under the node first", () => {
    const node = { left: 400, top: 300, width: 160, height: 60 };
    const barPos = placeRunBar(node, bar, pane);
    expect(placeRunPop(node, barPos, bar, pop, pane)).toEqual({ left: 330, top: 368 });
  });

  it("goes under the bar when the bar is below the node", () => {
    const node = { left: 400, top: 20, width: 160, height: 60 };
    const barPos = placeRunBar(node, bar, pane);
    expect(placeRunPop(node, barPos, bar, pop, pane)).toEqual({ left: 330, top: 130 });
  });

  it("moves to the right, then the left, then above the bar when there is no room below", () => {
    const low = { left: 400, top: 560, width: 160, height: 60 };
    const barPos = placeRunBar(low, bar, pane);
    expect(placeRunPop(low, barPos, bar, pop, pane)).toEqual({ left: 572, top: 510 });
    const lowRight = { left: 700, top: 560, width: 160, height: 60 };
    expect(placeRunPop(lowRight, placeRunBar(lowRight, bar, pane), bar, pop, pane)).toEqual({ left: 388, top: 510 });
    const wide = { width: 600, height: 700 };
    const middle = { left: 220, top: 560, width: 160, height: 60 };
    const middleBar = placeRunBar(middle, bar, wide);
    expect(placeRunPop(middle, middleBar, bar, pop, wide)).toEqual({ left: 150, top: middleBar.top - 160 - 6 });
  });
});

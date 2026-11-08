// 실행 화면 파생(lib/run-view)·실행 링크(lib/run-links) 테스트 — 노드 키·범위 상태·범위별 상태 색·연결선 종류·에러 문구.

import { MarkerType, type Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { ApiError, type FlatNode, type GraphEdge, type RunDetail, type RunNodeState } from "@/lib/api";
import { messages, type MessageKey } from "@/lib/i18n-messages";
import type { RunGraph } from "@/lib/run-graph";
import { buildMapVersionHref, buildRunHref, readRunIdParam, readVersionIdParam } from "@/lib/run-links";
import {
  applyRunBranchPreview,
  applyRunEdgeKind,
  buildRunScopeStates,
  buildRunView,
  formatRunPeriod,
  formatRunSummaryParts,
  formatSummaryCountdown,
  getRunCapKind,
  getRunMenuDisabledReason,
  getRunTouchedAfterTitle,
  getRunWatermarkFontSize,
  humanizeRunError,
  isRunSubProgressError,
  splitRunNodeKey,
  splitRunScopeGraphs,
  toRunNodeKey,
  validateRunLimits,
  type RunLimitsDraft,
} from "@/lib/run-view";

// 실제 ko 문구로 해석 — 문구 키가 빠지면 key가 그대로 나와 테스트가 잡는다
function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text: string = messages.ko[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

// 영어 문구로도 같은 함수가 읽히는지 본다
function tEn(key: MessageKey, vars?: Record<string, string | number>): string {
  let text: string = messages.en[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
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
    scope: "shared",
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

function makeState(
  scopePath: string,
  nodeId: string,
  status: RunNodeState["status"],
  extra: Partial<RunNodeState> = {},
): RunNodeState {
  return {
    scope_path: scopePath,
    node_id: nodeId,
    node_title: nodeId,
    status,
    chosen_edge_id: null,
    exit_key: null,
    updated_by: "me",
    updated_at: "2026-11-04T09:00:00+09:00",
    ...extra,
  };
}

function makeRunGraph(nodes: [string, string][], edges: [string, string, string][]): RunGraph {
  return {
    nodes: nodes.map(([id, nodeType]) => ({ id, nodeType, title: id, isPrimaryEnd: nodeType === "end", parallelOutputs: [] })),
    edges: edges.map(([id, source, target]) => ({ id, source, target, sourceHandle: null, label: "", gateway: null })),
  };
}

// 최상위: s → a → h(하위프로세스) → e, 하위 맵 h: s2 → b → e2
const ROOT = makeRunGraph(
  [["s", "start"], ["a", "process"], ["h", "subprocess"], ["e", "end"]],
  [["r1", "s", "a"], ["r2", "a", "h"], ["r3", "h", "e"]],
);
const SUB = makeRunGraph(
  [["s2", "start"], ["b", "process"], ["e2", "end"]],
  [["x1", "s2", "b"], ["x2", "b", "e2"]],
);

describe("run node keys", () => {
  it("joins a scope path and a node id like the editor's embedded ids", () => {
    expect(toRunNodeKey("12/34", "n5")).toBe("12/34/n5");
    expect(toRunNodeKey("", "n5")).toBe("n5");
  });

  it("splits a key at its last slash", () => {
    expect(splitRunNodeKey("12/34/n5")).toEqual({ scopePath: "12/34", nodeId: "n5" });
    expect(splitRunNodeKey("n5")).toEqual({ scopePath: "", nodeId: "n5" });
  });
});

describe("buildRunScopeStates", () => {
  it("turns state rows into manual, choice and exit per scope", () => {
    const detail = makeDetail({
      states: [
        makeState("", "a", "done"),
        makeState("", "d", "done", { chosen_edge_id: "e7" }),
        makeState("h", "b", "active"),
        makeState("", "h", "done", { exit_key: "__primary__" }),
      ],
      scopes: [{ scope_path: "h", version_id: 200, closed: true }],
    });
    const states = buildRunScopeStates(detail);
    expect(states.get("")).toEqual({
      manual: { a: "done", d: "done", h: "done" },
      choice: { d: "e7" },
      exit: { h: "__primary__" },
      closed: false,
    });
    expect(states.get("h")).toEqual({ manual: { b: "active" }, choice: {}, exit: {}, closed: true });
  });

  it("closes the root scope of a stopped run", () => {
    const states = buildRunScopeStates(makeDetail({ status: "stopped" }));
    expect(states.get("")?.closed).toBe(true);
  });

  it("closes the root scope of a summarized run", () => {
    const states = buildRunScopeStates(makeDetail({ status: "summarized" }));
    expect(states.get("")?.closed).toBe(true);
  });
});

describe("buildRunView of a summarized run", () => {
  it("shows no open step and no flowing path, sub maps included", () => {
    // 요약된 실행은 상태·범위 행을 지운 뒤라 기록이 없다 — 새 실행처럼 첫 단계가 열려 보이면 안 된다
    const detail = makeDetail({ status: "summarized", can_act: false, can_keep: false });
    const view = buildRunView(detail, new Map([["", ROOT], ["h", SUB]]));
    const statuses = [...view.statusByKey.values()];
    const kinds = [...view.edgeKindByKey.values()];
    expect(statuses).not.toContain("ready");
    expect(statuses).not.toContain("active");
    expect(kinds).not.toContain("now");
    expect(view.statusByKey.get("a")).toBe("skipped");
    expect(view.statusByKey.get("h/b")).toBe("skipped");
  });
});

describe("buildRunView", () => {
  it("keys sub-map nodes and edges as {host}/{id} and counts root progress", () => {
    const detail = makeDetail({
      states: [makeState("", "a", "done"), makeState("", "h", "active"), makeState("h", "b", "done")],
      scopes: [{ scope_path: "h", version_id: 200, closed: false }],
    });
    const view = buildRunView(detail, new Map([["", ROOT], ["h", SUB]]));
    expect(view.statusByKey.get("a")).toBe("done");
    expect(view.statusByKey.get("h")).toBe("active");
    expect(view.statusByKey.get("e")).toBe("waiting");
    expect(view.statusByKey.get("h/b")).toBe("done");
    expect(view.statusByKey.get("h/e2")).toBe("done");
    expect(view.edgeKindByKey.get("r1")).toBe("past");
    expect(view.edgeKindByKey.get("r2")).toBe("now");
    expect(view.edgeKindByKey.get("r3")).toBe("fut");
    expect(view.edgeKindByKey.get("h/x1")).toBe("past");
    expect(view.progress).toEqual({ done: 1, total: 2 });
  });

  it("skips the remaining steps of a sub map whose host was completed without entering it", () => {
    const detail = makeDetail({ states: [makeState("", "a", "done"), makeState("", "h", "done")] });
    const view = buildRunView(detail, new Map([["", ROOT], ["h", SUB]]));
    expect(view.statusByKey.get("h/b")).toBe("skipped");
    expect(view.edgeKindByKey.get("h/x1")).toBe("skip");
  });

  it("reads every step under a waiting host as waiting, nested maps included, with no flowing path", () => {
    // 최상위 h는 a가 진행 가능이라 대기, h 안의 g(하위프로세스) 아래 손자 맵까지 같은 규칙
    const child = makeRunGraph(
      [["s2", "start"], ["g", "subprocess"], ["e2", "end"]],
      [["x1", "s2", "g"], ["x2", "g", "e2"]],
    );
    const grandchild = makeRunGraph([["s3", "start"], ["c", "process"]], [["y1", "s3", "c"]]);
    const view = buildRunView(makeDetail(), new Map([["", ROOT], ["h", child], ["h/g", grandchild]]));
    expect(view.statusByKey.get("h")).toBe("waiting");
    expect(view.statusByKey.get("h/g")).toBe("waiting");
    expect(view.statusByKey.get("h/e2")).toBe("waiting");
    expect(view.statusByKey.get("h/g/c")).toBe("waiting");
    expect(view.statusByKey.get("h/s2")).toBe("done");
    expect(view.edgeKindByKey.get("h/x1")).toBe("fut");
    expect(view.edgeKindByKey.get("h/g/y1")).toBe("fut");
    const childKinds = [...view.edgeKindByKey].filter(([key]) => key.startsWith("h/")).map(([, kind]) => kind);
    expect(childKinds).not.toContain("now");
  });

  it("reads every step under a skipped host as skipped, even pinned ones", () => {
    // 최상위: s → d(판단) → h | c, 판단에서 c를 골라 h가 건너뜀
    const root = makeRunGraph(
      [["s", "start"], ["d", "decision"], ["h", "subprocess"], ["c", "process"], ["e", "end"]],
      [["r1", "s", "d"], ["ry", "d", "h"], ["rn", "d", "c"], ["r2", "h", "e"], ["r3", "c", "e"]],
    );
    const detail = makeDetail({
      states: [makeState("", "d", "done", { chosen_edge_id: "rn" }), makeState("h", "b", "done")],
      scopes: [{ scope_path: "h", version_id: 200, closed: false }],
    });
    const view = buildRunView(detail, new Map([["", root], ["h", SUB]]));
    expect(view.statusByKey.get("h")).toBe("skipped");
    expect(view.statusByKey.get("h/b")).toBe("skipped");
    expect(view.statusByKey.get("h/e2")).toBe("skipped");
    expect(view.edgeKindByKey.get("h/x1")).toBe("skip");
    expect(view.edgeKindByKey.get("h/x2")).toBe("skip");
  });

  it("leaves out scopes whose graph has not arrived", () => {
    const detail = makeDetail({
      states: [makeState("h", "b", "done")],
      scopes: [{ scope_path: "h", version_id: 200, closed: false }],
    });
    const view = buildRunView(detail, new Map([["", ROOT]]));
    expect(view.statusByKey.has("h/b")).toBe(false);
    expect(view.statusByKey.get("a")).toBe("ready");
  });

  it("falls back to the server progress when the root graph is missing", () => {
    const view = buildRunView(makeDetail({ progress: { done: 3, total: 9 } }), new Map());
    expect(view.progress).toEqual({ done: 3, total: 9 });
  });
});

function makeFlatNode(id: string, nodeType: string, parent: string | null): FlatNode {
  return {
    id,
    title: id,
    description: "",
    node_type: nodeType,
    color: "",
    assignee: "",
    department: "",
    system: "",
    duration: "",
    pos_x: 0,
    pos_y: 0,
    sort_order: 0,
    group_ids: [],
    linked_map_id: null,
    follow_latest: true,
    linked_version_id: null,
    is_primary_end: nodeType === "end",
    parent_node_id: parent,
    source_node_id: null,
  };
}

function makeGraphEdge(id: string, source: string, target: string): GraphEdge {
  return {
    id,
    source_node_id: source,
    target_node_id: target,
    label: "",
    source_side: "right",
    target_side: "left",
    source_handle: null,
    target_handle: null,
    line_style: "",
  };
}

describe("splitRunScopeGraphs", () => {
  it("splits the editor composite tree into per-scope graphs with original ids", () => {
    const graphs = splitRunScopeGraphs({
      nodes: [
        makeFlatNode("s", "start", null),
        makeFlatNode("h", "subprocess", null),
        makeFlatNode("h/s2", "start", "h"),
        makeFlatNode("h/b", "process", "h"),
      ],
      edges: [makeGraphEdge("r1", "s", "h"), makeGraphEdge("h/x1", "h/s2", "h/b")],
    });
    expect([...graphs.keys()].sort()).toEqual(["", "h"]);
    expect(graphs.get("h")?.nodes.map((n) => n.id)).toEqual(["s2", "b"]);
    expect(graphs.get("h")?.edges).toEqual([
      { id: "x1", source: "s2", target: "b", sourceHandle: null, label: "", gateway: null },
    ]);
    expect(graphs.get("")?.edges.map((e) => e.id)).toEqual(["r1"]);
  });
});

describe("applyRunEdgeKind", () => {
  const edge: Edge = { id: "r2", source: "a", target: "h", animated: true, style: { opacity: 0.4 } };

  it("paints the next path with the light base, an accent flow and no marching dashes", () => {
    const next = applyRunEdgeKind(edge, "now");
    expect(next.style).toMatchObject({ stroke: "var(--color-run-edge-now-base)", strokeWidth: 2, opacity: 0.4 });
    expect(next.markerEnd).toEqual({ type: MarkerType.ArrowClosed, color: "var(--color-run-edge-now-base)" });
    expect(next.data?.runFlow).toBe(true);
    expect(next.animated).toBe(false);
  });

  it("draws skipped edges faint and dashed", () => {
    const next = applyRunEdgeKind(edge, "skip");
    expect(next.style).toMatchObject({ stroke: "var(--color-run-edge-skip)", strokeWidth: 1.5, strokeDasharray: "4 4", opacity: 0.5 });
    expect(next.data?.runFlow).toBe(false);
  });

  it("leaves edges without a run kind alone", () => {
    expect(applyRunEdgeKind(edge, undefined)).toBe(edge);
  });
});

describe("applyRunBranchPreview", () => {
  const preview = { siblingKeys: new Set(["e-yes", "e-no"]), activeKeys: new Set(["e-yes"]) };
  const base = applyRunEdgeKind({ id: "e-yes", source: "d", target: "y" }, "fut");

  it("lights the pointed branch like the next path with a flow", () => {
    const next = applyRunBranchPreview(base, preview);
    expect(next.style).toMatchObject({ stroke: "var(--color-run-edge-now-base)", strokeWidth: 2.5, opacity: 1 });
    expect(next.data).toMatchObject({ runFlow: true, runPreview: "on" });
  });

  it("turns the other branches of that node off", () => {
    const other = applyRunBranchPreview({ ...base, id: "e-no" }, preview);
    expect(other.data).toMatchObject({ runFlow: false, runPreview: "off" });
  });

  it("leaves other edges and the no-preview state alone", () => {
    const unrelated = { ...base, id: "e-else" };
    expect(applyRunBranchPreview(unrelated, preview)).toBe(unrelated);
    expect(applyRunBranchPreview(base, null)).toBe(base);
  });
});

function makeApiError(status: number, detail: string): ApiError {
  return new ApiError(`API POST /runs/7/actions failed: ${status}`, status, JSON.stringify({ detail }));
}

describe("getRunWatermarkFontSize", () => {
  it("keeps short names at the published watermark size", () => {
    expect(getRunWatermarkFontSize("LOT 7")).toBe(120);
  });

  it("shrinks long names so they fit one line, Korean counted wider", () => {
    expect(getRunWatermarkFontSize("11월 1차 입고 · LOT 2611-07")).toBe(71);
    expect(getRunWatermarkFontSize("원자재 입고 검사 11월 1차")).toBeLessThan(getRunWatermarkFontSize("raw intake LOT 11 1st"));
  });

  it("never goes below the floor", () => {
    expect(getRunWatermarkFontSize("x".repeat(200))).toBe(44);
  });
});

describe("getRunTouchedAfterTitle", () => {
  it("reads the first blocking step from the 409", () => {
    expect(getRunTouchedAfterTitle(makeApiError(409, "later steps already changed: 시료 채취"))).toBe("시료 채취");
    expect(getRunTouchedAfterTitle(makeApiError(409, "subprocess has progress"))).toBeNull();
  });
});

describe("humanizeRunError", () => {
  it("names the later step that blocks an undo", () => {
    expect(humanizeRunError(makeApiError(409, "later steps already changed: 시료 채취"), t)).toBe(
      "뒤 단계(시료 채취)가 이미 진행돼서 완료를 취소할 수 없어요",
    );
  });

  it("explains a stale action", () => {
    expect(humanizeRunError(makeApiError(409, "action not allowed in this state"), t)).toBe(
      "다른 사람이 먼저 바꿔서 최신 상태로 새로 고쳤어요",
    );
  });

  it("maps the open and keep limits", () => {
    expect(humanizeRunError(makeApiError(409, "open solo run limit reached"), t)).toBe(t("run.err.soloCap"));
    expect(humanizeRunError(makeApiError(409, "open shared run limit reached"), t)).toBe(t("run.err.sharedCap"));
    expect(humanizeRunError(makeApiError(409, "keep limit reached"), t)).toBe(t("run.err.keepCap"));
    expect(t("run.err.soloCap")).not.toBe("run.err.soloCap");
  });

  it.each([
    [403, "only participants can change this run", "참여자만 이 Run을 바꿀 수 있어요"],
    [403, "only the starter can do this", "Run을 시작한 사람만 할 수 있어요"],
    [409, "summarized runs cannot be changed", "요약만 남은 Run이라 바꿀 수 없어요"],
    [422, "participant kim.a cannot view this map", "kim.a님은 이 맵을 볼 수 없어 참여할 수 없어요"],
    [422, "node is not actionable", "이 단계는 Run에서 바꿀 수 없어요"],
    [404, "run 42 not found", "Run이 없거나 볼 수 없어요"],
  ])("maps the server message %s %s", (status, detail, expected) => {
    expect(humanizeRunError(makeApiError(status, detail), t)).toBe(expected);
  });

  it("keeps the participant login in the English copy", () => {
    expect(humanizeRunError(makeApiError(422, "participant kim.a cannot view this map"), tEn)).toContain("kim.a");
  });

  it("falls back to the generic API error text", () => {
    expect(humanizeRunError(makeApiError(422, "choose a branch"), t)).toBe("choose a branch (HTTP 422)");
  });
});

describe("getRunMenuDisabledReason", () => {
  it("allows published and past published versions", () => {
    expect(getRunMenuDisabledReason("published", false)).toBeNull();
    expect(getRunMenuDisabledReason("expired", false)).toBeNull();
  });

  it("blocks versions that are not published yet", () => {
    expect(getRunMenuDisabledReason("draft", false)).toBe("run.menu.disabledDraft");
    expect(getRunMenuDisabledReason("pending", false)).toBe("run.menu.disabledDraft");
    expect(getRunMenuDisabledReason("approved", false)).toBe("run.menu.disabledDraft");
    expect(getRunMenuDisabledReason("rejected", false)).toBe("run.menu.disabledDraft");
  });

  it("blocks framework canvases whatever the version", () => {
    expect(getRunMenuDisabledReason("confirmed", true)).toBe("run.menu.disabledFramework");
    expect(getRunMenuDisabledReason("published", true)).toBe("run.menu.disabledFramework");
  });

  it("has both reasons in en and ko", () => {
    expect(t("run.menu.disabledDraft")).not.toBe("run.menu.disabledDraft");
    expect(t("run.menu.disabledFramework")).not.toBe("run.menu.disabledFramework");
    expect(messages.en["run.menu.disabledDraft"]).toBeTruthy();
  });
});

describe("getRunCapKind", () => {
  it("tells which open-run limit refused a new run", () => {
    expect(getRunCapKind(makeApiError(409, "open solo run limit reached"))).toBe("solo");
    expect(getRunCapKind(makeApiError(409, "open shared run limit reached"))).toBe("shared");
  });

  it("ignores other errors", () => {
    expect(getRunCapKind(makeApiError(409, "keep limit reached"))).toBeNull();
    expect(getRunCapKind(makeApiError(403, "only the starter can do this"))).toBeNull();
    expect(getRunCapKind(new Error("network"))).toBeNull();
  });
});

describe("isRunSubProgressError", () => {
  it("spots the sub-map-progress refusal that asks for a cascade confirm", () => {
    expect(isRunSubProgressError(makeApiError(409, "subprocess has progress"))).toBe(true);
    expect(isRunSubProgressError(makeApiError(409, "later steps already changed: 시료 채취"))).toBe(false);
    expect(isRunSubProgressError(new Error("network"))).toBe(false);
  });
});

describe("run links", () => {
  it("builds the run URL on the map screen", () => {
    expect(buildRunHref(10, 100, 7)).toBe("/maps/10?version=100&run=7");
  });

  it("builds the plain map URL for leaving a run on the same version", () => {
    expect(buildMapVersionHref(10, 100)).toBe("/maps/10?version=100");
  });

  it("reads only a positive integer run id", () => {
    expect(readRunIdParam("?version=100&run=7")).toBe(7);
    expect(readRunIdParam("?version=100")).toBeNull();
    expect(readRunIdParam("?run=abc")).toBeNull();
    expect(readRunIdParam("?run=0")).toBeNull();
    expect(readRunIdParam("?run=1.5")).toBeNull();
  });

  it("reads the version to land on when leaving a run by URL", () => {
    expect(readVersionIdParam("version=100")).toBe(100);
    expect(readVersionIdParam("?version=100&run=7")).toBe(100);
    expect(readVersionIdParam("run=7")).toBeNull();
    expect(readVersionIdParam("version=x")).toBeNull();
    expect(readVersionIdParam("version=-3")).toBeNull();
  });
});

describe("formatSummaryCountdown", () => {
  const now = new Date("2026-11-04T00:00:00+09:00");
  const DAY_MS = 24 * 60 * 60 * 1000;
  const after = (days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();

  it("rounds the remaining days up", () => {
    expect(formatSummaryCountdown(after(23.2), now)).toBe(24);
    expect(formatSummaryCountdown(after(23), now)).toBe(23);
    expect(formatSummaryCountdown(after(0.1), now)).toBe(1);
  });

  it("is 0 once the date has passed", () => {
    expect(formatSummaryCountdown(after(-0.5), now)).toBe(0);
    expect(formatSummaryCountdown(after(-10), now)).toBe(0);
  });

  it("is null when there is no summary date or it can't be read", () => {
    expect(formatSummaryCountdown(null, now)).toBeNull();
    expect(formatSummaryCountdown("not a date", now)).toBeNull();
  });
});

describe("formatRunPeriod", () => {
  it("says one day when the run starts and ends on the same KST day", () => {
    expect(formatRunPeriod("2026-09-21T09:00:00+09:00", "2026-09-21T18:00:00+09:00", t)).toBe("9월 21일 하루");
    // UTC로는 날짜가 갈리지만 KST로는 같은 날
    expect(formatRunPeriod("2026-09-20T16:00:00Z", "2026-09-21T14:30:00Z", t)).toBe("9월 21일 하루");
  });

  it("writes the end as the day only inside one month", () => {
    expect(formatRunPeriod("2026-09-12T10:00:00+09:00", "2026-09-14T15:00:00+09:00", t)).toBe("9월 12일~14일(3일)");
  });

  it("writes the end month when the period crosses months", () => {
    expect(formatRunPeriod("2026-09-30T10:00:00+09:00", "2026-10-02T15:00:00+09:00", t)).toBe("9월 30일~10월 2일(3일)");
  });

  it("counts KST calendar days, not 24-hour spans", () => {
    expect(formatRunPeriod("2026-09-21T14:00:00Z", "2026-09-21T16:00:00Z", t)).toBe("9월 21일~22일(2일)");
  });

  it("reads in English with the English copy", () => {
    expect(formatRunPeriod("2026-09-21T09:00:00+09:00", "2026-09-21T18:00:00+09:00", tEn)).toBe("9/21 (1 day)");
    expect(formatRunPeriod("2026-09-12T10:00:00+09:00", "2026-09-14T15:00:00+09:00", tEn)).toBe("9/12 to 14 (3 days)");
    expect(formatRunPeriod("2026-09-30T10:00:00+09:00", "2026-10-02T15:00:00+09:00", tEn)).toBe("9/30 to 10/2 (3 days)");
  });
});

describe("formatRunSummaryParts", () => {
  const summary = {
    result: "completed",
    started_at: "2026-09-12T10:00:00+09:00",
    ended_at: "2026-09-14T15:00:00+09:00",
    days: 3,
    version_number: 4,
    version_label: "v4",
    problem_steps: 2,
    participants: ["me", "kim.a"],
    starter: "me",
  };

  it("lists the period, the version and the problem steps", () => {
    expect(formatRunSummaryParts(summary, t)).toEqual(["9월 12일~14일(3일)", "v4", "문제 단계 2"]);
  });

  it("drops the problem part when nothing went wrong and falls back to the version label", () => {
    expect(formatRunSummaryParts({ ...summary, problem_steps: 0, version_number: null, version_label: "As-Is" }, t)).toEqual([
      "9월 12일~14일(3일)",
      "As-Is",
    ]);
  });
});

describe("validateRunLimits", () => {
  const base: RunLimitsDraft = {
    warn: "30",
    stop: "40",
    summary: "30",
    openSolo: "10",
    openShared: "30",
    keepShared: "50",
    keepSolo: "10",
  };

  it("accepts the defaults", () => {
    expect(validateRunLimits(base)).toBeNull();
  });

  it("blocks auto stop on or before the idle warning day", () => {
    expect(validateRunLimits({ ...base, warn: "30", stop: "30" })).toBe("run.admin.stopAfterWarn");
    expect(validateRunLimits({ ...base, warn: "30", stop: "20" })).toBe("run.admin.stopAfterWarn");
    expect(validateRunLimits({ ...base, warn: "30", stop: "31" })).toBeNull();
  });

  it("blocks values that are not whole numbers in range", () => {
    expect(validateRunLimits({ ...base, summary: "" })).toBe("run.admin.invalidNumber");
    expect(validateRunLimits({ ...base, summary: "0" })).toBe("run.admin.invalidNumber");
    expect(validateRunLimits({ ...base, summary: "3651" })).toBe("run.admin.invalidNumber");
    expect(validateRunLimits({ ...base, openSolo: "1.5" })).toBe("run.admin.invalidNumber");
    expect(validateRunLimits({ ...base, keepSolo: "1001" })).toBe("run.admin.invalidNumber");
    expect(validateRunLimits({ ...base, openShared: "abc" })).toBe("run.admin.invalidNumber");
  });

  it("accepts the range edges", () => {
    expect(validateRunLimits({ ...base, warn: "1", stop: "3650", summary: "3650", openSolo: "1", keepShared: "1000" })).toBeNull();
  });

  it("has copy for both error keys", () => {
    for (const key of ["run.admin.stopAfterWarn", "run.admin.invalidNumber"] as const) {
      expect(messages.en[key]).toBeTruthy();
      expect(messages.ko[key]).toBeTruthy();
    }
  });
});

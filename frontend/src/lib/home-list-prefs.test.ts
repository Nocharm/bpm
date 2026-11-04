// 홈 대시보드 펼침 목록 — 거르기·정렬 기억과 실행 줄 거르기·정렬 단위 테스트 (design 2026-11-04 §4.8)
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeedbackItem, MeDashboardRun } from "@/lib/api";
import {
  countRunFilters,
  DEFAULT_HOME_LIST_PREFS,
  filterRuns,
  getFeedbackUpdatedAt,
  loadHomeListPrefs,
  saveHomeListPrefs,
  selectMyFeedback,
  sortRuns,
  type HomeListPrefs,
} from "@/lib/home-list-prefs";

const KEY = "bpm.home.lists";
const NOW = Date.parse("2026-11-04T12:00:00+09:00");
const DAY = 1440;

// 목업 v9 HD_RUNS 6줄 — ago는 마지막으로 손댄 뒤 지난 분
function makeRun(
  runId: number,
  name: string,
  mapName: string,
  shared: number,
  kind: MeDashboardRun["state_kind"],
  done: number,
  total: number,
  agoMinutes: number,
): MeDashboardRun {
  return {
    run_id: runId,
    map_id: runId * 10,
    map_name: mapName,
    version_id: runId * 100,
    name,
    scope: shared > 0 ? "shared" : "solo",
    participant_count: shared > 0 ? shared : 1,
    state_kind: kind,
    state_title: "",
    state_more: 0,
    is_idle: kind === "idle",
    idle_days: kind === "idle" ? 32 : 0,
    stop_in_days: kind === "idle" ? 8 : 0,
    done,
    total,
    last_activity_at: new Date(NOW - agoMinutes * 60_000).toISOString(),
  };
}

const HD_RUNS: MeDashboardRun[] = [
  makeRun(1, "11월 1차 입고 · LOT 2611-07", "원자재 입고 검사", 3, "problem", 5, 8, 12),
  makeRun(2, "교육용 연습", "원자재 입고 검사", 0, "idle", 2, 10, 32 * DAY),
  makeRun(3, "신규 협력사 등록 · 대한산업", "협력사 등록 심사", 2, "next", 2, 7, DAY),
  makeRun(4, "긴급 입고 · LOT 2611-15", "원자재 입고 검사", 4, "next", 1, 10, 3 * DAY),
  makeRun(5, "설비 점검 연습", "월간 설비 점검", 0, "next", 4, 6, 120),
  makeRun(6, "10월 마감 정산", "월말 결산", 5, "problem", 7, 9, 5 * DAY),
];

const names = (runs: MeDashboardRun[]): string[] => runs.map((run) => run.name);

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("home list prefs storage", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadHomeListPrefs()).toEqual({
      runFilter: "all",
      runSort: "urgent",
      notiRead: "unread",
      notiCat: "all",
      fbStatus: "open",
      fbKind: "all",
    });
    expect(DEFAULT_HOME_LIST_PREFS.runSort).toBe("urgent");
  });

  it("falls back to the defaults on broken JSON or a non-object", () => {
    window.localStorage.setItem(KEY, "{broken");
    expect(loadHomeListPrefs()).toEqual(DEFAULT_HOME_LIST_PREFS);
    window.localStorage.setItem(KEY, JSON.stringify(["urgent"]));
    expect(loadHomeListPrefs()).toEqual(DEFAULT_HOME_LIST_PREFS);
  });

  it("replaces unknown values field by field and keeps the known ones", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ runSort: "fastest", runFilter: "idle", notiCat: "spam", fbKind: 3 }));
    expect(loadHomeListPrefs()).toEqual({ ...DEFAULT_HOME_LIST_PREFS, runFilter: "idle" });
  });

  it("round-trips a saved choice", () => {
    const prefs: HomeListPrefs = {
      runFilter: "shared",
      runSort: "map",
      notiRead: "all",
      notiCat: "run",
      fbStatus: "all",
      fbKind: "bug",
    };
    saveHomeListPrefs(prefs);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "null")).toEqual(prefs);
    expect(loadHomeListPrefs()).toEqual(prefs);
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadHomeListPrefs()).toEqual(DEFAULT_HOME_LIST_PREFS);
    expect(() => saveHomeListPrefs(DEFAULT_HOME_LIST_PREFS)).not.toThrow();
  });
});

describe("sortRuns", () => {
  it("urgent puts problems, then stopping soon, then the rest, newest first inside a group", () => {
    expect(names(sortRuns(HD_RUNS, "urgent"))).toEqual([
      "11월 1차 입고 · LOT 2611-07",
      "10월 마감 정산",
      "교육용 연습",
      "설비 점검 연습",
      "신규 협력사 등록 · 대한산업",
      "긴급 입고 · LOT 2611-15",
    ]);
  });

  it("recent is newest activity first", () => {
    expect(names(sortRuns(HD_RUNS, "recent"))).toEqual([
      "11월 1차 입고 · LOT 2611-07",
      "설비 점검 연습",
      "신규 협력사 등록 · 대한산업",
      "긴급 입고 · LOT 2611-15",
      "10월 마감 정산",
      "교육용 연습",
    ]);
  });

  it("progress is lowest done/total first", () => {
    expect(names(sortRuns(HD_RUNS, "progress"))).toEqual([
      "긴급 입고 · LOT 2611-15",
      "교육용 연습",
      "신규 협력사 등록 · 대한산업",
      "11월 1차 입고 · LOT 2611-07",
      "설비 점검 연습",
      "10월 마감 정산",
    ]);
  });

  it("map compares map names in ko order, newest first inside a map", () => {
    const sorted = sortRuns(HD_RUNS, "map");
    expect(sorted[0].map_name).toBe("원자재 입고 검사");
    expect(names(sorted)).toEqual([
      "11월 1차 입고 · LOT 2611-07",
      "긴급 입고 · LOT 2611-15",
      "교육용 연습",
      "설비 점검 연습",
      "10월 마감 정산",
      "신규 협력사 등록 · 대한산업",
    ]);
  });

  it("does not mutate the input", () => {
    const before = names(HD_RUNS);
    sortRuns(HD_RUNS, "progress");
    expect(names(HD_RUNS)).toEqual(before);
  });

  it("treats a problem run that is also idle as a problem (R20)", () => {
    const both = { ...makeRun(7, "문제와 방치", "월말 결산", 0, "problem", 0, 4, 40 * DAY), is_idle: true };
    expect(names(sortRuns([HD_RUNS[1], both], "urgent"))).toEqual(["문제와 방치", "교육용 연습"]);
  });
});

describe("filterRuns / countRunFilters", () => {
  it("filters by state and scope", () => {
    expect(filterRuns(HD_RUNS, "all")).toHaveLength(6);
    expect(names(filterRuns(HD_RUNS, "problem"))).toEqual(["11월 1차 입고 · LOT 2611-07", "10월 마감 정산"]);
    expect(names(filterRuns(HD_RUNS, "idle"))).toEqual(["교육용 연습"]);
    expect(filterRuns(HD_RUNS, "shared")).toHaveLength(4);
    expect(names(filterRuns(HD_RUNS, "solo"))).toEqual(["교육용 연습", "설비 점검 연습"]);
  });

  it("counts every filter", () => {
    expect(countRunFilters(HD_RUNS)).toEqual({ all: 6, problem: 2, idle: 1, shared: 4, solo: 2 });
  });

  it("stopping soon follows is_idle even when the run has a problem (R20)", () => {
    const both = { ...makeRun(7, "문제와 방치", "월말 결산", 0, "problem", 0, 4, 40 * DAY), is_idle: true };
    const runs = [...HD_RUNS, both];
    expect(names(filterRuns(runs, "idle"))).toEqual(["교육용 연습", "문제와 방치"]);
    expect(countRunFilters(runs)).toEqual({ all: 7, problem: 3, idle: 2, shared: 4, solo: 3 });
  });
});

describe("selectMyFeedback", () => {
  const base: FeedbackItem = {
    id: 0,
    kind: "bug",
    body: "",
    author: "me",
    context: {},
    status: "draft",
    reply: "",
    created_at: "2026-11-01T09:00:00+09:00",
    body_edited_at: null,
    reply_at: null,
    done_at: null,
    reply_notified_at: null,
    status_notified_at: null,
  };

  it("keeps only my items, latest update first", () => {
    const items: FeedbackItem[] = [
      { ...base, id: 1, created_at: "2026-11-03T09:00:00+09:00" },
      { ...base, id: 2, author: "someone", created_at: "2026-11-04T09:00:00+09:00" },
      { ...base, id: 3, created_at: "2026-10-01T09:00:00+09:00", reply_at: "2026-11-04T08:00:00+09:00" },
      { ...base, id: 4, created_at: "2026-10-02T09:00:00+09:00", body_edited_at: "2026-11-02T09:00:00+09:00" },
    ];
    expect(selectMyFeedback(items, "me").map((item) => item.id)).toEqual([3, 1, 4]);
    expect(getFeedbackUpdatedAt(items[2])).toBe("2026-11-04T08:00:00+09:00");
    expect(getFeedbackUpdatedAt(items[0])).toBe("2026-11-03T09:00:00+09:00");
  });

  it("returns nothing without a signed-in user", () => {
    expect(selectMyFeedback([{ ...base, id: 1, author: "" }], "")).toEqual([]);
  });
});

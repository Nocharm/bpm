// 고아 참조 패널 순수 로직 — 체크 가능 판정·토글 대상·알림 대상 (design 2026-09-09)
import { describe, expect, it } from "vitest";

import type { RefGroup, RefLine } from "@/lib/api";
import {
  checkableTargets,
  countNotifyOwners,
  isLineCheckable,
  notifyTargets,
  summarizeSources,
} from "@/lib/ref-audit";

const line = (over: Partial<RefLine>): RefLine => ({
  source: "map_grant", fixable: true, count: 1, target_id: "map_grant:1",
  map_id: 1, map_name: "Map A", owner_id: "user.lee", owner_name: "Minjae Lee",
  group_id: null, group_name: null, category_id: null, category_name: null,
  version_id: null, version_status: null, ...over,
});

const group: RefGroup = {
  kind: "user", value: "gone.user", value_kind: "login",
  lines: [
    line({ source: "map_owner", target_id: "map_owner:1" }),
    line({ source: "map_collab", target_id: "map_collab:7", map_id: 2, map_name: "Map B", owner_id: "user.park" }),
    line({ source: "node_assignee", fixable: false, count: 4, target_id: "node_assignee:30", version_id: 30, version_status: "published" }),
    line({ source: "node_assignee", fixable: false, count: 1, target_id: "node_assignee:31", map_id: 3, map_name: "Map C", owner_id: null, owner_name: null, version_id: 31, version_status: "draft" }),
  ],
};

describe("isLineCheckable", () => {
  it("노드 라인은 어떤 모드에서도 체크 불가", () => {
    expect(isLineCheckable(group.lines[2], "replace")).toBe(false);
  });
  it("remove 모드에선 오너·오우닝·SP 부서 라인이 체크 불가", () => {
    expect(isLineCheckable(group.lines[0], "replace")).toBe(true);
    expect(isLineCheckable(group.lines[0], "remove")).toBe(false);
    expect(isLineCheckable(line({ source: "owning_dept" }), "remove")).toBe(false);
    expect(isLineCheckable(line({ source: "sp_dept" }), "remove")).toBe(false);
    expect(isLineCheckable(line({ source: "sp_assignee" }), "remove")).toBe(true);
  });
});

describe("checkableTargets / notifyTargets", () => {
  it("replace: 고칠 수 있는 라인 전부", () => {
    expect(checkableTargets(group, "replace")).toEqual(["map_owner:1", "map_collab:7"]);
  });
  it("remove: 오너 제외", () => {
    expect(checkableTargets(group, "remove")).toEqual(["map_collab:7"]);
  });
  it("알림 대상은 체크 불가 라인(노드)만", () => {
    expect(notifyTargets(group)).toEqual(["node_assignee:30", "node_assignee:31"]);
  });
  it("알림 오너 수는 오너가 있는 노드 라인의 distinct owner", () => {
    expect(countNotifyOwners(group)).toBe(1);
  });
});

describe("summarizeSources", () => {
  it("소스별 count 합", () => {
    expect(summarizeSources(group)).toEqual([
      ["map_owner", 1], ["map_collab", 1], ["node_assignee", 5],
    ]);
  });
});

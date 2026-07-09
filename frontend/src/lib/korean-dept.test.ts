import { describe, expect, it } from "vitest";

import type { AdminUser, EmployeeRow } from "./api";
import {
  buildAssigneeOptions,
  buildDepartmentOptions,
  buildExportIds,
  deriveDeptKoreanKeywords,
  formatRosterName,
  getDeptMembers,
  sortManagersFirst,
} from "./korean-dept";

const user = (login_id: string, org: string[], korean_dept = "", korean_name = ""): AdminUser => ({
  login_id,
  name: `EN ${login_id}`,
  department: org[org.length - 1] ?? "",
  role: "user",
  is_sysadmin: false,
  org_levels: org,
  active: true,
  korean_name,
  korean_dept,
});

const emp = (login_id: string, department: string, korean_name = ""): EmployeeRow => ({
  login_id,
  name: "",
  title: "",
  source: "ad",
  role: "user",
  department,
  korean_name,
  korean_dept: "",
  active: true,
  is_sysadmin: false,
});

describe("getDeptMembers", () => {
  const users = [
    user("a", ["HQ", "TeamA"], "팀에이"),
    user("b", ["HQ", "TeamA"], "팀A그룹"),
    user("c", ["HQ", "TeamA"], "팀A그룹"),
    user("d", ["HQ", "TeamA"], ""),
    user("e", ["HQ", "TeamA", "Cell"], "셀"),
  ];

  it("matches exact org path only", () => {
    expect(getDeptMembers(users, ["HQ", "TeamA"]).map((u) => u.login_id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("formatRosterName", () => {
  const both = { name: "Hyeonjin Jang", korean_name: "장현진" };
  it("orders by lang, falls back to whichever exists", () => {
    expect(formatRosterName(both, "ko")).toBe("장현진 (Hyeonjin Jang)");
    expect(formatRosterName(both, "en")).toBe("Hyeonjin Jang (장현진)");
    expect(formatRosterName({ name: "Only EN", korean_name: "" }, "ko")).toBe("Only EN");
    expect(formatRosterName({ name: "", korean_name: "한글만" }, "en")).toBe("한글만");
  });
});

describe("buildExportIds", () => {
  const rows = [
    emp("m1", "TeamA", ""),
    emp("m2", "TeamA", "홍길동"),
    emp("m3", "TeamB", ""),
    emp("m4", "TeamB", ""),
  ];

  it("missing — only empty korean_name", () => {
    expect(buildExportIds(rows, "missing")).toEqual(["m1", "m3", "m4"]);
  });

  it("all — every id", () => {
    expect(buildExportIds(rows, "all")).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("deptSample — one per department, deterministic with rng", () => {
    expect(buildExportIds(rows, "deptSample", () => 0)).toEqual(["m1", "m3"]);
    expect(buildExportIds(rows, "deptSample", () => 0.99)).toEqual(["m2", "m4"]);
  });

  it("random50 — min(50, n) without replacement", () => {
    const picked = buildExportIds(rows, "random50", () => 0);
    expect(picked).toHaveLength(4);
    expect(new Set(picked).size).toBe(4);
  });
});

describe("deriveDeptKoreanKeywords", () => {
  it("groups distinct non-empty korean_dept by exact org_path", () => {
    const users = [
      { org_path: "HQ/TeamA", korean_dept: "팀에이" },
      { org_path: "HQ/TeamA", korean_dept: "팀A그룹" },
      { org_path: "HQ/TeamA", korean_dept: "팀에이" },
      { org_path: "HQ/TeamA", korean_dept: "" },
      { org_path: "HQ/TeamA/Cell", korean_dept: "셀" },
      { korean_dept: "무경로" },
    ];
    const map = deriveDeptKoreanKeywords(users);
    expect(map.get("HQ/TeamA")).toEqual(["팀에이", "팀A그룹"]);
    expect(map.get("HQ/TeamA/Cell")).toEqual(["셀"]);
    expect(map.has("")).toBe(false);
  });
});

describe("buildAssigneeOptions", () => {
  it("keeps value as english name, localizes label, adds korean keywords", () => {
    const users = [
      { id: "h.jang", name: "Hyeonjin Jang", department: "TeamA", korean_name: "장현진", korean_dept: "팀에이" },
      { id: "no.kr", name: "No Korean", department: "TeamB" },
    ];
    const ko = buildAssigneeOptions(users, "ko");
    expect(ko[0]).toEqual({
      value: "Hyeonjin Jang",
      label: "장현진 (Hyeonjin Jang)",
      sub: "h.jang · TeamA",
      keywords: "h.jang 장현진",
    });
    expect(ko[1].label).toBe("No Korean");
    const en = buildAssigneeOptions(users, "en");
    expect(en[0].label).toBe("Hyeonjin Jang (장현진)");
    expect(en[0].value).toBe("Hyeonjin Jang");
  });
});

describe("sortManagersFirst", () => {
  const items = [
    { type: "user", id: "a" },
    { type: "dept", id: "D1" },
    { type: "user", id: "mgr.root" },
    { type: "user", id: "b" },
    { type: "user", id: "mgr.leaf" },
  ];
  const getUserId = (i: { type: string; id: string }) => (i.type === "user" ? i.id : null);

  it("pins managers in managerIds order (leaf first), keeps rest stable", () => {
    const out = sortManagersFirst(items, getUserId, ["mgr.leaf", "mgr.root"]);
    expect(out.map((i) => i.id)).toEqual(["mgr.leaf", "mgr.root", "a", "D1", "b"]);
  });

  it("no managers — returns original order", () => {
    expect(sortManagersFirst(items, getUserId, [])).toEqual(items);
  });

  it("dept items never match manager ids", () => {
    const out = sortManagersFirst(items, getUserId, ["D1"]);
    expect(out.map((i) => i.id)).toEqual(["a", "D1", "mgr.root", "b", "mgr.leaf"]);
  });
});

describe("buildDepartmentOptions", () => {
  const users = [
    { id: "a", name: "A", department: "TeamA", korean_dept: "팀에이" },
    { id: "b", name: "B", department: "TeamA", korean_dept: "팀A그룹" },
    { id: "c", name: "C", department: "TeamB" },
  ];

  it("derives korean keywords from members by department string", () => {
    const opts = buildDepartmentOptions(["TeamA", "TeamB"], users, "en");
    expect(opts[0]).toEqual({ value: "TeamA", label: "TeamA", keywords: "팀에이 팀A그룹" });
    expect(opts[1]).toEqual({ value: "TeamB", label: "TeamB", keywords: undefined });
  });

  it("dept_info korean name toggles label by lang, value stays English", () => {
    const infos = { TeamA: { korean_name: "에이팀", manager: "kim.cs" } };
    const ko = buildDepartmentOptions(["TeamA"], users, "ko", infos);
    expect(ko[0].value).toBe("TeamA");
    expect(ko[0].label).toBe("에이팀 (TeamA)");
    const en = buildDepartmentOptions(["TeamA"], users, "en", infos);
    expect(en[0].label).toBe("TeamA (에이팀)");
  });

  it("adds dept_info korean name and manager to keywords ahead of observations", () => {
    const infos = { TeamA: { korean_name: "에이팀", manager: "kim.cs" } };
    const opts = buildDepartmentOptions(["TeamA"], users, "en", infos);
    expect(opts[0].keywords).toBe("에이팀 kim.cs 팀에이 팀A그룹");
  });

  it("missing korean name or manager degrades gracefully", () => {
    const infos = { TeamB: { korean_name: "", manager: "lee.mj" } };
    const opts = buildDepartmentOptions(["TeamA", "TeamB"], users, "ko", infos);
    expect(opts[0].label).toBe("TeamA"); // info 없음 — 영문만
    expect(opts[1]).toEqual({ value: "TeamB", label: "TeamB", keywords: "lee.mj" });
  });
});

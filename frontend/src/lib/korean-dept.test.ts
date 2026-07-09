import { describe, expect, it } from "vitest";

import type { AdminUser, EmployeeRow } from "./api";
import { aggregateDeptKoreanDepts, buildExportIds, formatRosterName, getDeptMembers } from "./korean-dept";

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
});

describe("getDeptMembers / aggregateDeptKoreanDepts", () => {
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

  it("aggregates distinct non-empty values, count desc", () => {
    expect(aggregateDeptKoreanDepts(getDeptMembers(users, ["HQ", "TeamA"]))).toEqual([
      { value: "팀A그룹", count: 2 },
      { value: "팀에이", count: 1 },
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

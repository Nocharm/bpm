import { describe, expect, it } from "vitest";

import {
  buildDeptTreeLevels,
  countFilledSpTiles,
  hasSpContent,
  parseIoLines,
  resolveValueOrNote,
} from "./sp-detail";

describe("resolveValueOrNote", () => {
  it("prefers the representative value", () => {
    expect(resolveValueOrNote("52", "주 1회")).toEqual({ value: "52", tone: "default" });
  });
  it("falls back to the source note when the value is blank", () => {
    expect(resolveValueOrNote("  ", " 주 1회 ")).toEqual({ value: "주 1회", tone: "fallback" });
    expect(resolveValueOrNote(null, "한시간쯤")).toEqual({ value: "한시간쯤", tone: "fallback" });
  });
  it("returns an empty default when both are blank", () => {
    expect(resolveValueOrNote("", null)).toEqual({ value: "", tone: "default" });
  });
});

describe("buildDeptTreeLevels", () => {
  it("maps up to four levels root→leaf with increasing depth", () => {
    const levels = buildDeptTreeLevels("Quality Center/QC Department/QC Support Team/QC Sample Management Group");
    expect(levels.map((l) => l.depth)).toEqual([0, 1, 2, 3]);
    expect(levels.map((l) => l.path)).toEqual([
      "Quality Center",
      "Quality Center/QC Department",
      "Quality Center/QC Department/QC Support Team",
      "Quality Center/QC Department/QC Support Team/QC Sample Management Group",
    ]);
    expect(levels.filter((l) => l.leaf)).toHaveLength(1);
    expect(levels[3].leaf).toBe(true);
    expect(levels.some((l) => l.ellipsis)).toBe(false);
  });
  it("collapses the middle of deep paths into one ellipsis row so the leaf stays visible", () => {
    const levels = buildDeptTreeLevels("A/B/C/D/E/F");
    expect(levels).toHaveLength(4);
    expect(levels[0]).toMatchObject({ path: "A", depth: 0, ellipsis: false });
    expect(levels[1]).toMatchObject({ path: "", depth: 1, ellipsis: true });
    expect(levels[2]).toMatchObject({ path: "A/B/C/D/E", depth: 2, leaf: false });
    expect(levels[3]).toMatchObject({ path: "A/B/C/D/E/F", depth: 3, leaf: true });
  });
  it("handles a single level and blanks", () => {
    expect(buildDeptTreeLevels("Solo")).toEqual([{ path: "Solo", depth: 0, leaf: true, ellipsis: false }]);
    expect(buildDeptTreeLevels("")).toEqual([]);
  });
});

describe("parseIoLines", () => {
  it("splits by newline, trims, drops blanks", () => {
    expect(parseIoLines(" 교정 작업지시 \n\n준비 목록\n")).toEqual(["교정 작업지시", "준비 목록"]);
    expect(parseIoLines(null)).toEqual([]);
  });
});

describe("countFilledSpTiles / hasSpContent", () => {
  it("counts a tile as filled when either the value or its source note exists", () => {
    expect(countFilledSpTiles({})).toBe(0);
    expect(countFilledSpTiles({ sp_annual_count: "", sp_frequency_fallback: "주 1회" })).toBe(1);
    expect(countFilledSpTiles({ sp_duration: "2.30", sp_total_time_fallback: "두 시간 반" })).toBe(1);
    expect(countFilledSpTiles({ sp_cost_krw: "", sp_cost_usd: "120" })).toBe(1);
  });
  it("counts every tile once — 15 when everything is filled", () => {
    expect(
      countFilledSpTiles({
        sp_department: "A/B",
        sp_assignee: "Bora Choi",
        sp_system: "EAM",
        sp_url: "https://x",
        sp_gmp: "direct",
        sp_duration: "2.30",
        sp_touch_time: "1",
        sp_cost_krw: "154900",
        sp_headcount: "2",
        sp_annual_count: "52",
        sp_fte: "0.03",
        sp_input: "a",
        sp_output: "b",
        sp_start_condition: "c",
        sp_end_condition: "d",
      }),
    ).toBe(15);
  });
  it("shows the section when designated even with no values, hides it when neither", () => {
    expect(hasSpContent({ sp_designated_at: "2026-09-03T18:10:00" })).toBe(true);
    expect(hasSpContent({ sp_system_fallback: "EAM, 수기 대장" })).toBe(true);
    expect(hasSpContent({})).toBe(false);
  });
});

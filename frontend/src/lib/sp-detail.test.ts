import { describe, expect, it } from "vitest";

import { countFilledSpTiles, hasSpContent, parseIoRows, resolveValueOrNote } from "./sp-detail";

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

describe("parseIoRows", () => {
  it("splits by newline, trims, drops blank text rows", () => {
    expect(parseIoRows(" 교정 작업지시 \n\n준비 목록\n")).toEqual([
      { text: "교정 작업지시", form: "" },
      { text: "준비 목록", form: "" },
    ]);
    expect(parseIoRows(null)).toEqual([]);
  });
  it("pairs each item with the data form on the same line", () => {
    expect(parseIoRows("작업지시\n대장\n성적서", "Excel\n\nPDF")).toEqual([
      { text: "작업지시", form: "Excel" },
      { text: "대장", form: "" },
      { text: "성적서", form: "PDF" },
    ]);
  });
  it("keeps the form aligned by original line index when a text line is blank", () => {
    expect(parseIoRows("작업지시\n\n성적서", "Excel\nCSV\nPDF")).toEqual([
      { text: "작업지시", form: "Excel" },
      { text: "성적서", form: "PDF" },
    ]);
  });
  it("tolerates a shorter or missing forms column", () => {
    expect(parseIoRows("a\nb", "Excel")).toEqual([
      { text: "a", form: "Excel" },
      { text: "b", form: "" },
    ]);
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

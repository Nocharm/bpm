// 내보내기 컬럼 정의·선택 영속 단위 테스트 (export-column-picker-design 2026-10-02)
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CSV_COLUMNS,
  EXCEL_COLUMNS,
  EXPORT_COLUMN_GROUPS,
  isExportColumnForced,
  loadExportColumns,
  normalizeExportColumns,
  saveExportColumns,
  toggleExportColumnGroup,
} from "./export-columns";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("normalizeExportColumns", () => {
  it("미지정이면 전부, 지정이면 정식 순서로 정렬하고 잠금 열을 강제한다", () => {
    expect(normalizeExportColumns(CSV_COLUMNS, undefined)).toEqual(CSV_COLUMNS.map((c) => c.key));
    expect(normalizeExportColumns(CSV_COLUMNS, ["next", "gmp", "unknown"])).toEqual(["name", "gmp", "parallel", "next"]);
  });

  it("CSV는 다시 가져오기에 필요한 Name·Parallel·Next를 전부 해제해도 남긴다", () => {
    expect(normalizeExportColumns(CSV_COLUMNS, [])).toEqual(["name", "parallel", "next"]);
  });

  it("Excel은 맵을 다시 그릴 최소 열 No·Name·Type·Parallel·Next를 전부 해제해도 남긴다", () => {
    expect(normalizeExportColumns(EXCEL_COLUMNS, [])).toEqual(["no", "name", "type", "parallel", "next"]);
  });

  it("CSV 줄 정렬 열은 값 열을 따라간다 — Input이 있으면 Input_Flags·Input_Forms, Output이 있으면 Output_Forms", () => {
    expect(normalizeExportColumns(CSV_COLUMNS, ["input"])).toEqual(["name", "input", "input_flags", "input_forms", "parallel", "next"]);
    expect(normalizeExportColumns(CSV_COLUMNS, ["output"])).toEqual(["name", "output", "output_forms", "parallel", "next"]);
    // 값 열이 없으면 짝 열은 자유(병합 시 기존 텍스트에 맞춰 정렬돼 해가 없다)
    expect(normalizeExportColumns(CSV_COLUMNS, ["input_flags"])).toEqual(["name", "input_flags", "parallel", "next"]);
  });
});

describe("toggleExportColumnGroup", () => {
  const all = CSV_COLUMNS.map((c) => c.key);
  const metrics = ["duration", "touch_time", "cost_krw", "cost_usd", "headcount", "annual_count", "fte"];

  it("묶음이 전부 켜져 있으면 해제 가능한 열만 끄고, 하나라도 꺼져 있으면 전부 켠다", () => {
    const off = toggleExportColumnGroup(CSV_COLUMNS, all, "metrics");
    expect(off).toEqual(all.filter((key) => !metrics.includes(key)));
    expect(toggleExportColumnGroup(CSV_COLUMNS, off, "metrics")).toEqual(all);
    const partial = off.concat(["fte"]);
    expect(toggleExportColumnGroup(CSV_COLUMNS, partial, "metrics")).toEqual(all);
  });

  it("잠금 열·짝 강제 열은 묶음 해제에도 남는다", () => {
    expect(toggleExportColumnGroup(CSV_COLUMNS, all, "flow")).toEqual(all); // 흐름 묶음은 전부 잠금
    const detailsOff = toggleExportColumnGroup(CSV_COLUMNS, all, "details");
    // Input이 꺼지면 짝 열도 풀려 함께 꺼진다 — 입출력·조건 묶음이 통째로 빠짐
    expect(detailsOff.filter((key) => CSV_COLUMNS.find((c) => c.key === key)?.group === "details")).toEqual([]);
    expect(detailsOff).toEqual(expect.arrayContaining(["name", "parallel", "next"]));
  });

  it("모든 열은 피커 묶음 중 하나에 속한다(CSV·Excel)", () => {
    for (const def of [...CSV_COLUMNS, ...EXCEL_COLUMNS]) expect(EXPORT_COLUMN_GROUPS).toContain(def.group);
  });
});

describe("isExportColumnForced", () => {
  it("잠금 열은 항상, 짝 열은 값 열이 선택된 동안만 강제한다", () => {
    const byKey = new Map(CSV_COLUMNS.map((c) => [c.key, c]));
    expect(isExportColumnForced(byKey.get("next")!, new Set())).toBe(true);
    expect(isExportColumnForced(byKey.get("input_forms")!, new Set(["input"]))).toBe(true);
    expect(isExportColumnForced(byKey.get("input_forms")!, new Set())).toBe(false);
    expect(isExportColumnForced(byKey.get("description")!, new Set(["input"]))).toBe(false);
  });
});

describe("loadExportColumns / saveExportColumns", () => {
  it("저장이 없으면 기본은 전부 선택", () => {
    expect(loadExportColumns("csv")).toEqual(CSV_COLUMNS.map((c) => c.key));
    expect(loadExportColumns("excel")).toEqual(EXCEL_COLUMNS.map((c) => c.key));
  });

  it("제외한 키만 저장해 다시 읽으면 같은 선택이 되고, 종류별로 따로 기억한다", () => {
    saveExportColumns("csv", ["name", "description", "parallel", "next"]);
    expect(loadExportColumns("csv")).toEqual(["name", "description", "parallel", "next"]);
    expect(loadExportColumns("excel")).toEqual(EXCEL_COLUMNS.map((c) => c.key));
    const stored = JSON.parse(window.localStorage.getItem("bpm.exportColumns.csv") ?? "[]") as string[];
    expect(stored).not.toContain("name"); // 잠금 열은 제외 목록에 들어가지 않는다
    expect(stored).toContain("gmp");
  });

  it("저장 이후 새로 생긴 열은 기본 켜짐(제외 목록에 없으므로)", () => {
    window.localStorage.setItem("bpm.exportColumns.excel", JSON.stringify(["groups"]));
    const keys = loadExportColumns("excel");
    expect(keys).not.toContain("groups");
    expect(keys).toContain("parallel");
  });

  it("깨진 값·접근 실패는 기본(전부)으로 수렴한다", () => {
    window.localStorage.setItem("bpm.exportColumns.csv", "{broken");
    expect(loadExportColumns("csv")).toEqual(CSV_COLUMNS.map((c) => c.key));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadExportColumns("csv")).toEqual(CSV_COLUMNS.map((c) => c.key));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveExportColumns("csv", ["name"])).not.toThrow();
  });
});

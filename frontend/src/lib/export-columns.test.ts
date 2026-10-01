// 내보내기 컬럼 정의·선택 영속 단위 테스트 (export-column-picker-design 2026-10-02)
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CSV_COLUMNS,
  EXCEL_COLUMNS,
  loadExportColumns,
  normalizeExportColumns,
  saveExportColumns,
} from "./export-columns";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("normalizeExportColumns", () => {
  it("미지정이면 전부, 지정이면 정식 순서로 정렬하고 잠금 열을 강제한다", () => {
    expect(normalizeExportColumns(CSV_COLUMNS, undefined)).toEqual(CSV_COLUMNS.map((c) => c.key));
    expect(normalizeExportColumns(CSV_COLUMNS, ["next", "gmp", "unknown"])).toEqual(["name", "gmp", "next"]);
    expect(normalizeExportColumns(EXCEL_COLUMNS, [])).toEqual(["no", "name"]);
  });
});

describe("loadExportColumns / saveExportColumns", () => {
  it("저장이 없으면 기본은 전부 선택", () => {
    expect(loadExportColumns("csv")).toEqual(CSV_COLUMNS.map((c) => c.key));
    expect(loadExportColumns("excel")).toEqual(EXCEL_COLUMNS.map((c) => c.key));
  });

  it("제외한 키만 저장해 다시 읽으면 같은 선택이 되고, 종류별로 따로 기억한다", () => {
    saveExportColumns("csv", ["name", "description", "next"]);
    expect(loadExportColumns("csv")).toEqual(["name", "description", "next"]);
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

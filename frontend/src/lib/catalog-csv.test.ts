// 카탈로그 CSV 임포트 — 1열 파싱(헤더 value 허용)·대소문자 무시 병합 (설정 Catalogs 탭)
import { describe, expect, it } from "vitest";

import { mergeCatalogValues, parseCatalogCsv } from "./catalog-csv";

describe("parseCatalogCsv", () => {
  it("reads the first column, skips a value header and blank lines", () => {
    expect(parseCatalogCsv("value\r\n실험자\r\n\r\n 검토자 ,ignored\r\n")).toEqual(["실험자", "검토자"]);
  });
  it("accepts a headerless file", () => {
    expect(parseCatalogCsv("LIMS\nSAP\n")).toEqual(["LIMS", "SAP"]);
  });
});

describe("mergeCatalogValues", () => {
  it("appends new values, counts duplicates case-insensitively and keeps the existing spelling", () => {
    const { next, added, duplicates } = mergeCatalogValues(["LIMS"], ["lims", "SAP", " SAP ", ""]);
    expect(next).toEqual(["LIMS", "SAP"]);
    expect(added).toBe(1);
    expect(duplicates).toBe(2);
  });
});

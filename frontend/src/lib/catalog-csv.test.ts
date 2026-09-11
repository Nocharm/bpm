// 카탈로그 CSV 임포트 — value,aliases 2열 파싱(별칭 | 구분, 헤더 선택)·값 병합 + 별칭 합집합 (설정 Catalogs 탭)
import { describe, expect, it } from "vitest";

import { mergeCatalogEntries, normalizeAliases, parseCatalogCsv } from "./catalog-csv";

describe("parseCatalogCsv", () => {
  it("reads value and |-separated aliases, skips a header and blank lines", () => {
    expect(parseCatalogCsv("value,aliases\r\n실험자,\r\n\r\n 검토자 ,리뷰어| review |리뷰어\r\n")).toEqual([
      { value: "실험자", aliases: [] },
      { value: "검토자", aliases: ["리뷰어", "review"] },
    ]);
  });
  it("accepts a headerless single-column file", () => {
    expect(parseCatalogCsv("LIMS\nSAP\n")).toEqual([{ value: "LIMS", aliases: [] }, { value: "SAP", aliases: [] }]);
  });
});

describe("mergeCatalogEntries", () => {
  it("appends new values, unions aliases into existing values and counts duplicates", () => {
    const { next, added, duplicates, aliasesAdded } = mergeCatalogEntries(
      [{ value: "LIMS", aliases: ["랩정보"] }],
      [
        { value: "lims", aliases: ["lab info", "랩정보"] },
        { value: "SAP", aliases: ["sap erp"] },
        { value: " SAP ", aliases: [] },
        { value: "", aliases: ["x"] },
      ],
    );
    expect(next).toEqual([{ value: "LIMS", aliases: ["랩정보", "lab info"] }, { value: "SAP", aliases: ["sap erp"] }]);
    expect(added).toBe(1);
    expect(duplicates).toBe(2);
    expect(aliasesAdded).toBe(2);
  });
});

describe("normalizeAliases", () => {
  it("drops aliases that collide with any value or an earlier alias (values win)", () => {
    expect(
      normalizeAliases([
        { value: "Reviewer", aliases: ["검토자", "approver", "Reviewer"] },
        { value: "Approver", aliases: ["승인자", "검토자"] },
      ]),
    ).toEqual([{ value: "Reviewer", aliases: ["검토자"] }, { value: "Approver", aliases: ["승인자"] }]);
  });
});

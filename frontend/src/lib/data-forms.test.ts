import { describe, expect, it } from "vitest";

import { matchExactDataForm, resolveDataForm, searchDataForms } from "./data-forms";

describe("searchDataForms", () => {
  it("확장자/영문/한글 어느 쪽으로도 같은 항목이 최상위", () => {
    expect(searchDataForms(".xlsx")[0].value).toBe("Excel");
    expect(searchDataForms("excel")[0].value).toBe("Excel");
    expect(searchDataForms("엑셀")[0].value).toBe("Excel");
    expect(searchDataForms("파워")[0].value).toBe("PowerPoint");
    expect(searchDataForms("메일")[0].value).toBe("Email");
  });

  it("부분 질의도 유사도 랭킹으로 매치", () => {
    expect(searchDataForms("doc").map((o) => o.value)).toContain("Word");
    expect(searchDataForms("doc").map((o) => o.value)).toContain("document");
  });

  it("빈 질의는 전체 카탈로그", () => {
    expect(searchDataForms("").length).toBeGreaterThanOrEqual(12);
  });
});

describe("resolveDataForm / matchExactDataForm", () => {
  it("canonical·별칭·확장자 대소문자 무시 매치", () => {
    expect(resolveDataForm("EXCEL")?.value).toBe("Excel");
    expect(resolveDataForm(".pdf")?.value).toBe("PDF");
    expect(resolveDataForm("document")?.value).toBe("document");
    expect(matchExactDataForm("워드")).toBe("Word");
  });

  it("미지(기타) 값은 null — 자유값은 추가 행 경로", () => {
    expect(resolveDataForm("계약서 원본")).toBeNull();
    expect(matchExactDataForm("계약서 원본")).toBeNull();
  });
});

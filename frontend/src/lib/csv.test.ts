// 범용 CSV 유틸 단위 테스트 — 이스케이프 규칙 + CRLF 조인.
import { describe, expect, it } from "vitest";

import { buildCsv, escapeCsvCell } from "./csv";

describe("escapeCsvCell", () => {
  it("특수문자 없는 셀은 그대로 반환", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
  });

  it("쉼표 포함 셀은 인용", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
  });

  it("따옴표 포함 셀은 이중화 후 인용", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("개행 포함 셀은 인용", () => {
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("'='로 시작하는 셀은 수식 인젝션 가드로 ' 접두", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
  });

  it("가드 접두 후 쉼표까지 있으면 인용도 함께 적용", () => {
    expect(escapeCsvCell("=a,b")).toBe('"\'=a,b"');
  });
});

describe("buildCsv", () => {
  it("행은 CRLF로, 셀은 쉼표로 조인한다", () => {
    const csv = buildCsv([
      ["Name", "Dept"],
      ["A", "Quality"],
      ["B, C", 'say "hi"'],
    ]);
    expect(csv).toBe('Name,Dept\r\nA,Quality\r\n"B, C","say ""hi"""');
  });
});

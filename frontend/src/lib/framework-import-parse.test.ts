// 프레임워크 대량 임포트 클라이언트 파서 단위 테스트 (brief: .superpowers/sdd/2026-08-11-framework-admin-ui/task-4-brief.md)
import { describe, expect, it } from "vitest";

import { parseCategoriesFile, parseInterviewFile, parseMapsFile } from "./framework-import-parse";

describe("parseCategoriesFile", () => {
  it("{categories:[...]} 형태를 그대로 반환한다", () => {
    const result = parseCategoriesFile(
      JSON.stringify({ categories: [{ code: "A", name: "구매", level: 1, parent: null }] }),
    );
    expect(result.error).toBeUndefined();
    expect(result.categories).toEqual([{ code: "A", name: "구매", level: 1, parent: null }]);
  });

  it("빈 파일은 오류로 보고한다", () => {
    const result = parseCategoriesFile("");
    expect(result.categories).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("깨진 JSON 문법은 오류로 보고한다", () => {
    const result = parseCategoriesFile("{ not valid json");
    expect(result.categories).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("{categories:[...]} 형태가 아니면 오류로 보고한다(최상위 배열)", () => {
    const result = parseCategoriesFile(JSON.stringify([{ code: "A" }]));
    expect(result.categories).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("{categories:[...]} 형태가 아니면 오류로 보고한다(키 누락)", () => {
    const result = parseCategoriesFile(JSON.stringify({ items: [] }));
    expect(result.categories).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe("parseMapsFile", () => {
  it("JSONL(줄 단위) 텍스트를 파싱한다", () => {
    const text = ['{"code":"A"}', '{"code":"B"}'].join("\n");
    const result = parseMapsFile(text);
    expect(result.maps).toEqual([{ code: "A" }, { code: "B" }]);
    expect(result.lineErrors).toEqual([]);
  });

  it("JSON 배열 텍스트를 파싱한다", () => {
    const text = JSON.stringify([{ code: "A" }, { code: "B" }]);
    const result = parseMapsFile(text);
    expect(result.maps).toEqual([{ code: "A" }, { code: "B" }]);
    expect(result.lineErrors).toEqual([]);
  });

  it("깨진 줄은 수집하고 나머지 유효한 줄은 계속 파싱한다", () => {
    const text = ['{"code":"A"}', "{ not valid", '{"code":"C"}'].join("\n");
    const result = parseMapsFile(text);
    expect(result.maps).toEqual([{ code: "A" }, { code: "C" }]);
    expect(result.lineErrors).toHaveLength(1);
    expect(result.lineErrors[0]).toContain("2");
  });

  it("빈 파일은 빈 결과를 반환한다(오류 아님)", () => {
    const result = parseMapsFile("");
    expect(result.maps).toEqual([]);
    expect(result.lineErrors).toEqual([]);
  });

  it("빈 줄은 건너뛴다", () => {
    const text = ['{"code":"A"}', "", "  ", '{"code":"B"}'].join("\n");
    const result = parseMapsFile(text);
    expect(result.maps).toEqual([{ code: "A" }, { code: "B" }]);
    expect(result.lineErrors).toEqual([]);
  });
});

describe("parseInterviewFile", () => {
  it("정상 객체 파일을 content로 반환한다", () => {
    const result = parseInterviewFile('{"schema_version": "0.3", "rows": []}');
    expect(result.error).toBeUndefined();
    expect(result.content).toEqual({ schema_version: "0.3", rows: [] });
  });

  it("깨진 JSON은 error를 채운다", () => {
    const result = parseInterviewFile("{broken");
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/Invalid JSON/);
  });

  it("루트가 객체가 아니면(배열) error", () => {
    const result = parseInterviewFile("[1, 2]");
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/object/);
  });
});

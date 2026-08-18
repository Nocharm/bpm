// 인터뷰 임포트 클라이언트 파서 단위 테스트 — canonical 파서 테스트는 경로 제거와 함께 삭제(2026-08-18).
import { describe, expect, it } from "vitest";

import { parseInterviewFile } from "./framework-import-parse";

describe("parseInterviewFile", () => {
  it("정상 객체 파일을 content로 반환한다", () => {
    const result = parseInterviewFile('{"schema_version": "0.3", "rows": []}');
    expect(result.error).toBeUndefined();
    expect(result.content).toEqual({ schema_version: "0.3", rows: [] });
  });

  it("빈 파일은 error", () => {
    const result = parseInterviewFile("   ");
    expect(result.content).toBeNull();
    expect(result.error).toBeTruthy();
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

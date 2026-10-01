// subprocess-embed 핸들 헬퍼 — 들어오는 문(in) 네 방향 id와 끝 핸들 판정
import { describe, expect, it } from "vitest";

import {
  isSubprocessEndHandle,
  isSubprocessInHandle,
  parseSubprocessInHandle,
  PRIMARY_END_HANDLE,
  SUBPROCESS_IN_HANDLE,
  subprocessInHandle,
} from "@/lib/subprocess-embed";

describe("subprocessInHandle / parseSubprocessInHandle", () => {
  it("좌측은 레거시 id 'in' 그대로, 나머지 변은 'in:<side>'", () => {
    expect(subprocessInHandle("left")).toBe(SUBPROCESS_IN_HANDLE);
    expect(subprocessInHandle("top")).toBe("in:top");
    expect(subprocessInHandle("right")).toBe("in:right");
    expect(subprocessInHandle("bottom")).toBe("in:bottom");
  });

  it("파싱은 역함수 — 'in'은 left, 모르는 id·null은 null", () => {
    expect(parseSubprocessInHandle("in")).toBe("left");
    expect(parseSubprocessInHandle("in:bottom")).toBe("bottom");
    expect(parseSubprocessInHandle("t-left")).toBeNull();
    expect(parseSubprocessInHandle("in:diagonal")).toBeNull();
    expect(parseSubprocessInHandle(null)).toBeNull();
    expect(parseSubprocessInHandle(undefined)).toBeNull();
  });
});

describe("isSubprocessInHandle / isSubprocessEndHandle", () => {
  it("in 변형은 들어오는 문, 변 id·끝 키는 아니다", () => {
    expect(isSubprocessInHandle("in")).toBe(true);
    expect(isSubprocessInHandle("in:top")).toBe(true);
    expect(isSubprocessInHandle("t-left")).toBe(false);
    expect(isSubprocessInHandle(PRIMARY_END_HANDLE)).toBe(false);
  });

  it("끝 핸들 = 변 id(s-*)·in 변형·null이 아닌 문자열(대표 끝 또는 끝 제목)", () => {
    expect(isSubprocessEndHandle(PRIMARY_END_HANDLE)).toBe(true);
    expect(isSubprocessEndHandle("반려")).toBe(true);
    expect(isSubprocessEndHandle("s-right")).toBe(false);
    expect(isSubprocessEndHandle("in")).toBe(false);
    expect(isSubprocessEndHandle(null)).toBe(false);
    expect(isSubprocessEndHandle(undefined)).toBe(false);
    expect(isSubprocessEndHandle("")).toBe(false);
  });
});

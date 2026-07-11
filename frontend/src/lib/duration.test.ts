import { describe, expect, it } from "vitest";

import { formatDurationHm, normalizeDuration, normalizeNumericParam } from "./duration";

describe("normalizeDuration", () => {
  it("빈값은 빈값", () => expect(normalizeDuration("")).toBe(""));
  it("공백 트림", () => expect(normalizeDuration(" 2 ")).toBe("2"));
  it("정수 그대로", () => expect(normalizeDuration("2")).toBe("2"));
  it("2자리 분 유지", () => expect(normalizeDuration("1.15")).toBe("1.15"));
  it("1자리는 10분 단위 패딩", () => expect(normalizeDuration("0.3")).toBe("0.30"));
  it("3분", () => expect(normalizeDuration("0.03")).toBe("0.03"));
  it("60분 이월", () => expect(normalizeDuration("0.60")).toBe("1"));
  it("75분 이월", () => expect(normalizeDuration("0.75")).toBe("1.15"));
  it("2.99 → 3.39", () => expect(normalizeDuration("2.99")).toBe("3.39"));
  it("소수부 0은 정수로", () => expect(normalizeDuration("2.00")).toBe("2"));
  it("자유텍스트 무효", () => expect(normalizeDuration("2일")).toBeNull());
  it("음수 무효", () => expect(normalizeDuration("-1")).toBeNull());
  it("소수부 3자리 무효", () => expect(normalizeDuration("1.234")).toBeNull());
  it("점만 무효", () => expect(normalizeDuration(".")).toBeNull());
});

describe("normalizeNumericParam", () => {
  it("빈값", () => expect(normalizeNumericParam("")).toBe(""));
  it("정수", () => expect(normalizeNumericParam("3")).toBe("3"));
  it("소수", () => expect(normalizeNumericParam("2.25")).toBe("2.25"));
  it("텍스트 무효", () => expect(normalizeNumericParam("2명")).toBeNull());
  it("음수 무효", () => expect(normalizeNumericParam("-2")).toBeNull());
});

describe("formatDurationHm", () => {
  it("시+분", () => expect(formatDurationHm("1.30")).toBe("1h30m"));
  it("정수 시간", () => expect(formatDurationHm("2")).toBe("2h"));
  it("분만", () => expect(formatDurationHm("0.30")).toBe("30m"));
  it("분 제로패딩 없음", () => expect(formatDurationHm("1.05")).toBe("1h5m"));
  it("0은 0h", () => expect(formatDurationHm("0")).toBe("0h"));
  it("빈값", () => expect(formatDurationHm("")).toBe(""));
  it("무효(레거시)", () => expect(formatDurationHm("2일")).toBe(""));
  it("비정규 입력도 정규화 후 포맷", () => expect(formatDurationHm("0.75")).toBe("1h15m"));
});

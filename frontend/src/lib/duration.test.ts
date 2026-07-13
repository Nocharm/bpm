import { describe, expect, it } from "vitest";

import {
  formatDurationHm,
  formatThousands,
  normalizeDuration,
  normalizeNumericParam,
  stripThousands,
} from "./duration";

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

describe("formatThousands", () => {
  it("정수부에 세 자리마다 콤마", () => {
    expect(formatThousands("1250000")).toBe("1,250,000");
    expect(formatThousands("380000")).toBe("380,000");
    expect(formatThousands("999")).toBe("999");
  });

  it("소수부는 콤마 없이 보존", () => {
    expect(formatThousands("1200.50")).toBe("1,200.50");
  });

  it("빈값·무효값은 빈 문자열", () => {
    expect(formatThousands("")).toBe("");
    expect(formatThousands("abc")).toBe("");
  });

  it("4자리는 콤마 1개만", () => expect(formatThousands("1000")).toBe("1,000"));
});

describe("stripThousands", () => {
  it("콤마를 제거한다 — CSV의 '1,250,000' 같은 입력 허용", () => {
    expect(stripThousands("1,250,000")).toBe("1250000");
    expect(stripThousands("1200.50")).toBe("1200.50");
  });

  it("콤마 없는 값은 그대로", () => expect(stripThousands("999")).toBe("999"));

  it("왕복 — strip 후 재포맷하면 원래 표시형으로 복원", () => {
    expect(formatThousands(stripThousands("1,250,000"))).toBe("1,250,000");
  });
});

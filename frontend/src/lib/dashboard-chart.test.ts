import { describe, expect, it } from "vitest";

import { buildScale, getTodayKeyKst, resolvePeriod } from "./dashboard-chart";

describe("buildScale", () => {
  it("올림한 nice max를 만든다", () => {
    const scale = buildScale([3, 7, 12], 4);
    expect(scale.max).toBe(20);
  });

  it("전부 0이면 max를 1로 둬 0 나눗셈을 막는다", () => {
    const scale = buildScale([0, 0], 4);
    expect(scale.max).toBe(1);
  });

  it("빈 배열도 안전하다", () => {
    expect(buildScale([], 4).max).toBe(1);
  });
});

describe("resolvePeriod", () => {
  it("7일은 오늘 포함 7일 창을 만든다", () => {
    expect(resolvePeriod("7d", "2026-07-11")).toEqual({
      from: "2026-07-05",
      to: "2026-07-11",
    });
  });

  it("1개월은 30일, 3개월은 90일 창", () => {
    expect(resolvePeriod("1m", "2026-07-11").from).toBe("2026-06-12");
    expect(resolvePeriod("3m", "2026-07-11").from).toBe("2026-04-13");
  });

  it("월 경계를 넘어도 정확하다", () => {
    expect(resolvePeriod("7d", "2026-03-02")).toEqual({
      from: "2026-02-24",
      to: "2026-03-02",
    });
  });
});

describe("getTodayKeyKst", () => {
  it("KST 기준 YYYY-MM-DD를 만든다 — 브라우저 tz와 무관", () => {
    // UTC 2026-07-11T20:00Z = KST 2026-07-12 05:00 → 날짜키는 07-12
    expect(getTodayKeyKst(new Date("2026-07-11T20:00:00Z"))).toBe("2026-07-12");
    expect(getTodayKeyKst(new Date("2026-07-11T10:00:00Z"))).toBe("2026-07-11");
  });
});

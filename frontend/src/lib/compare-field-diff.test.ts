// 비교 필드 diff 분류·텍스트 부분 diff 테스트.
import { describe, expect, it } from "vitest";

import { classifyFieldDiff, splitTextDiff } from "@/lib/compare-field-diff";

describe("classifyFieldDiff", () => {
  it("returns added when value appears (empty → value)", () => {
    expect(classifyFieldDiff("", "박승인")).toBe("added");
  });

  it("returns removed when value disappears (value → empty)", () => {
    expect(classifyFieldDiff("50,000", "")).toBe("removed");
  });

  it("returns changed when both sides have values", () => {
    expect(classifyFieldDiff("김결제", "박결제")).toBe("changed");
  });

  it("treats whitespace-only as empty", () => {
    expect(classifyFieldDiff("  ", "PG v2")).toBe("added");
  });
});

describe("splitTextDiff", () => {
  it("isolates the changed middle with common prefix/suffix", () => {
    expect(splitTextDiff("고객 주문 접수", "고객 주문 발생")).toEqual({
      prefix: "고객 주문 ",
      removedMid: "접수",
      addedMid: "발생",
      suffix: "",
    });
  });

  it("keeps a shared suffix", () => {
    expect(splitTextDiff("재무팀", "재무혁신팀")).toEqual({
      prefix: "재무",
      removedMid: "",
      addedMid: "혁신",
      suffix: "팀",
    });
  });

  it("marks fully different strings whole", () => {
    expect(splitTextDiff("PG", "결제 게이트웨이")).toEqual({
      prefix: "",
      removedMid: "PG",
      addedMid: "결제 게이트웨이",
      suffix: "",
    });
  });

  it("does not double-count overlapping prefix/suffix", () => {
    expect(splitTextDiff("aa", "a")).toEqual({
      prefix: "a",
      removedMid: "a",
      addedMid: "",
      suffix: "",
    });
  });
});

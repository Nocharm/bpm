// 서브프로세스 설명 합성(링크맵 베이스 + 이 맵 추가분) 테스트.
import { describe, expect, it } from "vitest";

import { mergeSubprocessDescription } from "./subprocess-description";

describe("mergeSubprocessDescription", () => {
  it("joins base and local with a newline", () => {
    expect(mergeSubprocessDescription("주문 처리 표준 절차", "우리 팀은 B안으로 운영")).toBe(
      "주문 처리 표준 절차\n우리 팀은 B안으로 운영",
    );
  });

  it("returns local only when base is empty/null", () => {
    expect(mergeSubprocessDescription("", "추가분")).toBe("추가분");
    expect(mergeSubprocessDescription(null, "추가분")).toBe("추가분");
    expect(mergeSubprocessDescription(undefined, "추가분")).toBe("추가분");
  });

  it("returns base only when local is empty/null", () => {
    expect(mergeSubprocessDescription("베이스", "")).toBe("베이스");
    expect(mergeSubprocessDescription("베이스", null)).toBe("베이스");
  });

  it("returns empty string when both are empty", () => {
    expect(mergeSubprocessDescription("", "")).toBe("");
    expect(mergeSubprocessDescription(null, undefined)).toBe("");
  });

  it("trims stray edge whitespace but keeps internal line breaks", () => {
    expect(mergeSubprocessDescription("베이스 1줄\n2줄\n", "  추가분  ")).toBe(
      "베이스 1줄\n2줄\n추가분",
    );
  });
});

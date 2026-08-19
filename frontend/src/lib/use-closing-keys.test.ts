import { describe, expect, it } from "vitest";

import { pickSectionClass } from "./use-closing-keys";

describe("pickSectionClass", () => {
  it("첫 페인트·복원 펼침은 애니메이션 없이 같은 레이아웃만", () => {
    expect(pickSectionClass(false, false)).toBe("accordion-static");
  });

  it("사용자가 조작한 뒤의 펼침은 진입 애니메이션", () => {
    expect(pickSectionClass(false, true)).toBe("accordion-open");
  });

  it("닫히는 중이면 조작 여부와 무관하게 접힘 애니메이션", () => {
    expect(pickSectionClass(true, true)).toBe("accordion-close");
    expect(pickSectionClass(true, false)).toBe("accordion-close");
  });
});

import { describe, expect, it } from "vitest";

import { buildTypingSchedule } from "./typewriter";

describe("buildTypingSchedule", () => {
  it("spaces characters evenly at msPerChar", () => {
    expect(buildTypingSchedule("abc", 25, 1200)).toEqual([25, 50, 75]);
  });
  it("compresses long text so the whole word finishes within capMs", () => {
    const s = buildTypingSchedule("x".repeat(100), 25, 1200);
    expect(s).toHaveLength(100);
    expect(s[99]).toBe(1200);
    expect(s[0]).toBe(12);
  });
  it("empty text has no frames", () => {
    expect(buildTypingSchedule("", 25, 1200)).toEqual([]);
  });
});

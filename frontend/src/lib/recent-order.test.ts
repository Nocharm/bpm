import { beforeEach, describe, expect, it } from "vitest";

import { readTopChanged } from "@/lib/recent-order";

describe("readTopChanged", () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it("is true on first sight of a top id and stores it", () => {
    expect(readTopChanged(5)).toBe(true);
    expect(window.sessionStorage.getItem("bpm.home.recentTop")).toBe("5");
  });

  it("is false when top id is unchanged", () => {
    readTopChanged(5);
    expect(readTopChanged(5)).toBe(false);
  });

  it("is true when top id changes", () => {
    readTopChanged(5);
    expect(readTopChanged(7)).toBe(true);
  });

  it("is false for null top", () => {
    expect(readTopChanged(null)).toBe(false);
  });
});

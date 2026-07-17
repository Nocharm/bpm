import { beforeEach, describe, expect, it } from "vitest";

import { commitTop, peekTopChanged } from "@/lib/recent-order";

describe("peekTopChanged", () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it("is true on first sight and does not mutate storage", () => {
    expect(peekTopChanged(5)).toBe(true);
    expect(peekTopChanged(5)).toBe(true);
    expect(window.sessionStorage.getItem("bpm.home.recentTop")).toBe(null);
  });

  it("is false after commitTop stores the same id", () => {
    commitTop(5);
    expect(peekTopChanged(5)).toBe(false);
    expect(window.sessionStorage.getItem("bpm.home.recentTop")).toBe("5");
  });

  it("is true when top id differs from the committed one", () => {
    commitTop(5);
    expect(peekTopChanged(7)).toBe(true);
  });

  it("is false for null top; commitTop(null) writes nothing", () => {
    expect(peekTopChanged(null)).toBe(false);
    commitTop(null);
    expect(window.sessionStorage.getItem("bpm.home.recentTop")).toBe(null);
  });
});

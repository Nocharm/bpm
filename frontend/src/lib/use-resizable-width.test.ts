import { describe, expect, it } from "vitest";

import { readStoredWidth } from "./use-resizable-width";

describe("readStoredWidth", () => {
  it("returns the stored value when inside [min, max]", () => {
    expect(readStoredWidth("320", 240, 520, 288)).toBe(320);
  });
  it("falls back when missing, NaN or out of range", () => {
    expect(readStoredWidth(null, 240, 520, 288)).toBe(288);
    expect(readStoredWidth("abc", 240, 520, 288)).toBe(288);
    expect(readStoredWidth("100", 240, 520, 288)).toBe(288);
    expect(readStoredWidth("900", 240, 520, 288)).toBe(288);
  });
});

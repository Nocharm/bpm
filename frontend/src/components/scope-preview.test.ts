import { describe, expect, it } from "vitest";

import { buildDiamondPoints } from "./scope-preview";

describe("buildDiamondPoints", () => {
  it("returns the four box-inscribed vertices top,right,bottom,left", () => {
    expect(buildDiamondPoints(10, 20, 100, 50)).toBe("60,20 110,45 60,70 10,45");
  });
});

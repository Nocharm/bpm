import { describe, expect, it } from "vitest";

import { splitMapsByMode } from "@/lib/map-mode";

describe("splitMapsByMode", () => {
  it("routes framework linkage canvases to their own bucket (missing mode = process)", () => {
    const { processMaps, frameworkMaps } = splitMapsByMode([
      { id: 1, mode: "normal" },
      { id: 3, mode: "framework" },
      { id: 4 },
    ]);
    expect(processMaps.map((m) => m.id)).toEqual([1, 4]);
    expect(frameworkMaps.map((m) => m.id)).toEqual([3]);
  });
});

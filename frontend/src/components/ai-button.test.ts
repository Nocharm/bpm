import { describe, expect, it } from "vitest";

import { buildAiButtonClass } from "./ai-button";

describe("buildAiButtonClass", () => {
  it("every variant carries the gradient + shimmer hooks", () => {
    for (const v of ["primary", "tile", "inline"] as const) {
      const cls = buildAiButtonClass(v);
      expect(cls).toContain("ai-shimmer");
      expect(cls).toContain("var(--color-accent)");
      expect(cls).toContain("text-on-accent");
    }
  });
  it("tile is a full-width row, inline is compact", () => {
    expect(buildAiButtonClass("tile")).toContain("h-14 w-full");
    expect(buildAiButtonClass("inline")).toContain("text-fine");
    expect(buildAiButtonClass("primary")).toContain("text-caption");
  });
});

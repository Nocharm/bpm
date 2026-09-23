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
  it("tile is a full-width row; inline and primary share one size", () => {
    expect(buildAiButtonClass("tile")).toContain("h-14 w-full");
    expect(buildAiButtonClass("inline")).toContain("px-3 py-1.5 text-caption");
    expect(buildAiButtonClass("primary")).toContain("px-3 py-1.5 text-caption");
  });
  it("text variant is a bare accent link without gradient or shimmer", () => {
    const cls = buildAiButtonClass("text");
    expect(cls).toContain("text-accent");
    expect(cls).not.toContain("ai-shimmer");
    expect(cls).not.toContain("linear-gradient");
  });
});

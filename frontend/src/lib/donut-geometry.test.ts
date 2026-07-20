import { describe, expect, it } from "vitest";

import { computeDonutArcs } from "@/lib/donut-geometry";

describe("computeDonutArcs", () => {
  it("splits circumference proportionally and accumulates offsets", () => {
    const C = 100;
    const arcs = computeDonutArcs(
      [{ key: "a", value: 3, colorVar: "--x" }, { key: "b", value: 1, colorVar: "--y" }],
      C,
    );
    expect(arcs).toHaveLength(2);
    // a=75% → dash "75 25", offset 0; b=25% → dash "25 75", offset -75
    expect(arcs[0].dashArray).toBe("75 25");
    expect(arcs[0].dashOffset).toBe(0);
    expect(arcs[1].dashArray).toBe("25 75");
    expect(arcs[1].dashOffset).toBe(-75);
  });

  it("drops zero-value segments", () => {
    const arcs = computeDonutArcs(
      [{ key: "a", value: 0, colorVar: "--x" }, { key: "b", value: 2, colorVar: "--y" }],
      100,
    );
    expect(arcs.map((a) => a.key)).toEqual(["b"]);
    expect(arcs[0].dashArray).toBe("100 0");
  });

  it("returns empty for all-zero", () => {
    expect(computeDonutArcs([{ key: "a", value: 0, colorVar: "--x" }], 100)).toEqual([]);
  });
});

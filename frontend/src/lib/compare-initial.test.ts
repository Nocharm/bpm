import { describe, expect, it } from "vitest";

import { pickInitialCompareVersions } from "./compare-initial";

const v = (id: number, status: string) => ({ id, status });

describe("pickInitialCompareVersions", () => {
  it("base=last published, target=latest other version", () => {
    const out = pickInitialCompareVersions([v(1, "published"), v(2, "draft")], false, new URLSearchParams());
    expect(out).toEqual({ baseId: 1, targetId: 2 });
  });
  it("published is the latest: target falls back to the previous version, never equal to base", () => {
    const out = pickInitialCompareVersions([v(1, "published"), v(2, "published")], false, new URLSearchParams());
    expect(out).toEqual({ baseId: 2, targetId: 1 });
  });
  it("single version: base and target are the same (nothing else to pick)", () => {
    const out = pickInitialCompareVersions([v(7, "draft")], false, new URLSearchParams());
    expect(out).toEqual({ baseId: 7, targetId: 7 });
  });
  it("framework maps use the last confirmed snapshot as base", () => {
    const out = pickInitialCompareVersions([v(1, "confirmed"), v(2, "confirmed"), v(3, "draft")], true, new URLSearchParams());
    expect(out).toEqual({ baseId: 2, targetId: 3 });
  });
  it("deep link ids win when they exist", () => {
    const out = pickInitialCompareVersions([v(1, "published"), v(2, "draft"), v(3, "draft")], false, new URLSearchParams("base=2&target=1"));
    expect(out).toEqual({ baseId: 2, targetId: 1 });
  });
  it("unknown deep link ids fall back to defaults", () => {
    const out = pickInitialCompareVersions([v(1, "published"), v(2, "draft")], false, new URLSearchParams("base=99"));
    expect(out).toEqual({ baseId: 1, targetId: 2 });
  });
});

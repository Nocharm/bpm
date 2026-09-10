import { describe, expect, it } from "vitest";

import { collectMapWarnings } from "./map-card-warnings";

describe("collectMapWarnings", () => {
  it("returns nothing for a healthy map", () => {
    expect(collectMapWarnings({ owning_department: "A/B", stale_ref_count: 0 })).toEqual([]);
    expect(collectMapWarnings({ owning_department: "A/B" })).toEqual([]);
  });
  it("flags missing owning department (null or empty)", () => {
    expect(collectMapWarnings({ owning_department: null })).toEqual([{ kind: "owning_missing" }]);
    expect(collectMapWarnings({ owning_department: "" })).toEqual([{ kind: "owning_missing" }]);
  });
  it("flags stale refs with count, after owning", () => {
    expect(collectMapWarnings({ owning_department: null, stale_ref_count: 3 })).toEqual([
      { kind: "owning_missing" },
      { kind: "stale_refs", count: 3 },
    ]);
    expect(collectMapWarnings({ owning_department: "A", stale_ref_count: 1 })).toEqual([
      { kind: "stale_refs", count: 1 },
    ]);
  });
});

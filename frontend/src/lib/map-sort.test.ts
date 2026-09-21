import { describe, expect, it } from "vitest";

import { isMapSortKey, sortMaps } from "@/lib/map-sort";

const rows = [
  { id: 1, name: "나", updated_at: "2026-09-02T00:00:00", created_at: "2026-01-01T00:00:00" },
  { id: 2, name: "가", updated_at: "2026-09-03T00:00:00", created_at: "2026-03-01T00:00:00" },
  { id: 3, name: "다", updated_at: "2026-09-01T00:00:00", created_at: "2026-02-01T00:00:00" },
];

describe("sortMaps", () => {
  it("sorts by updated desc by default and does not mutate the input", () => {
    const out = sortMaps(rows, "updated");
    expect(out.map((r) => r.id)).toEqual([2, 1, 3]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });
  it("sorts by name (ko collation) and by created desc", () => {
    expect(sortMaps(rows, "name").map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortMaps(rows, "created").map((r) => r.id)).toEqual([2, 3, 1]);
  });
  it("keeps input order for equal keys (stable)", () => {
    const same = rows.map((r) => ({ ...r, updated_at: "2026-09-01T00:00:00" }));
    expect(sortMaps(same, "updated").map((r) => r.id)).toEqual([1, 2, 3]);
  });
  it("guards persisted values", () => {
    expect(isMapSortKey("name")).toBe(true);
    expect(isMapSortKey("bogus")).toBe(false);
  });
});

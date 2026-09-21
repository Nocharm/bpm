import { describe, expect, it } from "vitest";

import type { MapSummary } from "@/lib/api";
import { groupHitsByCategory } from "@/lib/framework-search-groups";

const map = (over: Partial<MapSummary>): MapSummary => ({ id: 0, name: "", ...over }) as MapSummary;
const hit = (m: MapSummary) => ({ item: m });

describe("groupHitsByCategory", () => {
  it("groups general maps by L5, attaches the canvas hit to its group, unregistered last", () => {
    const hits = [
      hit(map({ id: 1, name: "a", category_id: null })),
      hit(map({ id: 2, name: "b", category_id: 5, category_path: "L1/L2/L3/L4/L5" })),
      hit(map({ id: 3, name: "c", mode: "framework", linkage_category_id: 5, linkage_category_path: "L1/L2/L3/L4/L5" })),
      hit(map({ id: 4, name: "d", category_id: 9, category_path: "X1/X2/X3/X4/X5" })),
      hit(map({ id: 5, name: "e", category_id: 5, category_path: "L1/L2/L3/L4/L5" })),
    ];
    const groups = groupHitsByCategory(hits);
    expect(groups.map((g) => g.key)).toEqual(["cat:5", "cat:9", "unregistered"]);
    expect(groups[0].path).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(groups[0].canvas?.id).toBe(3);
    expect(groups[0].rows.map((h) => h.item.id)).toEqual([2, 5]);
    expect(groups[2].rows.map((h) => h.item.id)).toEqual([1]);
  });
  it("skips canvases without a linkage and keeps a canvas-only group", () => {
    const groups = groupHitsByCategory([
      hit(map({ id: 1, mode: "framework", linkage_category_id: null })),
      hit(map({ id: 2, mode: "framework", linkage_category_id: 7, linkage_category_path: "A/B/C/D/E" })),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(0);
    expect(groups[0].canvas?.id).toBe(2);
  });
});

import { describe, expect, it } from "vitest";

import type { MapSummary } from "@/lib/api";
import { bucketOfMap, countByBucket, countByStatus, sortForBucket, sortForStatus, summarizeDept } from "@/lib/dashboard-stats";

function makeMap(partial: Partial<MapSummary> & { id: number }): MapSummary {
  return {
    name: `map-${partial.id}`,
    description: "",
    created_by: "u",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    my_role: "owner",
    visibility: "public",
    latest_version_status: null,
    ...partial,
  } as MapSummary;
}

describe("bucketOfMap", () => {
  it("maps published+draft to updating, published-only to current, draft-only to unpublished", () => {
    expect(bucketOfMap(makeMap({ id: 1, latest_version_status: "draft", published_version_number: 1 }))).toBe("updating");
    expect(bucketOfMap(makeMap({ id: 2, latest_version_status: "pending", published_version_number: 2 }))).toBe("updating");
    expect(bucketOfMap(makeMap({ id: 3, latest_version_status: "published", published_version_number: 1 }))).toBe("current");
    expect(bucketOfMap(makeMap({ id: 4, latest_version_status: "confirmed" }))).toBe("current");
    expect(bucketOfMap(makeMap({ id: 5, latest_version_status: "draft" }))).toBe("unpublished");
    expect(bucketOfMap(makeMap({ id: 6 }))).toBe("unpublished");
  });

  it("sends expired and rejected to recheck regardless of a published version", () => {
    expect(bucketOfMap(makeMap({ id: 1, latest_version_status: "rejected", published_version_number: 1 }))).toBe("recheck");
    expect(bucketOfMap(makeMap({ id: 2, latest_version_status: "expired" }))).toBe("recheck");
  });
});

describe("countByBucket / sortForBucket", () => {
  const maps = [
    makeMap({ id: 1, latest_version_status: "draft", published_version_number: 1, updated_at: "2026-01-03T00:00:00Z" }),
    makeMap({ id: 2, latest_version_status: "published", published_version_number: 1, updated_at: "2026-01-02T00:00:00Z" }),
    makeMap({ id: 3, latest_version_status: "draft", updated_at: "2026-01-05T00:00:00Z" }),
    makeMap({ id: 4, latest_version_status: "approved", published_version_number: 2, updated_at: "2026-01-04T00:00:00Z" }),
  ];
  it("counts in bucket order and drops empty buckets", () => {
    expect(countByBucket(maps)).toEqual([
      { bucket: "unpublished", count: 1 },
      { bucket: "current", count: 1 },
      { bucket: "updating", count: 2 },
    ]);
  });
  it("puts the picked bucket first, newest updated first inside", () => {
    expect(sortForBucket(maps, "updating").map((m) => m.id)).toEqual([4, 1, 3, 2]);
  });
});

describe("countByStatus", () => {
  it("treats a map without a version as draft and keeps workflow order", () => {
    const maps = [
      makeMap({ id: 1, latest_version_status: "published" }),
      makeMap({ id: 2 }),
      makeMap({ id: 3, latest_version_status: "draft" }),
      makeMap({ id: 4, latest_version_status: "rejected" }),
    ];
    expect(countByStatus(maps)).toEqual([
      { status: "draft", count: 2 },
      { status: "published", count: 1 },
      { status: "rejected", count: 1 },
    ]);
  });

  it("returns an empty list for no maps", () => {
    expect(countByStatus([])).toEqual([]);
  });
});

describe("sortForStatus", () => {
  const maps = [
    makeMap({ id: 1, latest_version_status: "published", updated_at: "2026-03-01T00:00:00Z" }),
    makeMap({ id: 2, latest_version_status: "draft", updated_at: "2026-01-01T00:00:00Z" }),
    makeMap({ id: 3, latest_version_status: "draft", updated_at: "2026-02-01T00:00:00Z" }),
  ];

  it("puts the selected status first, newest updated within each group", () => {
    expect(sortForStatus(maps, "draft").map((m) => m.id)).toEqual([3, 2, 1]);
  });

  it("sorts purely by updated_at when no status is selected", () => {
    expect(sortForStatus(maps, null).map((m) => m.id)).toEqual([1, 3, 2]);
  });
});

describe("summarizeDept", () => {
  it("counts maps with stale refs and without an SP designation", () => {
    const maps = [
      makeMap({ id: 1, stale_ref_count: 2, sp_designated_at: "2026-01-01T00:00:00Z" }),
      makeMap({ id: 2, stale_ref_count: 0 }),
      makeMap({ id: 3 }),
    ];
    expect(summarizeDept(maps)).toEqual({ total: 3, staleRefs: 1, spMissing: 2 });
  });
});

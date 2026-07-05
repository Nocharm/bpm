import { describe, expect, it } from "vitest";

import { mergeRecentEntry, partitionByRecency } from "@/lib/recent-maps";

describe("mergeRecentEntry", () => {
  it("prepends a new id", () => {
    expect(mergeRecentEntry([], 1, 100)).toEqual([{ id: 1, at: 100 }]);
  });

  it("moves an existing id to the front and updates its time", () => {
    const entries = [
      { id: 1, at: 10 },
      { id: 2, at: 20 },
    ];
    expect(mergeRecentEntry(entries, 2, 30)).toEqual([
      { id: 2, at: 30 },
      { id: 1, at: 10 },
    ]);
  });

  it("caps at max, dropping the oldest", () => {
    const entries = [
      { id: 1, at: 1 },
      { id: 2, at: 2 },
      { id: 3, at: 3 },
    ];
    expect(mergeRecentEntry(entries, 4, 4, 3)).toEqual([
      { id: 4, at: 4 },
      { id: 1, at: 1 },
      { id: 2, at: 2 },
    ]);
  });
});

describe("partitionByRecency", () => {
  const items = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }];
  const getId = (x: { id: number }) => x.id;

  it("splits recent (in recentIds order) from rest (original order)", () => {
    const { recent, rest } = partitionByRecency(items, getId, [30, 10]);
    expect(recent).toEqual([{ id: 30 }, { id: 10 }]);
    expect(rest).toEqual([{ id: 20 }, { id: 40 }]);
  });

  it("empty recentIds → everything is rest", () => {
    const { recent, rest } = partitionByRecency(items, getId, []);
    expect(recent).toEqual([]);
    expect(rest).toEqual(items);
  });

  it("ignores recentIds not present in items", () => {
    const { recent } = partitionByRecency(items, getId, [99, 20]);
    expect(recent).toEqual([{ id: 20 }]);
  });
});

import { describe, expect, it } from "vitest";

import { buildIoDiff, buildIoDiffSide } from "./io-diff";

describe("buildIoDiffSide", () => {
  it("marks kept items in after order, then appends removed ones", () => {
    expect(buildIoDiffSide("A\nB\nC", "C\nA\nD")).toEqual([
      { text: "C", status: "unchanged" },
      { text: "A", status: "unchanged" },
      { text: "D", status: "added" },
      { text: "B", status: "removed" },
    ]);
  });

  it("treats duplicates as a multiset and ignores blank lines", () => {
    expect(buildIoDiffSide("A\nA\n\n", " A ")).toEqual([
      { text: "A", status: "unchanged" },
      { text: "A", status: "removed" },
    ]);
  });
});

describe("buildIoDiff", () => {
  it("returns null when nothing was added or removed", () => {
    expect(buildIoDiff({ input: { before: "A\nB", after: "B\nA" }, output: { before: "", after: "" } })).toBeNull();
  });

  it("counts additions and removals across both sides", () => {
    const diff = buildIoDiff({ input: { before: "A", after: "A\nB" }, output: { before: "X\nY", after: "Y" } });
    expect(diff).not.toBeNull();
    expect(diff!.added).toBe(1);
    expect(diff!.removed).toBe(1);
    expect(diff!.output).toEqual([{ text: "Y", status: "unchanged" }, { text: "X", status: "removed" }]);
  });
});

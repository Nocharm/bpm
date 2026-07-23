import { describe, expect, it } from "vitest";

import {
  formatDocStamp,
  getStaleSectionNodeIds,
  needsRegenerate,
  splitMapsByMode,
} from "@/lib/word-map-home";

describe("splitMapsByMode", () => {
  it("separates word maps from process maps (missing mode = process)", () => {
    const { processMaps, wordMaps } = splitMapsByMode([
      { id: 1, mode: "normal" },
      { id: 2, mode: "word" },
      { id: 3 },
    ]);
    expect(processMaps.map((m) => m.id)).toEqual([1, 3]);
    expect(wordMaps.map((m) => m.id)).toEqual([2]);
  });
});

describe("needsRegenerate", () => {
  it("true only when import is newer than last generation", () => {
    expect(
      needsRegenerate({
        doc_imported_at: "2026-07-24T10:00:00+09:00",
        doc_generated_at: "2026-07-24T09:00:00+09:00",
      }),
    ).toBe(true);
    expect(
      needsRegenerate({
        doc_imported_at: "2026-07-24T08:00:00+09:00",
        doc_generated_at: "2026-07-24T09:00:00+09:00",
      }),
    ).toBe(false);
    expect(needsRegenerate({ doc_imported_at: "2026-07-24T08:00:00+09:00", doc_generated_at: null })).toBe(false);
    expect(needsRegenerate({ doc_imported_at: null, doc_generated_at: null })).toBe(false);
  });
});

describe("getStaleSectionNodeIds", () => {
  it("flags section nodes whose anchor left the catalog", () => {
    const ids = getStaleSectionNodeIds(
      [
        { id: "s1", nodeType: "section", sectionAnchor: "_Toc1" },
        { id: "s2", nodeType: "section", sectionAnchor: "_TocGone" },
        { id: "s3", nodeType: "section", sectionAnchor: "" },
        { id: "p1", nodeType: "process", sectionAnchor: "_TocGone" },
      ],
      [{ anchor: "_Toc1" }],
    );
    expect([...ids]).toEqual(["s2"]);
  });
});

describe("formatDocStamp", () => {
  it("formats to YYYY-MM-DD and passes through empties", () => {
    expect(formatDocStamp("2026-07-24T10:00:00+09:00")).toBe("2026-07-24");
    expect(formatDocStamp(null)).toBeNull();
    expect(formatDocStamp(undefined)).toBeNull();
  });
});

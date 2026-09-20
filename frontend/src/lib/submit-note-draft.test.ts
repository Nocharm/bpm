// findLatestPublishedVersion — 제출 코멘트 AI 초안의 base(최신 게시본) 선택 규칙.

import { describe, expect, it } from "vitest";

import type { VersionSummary } from "@/lib/api";
import { findLatestPublishedVersion } from "@/lib/submit-note-draft";

function mkVersion(over: Partial<VersionSummary> & { id: number; status: VersionSummary["status"] }): VersionSummary {
  return {
    label: `v${over.id}`,
    submitted_by: null,
    events: [],
    version_number: null,
    ...over,
  } as VersionSummary;
}

describe("findLatestPublishedVersion", () => {
  it("picks the published version with the highest number, ignoring the draft itself", () => {
    const versions = [
      mkVersion({ id: 1, status: "published", version_number: 1 }),
      mkVersion({ id: 2, status: "published", version_number: 2 }),
      mkVersion({ id: 3, status: "draft" }),
    ];
    expect(findLatestPublishedVersion(versions, 3)?.id).toBe(2);
  });

  it("falls back to the highest id when numbers are missing", () => {
    const versions = [mkVersion({ id: 5, status: "published" }), mkVersion({ id: 9, status: "published" })];
    expect(findLatestPublishedVersion(versions, 11)?.id).toBe(9);
  });

  it("returns null on the first submission (no published version)", () => {
    expect(findLatestPublishedVersion([mkVersion({ id: 1, status: "draft" })], 1)).toBeNull();
  });
});

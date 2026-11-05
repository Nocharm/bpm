// 홈 첫 실행 권유 판정 — 후보 맵 고르기·보일 조건·브라우저 기록·새 실행 주소
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapSummary } from "@/lib/api";
import {
  buildNewRunHref,
  hasNewRunParam,
  isRunOnboardSeen,
  markRunOnboardSeen,
  pickRunOnboardMaps,
  RUN_ONBOARD_SEEN_KEY,
  shouldShowRunOnboard,
} from "@/lib/run-onboard";

const buildMap = (id: number, patch: Partial<MapSummary> = {}): MapSummary => ({
  id,
  name: `Map ${id}`,
  description: "",
  created_by: null,
  created_at: "2026-11-01T00:00:00+09:00",
  updated_at: "2026-11-01T00:00:00+09:00",
  my_role: "viewer",
  visibility: "public",
  latest_version_status: "published",
  published_version_number: 1,
  ...patch,
});

describe("pickRunOnboardMaps", () => {
  it("keeps only visible maps with a published version", () => {
    const maps = [
      buildMap(1),
      buildMap(2, { published_version_number: null }),
      buildMap(3, { my_role: null }),
      buildMap(4, { deleted_at: "2026-11-02T00:00:00+09:00" }),
    ];
    expect(pickRunOnboardMaps(maps).map((m) => m.id)).toEqual([1]);
  });

  it("puts my maps first, then the most recently updated, up to the limit", () => {
    const maps = [
      buildMap(1, { updated_at: "2026-11-04T00:00:00+09:00" }),
      buildMap(2, { my_role: "editor", updated_at: "2026-10-01T00:00:00+09:00" }),
      buildMap(3, { updated_at: "2026-11-05T00:00:00+09:00" }),
      buildMap(4, { my_role: "owner", updated_at: "2026-10-02T00:00:00+09:00" }),
    ];
    expect(pickRunOnboardMaps(maps).map((m) => m.id)).toEqual([4, 2, 3]);
  });
});

describe("shouldShowRunOnboard", () => {
  const base = { isSeen: false, openRuns: 0, endedRuns: 0, candidateCount: 2 };

  it("shows for someone with no runs and a map to run", () => {
    expect(shouldShowRunOnboard(base)).toBe(true);
  });

  it("hides once seen, with any run history, or with nothing to run", () => {
    expect(shouldShowRunOnboard({ ...base, isSeen: true })).toBe(false);
    expect(shouldShowRunOnboard({ ...base, openRuns: 1 })).toBe(false);
    expect(shouldShowRunOnboard({ ...base, endedRuns: 1 })).toBe(false);
    expect(shouldShowRunOnboard({ ...base, candidateCount: 0 })).toBe(false);
  });
});

describe("seen flag", () => {
  afterEach(() => {
    window.localStorage.removeItem(RUN_ONBOARD_SEEN_KEY);
    vi.restoreAllMocks();
  });

  it("remembers that the onboarding was opened", () => {
    expect(isRunOnboardSeen()).toBe(false);
    markRunOnboardSeen();
    expect(isRunOnboardSeen()).toBe(true);
  });

  it("treats a blocked storage as not seen and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isRunOnboardSeen()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("new run link", () => {
  it("builds and reads the newRun flag", () => {
    expect(buildNewRunHref(7)).toBe("/maps/7?newRun=1");
    expect(hasNewRunParam("?newRun=1")).toBe(true);
    expect(hasNewRunParam("?version=3&newRun=1")).toBe(true);
    expect(hasNewRunParam("?newRun=0")).toBe(false);
    expect(hasNewRunParam("")).toBe(false);
  });
});

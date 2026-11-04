import { describe, expect, it } from "vitest";

import { getNotificationCategory, NOTIFICATION_CATEGORIES } from "./notification-categories";

describe("getNotificationCategory", () => {
  it("maps version workflow types", () => {
    for (const t of ["review_requested", "approved", "rejected", "published", "approval_cancelled"]) {
      expect(getNotificationCategory(t)).toBe("version");
    }
  });
  it("maps checkout_/permission_ prefixes, subprocess_registered, and notice", () => {
    expect(getNotificationCategory("checkout_requested")).toBe("checkout");
    expect(getNotificationCategory("checkout_rejected")).toBe("checkout");
    expect(getNotificationCategory("permission_approved")).toBe("permission");
    expect(getNotificationCategory("subprocess_registered")).toBe("subprocess");
    expect(getNotificationCategory("fw_external_linked")).toBe("subprocess"); // 필터·카테고리 통계에서 빠지지 않게
    expect(getNotificationCategory("notice")).toBe("notice");
  });
  it("returns null for unknown types (All에서만 노출)", () => {
    expect(getNotificationCategory("mystery")).toBeNull();
  });
  it("classifies rename types as permission", () => {
    expect(getNotificationCategory("rename_requested")).toBe("permission");
    expect(getNotificationCategory("rename_approved")).toBe("permission");
    expect(getNotificationCategory("rename_rejected")).toBe("permission");
    expect(getNotificationCategory("rename_superseded")).toBe("permission");
    expect(getNotificationCategory("map_renamed")).toBe("permission");
  });
  it("classifies fw_confirm types as permission", () => {
    expect(getNotificationCategory("fw_confirm_requested")).toBe("permission");
    expect(getNotificationCategory("fw_confirm_done")).toBe("permission");
    expect(getNotificationCategory("fw_confirm_rejected")).toBe("permission");
  });
  it("classifies run_ types as run, listed first in the filter order", () => {
    for (const t of [
      "run_invited", "run_steps_done", "run_problem", "run_resolved", "run_finished", "run_stopped", "run_idle_warning",
    ]) {
      expect(getNotificationCategory(t)).toBe("run");
    }
    expect(NOTIFICATION_CATEGORIES[0]).toBe("run");
  });
});

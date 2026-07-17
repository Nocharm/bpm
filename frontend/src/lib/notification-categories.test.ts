import { describe, expect, it } from "vitest";

import { getNotificationCategory } from "./notification-categories";

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
    expect(getNotificationCategory("notice")).toBe("notice");
  });
  it("returns null for unknown types (All에서만 노출)", () => {
    expect(getNotificationCategory("mystery")).toBeNull();
  });
});

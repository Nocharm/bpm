import { describe, expect, it } from "vitest";

import { canManageInScope } from "./framework-admin-scope";

describe("canManageInScope", () => {
  it("sysadmin(scopeRootIds undefined)은 항상 허용", () => {
    expect(canManageInScope({ id: 1, level: 1 }, "move", undefined, undefined)).toBe(true);
    expect(canManageInScope({ id: 1, level: 1 }, "delete", undefined, undefined)).toBe(true);
    expect(canManageInScope({ id: 1, level: 1 }, "perms", undefined, undefined)).toBe(true);
  });

  it("move/delete는 seed 자신에서만 금지", () => {
    const scopeRootIds = [10];
    expect(canManageInScope({ id: 10, level: 2 }, "move", scopeRootIds, 2)).toBe(false);
    expect(canManageInScope({ id: 10, level: 2 }, "delete", scopeRootIds, 2)).toBe(false);
    expect(canManageInScope({ id: 11, level: 3 }, "move", scopeRootIds, 2)).toBe(true);
    expect(canManageInScope({ id: 11, level: 3 }, "delete", scopeRootIds, 2)).toBe(true);
  });

  it("perms는 level이 minSeedLevel보다 클 때만 허용", () => {
    const scopeRootIds = [10];
    expect(canManageInScope({ id: 10, level: 2 }, "perms", scopeRootIds, 2)).toBe(false);
    expect(canManageInScope({ id: 11, level: 3 }, "perms", scopeRootIds, 2)).toBe(true);
  });
});

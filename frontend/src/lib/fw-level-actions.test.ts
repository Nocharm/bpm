import { describe, expect, it } from "vitest";

import { countSessionsUnder, findDuplicateSibling, findSessionFor } from "./fw-level-actions";

describe("countSessionsUnder", () => {
  const sessions = [
    { category_path_ids: [1, 10, 100, 1000, 10000] },
    { category_path_ids: [1, 10, 101, 1010, 10100] },
    { category_path_ids: [2, 20, 200, 2000, 20000] },
  ];
  it("counts sessions whose chain contains the id", () => {
    expect(countSessionsUnder(sessions, 1)).toBe(2);
    expect(countSessionsUnder(sessions, 10)).toBe(2);
    expect(countSessionsUnder(sessions, 100)).toBe(1);
    expect(countSessionsUnder(sessions, 2)).toBe(1);
    expect(countSessionsUnder(sessions, 999)).toBe(0);
  });
});

describe("findDuplicateSibling", () => {
  it("matches trimmed exact names, case-sensitive", () => {
    const children = [{ name: "Order Intake" }, { name: "Billing" }];
    expect(findDuplicateSibling(children, " Billing ")).toBe(true);
    expect(findDuplicateSibling(children, "billing")).toBe(false);
    expect(findDuplicateSibling(children, "Shipping")).toBe(false);
  });
});

describe("findSessionFor", () => {
  it("returns the session bound to the category or null", () => {
    const sessions = [{ id: 5, category_id: 100 }, { id: 6, category_id: 200 }];
    expect(findSessionFor(sessions, 200)).toEqual({ id: 6, category_id: 200 });
    expect(findSessionFor(sessions, 300)).toBeNull();
  });
});

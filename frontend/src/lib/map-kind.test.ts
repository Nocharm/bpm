import { describe, expect, it } from "vitest";

import { getDisabledKinds, isKindExclusive, isMapKind } from "@/lib/map-kind";

describe("map kind exclusivity", () => {
  it("nothing is disabled with no selection", () => {
    expect(getDisabledKinds(new Set())).toEqual(new Set());
  });
  it("SP disables Non-SP and L5 canvases; canvases are never SP", () => {
    expect(getDisabledKinds(new Set(["sp"]))).toEqual(new Set(["non_sp", "canvas"]));
    expect(getDisabledKinds(new Set(["canvas"]))).toEqual(new Set(["sp", "unregistered"]));
  });
  it("registration options exclude each other; a selected option is never disabled", () => {
    expect(getDisabledKinds(new Set(["registered"]))).toEqual(new Set(["unregistered"]));
    expect(getDisabledKinds(new Set(["registered", "sp"]))).toEqual(new Set(["unregistered", "non_sp", "canvas"]));
  });
  it("pairs with a real intersection stay enabled", () => {
    expect(isKindExclusive("non_sp", "canvas")).toBe(false);
    expect(isKindExclusive("sp", "unregistered")).toBe(false);
    expect(getDisabledKinds(new Set(["non_sp"]))).toEqual(new Set(["sp"]));
  });
  it("guards persisted values", () => {
    expect(isMapKind("canvas")).toBe(true);
    expect(isMapKind("bogus")).toBe(false);
  });
});

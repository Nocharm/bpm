import { describe, expect, it } from "vitest";

import { constrainToAxis } from "@/lib/drag-constrain";

describe("constrainToAxis", () => {
  const start = { x: 100, y: 100 };

  it("passes current through unchanged when shift is not held", () => {
    expect(constrainToAxis(start, { x: 150, y: 130 }, false)).toEqual({ x: 150, y: 130 });
  });

  it("locks the vertical axis (keeps start.y) when horizontal delta dominates", () => {
    expect(constrainToAxis(start, { x: 180, y: 120 }, true)).toEqual({ x: 180, y: 100 });
  });

  it("locks the horizontal axis (keeps start.x) when vertical delta dominates", () => {
    expect(constrainToAxis(start, { x: 110, y: 190 }, true)).toEqual({ x: 100, y: 190 });
  });

  it("prefers horizontal lock on an exact diagonal tie", () => {
    expect(constrainToAxis(start, { x: 140, y: 140 }, true)).toEqual({ x: 140, y: 100 });
  });
});

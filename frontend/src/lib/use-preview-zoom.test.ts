import { describe, expect, it } from "vitest";

import {
  computePreviewFitZoom,
  computePreviewStartScroll,
  PREVIEW_ZOOM_MAX,
  PREVIEW_ZOOM_MIN,
} from "./use-preview-zoom";

describe("computePreviewFitZoom", () => {
  it("keeps a small map at fit (1x) — it never zooms out below the window", () => {
    expect(computePreviewFitZoom({ x: 0, y: 0, w: 600, h: 200 }, { width: 600, height: 266 })).toBe(PREVIEW_ZOOM_MIN);
  });

  it("starts a wide 30-node L6 at the max so nodes are readable instead of a fitted strip", () => {
    expect(computePreviewFitZoom({ x: 0, y: 0, w: 9900, h: 300 }, { width: 600, height: 266 })).toBe(PREVIEW_ZOOM_MAX);
  });

  it("picks the step that shows a process node at the target height using the narrower meet axis", () => {
    // 가로가 병목: scale = 600/1500 = 0.4 → 44 / (52 × 0.4) ≈ 2.12 → 2
    expect(computePreviewFitZoom({ x: 0, y: 0, w: 1500, h: 200 }, { width: 600, height: 400 })).toBe(2);
  });
});

describe("computePreviewStartScroll", () => {
  it("puts the start node 16px from the left and its row at the vertical center", () => {
    // viewBox 1000×250, 창 500×250, 2배 → SVG 1000×500, scale = min(1, 2) = 1, 세로 가운데 여백 125
    const scroll = computePreviewStartScroll({ x: -40, y: -50, w: 1000, h: 250 }, { width: 500, height: 250 }, 2, { x: 0, cy: 20 });
    expect(scroll).toEqual({ left: 40 - 16, top: 125 + 70 - 125 });
  });

  it("never scrolls to a negative offset", () => {
    expect(computePreviewStartScroll({ x: 0, y: 0, w: 100, h: 100 }, { width: 100, height: 100 }, 1, { x: 0, cy: 0 })).toEqual({ left: 0, top: 0 });
  });
});

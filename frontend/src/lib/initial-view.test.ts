import { describe, expect, it } from "vitest";

import { pickReadableViewport, READABLE_EDGE_GAP } from "./initial-view";

const anchor = { x: 0, y: 300, width: 120, height: 48 };

describe("pickReadableViewport", () => {
  it("keeps the whole-map fit when the fit zoom stays readable", () => {
    const bounds = { x: 0, y: 0, width: 1300, height: 500 };
    expect(pickReadableViewport(bounds, anchor, 1000, 700)).toBeNull();
  });

  it("opens a wide map at 100% with the start node at the left edge", () => {
    const bounds = { x: 0, y: 200, width: 4200, height: 300 };
    const view = pickReadableViewport(bounds, anchor, 1000, 700);
    expect(view?.zoom).toBe(1);
    expect(view?.x).toBe(READABLE_EDGE_GAP);
    // 세로는 내용 전체가 들어가므로 내용 가운데가 화면 가운데
    expect(view?.y).toBe(350 - 350);
  });

  it("shrinks to fit the height but never below 70%", () => {
    const bounds = { x: 0, y: 0, width: 4200, height: 700 };
    const view = pickReadableViewport(bounds, anchor, 1000, 700);
    expect(view?.zoom).toBeCloseTo((700 - READABLE_EDGE_GAP * 2) / 700);
    const tall = pickReadableViewport({ x: 0, y: 0, width: 4200, height: 1600 }, anchor, 1000, 700);
    expect(tall?.zoom).toBe(0.7);
    // 세로가 넘치면 시작 노드를 화면 세로 가운데에 둔다
    expect(tall?.y).toBeCloseTo(350 - 324 * 0.7);
  });

  it("returns null for an empty pane or empty bounds", () => {
    expect(pickReadableViewport({ x: 0, y: 0, width: 0, height: 0 }, anchor, 1000, 700)).toBeNull();
    expect(pickReadableViewport({ x: 0, y: 0, width: 4200, height: 300 }, anchor, 0, 0)).toBeNull();
  });
});

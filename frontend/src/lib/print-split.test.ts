// 나눠 싣기(자를 자리·교차·조각 범위·연결 기호) 단위 테스트
import { describe, expect, it } from "vitest";

import {
  findCutCrossings,
  findFreeGaps,
  getConnectorLabel,
  getPieceBounds,
  planSplit,
  type Point,
  type Rect,
  type SplitSource,
} from "./print-split";

const box = (x: number, width: number, y = 100, height = 80): Rect => ({ x, y, width, height });
const hline = (x0: number, x1: number, y: number): Point[] => [
  { x: x0, y },
  { x: x1, y },
];

describe("findFreeGaps", () => {
  it("returns the gaps between blocks with a clearance, not the frame edges", () => {
    expect(findFreeGaps(1000, [box(100, 200), box(500, 200)])).toEqual([[306, 494]]);
  });

  it("merges overlapping blocks", () => {
    expect(findFreeGaps(1000, [box(100, 300), box(350, 100), box(700, 100)])).toEqual([[456, 694]]);
  });
});

describe("findCutCrossings", () => {
  it("finds where connectors cross a vertical cut, top to bottom", () => {
    const edges = [hline(0, 200, 150), [{ x: 0, y: 0 }, { x: 200, y: 100 }]];
    expect(findCutCrossings(edges, 100)).toEqual([50, 150]);
  });

  it("merges a bundle of overlapping connectors into one crossing", () => {
    expect(findCutCrossings([hline(0, 200, 150), hline(0, 200, 152), hline(0, 200, 190)], 100)).toEqual([150, 190]);
  });

  it("ignores connectors that end before the cut", () => {
    expect(findCutCrossings([hline(0, 90, 150)], 100)).toEqual([]);
  });
});

describe("planSplit", () => {
  // 노드 다섯 개(폭 300)가 600 간격으로 늘어선 3,000px 맵
  const row: SplitSource = {
    width: 3000,
    height: 300,
    blocks: [0, 1, 2, 3, 4].map((i) => box(100 + i * 600, 300)),
    regions: [],
    edges: [0, 1, 2, 3].map((i) => hline(400 + i * 600, 700 + i * 600, 140)),
  };

  it("keeps one piece when the map fits the limit", () => {
    expect(planSplit({ ...row, width: 800 }, 900)).toEqual({ pieces: [{ x0: 0, x1: 800 }], maxWidth: 800 });
  });

  it("cuts only in the gaps, covers the whole width and keeps every piece within the limit", () => {
    const plan = planSplit(row, 900);
    expect(plan.pieces.length).toBe(5);
    expect(plan.pieces[0].x0).toBe(0);
    expect(plan.pieces[plan.pieces.length - 1].x1).toBe(3000);
    for (let i = 1; i < plan.pieces.length; i += 1) expect(plan.pieces[i].x0).toBe(plan.pieces[i - 1].x1);
    for (const piece of plan.pieces) {
      expect(piece.x1 - piece.x0).toBeLessThanOrEqual(900);
      // 자른 자리는 어떤 노드도 가르지 않는다
      for (const block of row.blocks) {
        expect(piece.x0 <= block.x || piece.x0 >= block.x + block.width).toBe(true);
      }
    }
  });

  it("prefers the gap where fewer connectors cross when piece counts tie", () => {
    // 두 빈 칸 중 어디서 잘라도 두 조각 — 왼쪽 빈 칸엔 연결선 셋, 오른쪽엔 하나
    const source: SplitSource = {
      width: 1200,
      height: 300,
      blocks: [box(50, 300), box(500, 200), box(850, 300)],
      regions: [],
      edges: [hline(350, 500, 120), hline(350, 500, 150), hline(350, 500, 180), hline(700, 850, 140)],
    };
    const plan = planSplit(source, 800);
    expect(plan.pieces.length).toBe(2);
    expect(plan.pieces[0].x1).toBeGreaterThan(700);
  });

  it("avoids cutting through a region when another gap works", () => {
    const source: SplitSource = {
      width: 1200,
      height: 300,
      blocks: [box(50, 300), box(500, 200), box(850, 300)],
      regions: [{ x: 30, y: 60, width: 700, height: 200 }],
      edges: [],
    };
    const plan = planSplit(source, 800);
    // 영역(30~730) 밖 오른쪽 빈 칸(706~844)에서 자른다
    expect(plan.pieces[0].x1).toBeGreaterThanOrEqual(706);
  });

  it("widens the limit to the widest unavoidable span when blocks leave no gap in time", () => {
    const source: SplitSource = { width: 2000, height: 300, blocks: [box(50, 1200), box(1400, 500)], regions: [], edges: [] };
    const plan = planSplit(source, 800);
    expect(plan.pieces.length).toBe(2);
    expect(plan.maxWidth).toBeGreaterThan(800);
  });
});

describe("getPieceBounds", () => {
  it("trims a piece to its own content plus padding", () => {
    const source: SplitSource = {
      width: 1200,
      height: 600,
      blocks: [box(100, 200, 50, 60), box(800, 200, 400, 60)],
      regions: [],
      edges: [hline(300, 800, 430)],
    };
    expect(getPieceBounds(source, { x0: 0, x1: 500 })).toEqual({ y0: 34, y1: 446 });
    expect(getPieceBounds(source, { x0: 600, x1: 1200 })).toEqual({ y0: 384, y1: 476 });
  });
});

describe("getConnectorLabel", () => {
  it("runs A to Z and then two letters", () => {
    expect(getConnectorLabel(0)).toBe("A");
    expect(getConnectorLabel(25)).toBe("Z");
    expect(getConnectorLabel(26)).toBe("AA");
    expect(getConnectorLabel(27)).toBe("AB");
  });
});

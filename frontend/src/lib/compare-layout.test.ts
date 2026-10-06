import { describe, expect, it } from "vitest";

import {
  ARC_CLEARANCE,
  type CompareBox,
  type CompareRect,
  getArcControlDepth,
  getCompareEdgeLabel,
  getDiffPillAllowance,
  getRemovedArcLevel,
  placeRemovedNodes,
  REMOVED_MIN_GAP,
} from "@/lib/compare-layout";
import { PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

const box = (id: string, w = 150, h = 38): CompareBox => ({ id, w, h });
const rect = (id: string, x: number, y: number, w = 150, h = 38): CompareRect => ({ id, x, y, w, h });

// 모든 사각형 쌍이 REMOVED_MIN_GAP 미만으로 붙지 않는지
function expectNoOverlap(rects: CompareRect[]) {
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const isApart =
        a.x + a.w + REMOVED_MIN_GAP <= b.x ||
        b.x + b.w + REMOVED_MIN_GAP <= a.x ||
        a.y + a.h + REMOVED_MIN_GAP <= b.y ||
        b.y + b.h + REMOVED_MIN_GAP <= a.y;
      expect(isApart, `${a.id} vs ${b.id}`).toBe(true);
    }
  }
}

function collect(placed: CompareRect[], boxes: CompareBox[], positions: Map<string, { x: number; y: number }>) {
  return [
    ...placed,
    ...boxes.map((b) => {
      const pos = positions.get(b.id);
      if (!pos) throw new Error(`missing ${b.id}`);
      return { ...b, ...pos };
    }),
  ];
}

describe("placeRemovedNodes", () => {
  it("삭제 사슬 K→A→B→C는 원점에 포개지지 않고 흐름 방향으로 이어진다(LR)", () => {
    // Arrange
    const placed = [rect("K", 0, 0)];
    const boxes = [box("A"), box("B"), box("C")];
    const links = [
      { source: "K", target: "A" },
      { source: "A", target: "B" },
      { source: "B", target: "C" },
    ];
    // Act
    const pos = placeRemovedNodes(placed, boxes, links, "LR");
    // Assert
    expectNoOverlap(collect(placed, boxes, pos));
    expect(pos.get("B")!.x).toBeGreaterThan(pos.get("A")!.x);
    expect(pos.get("C")!.x).toBeGreaterThan(pos.get("B")!.x);
    expect(pos.get("A")!.y).toBeGreaterThan(38);
  });

  it("빈 버전과 비교(배치된 노드 없음)해도 전부 다른 자리에 놓인다", () => {
    const boxes = [box("A"), box("B"), box("C"), box("D")];
    const links = [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
    ];
    const pos = placeRemovedNodes([], boxes, links, "LR");
    expectNoOverlap(collect([], boxes, pos));
    expect(pos.get("B")!.x).toBeGreaterThan(pos.get("A")!.x);
  });

  it("이웃 {A}인 R1과 이웃 {A,B}인 R2가 겹치지 않는다", () => {
    const placed = [rect("A", 0, 0), rect("B", 300, 0)];
    const boxes = [box("R1"), box("R2")];
    const links = [
      { source: "A", target: "R1" },
      { source: "A", target: "R2" },
      { source: "R2", target: "B" },
    ];
    const pos = placeRemovedNodes(placed, boxes, links, "LR");
    expectNoOverlap(collect(placed, boxes, pos));
  });

  it("키 큰 이웃(실측 높이 200)의 아래로 놓인다", () => {
    const placed = [rect("A", 0, 0, 150, 200)];
    const boxes = [box("R")];
    const pos = placeRemovedNodes(placed, boxes, [{ source: "A", target: "R" }], "LR");
    expect(pos.get("R")!.y).toBeGreaterThanOrEqual(200 + REMOVED_MIN_GAP);
  });

  it("이웃 아래 추가 곁가지가 있으면 그 아래 빈 자리로 밀린다", () => {
    const placed = [rect("K", 0, 0), rect("S", 0, 120)];
    const boxes = [box("R")];
    const pos = placeRemovedNodes(placed, boxes, [{ source: "K", target: "R" }], "LR");
    expectNoOverlap(collect(placed, boxes, pos));
    expect(pos.get("R")!.y).toBeGreaterThanOrEqual(158 + REMOVED_MIN_GAP);
  });

  it("TB는 교차축이 x — 유지 이웃의 오른쪽에 놓인다", () => {
    const placed = [rect("K", 0, 0)];
    const pos = placeRemovedNodes(placed, [box("R")], [{ source: "K", target: "R" }], "TB");
    expect(pos.get("R")!.x).toBeGreaterThanOrEqual(150 + REMOVED_MIN_GAP);
  });

  it("이웃 없는 삭제 노드들은 bbox 아래 한 줄로 나란히 놓인다", () => {
    const placed = [rect("K", 0, 0), rect("L", 300, 0)];
    const boxes = [box("X"), box("Y")];
    const pos = placeRemovedNodes(placed, boxes, [], "LR");
    expect(pos.get("X")!.y).toBe(pos.get("Y")!.y);
    expect(pos.get("X")!.y).toBeGreaterThan(38);
    expectNoOverlap(collect(placed, boxes, pos));
  });
});

describe("getDiffPillAllowance", () => {
  it("필 없음=0, 3줄 넘으면 +N more 한 줄을 더한다", () => {
    expect(getDiffPillAllowance(0)).toBe(0);
    expect(getDiffPillAllowance(2)).toBeLessThan(getDiffPillAllowance(3));
    expect(getDiffPillAllowance(5)).toBe(getDiffPillAllowance(4));
    expect(getDiffPillAllowance(5)).toBeGreaterThan(getDiffPillAllowance(3));
  });
});

describe("getRemovedArcLevel / getArcControlDepth", () => {
  it("구간 안 노드 아래로 비켜 가고 구간 밖 노드는 무시한다", () => {
    const source = rect("A", 0, 0);
    const target = rect("B", 600, 0);
    const inSpan = rect("R", 250, 100);
    const outside = rect("Z", 1000, 400);
    expect(getRemovedArcLevel(source, target, [source, target, inSpan, outside], "LR")).toBe(138 + ARC_CLEARANCE);
    expect(getRemovedArcLevel(source, target, [outside], "LR")).toBe(38 + ARC_CLEARANCE);
  });

  it("양끝 노드의 필 여유(높이 포함)를 수위에 반영한다", () => {
    const source = rect("A", 0, 0, 150, 38 + getDiffPillAllowance(3));
    const target = rect("B", 600, 0);
    expect(getRemovedArcLevel(source, target, [], "LR")).toBe(38 + getDiffPillAllowance(3) + ARC_CLEARANCE);
  });

  it("제어점 깊이로 그린 베지어 중앙이 수위에 닿는다", () => {
    const a = 38;
    const b = 50;
    const level = 300;
    const d = getArcControlDepth(a, b, level);
    expect((a + b) / 8 + 0.75 * d).toBeGreaterThanOrEqual(level - 1e-9);
    // 장애물이 얕아도 종전 최소 깊이는 유지
    expect(getArcControlDepth(38, 38, 40)).toBe(38 + 52);
  });
});

describe("getCompareEdgeLabel", () => {
  it("직접 라벨이 우선, 무라벨 SP 보조 끝은 끝 제목 미러, 대표 끝은 라벨 없음", () => {
    expect(getCompareEdgeLabel("Yes", "반려")).toEqual({ label: "Yes", isMirrored: false });
    expect(getCompareEdgeLabel("", "반려")).toEqual({ label: "반려", isMirrored: true });
    expect(getCompareEdgeLabel("", PRIMARY_END_HANDLE)).toEqual({ label: undefined, isMirrored: false });
  });
});

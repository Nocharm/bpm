// 위·아래 변 최소 높이 — 대상 판정과 꺾은선·곡선 경로가 40px 위로 뜨는지
import { getBezierPath, getSmoothStepPath, Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  getBezierPathWithStub,
  getSmoothStepPathWithStub,
  needsVerticalStub,
  VERTICAL_EDGE_STUB,
  type EdgeEndsArgs,
} from "@/lib/edge-stub";

const ends = (
  sourceX: number,
  sourceY: number,
  sourcePosition: Position,
  targetX: number,
  targetY: number,
  targetPosition: Position,
): EdgeEndsArgs => ({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

/** 경로 문자열의 y 좌표 최솟값 — 선이 가장 높이 뜬 지점 */
function getTopY(path: string): number {
  const ys = [...path.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  return Math.min(...ys);
}

describe("needsVerticalStub", () => {
  it("같은 높이의 위→위 연결은 대상", () => {
    expect(needsVerticalStub(ends(400, 100, Position.Top, 0, 100, Position.Top))).toBe(true);
  });

  it("상대가 등 뒤인 아래→위 연결(아래 핸들에서 위쪽 노드로)은 대상", () => {
    expect(needsVerticalStub(ends(0, 200, Position.Bottom, 300, 0, Position.Top))).toBe(true);
  });

  it("서로 마주 보는 아래→위 연결은 대상 아님 — 가운데에서 꺾인다", () => {
    expect(needsVerticalStub(ends(0, 100, Position.Bottom, 50, 130, Position.Top))).toBe(false);
  });

  it("좌·우 변끼리는 대상 아님", () => {
    expect(needsVerticalStub(ends(400, 100, Position.Right, 0, 100, Position.Left))).toBe(false);
  });
});

describe("getSmoothStepPathWithStub", () => {
  it("같은 높이 위→위 꺾은선은 노드 위 40px까지 뜬다(RF 기본은 20px)", () => {
    const args = ends(400, 100, Position.Top, 0, 100, Position.Top);
    const [path] = getSmoothStepPathWithStub(args);
    expect(getTopY(path)).toBe(100 - VERTICAL_EDGE_STUB);
    expect(getTopY(getSmoothStepPath(args)[0])).toBe(80);
  });

  it("대상 아닌 연결은 RF 경로 그대로", () => {
    const args = ends(0, 100, Position.Bottom, 50, 300, Position.Top);
    expect(getSmoothStepPathWithStub(args)[0]).toBe(getSmoothStepPath(args)[0]);
  });
});

describe("getBezierPathWithStub", () => {
  it("같은 높이 위→위 곡선은 꼭짓점(t=0.5)이 노드 위 40px까지 뜬다", () => {
    const [path, , labelY] = getBezierPathWithStub(ends(400, 100, Position.Top, 0, 100, Position.Top));
    expect(path.startsWith("M400,100 C400,46.6")).toBe(true);
    expect(labelY).toBeCloseTo(100 - VERTICAL_EDGE_STUB, 6);
  });

  it("대상 아닌 연결은 RF 곡선 그대로", () => {
    const args = ends(400, 100, Position.Right, 600, 100, Position.Left);
    expect(getBezierPathWithStub(args)[0]).toBe(getBezierPath(args)[0]);
  });
});

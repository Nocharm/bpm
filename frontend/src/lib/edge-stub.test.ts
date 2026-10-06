// 연결선 끝 최소 거리(네 변 공통) — 대상 판정과 꺾은선·곡선 경로가 40px 뜨는지
import { getBezierPath, getSmoothStepPath, Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  getBezierPathWithStub,
  getSmoothStepPathWithStub,
  EDGE_MIN_STUB,
  needsEdgeStub,
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

describe("needsEdgeStub", () => {
  it("같은 높이의 위→위 연결은 대상", () => {
    expect(needsEdgeStub(ends(400, 100, Position.Top, 0, 100, Position.Top))).toBe(true);
  });

  it("상대가 등 뒤인 아래→위 연결(아래 핸들에서 위쪽 노드로)은 대상", () => {
    expect(needsEdgeStub(ends(0, 200, Position.Bottom, 300, 0, Position.Top))).toBe(true);
  });

  it("서로 마주 보는 아래→위 연결은 대상 아님 — 가운데에서 꺾인다", () => {
    expect(needsEdgeStub(ends(0, 100, Position.Bottom, 50, 130, Position.Top))).toBe(false);
  });

  it("마주 보는 좌→우 연결(오른쪽 핸들 → 오른편 노드 왼쪽)은 대상 아님", () => {
    expect(needsEdgeStub(ends(0, 100, Position.Right, 400, 100, Position.Left))).toBe(false);
  });

  it("세로 정렬의 좌→좌(역행 루프)·우→우(척추 지름길)는 대상", () => {
    expect(needsEdgeStub(ends(100, 400, Position.Left, 100, 0, Position.Left))).toBe(true);
    expect(needsEdgeStub(ends(300, 0, Position.Right, 300, 400, Position.Right))).toBe(true);
  });

  it("상대가 등 뒤인 우→좌 U턴(오른쪽 핸들에서 왼편 노드로)은 대상", () => {
    expect(needsEdgeStub(ends(400, 100, Position.Right, 0, 100, Position.Left))).toBe(true);
  });
});

describe("getSmoothStepPathWithStub", () => {
  it("같은 높이 위→위 꺾은선은 노드 위 40px까지 뜬다(RF 기본은 20px)", () => {
    const args = ends(400, 100, Position.Top, 0, 100, Position.Top);
    const [path] = getSmoothStepPathWithStub(args);
    expect(getTopY(path)).toBe(100 - EDGE_MIN_STUB);
    expect(getTopY(getSmoothStepPath(args)[0])).toBe(80);
  });

  it("세로 정렬 좌→좌 꺾은선은 노드 왼쪽 40px까지 나간다(RF 기본은 20px)", () => {
    const args = ends(100, 400, Position.Left, 100, 0, Position.Left);
    const xs = (path: string) =>
      Math.min(...[...path.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])));
    expect(xs(getSmoothStepPathWithStub(args)[0])).toBe(100 - EDGE_MIN_STUB);
    expect(xs(getSmoothStepPath(args)[0])).toBe(80);
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
    expect(labelY).toBeCloseTo(100 - EDGE_MIN_STUB, 6);
  });

  it("대상 아닌 연결은 RF 곡선 그대로", () => {
    const args = ends(400, 100, Position.Right, 600, 100, Position.Left);
    expect(getBezierPathWithStub(args)[0]).toBe(getBezierPath(args)[0]);
  });
});

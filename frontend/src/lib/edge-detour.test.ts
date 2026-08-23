// edge-detour 계약 — 교차 판정·회랑 선택·라운드 경로/라벨 앵커
import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { buildDetourPoints, buildRoundedOrthPath, type ObstacleRect } from "@/lib/edge-detour";

// 수평쌍 기본 인자 — A(우측 핸들 200,26) → B(좌측 핸들 600,426), 기본 회랑 x=400
function makeArgsH(obstacles: ObstacleRect[]) {
  return {
    sourceX: 200,
    sourceY: 26,
    targetX: 600,
    targetY: 426,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    obstacles,
  };
}

describe("buildDetourPoints — 수평쌍(H·V·H)", () => {
  it("교차 없음 → null(기본 경로 유지)", () => {
    expect(buildDetourPoints(makeArgsH([]))).toBeNull();
    // 회랑(x=400)에서 멀리 떨어진 장애물
    expect(buildDetourPoints(makeArgsH([{ x: 900, y: 0, w: 170, h: 400 }]))).toBeNull();
  });

  it("V 회랑 관통 → 장애물 바깥 회랑으로 웨이포인트 생성(오프셋 방향은 짧은 쪽)", () => {
    // 장애물이 기본 회랑 x=400을 덮음(x 350..520). 왼쪽 바깥(350-12-1=337)이 오른쪽(533)보다 이탈이 작다
    const points = buildDetourPoints(makeArgsH([{ x: 350, y: 0, w: 170, h: 400 }]));
    expect(points).toEqual([
      { x: 200, y: 26 },
      { x: 337, y: 26 },
      { x: 337, y: 426 },
      { x: 600, y: 426 },
    ]);
  });

  it("H 진입 구간이 막히는 후보는 기각 — 장애물 앞에서 먼저 꺾는 회랑을 고른다", () => {
    // 소스행(y=26)을 덮는 장애물(x 300..470, y 0..100): 오른쪽 바깥 회랑(483)은 H 구간이 관통해 기각,
    // 왼쪽 바깥(287)만 3구간 전부 무교차
    const points = buildDetourPoints(makeArgsH([{ x: 300, y: 0, w: 170, h: 100 }]));
    expect(points?.[1]).toEqual({ x: 287, y: 26 });
  });

  it("복수 장애물 — 모든 rect에 대해 무교차인 회랑만 채택", () => {
    // 회랑 후보가 한 장애물은 피하지만 다른 장애물을 뚫으면 기각된다
    const points = buildDetourPoints(
      makeArgsH([
        { x: 350, y: 0, w: 170, h: 400 }, // 기본 회랑 차단 → 좌 337 / 우 533 후보
        { x: 260, y: 100, w: 120, h: 300 }, // 337 회랑(V) 차단(x 248..392)
      ]),
    );
    // 오른쪽 533은 소스행 H(y=26)가 첫 장애물(y 0..400)을 관통해 기각 — 남는 무교차 회랑은
    // 두 번째 장애물 왼쪽 바깥 247뿐(두 장애물·세 구간 전부 무교차)
    expect(points?.[1].x).toBe(247);
  });

  it("빈 회랑이 하나도 없으면 null — 기본 경로로 폴백(현행 동작 무회귀)", () => {
    // 소스~타깃 전 구간을 덮는 벽
    const wall: ObstacleRect = { x: -100, y: -100, w: 1000, h: 700 };
    expect(buildDetourPoints(makeArgsH([wall]))).toBeNull();
  });

  it("혼합 방향(수평→수직 핸들)은 대상 외 → null", () => {
    const args = { ...makeArgsH([{ x: 350, y: 0, w: 170, h: 400 }]), targetPosition: Position.Top };
    expect(buildDetourPoints(args)).toBeNull();
  });
});

describe("buildDetourPoints — 수직쌍(V·H·V)", () => {
  it("H 회랑 관통 → 장애물 위/아래 바깥으로 이동", () => {
    // S(100,100 아래 핸들)→T(500,500 위 핸들), 기본 회랑 y=300. 장애물(x 0..400, y 250..380)이
    // 소스 x=100의 V 구간을 차단 — 위 바깥 237로 이동(타깃 x=500은 장애물 밖이라 하강 구간 무교차)
    const points = buildDetourPoints({
      sourceX: 100,
      sourceY: 100,
      targetX: 500,
      targetY: 500,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      obstacles: [{ x: 0, y: 250, w: 400, h: 130 }],
    });
    expect(points).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 237 },
      { x: 500, y: 237 },
      { x: 500, y: 500 },
    ]);
  });
});

describe("buildRoundedOrthPath", () => {
  it("모서리마다 L+Q, 끝은 L — 라벨은 최장 구간 중앙", () => {
    const [path, labelX, labelY] = buildRoundedOrthPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 300 },
      { x: 400, y: 300 },
    ]);
    expect(path.startsWith("M 0,0")).toBe(true);
    expect(path.match(/Q /g)?.length).toBe(2);
    expect(path.endsWith("L 400,300")).toBe(true);
    // 최장 구간 = 세로 300 — 중앙 (100,150)
    expect(labelX).toBe(100);
    expect(labelY).toBe(150);
  });

  it("짧은 구간에서 반경 클램프 — 경로가 뒤집히지 않는다(진입점이 구간 절반 이내)", () => {
    const [path] = buildRoundedOrthPath([
      { x: 0, y: 0 },
      { x: 6, y: 0 }, // 6px 구간 → r = 3
      { x: 6, y: 100 },
    ]);
    expect(path).toContain("L 3,0");
    expect(path).toContain("Q 6,0 6,3");
  });
});

// 인라인 펼침 footprint-shift 좌표 변환(표시↔저장) 헬퍼 테스트.
import { describe, expect, it } from "vitest";

import { displayToSavedX, offsetAtSavedX, type ShiftStep } from "./inline-shift";

const single: ShiftStep[] = [{ x: 80, footprint: 868 }];
const multi: ShiftStep[] = [
  { x: 400, footprint: 300 },
  { x: 100, footprint: 200 }, // 순서 무관(정렬은 내부에서)
];

describe("offsetAtSavedX", () => {
  it("returns 0 with no steps", () => {
    expect(offsetAtSavedX(123, [])).toBe(0);
  });

  it("counts only anchors strictly left of savedX", () => {
    expect(offsetAtSavedX(80, single)).toBe(0); // 경계: 앵커 x 자신은 미포함
    expect(offsetAtSavedX(81, single)).toBe(868);
    expect(offsetAtSavedX(-10, single)).toBe(0);
  });

  it("accumulates multiple anchors", () => {
    expect(offsetAtSavedX(50, multi)).toBe(0);
    expect(offsetAtSavedX(250, multi)).toBe(200);
    expect(offsetAtSavedX(500, multi)).toBe(500);
  });
});

describe("displayToSavedX", () => {
  it("is identity with no steps", () => {
    expect(displayToSavedX(1234, [])).toBe(1234);
  });

  it("solves the reachable fixed point (finalize regression: drop right of the lane)", () => {
    // 실측 재현값: 앵커 80/footprint 868, 드롭 표시 x 1160 → 저장 292
    expect(displayToSavedX(1160, single)).toBe(292);
    expect(displayToSavedX(1168, single)).toBe(300);
    // 앵커 왼쪽은 그대로
    expect(displayToSavedX(40, single)).toBe(40);
    expect(displayToSavedX(80, single)).toBe(80); // 경계 고정점
  });

  it("round-trips every reachable saved x", () => {
    for (const steps of [single, multi]) {
      for (const saved of [-50, 0, 79, 80, 99, 100.5, 250, 399, 401, 500, 2000]) {
        const display = saved + offsetAtSavedX(saved, steps);
        expect(displayToSavedX(display, steps)).toBeCloseTo(saved, 10);
      }
    }
  });

  it("clamps unreachable gap displays to the anchor x (no oscillation)", () => {
    // 단일 앵커: 표시 (80, 948]은 도달 불가(저장 80⁺가 표시 948⁺로 점프) → 80으로 클램프
    expect(displayToSavedX(500, single)).toBe(80);
    expect(displayToSavedX(948, single)).toBe(80);
    expect(displayToSavedX(949, single)).toBe(81);
    // 다중 앵커: 앵커 400의 갭은 표시 (600, 900] → 400으로 클램프
    expect(displayToSavedX(601, multi)).toBe(400);
    expect(displayToSavedX(900, multi)).toBe(400);
    expect(displayToSavedX(901, multi)).toBe(401);
  });
});

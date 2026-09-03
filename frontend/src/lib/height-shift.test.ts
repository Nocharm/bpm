// height-shift 충돌 기반 오프셋·행 동기화·역변환 계약 (기준높이 52 · MIN_GAP 16)
import { describe, expect, it } from "vitest";

import type { AppNode } from "@/lib/canvas";
import {
  EMPTY_HEIGHT_FIELD,
  buildHeightShiftField,
  getDisplayHeight,
  invertDisplayY,
} from "@/lib/height-shift";

function makeNode(
  id: string,
  x: number,
  y: number,
  opts: { type?: string; measuredH?: number; label?: string } = {},
): AppNode {
  const node = {
    id,
    type: "process",
    position: { x, y },
    data: {
      label: opts.label ?? id,
      nodeType: opts.type ?? "process",
      color: "",
      groupIds: [],
      hasChildren: false,
    },
  } as unknown as AppNode;
  if (opts.measuredH !== undefined) {
    (node as { measured?: { width: number; height: number } }).measured = {
      width: 170,
      height: opts.measuredH,
    };
  }
  return node;
}

describe("getDisplayHeight", () => {
  it("measured 우선, 미측정은 estimateNodeHeight 폴백(짧은 라벨 process = 기준 52)", () => {
    expect(getDisplayHeight(makeNode("a", 0, 0, { measuredH: 300 }))).toBe(300);
    expect(getDisplayHeight(makeNode("b", 0, 0))).toBe(52);
  });
});

describe("buildHeightShiftField - 충돌 기반 오프셋", () => {
  it("성장 없음 → 오프셋·푸셔 없음", () => {
    const field = buildHeightShiftField([makeNode("a", 0, 0), makeNode("b", 0, 200)]);
    expect(field.offsets.size).toBe(0);
    expect(field.pushers.length).toBe(0);
  });

  it("EPSILON(4px) 미만 성장은 무시", () => {
    const field = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 55 }),
      makeNode("b", 0, 60),
    ]);
    expect(field.offsets.size).toBe(0);
  });

  it("여백이 성장을 흡수하면 안 밀림(저장 간격 148 > 성장 100)", () => {
    const field = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 152 }),
      makeNode("b", 0, 200),
    ]);
    expect(field.offsets.get("b")).toBeUndefined();
  });

  it("여백 부족분만 밀고 표시 간격 16 유지(간격 28 < 성장 100)", () => {
    const field = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 152 }),
      makeNode("b", 0, 80),
    ]);
    // needed = (0+152) + min(28,16) - 80 = 88 → 표시 간격 = (80+88) - 152 = 16
    expect(field.offsets.get("b")).toBe(88);
  });

  it("원래 간격이 16보다 좁으면 그 간격을 유지(간격 8 → 표시 간격 8)", () => {
    const field = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 152 }),
      makeNode("b", 0, 60),
    ]);
    // needed = 152 + min(8,16) - 60 = 100 → 표시 간격 = (60+100) - 152 = 8
    expect(field.offsets.get("b")).toBe(100);
  });

  it("X 구간이 겹치지 않는 다른 열·다른 행 노드는 안 밀림", () => {
    const field = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 152 }),
      makeNode("b", 0, 80),
      makeNode("c", 400, 140),
    ]);
    expect(field.offsets.get("b")).toBe(88);
    expect(field.offsets.get("c")).toBeUndefined();
  });

  it("행 동기화 - 같은 행(저장 Y구간 겹침)은 밀림량을 행 max로 공유", () => {
    const field = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 152 }),
      makeNode("b", 0, 80),
      makeNode("c", 400, 100), // [100,152) ∩ b[80,132) → 같은 행
    ]);
    expect(field.offsets.get("b")).toBe(88);
    expect(field.offsets.get("c")).toBe(88);
  });

  it("연쇄 - 밀린 노드가 아래 행을 다시 민다(간격 16 유지)", () => {
    const field = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 152 }),
      makeNode("b", 0, 80),
      makeNode("c", 0, 180),
    ]);
    // b: 88 → b 표시 bottom = 80+88+52 = 220. c needed = 220 + min(48,16) - 180 = 56
    expect(field.offsets.get("b")).toBe(88);
    expect(field.offsets.get("c")).toBe(56);
  });

  it("맞닿은 경계(savedGap=0)는 성장분만큼 밀려 맞닿음 유지", () => {
    const field = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 152 }),
      makeNode("b", 0, 52),
    ]);
    // needed = 152 + min(0,16) - 52 = 100
    expect(field.offsets.get("b")).toBe(100);
  });

  it("section은 밀지도 밀리지도 않음", () => {
    const field = buildHeightShiftField([
      makeNode("s", 0, 0, { type: "section", measuredH: 400 }),
      makeNode("a", 0, 100),
      makeNode("g", 300, 0, { measuredH: 152 }),
      makeNode("t", 300, 60, { type: "section" }),
    ]);
    expect(field.offsets.get("a")).toBeUndefined();
    expect(field.offsets.get("t")).toBeUndefined();
  });
});

describe("invertDisplayY - 열 단위 역변환", () => {
  const field = buildHeightShiftField([
    makeNode("a", 0, 0, { measuredH: 152 }), // 푸셔: x [0,170], baseBottom 52, dispBottom 152
  ]);

  it("빈 필드는 항등", () => {
    expect(invertDisplayY(EMPTY_HEIGHT_FIELD, 50, 50, 300)).toBe(300);
  });

  it("푸셔 열 밖(x 비겹침)은 항등", () => {
    expect(invertDisplayY(field, 400, 400, 100)).toBeCloseTo(100, 3);
  });

  it("영향권 아래 먼 지점은 항등(간격이 흡수)", () => {
    expect(invertDisplayY(field, 50, 50, 300)).toBeCloseTo(300, 3);
  });

  it("도달 불가 갭(표시 52~152)은 앵커 baseBottom(52)으로 클램프", () => {
    expect(invertDisplayY(field, 50, 50, 100)).toBeCloseTo(52, 3);
  });

  it("플래토는 최소 저장 y - forward와 왕복 일치", () => {
    // 표시 168 = dispBottom(152) + MIN_GAP(16) → 저장 68 (savedGap 16 지점)
    const saved = invertDisplayY(field, 50, 50, 168);
    expect(saved).toBeCloseTo(68, 3);
    // 왕복: 저장 68에 노드를 두면 needed = 152 + min(16,16) - 68 = 100 → 표시 168
    const round = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 152 }),
      makeNode("p", 0, saved),
    ]);
    expect(saved + (round.offsets.get("p") ?? 0)).toBeCloseTo(168, 2);
  });

  it("구간 프로브 - [x0,x1]가 푸셔와 일부라도 겹치면 영향권", () => {
    expect(invertDisplayY(field, 150, 320, 100)).toBeCloseTo(52, 3);
    expect(invertDisplayY(field, 171, 320, 100)).toBeCloseTo(100, 3);
  });

  it("excludeId - 드래그 노드 자신의 푸셔는 역변환에서 제외(자기 밴드 그림자 드롭 항등)", () => {
    // a 성장 300 → b(y=60, gap 8) offset 248, b 푸셔 밴드 [112, 360]
    const two = buildHeightShiftField([
      makeNode("a", 0, 0, { measuredH: 300 }),
      makeNode("b", 0, 60),
    ]);
    expect(two.offsets.get("b")).toBe(248);
    // 제외 없음: 표시 330은 b 자신의 밴드 갭 → b.baseBottom(112)으로 클램프
    expect(invertDisplayY(two, 0, 170, 330)).toBeCloseTo(112, 3);
    // b 자신 제외: a 영향권(표시 ≤ 316) 밖이라 항등
    expect(invertDisplayY(two, 0, 170, 330, "b")).toBeCloseTo(330, 3);
  });
});

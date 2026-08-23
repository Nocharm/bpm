// height-shift 스텝 생성·밴드 병합·오프셋 계약 (spec §4)
import { describe, expect, it } from "vitest";

import type { AppNode } from "@/lib/canvas";
import { buildHeightSteps, buildYOffsets, getDisplayHeight } from "@/lib/height-shift";

function makeNode(
  id: string,
  y: number,
  opts: { type?: string; measuredH?: number; label?: string } = {},
): AppNode {
  const node = {
    id,
    type: "process",
    position: { x: 0, y },
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
    expect(getDisplayHeight(makeNode("a", 0, { measuredH: 300 }))).toBe(300);
    expect(getDisplayHeight(makeNode("b", 0))).toBe(52);
  });
});

describe("buildHeightSteps", () => {
  it("성장 없음(전부 기준 이하) → 빈 배열", () => {
    expect(buildHeightSteps([makeNode("a", 0, { measuredH: 52 }), makeNode("b", 200)])).toEqual([]);
  });

  it("EPSILON(4px) 미만 extra는 무시", () => {
    expect(buildHeightSteps([makeNode("a", 0, { measuredH: 55 })])).toEqual([]);
  });

  it("단일 성장 노드 → 밴드 1개 {x: y+기준높이, footprint: extra}", () => {
    const steps = buildHeightSteps([makeNode("a", 100, { measuredH: 252 })]);
    expect(steps).toEqual([{ x: 152, footprint: 200 }]);
  });

  it("같은 행(저장 Y 구간 겹침) 두 성장 노드 → 한 밴드로 병합, extra는 max", () => {
    const steps = buildHeightSteps([
      makeNode("a", 100, { measuredH: 352 }), // 구간 [100,152], extra 300
      makeNode("b", 120, { measuredH: 172 }), // 구간 [120,172], 겹침, extra 120
    ]);
    expect(steps).toEqual([{ x: 172, footprint: 300 }]); // bottom=max, extra=max
  });

  it("수직 스택(구간 비겹침) 두 성장 노드 → 밴드 2개(합산은 오프셋 조회에서)", () => {
    const steps = buildHeightSteps([
      makeNode("a", 0, { measuredH: 152 }),   // [0,52] extra 100
      makeNode("b", 300, { measuredH: 252 }), // [300,352] extra 200
    ]);
    expect(steps).toEqual([
      { x: 52, footprint: 100 },
      { x: 352, footprint: 200 },
    ]);
  });

  it("section 노드는 대형 측정이라도 앵커 제외", () => {
    expect(buildHeightSteps([makeNode("s", 0, { type: "section", measuredH: 800 })])).toEqual([]);
  });

  it("subprocess는 기준 64 — 측정 300이면 extra 236", () => {
    expect(buildHeightSteps([makeNode("sp", 10, { type: "subprocess", measuredH: 300 })])).toEqual([
      { x: 74, footprint: 236 },
    ]);
  });
});

describe("buildYOffsets", () => {
  it("밴드 위/경계(y == bottom)는 0, 아래는 누적합 — section 노드는 항상 0", () => {
    const nodes = [
      makeNode("a", 0, { measuredH: 152 }),   // 밴드 [x:52, fp:100]
      makeNode("b", 300, { measuredH: 252 }), // 밴드 [x:352, fp:200]
      makeNode("above", 20),
      makeNode("boundary", 52),
      makeNode("mid", 200),
      makeNode("below", 500),
      makeNode("sec", 500, { type: "section" }),
    ];
    const offsets = buildYOffsets(nodes, buildHeightSteps(nodes));
    expect(offsets.get("above") ?? 0).toBe(0);
    expect(offsets.get("boundary") ?? 0).toBe(0); // strict < 계약 (spec §9)
    expect(offsets.get("mid")).toBe(100);
    expect(offsets.get("below")).toBe(300); // 100+200 스택 합산
    expect(offsets.get("a") ?? 0).toBe(0); // 자기 밴드는 자기보다 아래 — 자기 미포함
    expect(offsets.get("b")).toBe(100);
    expect(offsets.get("sec") ?? 0).toBe(0);
  });
});

// PNG 출력 정렬 유지(기준 추론·표시 이동량) 단위 테스트
import { describe, expect, it } from "vitest";

import { applyPrintShifts, getPrintShifts, inferAlignAnchors, type AnchorRect } from "./print-anchor";

const rect = (id: string, x: number, y: number, width: number, height: number): AnchorRect => ({ id, x, y, width, height });

describe("inferAlignAnchors", () => {
  it("reads a centered column as a center anchor across the x axis", () => {
    // 폭이 다른 세 노드를 세로 가운데 정렬(가운데 x = 300)
    const anchors = inferAlignAnchors([rect("a", 180, 0, 240, 120), rect("b", 225, 200, 150, 60), rect("c", 200, 320, 200, 90)]);
    expect(anchors.get("a")?.x).toBe("center");
    expect(anchors.get("b")?.x).toBe("center");
  });

  it("reads left, right, top and middle alignment from the matching edge", () => {
    const left = inferAlignAnchors([rect("a", 100, 0, 240, 60), rect("b", 100, 200, 150, 60)]);
    expect(left.get("b")?.x).toBe("start");
    const right = inferAlignAnchors([rect("a", 100, 0, 240, 60), rect("b", 190, 200, 150, 60)]);
    expect(right.get("b")?.x).toBe("end");
    const top = inferAlignAnchors([rect("a", 0, 50, 150, 120), rect("b", 300, 50, 150, 60)]);
    expect(top.get("b")?.y).toBe("start");
    const middle = inferAlignAnchors([rect("a", 0, 50, 150, 120), rect("b", 300, 80, 150, 60)]);
    expect(middle.get("b")?.y).toBe("center");
  });

  it("uses center across and top down for same-size lookalikes, and nothing for unaligned nodes", () => {
    const same = inferAlignAnchors([rect("a", 100, 0, 150, 60), rect("b", 100, 200, 150, 60), rect("c", 400, 0, 150, 60)]);
    expect(same.get("a")).toEqual({ x: "center", y: "start" });
    const lone = inferAlignAnchors([rect("a", 0, 0, 150, 60), rect("b", 517, 333, 170, 90)]);
    expect(lone.get("a")).toEqual({ x: null, y: null });
  });

  it("lets a same-size column neighbour outvote a far node that only shares the snapped left edge", () => {
    // a·b는 같은 크기로 한 열, f는 멀리서 왼쪽 x만 우연히 같다(8px 격자 스냅)
    const anchors = inferAlignAnchors([rect("a", 104, 0, 240, 60), rect("b", 104, 200, 240, 60), rect("f", 104, 900, 150, 60)]);
    expect(anchors.get("b")?.x).toBe("center");
    expect(anchors.get("f")?.x).toBe("start");
  });
});

describe("getPrintShifts", () => {
  it("keeps a centered column centered when the nodes narrow differently", () => {
    const reference = [rect("a", 180, 0, 240, 120), rect("b", 225, 200, 150, 60)];
    // 표시 정보를 숨겨 a는 240→150, b는 그대로
    const shifts = getPrintShifts(reference, new Map([["a", { width: 150, height: 60 }], ["b", { width: 150, height: 60 }]]));
    expect(shifts.get("a")).toEqual({ dx: 45, dy: 0 });
    expect(shifts.has("b")).toBe(false);
    const moved = applyPrintShifts([{ id: "a", position: { x: 180, y: 0 } }, { id: "b", position: { x: 225, y: 200 } }], shifts);
    // 둘 다 가운데 x = 300
    expect(moved[0].position.x + 150 / 2).toBe(300);
    expect(moved[1].position.x + 150 / 2).toBe(300);
  });

  it("keeps a middle-aligned row level when heights shrink", () => {
    const reference = [rect("a", 0, 50, 150, 120), rect("b", 300, 80, 150, 60)];
    const shifts = getPrintShifts(reference, new Map([["a", { width: 150, height: 50 }], ["b", { width: 150, height: 50 }]]));
    expect(shifts.get("a")).toEqual({ dx: 0, dy: 35 });
    expect(shifts.get("b")).toEqual({ dx: 0, dy: 5 });
  });

  it("leaves top-left aligned and unaligned nodes where they are", () => {
    const reference = [rect("a", 100, 0, 240, 120), rect("b", 100, 200, 150, 60), rect("c", 517, 333, 170, 90)];
    const shifts = getPrintShifts(
      reference,
      new Map([["a", { width: 150, height: 60 }], ["b", { width: 150, height: 60 }], ["c", { width: 150, height: 60 }]]),
    );
    expect(shifts.size).toBe(0);
  });
});

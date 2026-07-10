import { describe, expect, it } from "vitest";

import {
  DROPDOWN_MAX_HEIGHT,
  computeDropdownPlacement,
  type AnchorRect,
} from "./dropdown-placement";

// 앵커 헬퍼 — left/width만 주면 right는 파생.
function makeAnchor(partial: Partial<AnchorRect> & { top: number; bottom: number }): AnchorRect {
  const left = partial.left ?? 400;
  const width = partial.width ?? 400;
  return { left, width, right: partial.right ?? left + width, ...partial };
}

describe("computeDropdownPlacement", () => {
  it("opens below when there is room for the full height", () => {
    const p = computeDropdownPlacement(
      makeAnchor({ top: 200, bottom: 230 }),
      { width: 1280, height: 900 },
    );
    expect(p.side).toBe("below");
    expect(p.top).toBe(234); // bottom + GAP
    expect(p.left).toBe(400);
    expect(p.width).toBe(400);
    expect(p.maxHeight).toBe(DROPDOWN_MAX_HEIGHT);
  });

  it("opens to the right when below is short but the right side has room", () => {
    // bottom=500, viewport 580 → spaceBelow = 580-500-4-8 = 68 < 160
    // right=700, viewport width 1280 → spaceRight = 1280-700-4-8 = 568 >= 200
    const p = computeDropdownPlacement(
      makeAnchor({ top: 470, bottom: 500, left: 300, width: 400 }),
      { width: 1280, height: 580 },
    );
    expect(p.side).toBe("right");
    expect(p.left).toBe(704); // right + GAP
    expect(p.width).toBe(400); // 앵커 폭 유지(여유 충분)
    expect(p.maxHeight).toBe(DROPDOWN_MAX_HEIGHT);
  });

  it("narrows the side dropdown to the available room", () => {
    // right=700, viewport width 950 → spaceRight = 950-700-4-8 = 238 (>=200, <400)
    const p = computeDropdownPlacement(
      makeAnchor({ top: 470, bottom: 500, left: 300, width: 400 }),
      { width: 950, height: 580 },
    );
    expect(p.side).toBe("right");
    expect(p.width).toBe(238);
  });

  it("falls back to the left side when the right side is too narrow", () => {
    // right=880, viewport 1000 → spaceRight = 1000-880-4-8 = 108 < 200
    // left=480 → spaceLeft = 480-4-8 = 468 >= 200
    const p = computeDropdownPlacement(
      makeAnchor({ top: 470, bottom: 500, left: 480, width: 400 }),
      { width: 1000, height: 580 },
    );
    expect(p.side).toBe("left");
    expect(p.width).toBe(400);
    expect(p.left).toBe(76); // anchor.left - GAP - width
  });

  it("clamps the side dropdown top into the viewport", () => {
    // 앵커가 화면 아주 아래 — top을 끌어올려 160px가 뷰포트 안에 들어오게.
    const p = computeDropdownPlacement(
      makeAnchor({ top: 540, bottom: 570, left: 300, width: 400 }),
      { width: 1280, height: 580 },
    );
    expect(p.side).toBe("right");
    expect(p.top).toBe(580 - 8 - DROPDOWN_MAX_HEIGHT); // height - MARGIN - sideHeight
  });

  it("never flips above the anchor", () => {
    // 앵커가 뷰포트 바닥에 붙어도 top은 앵커 위로 올라가되(clamp) side는 절대 'above'가 아니다.
    const p = computeDropdownPlacement(
      makeAnchor({ top: 550, bottom: 575, left: 300, width: 400 }),
      { width: 1280, height: 580 },
    );
    expect(["below", "right", "left"]).toContain(p.side);
  });

  it("shrinks below when all three sides are cramped", () => {
    // 좁고 낮은 뷰포트 — 좌우 여유 모두 < 200
    // spaceBelow = 400-300-4-8 = 88
    const p = computeDropdownPlacement(
      makeAnchor({ top: 270, bottom: 300, left: 40, width: 520 }),
      { width: 600, height: 400 },
    );
    expect(p.side).toBe("below");
    expect(p.maxHeight).toBe(88);
    expect(p.top).toBe(304);
  });

  it("keeps a readable minimum height when below has almost no room", () => {
    // spaceBelow = 400-390-4-8 = -2 → 최소 80px 확보
    const p = computeDropdownPlacement(
      makeAnchor({ top: 360, bottom: 390, left: 40, width: 520 }),
      { width: 600, height: 400 },
    );
    expect(p.side).toBe("below");
    expect(p.maxHeight).toBe(80);
  });
});

import { describe, expect, it } from "vitest";

import { buildDiamondPoints, buildPreviewEdgePath, type PreviewBox } from "./scope-preview";

const box = (x: number, y: number, w = 100, h = 40): PreviewBox => ({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });

describe("buildDiamondPoints", () => {
  it("returns the four box-inscribed vertices top,right,bottom,left", () => {
    expect(buildDiamondPoints(10, 20, 100, 50)).toBe("60,20 110,45 60,70 10,45");
  });
});

describe("buildPreviewEdgePath", () => {
  it("draws a forward edge as a straight line that stops at the target border", () => {
    const { d, back } = buildPreviewEdgePath(box(0, 0), box(200, 0));
    expect(back).toBe(false);
    expect(d).toBe("M 50,20 L 200,20");  // 타겟 박스 왼쪽 테두리(x=200)에서 끝난다
  });

  it("routes a backward edge above both nodes so the loop is visible", () => {
    const { d, back } = buildPreviewEdgePath(box(400, 0), box(0, 0));
    expect(back).toBe(true);
    expect(d.startsWith("M 450,0")).toBe(true);
    expect(d).toContain(",-24");  // 두 노드 위 24px 통로
    expect(d.endsWith("L 50,0")).toBe(true);
  });

  it("keeps a slightly-left target as a forward edge", () => {
    expect(buildPreviewEdgePath(box(100, 0), box(80, 80)).back).toBe(false);
  });
});

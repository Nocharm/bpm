import { describe, expect, it } from "vitest";

import {
  assignPreviewBackLanes,
  buildDiamondPoints,
  buildPreviewEdgePath,
  previewPadTop,
  type PreviewBox,
} from "./scope-preview";

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
    expect(d).toContain(",-40");  // 두 노드 위 40px 통로(위·아래 변 최소 높이)
    expect(d.endsWith("L 50,0")).toBe(true);
  });

  it("keeps a slightly-left target as a forward edge", () => {
    expect(buildPreviewEdgePath(box(100, 0), box(80, 80)).back).toBe(false);
  });

  it("lifts the back-edge corridor 10px per lane so nested loops do not overlap", () => {
    const { d } = buildPreviewEdgePath(box(400, 0), box(0, 0), 1);
    expect(d).toContain(",-50");
    expect(d.startsWith("M 450,0")).toBe(true);
    expect(d.endsWith("L 50,0")).toBe(true);
  });
});

describe("assignPreviewBackLanes", () => {
  const edge = (id: string, source: string, target: string) => ({ id, source_node_id: source, target_node_id: target });

  it("same target: nearer source is the inner lane (rainbow); forward edges get no lane", () => {
    const centers = new Map([["T", box(0, 0)], ["M", box(300, 0)], ["N", box(600, 0)]]);
    const lanes = assignPreviewBackLanes([edge("m", "M", "T"), edge("n", "N", "T"), edge("f", "T", "M")], centers);
    expect(lanes.get("m")).toBe(0);
    expect(lanes.get("n")).toBe(1);
    expect(lanes.has("f")).toBe(false);
  });

  it("same source to two earlier targets: nearer target is inner; an edge in both groups takes the larger lane", () => {
    const centers = new Map([["A", box(0, 0)], ["B", box(300, 0)], ["S", box(600, 0)], ["R", box(900, 0)]]);
    const lanes = assignPreviewBackLanes([edge("sb", "S", "B"), edge("sa", "S", "A"), edge("rb", "R", "B")], centers);
    expect(lanes.get("sb")).toBe(0);
    expect(lanes.get("sa")).toBe(1);
    // rb: target B group = {sb(near), rb(far)} → 1
    expect(lanes.get("rb")).toBe(1);
  });

  it("a lone back edge is lane 0", () => {
    const centers = new Map([["T", box(0, 0)], ["M", box(300, 0)]]);
    expect(assignPreviewBackLanes([edge("m", "M", "T")], centers).get("m")).toBe(0);
  });

  it("two back edges leaving the same source never share a lane even when the target groups agree", () => {
    // T←M, T←N, N→Y(Y는 T 왼쪽): n과 ny가 둘 다 N에서 출발 — 타깃 그룹 순번이 같아도 소스 그룹에서 분리돼야 한다
    const centers = new Map([["Y", box(-300, 0)], ["T", box(0, 0)], ["M", box(300, 0)], ["N", box(600, 0)]]);
    const lanes = assignPreviewBackLanes([edge("m", "M", "T"), edge("n", "N", "T"), edge("ny", "N", "Y")], centers);
    expect(lanes.get("n")).not.toBe(lanes.get("ny"));
    expect(lanes.get("m")).toBe(0);
  });
});

describe("previewPadTop", () => {
  it("grows the top padding with the highest back-edge lane so nested loops stay inside the viewBox", () => {
    expect(previewPadTop(new Map())).toBe(56);
    expect(previewPadTop(new Map([["a", 0], ["b", 2]]))).toBe(76);
  });
});

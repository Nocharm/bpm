import { describe, expect, it } from "vitest";

import type { CategoryNode } from "@/lib/api";
import { DIAGRAM, fitScale, layoutDiagram } from "@/lib/framework-diagram";

const node = (id: number, level: number, extra: Partial<CategoryNode> = {}): CategoryNode => ({
  id,
  code: `C${id}`,
  name: `Cat ${id}`,
  level,
  sort_order: id,
  child_count: 0,
  map_count: 0,
  linkage_map_id: null,
  can_edit_linkage: false,
  l5_count: 0,
  canvas_state: null,
  admin: null,
  slot_pending_count: 0,
  ...extra,
});

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < DIAGRAM.BW && Math.abs(a.y - b.y) < DIAGRAM.BH;

describe("layoutDiagram", () => {
  it("stacks the ancestor chain at top center and links it down to the center box", () => {
    const l1 = node(1, 1), l2 = node(2, 2), l3 = node(3, 3);
    const out = layoutDiagram({ ancestors: [l1, l2], center: l3, children: [], grandchildren: new Map() });
    const anc = out.nodes.filter((n) => n.kind === "ancestor");
    expect(anc.map((n) => n.node.id)).toEqual([1, 2]);
    // 같은 x(가운데), y는 위에서 아래로
    expect(new Set(anc.map((n) => n.x)).size).toBe(1);
    expect(anc[0].y).toBeLessThan(anc[1].y);
    const center = out.nodes.find((n) => n.kind === "center");
    expect(center?.x).toBe(anc[0].x);
    expect(center!.y).toBeGreaterThan(anc[1].y + DIAGRAM.BH);
    expect(out.links.filter((l) => l.kind === "up")).toHaveLength(2);
  });

  it("alternates children left/right and stacks grandchildren beside each child without overlaps", () => {
    const center = node(10, 3);
    const kids = [node(11, 4), node(12, 4), node(13, 4)];
    const gc = new Map<number, CategoryNode[]>([
      [11, [node(111, 5), node(112, 5), node(113, 5)]],
      [12, [node(121, 5)]],
      [13, []],
    ]);
    const out = layoutDiagram({ ancestors: [], center, children: kids, grandchildren: gc });
    const byId = new Map(out.nodes.map((n) => [n.node.id, n]));
    expect(byId.get(11)?.side).toBe("R");
    expect(byId.get(12)?.side).toBe("L");
    expect(byId.get(13)?.side).toBe("R");
    expect(byId.get(11)!.x).toBeGreaterThan(out.cx);
    expect(byId.get(12)!.x).toBeLessThan(out.cx);
    // 손자는 자식보다 더 바깥쪽
    expect(byId.get(111)!.x).toBeGreaterThan(byId.get(11)!.x);
    expect(byId.get(121)!.x).toBeLessThan(byId.get(12)!.x);
    // 자식 박스는 손자 스택 세로 가운데
    const stackTop = byId.get(111)!.y, stackBottom = byId.get(113)!.y + DIAGRAM.BH;
    expect(Math.abs(byId.get(11)!.y + DIAGRAM.BH / 2 - (stackTop + stackBottom) / 2)).toBeLessThan(1);
    // 어떤 박스도 겹치지 않는다
    for (let i = 0; i < out.nodes.length; i += 1)
      for (let j = i + 1; j < out.nodes.length; j += 1)
        expect(overlaps(out.nodes[i], out.nodes[j])).toBe(false);
    // 링크 = 자식 3 + 손자 4
    expect(out.links.filter((l) => l.kind === "down")).toHaveLength(7);
  });

  it("grows the height with the taller side and fits it into the viewport", () => {
    const center = node(1, 3);
    const kids = [node(2, 4), node(3, 4)];
    const many = Array.from({ length: 30 }, (_, i) => node(100 + i, 5));
    const out = layoutDiagram({ ancestors: [], center, children: kids, grandchildren: new Map([[2, many]]) });
    expect(out.height).toBeGreaterThan(30 * DIAGRAM.ROW);
    expect(fitScale(out, 640)).toBeLessThan(1);
    const small = layoutDiagram({ ancestors: [], center, children: [], grandchildren: new Map() });
    expect(fitScale(small, 640)).toBe(1);
  });

  it("scales up only as far as the panel grew, bounded by both viewport axes", () => {
    const center = node(1, 3);
    const small = layoutDiagram({ ancestors: [], center, children: [node(2, 4), node(3, 4)], grandchildren: new Map() });
    // 기본 패널(maxScale 1)은 확대하지 않는다
    expect(fitScale(small, 640, 1180)).toBe(1);
    // 패널이 1.6배 커지면 그만큼 확대 — 단, 폭이 좁으면 폭이 상한
    expect(fitScale(small, 2000, 3000, 1.6)).toBe(1.6);
    const contentWidth = 2 * DIAGRAM.DX + DIAGRAM.BW;
    expect(fitScale(small, 2000, contentWidth + 40, 1.6)).toBeCloseTo(1, 5);
  });
});

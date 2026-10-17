// 영역 박스 기하 — 멤버 bbox·패딩·z, 라이브 좌표(getPos)를 따라가는지.
import { describe, expect, it } from "vitest";

import type { AppNode } from "@/lib/canvas";
import { GROUP_PAD, GROUP_TITLE_GAP, buildGroupBoxes } from "@/lib/group-boxes";

function makeNode(id: string, x: number, y: number, groupIds: string[]): AppNode {
  return {
    id,
    position: { x, y },
    measured: { width: 100, height: 50 },
    data: {
      label: id,
      description: "",
      nodeType: "process",
      color: "",
      assignee: "",
      department: "",
      system: "",
      duration: "",
      groupIds,
      hasChildren: false,
    },
  };
}

const groups = [{ id: "g", parent_group_id: null, label: "G", color: "" }];
const savedPos = (node: AppNode) => node.position;

describe("buildGroupBoxes", () => {
  it("wraps member bbox with padding that grows with member count", () => {
    const nodes = [makeNode("a", 0, 0, ["g"]), makeNode("b", 200, 100, ["g"])];
    const [box] = buildGroupBoxes(groups, nodes, savedPos);
    const pad = GROUP_PAD + 2 * 4;
    expect(box.x).toBe(-pad);
    expect(box.y).toBe(-pad - GROUP_TITLE_GAP);
    expect(box.width).toBe(300 + pad * 2);
    expect(box.height).toBe(150 + pad * 2 + GROUP_TITLE_GAP);
    expect(box.z).toBe(-2);
  });

  it("skips groups without members", () => {
    expect(buildGroupBoxes(groups, [makeNode("a", 0, 0, [])], savedPos)).toEqual([]);
  });

  it("follows the live position from getPos (frozen drag)", () => {
    const nodes = [makeNode("a", 0, 0, ["g"]), makeNode("b", 200, 100, ["g"])];
    const live = new Map([["b", { x: 600, y: 100 }]]);
    const [box] = buildGroupBoxes(groups, nodes, (node) => live.get(node.id) ?? node.position);
    const pad = GROUP_PAD + 2 * 4;
    expect(box.width).toBe(700 + pad * 2);
  });
});

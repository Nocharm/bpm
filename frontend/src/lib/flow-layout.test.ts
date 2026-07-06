// lib/flow-layout 테스트 — 주 경로(척추) 탐색·백본 직선화·방향별 핸들 재지정.
import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import type { AppNode, ProcessNodeType } from "@/lib/canvas";
import { nodeSizeOf } from "@/lib/canvas";
import { autoLayoutFlow, findMainPath } from "@/lib/flow-layout";

function makeNode(
  id: string,
  nodeType: ProcessNodeType,
  extra: Partial<AppNode["data"]> = {},
): AppNode {
  return {
    id,
    type: "process",
    position: { x: 0, y: 0 },
    data: {
      label: id,
      description: "",
      nodeType,
      color: "",
      assignee: "",
      department: "",
      system: "",
      duration: "",
      groupIds: [],
      hasChildren: false,
      ...extra,
    },
  } as AppNode;
}

const makeEdge = (id: string, source: string, target: string): Edge => ({ id, source, target });

// 시작 → a → 끝(대표) 본류 + a에서 갈라지는 곁가지 b
const nodes = [
  makeNode("start", "start"),
  makeNode("a", "process"),
  makeNode("b", "process"),
  makeNode("end", "end", { isPrimaryEnd: true }),
];
const edges = [
  makeEdge("e1", "start", "a"),
  makeEdge("e2", "a", "end"),
  makeEdge("e3", "a", "b"),
];

const centerY = (node: AppNode) => node.position.y + nodeSizeOf(node.data.nodeType).h / 2;
const centerX = (node: AppNode) => node.position.x + nodeSizeOf(node.data.nodeType).w / 2;

describe("findMainPath", () => {
  it("returns the start→primary-end path, excluding side branches", () => {
    const path = findMainPath(nodes, edges);
    expect([...path].sort()).toEqual(["a", "end", "start"]);
  });

  it("returns empty when start or end is missing", () => {
    expect(findMainPath([makeNode("x", "process")], []).size).toBe(0);
  });
});

describe("autoLayoutFlow", () => {
  it("LR: main-path nodes snap to one horizontal backbone, branch pushed off", () => {
    const result = autoLayoutFlow(nodes, edges, "LR");
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const startY = centerY(byId.get("start") as AppNode);
    expect(Math.abs(centerY(byId.get("a") as AppNode) - startY)).toBeLessThan(1);
    expect(Math.abs(centerY(byId.get("end") as AppNode) - startY)).toBeLessThan(1);
    // 곁가지는 백본에서 이격
    expect(Math.abs(centerY(byId.get("b") as AppNode) - startY)).toBeGreaterThan(30);
  });

  it("TB: main-path nodes snap to one vertical backbone and handles flip to bottom→top", () => {
    const result = autoLayoutFlow(nodes, edges, "TB");
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const startX = centerX(byId.get("start") as AppNode);
    expect(Math.abs(centerX(byId.get("a") as AppNode) - startX)).toBeLessThan(1);
    expect(Math.abs(centerX(byId.get("end") as AppNode) - startX)).toBeLessThan(1);
    const mainEdge = result.edges.find((edge) => edge.id === "e2");
    expect(mainEdge?.sourceHandle).toBe("s-bottom");
    expect(mainEdge?.targetHandle).toBe("t-top");
  });

  it("LR: flow edges use right→left handles", () => {
    const result = autoLayoutFlow(nodes, edges, "LR");
    const mainEdge = result.edges.find((edge) => edge.id === "e1");
    expect(mainEdge?.sourceHandle).toBe("s-right");
    expect(mainEdge?.targetHandle).toBe("t-left");
  });

  it("keeps stored handles on subprocess endpoints", () => {
    const withSub = [...nodes, makeNode("sub", "subprocess")];
    const subEdge: Edge = { id: "e4", source: "a", target: "sub", targetHandle: "in" };
    const result = autoLayoutFlow(withSub, [...edges, subEdge], "LR");
    const laidSubEdge = result.edges.find((edge) => edge.id === "e4");
    expect(laidSubEdge?.targetHandle).toBe("in"); // 서브프로세스 끝은 전용 핸들 유지
    // 일반 노드 끝은 재지정 — a는 척추라 곁가지(sub) 진입은 cross측(top/bottom)이 정상
    expect(laidSubEdge?.sourceHandle).toMatch(/^s-(top|bottom|right)$/);
  });
});

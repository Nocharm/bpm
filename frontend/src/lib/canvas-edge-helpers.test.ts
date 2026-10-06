// canvas 엣지·표시 기하 헬퍼 테스트 — 엣지 단일 생성기·표시 Y 오프셋·SP 넓힌 폭 추정·라벨 편집 박스 위치.
import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import {
  type AppNode,
  buildAppEdge,
  estimateNodeWidth,
  getHandleScreenPoint,
  getNewEdgeLineStyle,
  insertNodeBefore,
  readEdgeLabelFlowPoint,
  shiftNodesByDisplayY,
} from "@/lib/canvas";
import { PRIMARY_END_HANDLE, SUBPROCESS_IN_HANDLE } from "@/lib/subprocess-embed";

function makeNode(id: string, y: number): AppNode {
  return {
    id,
    type: "process",
    position: { x: 10, y },
    data: {
      label: id,
      description: "",
      nodeType: "process",
      color: "",
      assignee: "",
      department: "",
      system: "",
      duration: "",
      groupIds: [],
      hasChildren: false,
    },
  };
}

describe("buildAppEdge (엣지 단일 생성기)", () => {
  it("핸들 없으면 오른쪽 출발·왼쪽 도착, gateway는 null, 빈 라벨은 undefined, 선 모양은 새 엣지 기본값", () => {
    const edge = buildAppEdge({ source: "A", target: "B", label: "" });
    expect(edge).toMatchObject({
      source: "A",
      target: "B",
      sourceHandle: "s-right",
      targetHandle: "t-left",
      label: undefined,
      type: getNewEdgeLineStyle(),
      animated: true,
      data: { gateway: null },
    });
    expect(edge.id).toBeTruthy();
  });

  it("id·선 모양·gateway·라벨을 넘기면 그대로", () => {
    const edge = buildAppEdge({
      id: "e1",
      source: "A",
      target: "B",
      sourceHandle: "s-top",
      targetHandle: "t-bottom",
      label: "Yes",
      type: "straight",
      gateway: "parallel",
    });
    expect(edge).toMatchObject({
      id: "e1",
      sourceHandle: "s-top",
      targetHandle: "t-bottom",
      label: "Yes",
      type: "straight",
      data: { gateway: "parallel" },
    });
  });

  it("isSubprocess를 주면 SP 끝점 핸들을 정규화(끝 키·in 변형 보존), 안 주면 그대로", () => {
    const isSub = (id: string) => id === "P";
    expect(buildAppEdge({ source: "P", target: "P2", isSubprocess: (id) => id.startsWith("P") })).toMatchObject({
      sourceHandle: PRIMARY_END_HANDLE,
      targetHandle: SUBPROCESS_IN_HANDLE,
    });
    expect(buildAppEdge({ source: "P", target: "B", sourceHandle: "반려", isSubprocess: isSub }).sourceHandle).toBe("반려");
    expect(buildAppEdge({ source: "A", target: "P", targetHandle: "in:top", isSubprocess: isSub }).targetHandle).toBe("in:top");
    expect(buildAppEdge({ source: "P", target: "B" }).sourceHandle).toBe("s-right");
  });

  it("삽입 헬퍼(withEdge)가 만드는 엣지에도 data.gateway 기본값이 실린다", () => {
    const [added] = insertNodeBefore([] as Edge[], "A", "B", false);
    expect(added.data).toEqual({ gateway: null });
  });
});

describe("shiftNodesByDisplayY (height-shift 표시 좌표)", () => {
  it("오프셋이 없으면 같은 배열, 있으면 그 노드만 Y 이동", () => {
    const nodes = [makeNode("A", 0), makeNode("B", 100)];
    expect(shiftNodesByDisplayY(nodes, new Map())).toBe(nodes);
    expect(shiftNodesByDisplayY(nodes, new Map([["A", 0]]))).toBe(nodes);
    const shifted = shiftNodesByDisplayY(nodes, new Map([["B", 40]]));
    expect(shifted[0]).toBe(nodes[0]);
    expect(shifted[1].position).toEqual({ x: 10, y: 140 });
    expect(nodes[1].position.y).toBe(100);
  });
});

describe("estimateNodeWidth (SP 넓힌 폭)", () => {
  it("SP는 nodeWidth를 렌더와 같은 [180, 216]으로 클램프, 없으면 기본 180", () => {
    expect(estimateNodeWidth("x", "subprocess")).toBe(180);
    expect(estimateNodeWidth("x", "subprocess", 216)).toBe(216);
    expect(estimateNodeWidth("x", "subprocess", 400)).toBe(216);
    expect(estimateNodeWidth("x", "subprocess", 100)).toBe(180);
    expect(estimateNodeWidth("x", "decision", 300)).toBe(116);
  });
});

describe("readEdgeLabelFlowPoint / getHandleScreenPoint (인라인 라벨 편집 박스 위치)", () => {
  it("경로 요소의 data-label-x/y(흐름 좌표)를 읽고, 없거나 숫자가 아니면 null", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    expect(readEdgeLabelFlowPoint(el)).toBeNull();
    el.setAttribute("data-label-x", "120.5");
    el.setAttribute("data-label-y", "-40");
    expect(readEdgeLabelFlowPoint(el)).toEqual({ x: 120.5, y: -40 });
    el.setAttribute("data-label-y", "abc");
    expect(readEdgeLabelFlowPoint(el)).toBeNull();
    expect(readEdgeLabelFlowPoint(null)).toBeNull();
  });

  it("좌/우 핸들은 프로세스·SP면 상단 18px(줌 반영), 그 외는 세로 중앙, 상/하는 가로 중앙", () => {
    const rect = { left: 100, top: 50, width: 200, height: 104 };
    expect(getHandleScreenPoint(rect, "right", "process", 2)).toEqual({ x: 300, y: 86 });
    expect(getHandleScreenPoint(rect, "left", "decision", 2)).toEqual({ x: 100, y: 102 });
    expect(getHandleScreenPoint(rect, "top", "process", 2)).toEqual({ x: 200, y: 50 });
    expect(getHandleScreenPoint(rect, "bottom", "end", 1)).toEqual({ x: 200, y: 154 });
  });
});

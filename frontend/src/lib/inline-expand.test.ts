// buildGatewayEdges 단위 테스트 — 진출(끝노드→후속) 게이트웨이가 우측에서 출발하는지 검증.
// buildStepFlowEdges — Tab 스테퍼가 펼침 경계(호스트↔자식)를 건너는지 검증.

import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { getNextNodeAlongFlow, getPrevNodeAlongFlow } from "@/lib/canvas";
import type { AppNode, ProcessNodeType } from "@/lib/canvas";
import { buildGatewayEdges, buildStepFlowEdges } from "@/lib/inline-expand";

function mkChild(id: string, nodeType: ProcessNodeType, scopeId: string): AppNode {
  return {
    id,
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
      scopeId,
    },
  };
}

describe("buildGatewayEdges", () => {
  const expanded = new Set(["host"]);
  const children = [
    mkChild("c-start", "start", "host"),
    mkChild("c-task", "process", "host"),
    mkChild("c-end", "end", "host"),
  ];
  // 내부 흐름 + 루트 엣지(host→succ, 펼침 시 숨고 게이트웨이로 대체)
  const scopeEdges: Edge[] = [
    { id: "e1", source: "c-start", target: "c-task" },
    { id: "e2", source: "c-task", target: "c-end" },
    { id: "e3", source: "host", target: "succ" },
  ];

  it("exit gateway (end → successor) starts from the right handle", () => {
    const gateways = buildGatewayEdges(expanded, children, scopeEdges);
    const exit = gateways.find((g) => g.source === "c-end" && g.target === "succ");
    expect(exit).toBeDefined();
    expect(exit?.sourceHandle).toBe("s-right");
    expect(exit?.targetHandle).toBe("t-left");
  });

  it("entry gateway (host → start) targets the left handle", () => {
    const gateways = buildGatewayEdges(expanded, children, scopeEdges);
    const entry = gateways.find((g) => g.source === "host" && g.target === "c-start");
    expect(entry).toBeDefined();
    expect(entry?.targetHandle).toBe("t-left");
  });

  describe("buildStepFlowEdges", () => {
    // 루트 스코프 엣지 = host→succ(펼치면 가려짐), 자식 스코프 내부 엣지 = e1·e2.
    const rootEdges: Edge[] = [{ id: "e3", source: "host", target: "succ" }];
    const childEdges: Edge[] = [
      { id: "e1", source: "c-start", target: "c-task" },
      { id: "e2", source: "c-task", target: "c-end" },
    ];
    const composition = {
      childEdges,
      gateways: buildGatewayEdges(expanded, children, scopeEdges),
      hiddenIds: new Set(["e3"]),
    };
    const stepEdges = buildStepFlowEdges(rootEdges, composition);

    it("keeps the root edges untouched when nothing is expanded", () => {
      expect(buildStepFlowEdges(rootEdges, null)).toEqual(rootEdges);
    });

    it("steps into the child scope from the expanded host", () => {
      // 가려진 host→succ 대신 진입 게이트웨이를 따라간다(아웃라인의 부모→첫 자식과 동일 순서)
      expect(getNextNodeAlongFlow(stepEdges, "host")).toBe("c-start");
    });

    it("steps out of the child scope at the child end node", () => {
      expect(getNextNodeAlongFlow(stepEdges, "c-end")).toBe("succ");
    });

    it("steps back to the host from the child start node", () => {
      expect(getPrevNodeAlongFlow(stepEdges, "c-start")).toBe("host");
    });

    it("steps back into the child scope from the successor", () => {
      expect(getPrevNodeAlongFlow(stepEdges, "succ")).toBe("c-end");
    });
  });
});

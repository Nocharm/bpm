// buildGatewayEdges 단위 테스트 — 진출(끝노드→후속) 게이트웨이가 우측에서 출발하는지 검증.

import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { AppNode, ProcessNodeType } from "@/lib/canvas";
import { buildGatewayEdges } from "@/lib/inline-expand";

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
});

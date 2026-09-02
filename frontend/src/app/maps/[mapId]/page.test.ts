// Edge.gateway 왕복(load→save) 회귀 테스트 — finding: graph PUT(delete-후-재삽입)마다
// gateway가 서버에서 소거되던 버그(§4 게이트 6 plain_fanout 예외 판정 재료).
// toAppEdges/buildGraph는 page.tsx 내부 순수 변환 함수 — placeholder_category_id 왕복 선례와 동일 패턴.
import { describe, expect, it } from "vitest";

import type { AppNode } from "@/lib/canvas";
import type { Graph } from "@/lib/api";

import { buildGraph, toAppEdges } from "./page";

// inline-expand.test.ts의 mkChild 선례와 동일 — AppNode는 필수 필드만 채우면 나머지 옵셔널
function makeNode(id: string): AppNode {
  return {
    id,
    position: { x: 0, y: 0 },
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

function makeGraph(gateway: string | null): Graph {
  return {
    nodes: [],
    edges: [
      {
        id: "e1",
        source_node_id: "a",
        target_node_id: "b",
        label: "",
        source_side: "right",
        target_side: "left",
        source_handle: null,
        target_handle: null,
        line_style: "smoothstep",
        gateway,
      },
    ],
    groups: [],
  };
}

describe("gateway round-trip (load→save)", () => {
  it("toAppEdges carries the server gateway value into edge.data", () => {
    const [edge] = toAppEdges(makeGraph("parallel"));
    expect(edge.data?.gateway).toBe("parallel");
  });

  it("buildGraph re-serializes edge.data.gateway back onto GraphEdge.gateway", () => {
    const appEdges = toAppEdges(makeGraph("parallel"));
    const nodes = [makeNode("a"), makeNode("b")];

    const saved = buildGraph(nodes, appEdges, []);
    expect(saved.edges[0].gateway).toBe("parallel");
  });

  it("omits gateway (null) when the loaded edge never had one", () => {
    const appEdges = toAppEdges(makeGraph(null));
    expect(appEdges[0].data?.gateway ?? null).toBeNull();

    const saved = buildGraph([makeNode("a"), makeNode("b")], appEdges, []);
    expect(saved.edges[0].gateway).toBeNull();
  });
});

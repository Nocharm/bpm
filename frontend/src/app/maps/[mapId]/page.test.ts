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

describe("toAppEdges subprocess handle normalization", () => {
  const typed = (id: string, nodeType: string) => ({ id, node_type: nodeType }) as unknown as Graph["nodes"][number];
  const rawEdge = (id: string, source: string, target: string, extra: Partial<Graph["edges"][number]> = {}) =>
    ({ ...makeGraph(null).edges[0], id, source_node_id: source, target_node_id: target, ...extra }) as Graph["edges"][number];

  it("subprocess source without a stored handle (CSV/AI) lands on the primary end, stored end keys stay", () => {
    const graph: Graph = {
      nodes: [typed("S", "subprocess"), typed("B", "process"), typed("C", "process")],
      edges: [rawEdge("e1", "S", "B"), rawEdge("e2", "S", "C", { source_handle: "반려" })],
      groups: [],
    };
    const [e1, e2] = toAppEdges(graph);
    expect(e1.sourceHandle).toBe("__primary__");
    expect(e2.sourceHandle).toBe("반려");
  });

  it("subprocess target maps the stored side to the in-handle variant; side ids are rewritten too", () => {
    const graph: Graph = {
      nodes: [typed("A", "process"), typed("S", "subprocess")],
      edges: [
        rawEdge("e1", "A", "S", { target_side: "top" }),
        rawEdge("e2", "A", "S", { target_handle: "t-bottom", target_side: "bottom" }),
        rawEdge("e3", "A", "S", { target_handle: "in:right", target_side: "right" }),
        rawEdge("e4", "A", "S"),
      ],
      groups: [],
    };
    const handles = toAppEdges(graph).map((edge) => edge.targetHandle);
    expect(handles).toEqual(["in:top", "in:bottom", "in:right", "in"]);
  });

  it("non-subprocess endpoints keep the existing side derivation", () => {
    const graph: Graph = {
      nodes: [typed("A", "process"), typed("B", "process")],
      edges: [rawEdge("e1", "A", "B", { source_side: "bottom", target_side: "top" })],
      groups: [],
    };
    const [edge] = toAppEdges(graph);
    expect(edge.sourceHandle).toBe("s-bottom");
    expect(edge.targetHandle).toBe("t-top");
  });
});

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

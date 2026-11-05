// @vitest-environment node
// 실행 상태 엔진(lib/run-graph) 테스트 — BE app/run_graph.py와 같은 사례 파일을 읽어 두 구현을 맞물린다.
// node 환경: jsdom은 file: 기준 URL을 http://localhost로 풀어 사례 파일 경로를 못 만든다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphNode } from "@/lib/api";
import {
  countRunProgress,
  deriveRunStatuses,
  findOpenedNodeIds,
  findRunBackEdgeIds,
  findRunFrontier,
  findRunTouchedAfter,
  getBranchOptions,
  getReachedEndKey,
  getRunEdgeKind,
  getRunTopoOrder,
  isRunScopeFinished,
  toRunGraph,
  type RunGraph,
  type RunGraphEdge,
  type RunGraphNode,
  type RunManualStatus,
  type RunNodeStatus,
  type RunScopeState,
} from "@/lib/run-graph";

interface RawNode {
  id: string;
  node_type: string;
  title: string;
  is_primary_end?: boolean;
  parallel_outputs?: string[];
}

interface RawEdge {
  id: string;
  source: string;
  target: string;
  source_handle?: string | null;
  label?: string;
  gateway?: string | null;
}

interface RawState {
  manual?: Record<string, RunManualStatus>;
  choice?: Record<string, string>;
  exit?: Record<string, string>;
  closed?: boolean;
}

interface RunCase {
  name: string;
  graph: string;
  state: RawState;
  statuses: Record<string, RunNodeStatus>;
  progress: [number, number];
  finished: boolean;
  reached_end: string | null;
}

interface OptionsCase {
  graph: string;
  node: string;
  kind: "none" | "edge" | "exit";
  edge_ids: string[];
  exit_keys: string[];
}

interface TouchedAfterCase {
  graph: string;
  state: RawState;
  node: string;
  title: string | null;
  ids: string[];
}

interface CaseFile {
  graphs: Record<string, { nodes: RawNode[]; edges: RawEdge[] }>;
  cases: RunCase[];
  back_edges: Record<string, string[]>;
  options: OptionsCase[];
  touched_after: TouchedAfterCase[];
}

const FIXTURE_URL = new URL("../../../backend/tests/fixtures/run_graph_cases.json", import.meta.url);
const CASES = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), "utf-8")) as CaseFile;

function buildGraph(name: string): RunGraph {
  const raw = CASES.graphs[name];
  const nodes: RunGraphNode[] = raw.nodes.map((n) => ({
    id: n.id,
    nodeType: n.node_type,
    title: n.title,
    isPrimaryEnd: n.is_primary_end ?? false,
    parallelOutputs: n.parallel_outputs ?? [],
  }));
  const edges: RunGraphEdge[] = raw.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.source_handle ?? null,
    label: e.label ?? "",
    gateway: e.gateway ?? null,
  }));
  return { nodes, edges };
}

function buildState(raw: RawState = {}): RunScopeState {
  return {
    manual: { ...raw.manual },
    choice: { ...raw.choice },
    exit: { ...raw.exit },
    closed: raw.closed ?? false,
  };
}

function findCase(name: string): RunCase {
  const found = CASES.cases.find((c) => c.name === name);
  if (!found) throw new Error(`missing case ${name}`);
  return found;
}

function deriveCase(name: string): { graph: RunGraph; state: RunScopeState; statuses: Record<string, RunNodeStatus> } {
  const entry = findCase(name);
  const graph = buildGraph(entry.graph);
  const state = buildState(entry.state);
  return { graph, state, statuses: deriveRunStatuses(graph, state) };
}

describe.each(CASES.cases)("shared case $name", (entry) => {
  const graph = buildGraph(entry.graph);
  const state = buildState(entry.state);
  const statuses = deriveRunStatuses(graph, state);

  it("derives node statuses", () => {
    expect(statuses).toEqual(entry.statuses);
  });

  it("counts progress, finish and reached end", () => {
    expect(countRunProgress(graph, state)).toEqual({ done: entry.progress[0], total: entry.progress[1] });
    expect(isRunScopeFinished(statuses)).toBe(entry.finished);
    expect(getReachedEndKey(graph, statuses)).toBe(entry.reached_end);
  });
});

describe.each(Object.entries(CASES.back_edges))("shared back edges %s", (graphName, expected) => {
  it("finds the loop edges", () => {
    expect([...findRunBackEdgeIds(buildGraph(graphName))].sort()).toEqual(expected);
  });
});

describe.each(CASES.options)("shared options $graph/$node", (entry) => {
  it("reads the branch options", () => {
    const options = getBranchOptions(buildGraph(entry.graph), entry.node);

    expect(options.kind).toBe(entry.kind);
    expect(options.kind === "edge" ? options.edgeIds : []).toEqual(entry.edge_ids);
    expect(options.kind === "exit" ? options.exitKeys : []).toEqual(entry.exit_keys);
  });
});

describe.each(CASES.touched_after)("shared touched after $graph/$node", (entry) => {
  it("lists the later steps an undo clears, in flow order", () => {
    const graph = buildGraph(entry.graph);
    const ids = findRunTouchedAfter(graph, buildState(entry.state), entry.node);

    expect(ids).toEqual(entry.ids);
    expect(ids.length > 0 ? graph.nodes.find((n) => n.id === ids[0])?.title : null).toBe(entry.title);
  });
});

describe("engine rules the shared cases do not pin", () => {
  it("does not let a closed run change what progress counts", () => {
    const { graph, state } = deriveCase("linear_closed");

    expect(countRunProgress(graph, state)).toEqual({ done: 1, total: 2 });
  });

  it("returns the raw end title, including an empty one", () => {
    const graph = buildGraph("flag_parallel");
    // 대표 끝(x)이 아닌 끝(y)만 닿은 상태 — 제목 "보류"가 그대로 나온다
    const reachedOnlyY: Record<string, RunNodeStatus> = { s: "done", p: "done", a: "waiting", b: "done", x: "waiting", y: "done" };
    const untitled: RunGraph = {
      nodes: graph.nodes.map((n) => (n.id === "y" ? { ...n, title: "" } : n)),
      edges: graph.edges,
    };

    expect(getReachedEndKey(graph, reachedOnlyY)).toBe("보류");
    expect(getReachedEndKey(untitled, reachedOnlyY)).toBe("");
  });

  it("treats a node id like toString as a plain id, not an inherited member", () => {
    const graph: RunGraph = {
      nodes: [
        { id: "s", nodeType: "start", title: "", isPrimaryEnd: false, parallelOutputs: [] },
        { id: "toString", nodeType: "process", title: "접수", isPrimaryEnd: false, parallelOutputs: [] },
        { id: "e", nodeType: "end", title: "", isPrimaryEnd: true, parallelOutputs: [] },
      ],
      edges: [
        { id: "x1", source: "s", target: "toString", sourceHandle: null, label: "", gateway: null },
        { id: "x2", source: "toString", target: "e", sourceHandle: null, label: "", gateway: null },
      ],
    };

    expect(deriveRunStatuses(graph, buildState())).toEqual({ s: "done", toString: "ready", e: "waiting" });
  });

  it("leaves loop edges out of the topological order", () => {
    expect(getRunTopoOrder(buildGraph("loop"))).toEqual(["s", "w", "r", "e"]);
  });

  it("orders a round by id and puts later rounds after it", () => {
    // m→a라 a는 2라운드, 1라운드의 m·n 뒤에 온다
    const nodes: RunGraphNode[] = ["m", "n", "a"].map((id) => ({
      id, nodeType: "process", title: id, isPrimaryEnd: false, parallelOutputs: [],
    }));
    const edges: RunGraphEdge[] = [{ id: "x", source: "m", target: "a", sourceHandle: null, label: "", gateway: null }];

    expect(getRunTopoOrder({ nodes, edges })).toEqual(["m", "n", "a"]);
  });

  it("marks every edge of a looped pair as a back edge and drops dangling ones", () => {
    const graph = buildGraph("loop");
    const twin: RunGraphEdge = { id: "h3b", source: "r", target: "w", sourceHandle: null, label: "재작성", gateway: null };
    const dangling: RunGraphEdge = { id: "h9", source: "r", target: "ghost", sourceHandle: null, label: "", gateway: null };

    const backIds = findRunBackEdgeIds({ nodes: graph.nodes, edges: [...graph.edges, twin, dangling] });

    expect([...backIds].sort()).toEqual(["h3", "h3b"]);
  });

  it("throws for a node that is not in the graph", () => {
    expect(() => getBranchOptions(buildGraph("linear"), "nope")).toThrow("nope");
  });
});

describe("getRunEdgeKind", () => {
  it("classifies edges around a chosen decision", () => {
    const { graph, state, statuses } = deriveCase("decision_chosen");
    const kindOf = (id: string) => {
      const edge = graph.edges.find((e) => e.id === id);
      if (!edge) throw new Error(`missing edge ${id}`);
      return getRunEdgeKind(graph, state, statuses, edge);
    };

    expect(kindOf("e4")).toBe("skip");
    expect(kindOf("e3")).toBe("now");
    expect(kindOf("e2")).toBe("past");
    expect(kindOf("e5")).toBe("fut");
  });

  it("marks an edge into a problem node", () => {
    const { graph, state, statuses } = deriveCase("linear_problem_blocks");
    const edge = graph.edges.find((e) => e.id === "e1");
    if (!edge) throw new Error("missing edge e1");

    expect(getRunEdgeKind(graph, state, statuses, edge)).toBe("prob");
  });

  it("keeps the dead-edge verdict ahead of the future verdict", () => {
    // 완료된 판단 노드의 고르지 않은 갈래는 도착이 대기여도 skip
    const { graph, state, statuses } = deriveCase("decision_chosen");
    const dead = graph.edges.find((e) => e.id === "e6");
    if (!dead) throw new Error("missing edge e6");

    expect(statuses.n).toBe("skipped");
    expect(getRunEdgeKind(graph, state, statuses, dead)).toBe("skip");
  });
});

describe("findRunFrontier", () => {
  it("walks back through waiting nodes to the first actionable one", () => {
    const { graph, state, statuses } = deriveCase("decision_open");

    expect(findRunFrontier(graph, state, statuses, "j")).toEqual(["d"]);
  });

  it("skips finished sources and keeps the unfinished parallel branch", () => {
    const { graph, state, statuses } = deriveCase("start_parallel_join");

    expect(findRunFrontier(graph, state, statuses, "e")).toEqual(["b"]);
  });

  it("returns nothing when every earlier step is finished or skipped", () => {
    const { graph, state, statuses } = deriveCase("decision_chosen");

    expect(findRunFrontier(graph, state, statuses, "a")).toEqual([]);
  });
});

describe("findOpenedNodeIds", () => {
  it("lists nodes that became ready", () => {
    const before = deriveCase("linear_fresh").statuses;
    const after = deriveCase("linear_a_done").statuses;

    expect(findOpenedNodeIds(before, after)).toEqual(["b"]);
  });

  it("ignores nodes that were already ready", () => {
    const statuses = deriveCase("linear_fresh").statuses;

    expect(findOpenedNodeIds(statuses, statuses)).toEqual([]);
  });

  it("lists several parallel nodes in topological order", () => {
    const after = deriveCase("fanout_gateway_parallel").statuses;
    const before: Record<string, RunNodeStatus> = { ...after, a: "waiting", b: "waiting" };

    expect(findOpenedNodeIds(before, after)).toEqual(["a", "b"]);
  });
});

describe("toRunGraph", () => {
  function makeApiNode(over: Partial<GraphNode>): GraphNode {
    return {
      id: "q", title: "", description: "", node_type: "process", color: "", assignee: "", department: "", system: "",
      duration: "", pos_x: 0, pos_y: 0, sort_order: 0, group_ids: [], linked_map_id: null,
      follow_latest: false, linked_version_id: null, is_primary_end: false,
      ...over,
    };
  }

  function makeApiEdge(over: Partial<GraphEdge>): GraphEdge {
    return {
      id: "k1", source_node_id: "s", target_node_id: "q", label: "", source_side: "right", target_side: "left",
      source_handle: null, target_handle: null, line_style: "",
      ...over,
    };
  }

  it("maps the api graph fields", () => {
    const graph: Graph = {
      nodes: [makeApiNode({ title: "품질 시험", node_type: "subprocess", is_primary_end: true, parallel_outputs: ["불합격"] })],
      edges: [makeApiEdge({ label: "예", source_handle: "불합격", gateway: "parallel" })],
      groups: [],
    };

    expect(toRunGraph(graph)).toEqual({
      nodes: [{ id: "q", nodeType: "subprocess", title: "품질 시험", isPrimaryEnd: true, parallelOutputs: ["불합격"] }],
      edges: [{ id: "k1", source: "s", target: "q", sourceHandle: "불합격", label: "예", gateway: "parallel" }],
    });
  });

  it("folds missing optional fields to defaults", () => {
    const graph: Graph = { nodes: [makeApiNode({})], edges: [makeApiEdge({})], groups: [] };

    expect(toRunGraph(graph)).toEqual({
      nodes: [{ id: "q", nodeType: "process", title: "", isPrimaryEnd: false, parallelOutputs: [] }],
      edges: [{ id: "k1", source: "s", target: "q", sourceHandle: null, label: "", gateway: null }],
    });
  });
});

// 실행 체크(Run) 상태 엔진 — 맵 그래프 + 수동으로 저장된 소수의 상태에서 노드별 실행 상태를 계산한다.
// BE `app/run_graph.py`와 이중 구현, 사례 `backend/tests/fixtures/run_graph_cases.json`(run-graph.test.ts가 읽는다) —
// 한쪽 규칙을 바꾸면 사례와 양쪽을 같이 옮긴다. 설계: 2026-11-04-run-check-design.md §4.2.
//
// 두 구현이 같아야 하는 세부(사례 파일이 직접 가두지 못하는 것):
// - 위상 순서는 라운드 단위 Kahn — 매 라운드에 진입차수 0인 노드를 id 오름차순으로 한꺼번에 내보낸다.
// - `closed`는 정상 계산을 마친 뒤 `done`·`problem`이 아닌 상태를 일괄 `skipped`로 바꾼다(계산 중 전파엔 영향 없음).
// - 양 끝이 그래프에 없는 연결선은 계산에서 빠진다. 역행 판정은 레이아웃 엔진(`layout-graph`)과 같은 DFS.

import type { Graph } from "@/lib/api";
import { findBackEdges, sortLayoutEdges, type LayoutEdgeLink } from "@/lib/layout-graph";
import { getOutputGroups, getOutputKey } from "@/lib/output-rules";
import { PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

export type RunNodeStatus = "waiting" | "ready" | "active" | "done" | "problem" | "skipped";
export type RunManualStatus = "active" | "done" | "problem";
export type RunEdgeKind = "skip" | "fut" | "prob" | "now" | "past";

export interface RunGraphNode {
  id: string;
  nodeType: string;
  title: string;
  isPrimaryEnd: boolean;
  parallelOutputs: readonly string[];
}

export interface RunGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  label: string;
  gateway: string | null;
}

export interface RunGraph {
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
}

/** 범위 하나의 저장 상태 — manual: 노드→active|done|problem, choice: 노드→연결선 id, exit: 노드→출구 키. */
export interface RunScopeState {
  manual: Record<string, RunManualStatus>;
  choice: Record<string, string>;
  exit: Record<string, string>;
  closed: boolean;
}

export type BranchOptions =
  | { kind: "none" }
  | { kind: "edge"; edgeIds: string[] }
  | { kind: "exit"; exitKeys: string[] };

type RunStatusMap = Readonly<Record<string, RunNodeStatus>>;

// 진행률 분모 후보이자 사람이 직접 처리하는 노드 유형 — start·end는 흐름이 자동으로 지나간다
const ACTIONABLE_TYPES: ReadonlySet<string> = new Set(["process", "decision", "subprocess"]);

const NO_BRANCH: BranchOptions = { kind: "none" };

/** id 정렬은 코드 단위 비교 — BE 파이썬 `sorted`와 같다(localeCompare 금지). */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 자기 소유 키만 읽는다 — id가 `toString`이어도 Object.prototype 멤버를 값으로 오인하지 않는다. */
function readOwn<V>(record: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function readNodeStatus(statuses: RunStatusMap, nodeId: string): RunNodeStatus | undefined {
  return readOwn(statuses, nodeId);
}

function groupEdgesBy(edges: readonly RunGraphEdge[], keyOf: (edge: RunGraphEdge) => string): Map<string, RunGraphEdge[]> {
  const groups = new Map<string, RunGraphEdge[]>();
  for (const edge of edges) {
    const key = keyOf(edge);
    const group = groups.get(key);
    if (group) group.push(edge);
    else groups.set(key, [edge]);
  }
  return groups;
}

/** 양 끝이 모두 그래프에 있는 연결선 — 끝점이 없는 연결선(FK 없음)은 계산에서 빠진다. */
function getKnownEdges(graph: RunGraph): RunGraphEdge[] {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
}

function makePairKey(source: string, target: string): string {
  return JSON.stringify([source, target]);
}

/**
 * 역행(루프) 연결선 id — 레이아웃 엔진과 같은 DFS 판정이라 에디터가 보여 주는 루프와 일치한다.
 * BE `find_back_edges`는 (출발, 도착) 쌍·쌍별 마지막 라벨·핸들 차원 없음으로 돌므로 같은 입력을 만들어 넘기고,
 * 같은 쌍의 연결선은 모두 역행으로 묶는다.
 */
export function findRunBackEdgeIds(graph: RunGraph): Set<string> {
  const edges = getKnownEdges(graph);
  const nodeIds = graph.nodes.map((n) => n.id).sort(compareIds);
  const labelByPair = new Map<string, string>();
  for (const edge of edges) labelByPair.set(makePairKey(edge.source, edge.target), edge.label);
  const layoutEdges: LayoutEdgeLink[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: labelByPair.get(makePairKey(edge.source, edge.target)),
  }));
  const backEdges = findBackEdges(nodeIds, sortLayoutEdges(nodeIds, layoutEdges));
  const backPairs = new Set([...backEdges].map((edge) => makePairKey(edge.source, edge.target)));
  return new Set(edges.filter((e) => backPairs.has(makePairKey(e.source, e.target))).map((e) => e.id));
}

/** 역행을 뺀 연결선으로 라운드 단위 Kahn — 라운드 안에선 id 오름차순, 남는 노드는 id 순으로 뒤에 붙인다. */
function orderNodes(graph: RunGraph, forward: readonly RunGraphEdge[]): string[] {
  const indegree = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  const successors = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const edge of forward) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    successors.get(edge.source)?.push(edge.target);
  }
  const order: string[] = [];
  let ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort(compareIds);
  while (ready.length > 0) {
    order.push(...ready);
    const nextReady: string[] = [];
    for (const nodeId of ready) {
      for (const target of successors.get(nodeId) ?? []) {
        const left = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, left);
        if (left === 0) nextReady.push(target);
      }
    }
    ready = nextReady.sort(compareIds);
  }
  const placed = new Set(order);
  order.push(...graph.nodes.map((n) => n.id).filter((id) => !placed.has(id)).sort(compareIds));
  return order;
}

function getForwardEdges(graph: RunGraph): RunGraphEdge[] {
  const backIds = findRunBackEdgeIds(graph);
  return getKnownEdges(graph).filter((e) => !backIds.has(e.id));
}

/** 위상 순서(역행 제외) — 같은 라운드는 id 오름차순. 상태 맵의 키 순서도 이 순서다. */
export function getRunTopoOrder(graph: RunGraph): string[] {
  return orderNodes(graph, getForwardEdges(graph));
}

/** 나가는 연결선(역행 포함, 그래프 순서)에서 갈래 종류를 정한다. */
function buildBranchOptions(node: RunGraphNode, outgoing: readonly RunGraphEdge[]): BranchOptions {
  if (node.nodeType === "decision") {
    return outgoing.length >= 2 ? { kind: "edge", edgeIds: outgoing.map((e) => e.id) } : NO_BRANCH;
  }
  const groups = getOutputGroups(node, outgoing);
  if (node.nodeType === "subprocess" && groups.length >= 2) {
    return { kind: "exit", exitKeys: groups.map((g) => g.key) };
  }
  if (outgoing.length <= 1) return NO_BRANCH;
  // 출구가 하나뿐인 묶음(일반 노드 전부, 끝이 하나인 SP)이 병렬이면 전 갈래 동시, 아니면 레거시 택일
  return groups[0].parallel ? NO_BRANCH : { kind: "edge", edgeIds: outgoing.map((e) => e.id) };
}

export function getBranchOptions(graph: RunGraph, nodeId: string): BranchOptions {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`run graph has no node ${nodeId}`);
  return buildBranchOptions(node, getKnownEdges(graph).filter((e) => e.source === nodeId));
}

/** 건너뛴 출발의 연결선은 죽고, 완료된 갈래 노드는 사람이 고른 연결선·출구만 산다. */
function isEdgeLive(
  edge: RunGraphEdge,
  source: RunGraphNode,
  sourceStatus: RunNodeStatus,
  options: BranchOptions,
  state: RunScopeState,
): boolean {
  if (sourceStatus === "skipped") return false;
  if (sourceStatus !== "done") return true;
  if (options.kind === "edge") return readOwn(state.choice, source.id) === edge.id;
  if (options.kind === "exit") return getOutputKey(source.nodeType, edge.sourceHandle) === readOwn(state.exit, source.id);
  return true;
}

interface RunGraphIndex {
  nodes: Map<string, RunGraphNode>;
  order: string[];
  // 정방향 연결선을 도착 노드별로 — 상태 전파와 거슬러 오르기가 쓴다
  incoming: Map<string, RunGraphEdge[]>;
  options: Map<string, BranchOptions>;
}

function indexGraph(graph: RunGraph): RunGraphIndex {
  const forward = getForwardEdges(graph);
  const outgoing = groupEdgesBy(getKnownEdges(graph), (e) => e.source);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  return {
    nodes,
    order: orderNodes(graph, forward),
    incoming: groupEdgesBy(forward, (e) => e.target),
    options: new Map([...nodes].map(([id, node]) => [id, buildBranchOptions(node, outgoing.get(id) ?? [])])),
  };
}

function getIndexed<V>(map: ReadonlyMap<string, V>, key: string, what: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`run graph is missing ${what} ${key}`);
  return value;
}

export function deriveRunStatuses(graph: RunGraph, state: RunScopeState): Record<string, RunNodeStatus> {
  const { nodes, order, incoming, options } = indexGraph(graph);
  const statuses = new Map<string, RunNodeStatus>();
  for (const nodeId of order) {
    const node = getIndexed(nodes, nodeId, "node");
    if (node.nodeType === "start") {
      statuses.set(nodeId, "done");
      continue;
    }
    const live = (incoming.get(nodeId) ?? []).filter((e) =>
      isEdgeLive(
        e,
        getIndexed(nodes, e.source, "node"),
        getIndexed(statuses, e.source, "status"),
        getIndexed(options, e.source, "options"),
        state,
      ),
    );
    const manual = readOwn(state.manual, nodeId);
    if (live.length === 0) {
      statuses.set(nodeId, "skipped");
    } else if (manual !== undefined) {
      statuses.set(nodeId, manual);
    } else if (live.every((e) => statuses.get(e.source) === "done")) {
      statuses.set(nodeId, node.nodeType === "end" ? "done" : "ready");
    } else {
      statuses.set(nodeId, "waiting");
    }
  }
  if (!state.closed) return Object.fromEntries(statuses);
  return Object.fromEntries([...statuses].map(([id, status]) => [id, status === "done" || status === "problem" ? status : "skipped"]));
}

/** 완료 수와 건너뛰지 않은 처리 대상 수 — 중단(closed) 전 기준이라 closed를 끄고 계산한다. */
export function countRunProgress(graph: RunGraph, state: RunScopeState): { done: number; total: number } {
  const statuses = deriveRunStatuses(graph, { ...state, closed: false });
  let done = 0;
  let total = 0;
  for (const node of graph.nodes) {
    if (!ACTIONABLE_TYPES.has(node.nodeType)) continue;
    const status = readNodeStatus(statuses, node.id);
    if (status === "skipped") continue;
    total += 1;
    if (status === "done") done += 1;
  }
  return { done, total };
}

export function isRunScopeFinished(statuses: RunStatusMap): boolean {
  return Object.values(statuses).every((status) => status === "done" || status === "skipped");
}

/** 닿은 끝의 키 — 대표 끝이면 `__primary__`, 아니면 위상 순서상 첫 끝의 제목(빈 제목 가능), 없으면 null. */
export function getReachedEndKey(graph: RunGraph, statuses: RunStatusMap): string | null {
  const reached = graph.nodes.filter((n) => n.nodeType === "end" && readNodeStatus(statuses, n.id) === "done");
  if (reached.length === 0) return null;
  if (reached.some((n) => n.isPrimaryEnd)) return PRIMARY_END_HANDLE;
  const rank = new Map(getRunTopoOrder(graph).map((id, index) => [id, index]));
  const rankOf = (node: RunGraphNode): number => getIndexed(rank, node.id, "rank");
  const first = reached.reduce((best, node) => (rankOf(node) < rankOf(best) ? node : best));
  return first.title;
}

/**
 * 연결선 종류(우선순위 순) — 출발·도착이 건너뜀이거나 출발이 끝났는데 죽은 연결선은 `skip`, 출발이 안 끝나면 `fut`,
 * 도착이 문제면 `prob`, 도착이 진행 가능·진행 중이면 `now`, 나머지는 `past`. 끝점이 그래프에 없으면 `skip`.
 */
export function getRunEdgeKind(
  graph: RunGraph,
  state: RunScopeState,
  statuses: RunStatusMap,
  edge: RunGraphEdge,
): RunEdgeKind {
  const source = graph.nodes.find((n) => n.id === edge.source);
  const sourceStatus = readNodeStatus(statuses, edge.source);
  const targetStatus = readNodeStatus(statuses, edge.target);
  if (!source || sourceStatus === undefined || targetStatus === undefined) return "skip";
  if (sourceStatus === "skipped" || targetStatus === "skipped") return "skip";
  if (sourceStatus === "done" && !isEdgeLive(edge, source, sourceStatus, getBranchOptions(graph, source.id), state)) {
    return "skip";
  }
  if (sourceStatus !== "done") return "fut";
  if (targetStatus === "problem") return "prob";
  if (targetStatus === "ready" || targetStatus === "active") return "now";
  return "past";
}

/**
 * 먼저 끝낼 단계 — 산 정방향 연결선을 거슬러 올라가며 대기 노드는 계속 타고, 처음 만나는 진행 가능·진행 중·문제
 * 노드를 모은다(완료·건너뜀은 멈춘다). 위상 순서로 돌려준다.
 */
export function findRunFrontier(
  graph: RunGraph,
  state: RunScopeState,
  statuses: RunStatusMap,
  nodeId: string,
): string[] {
  const { nodes, order, incoming, options } = indexGraph(graph);
  const collected = new Set<string>();
  const seen = new Set<string>([nodeId]);
  const stack = [nodeId];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    for (const edge of incoming.get(current) ?? []) {
      const source = nodes.get(edge.source);
      const sourceStatus = readNodeStatus(statuses, edge.source);
      if (!source || sourceStatus === undefined || seen.has(source.id)) continue;
      if (!isEdgeLive(edge, source, sourceStatus, getIndexed(options, source.id, "options"), state)) continue;
      seen.add(source.id);
      if (sourceStatus === "waiting") stack.push(source.id);
      else if (sourceStatus === "ready" || sourceStatus === "active" || sourceStatus === "problem") collected.add(source.id);
    }
  }
  return order.filter((id) => collected.has(id));
}

/**
 * 완료 취소와 함께 지울 뒤 단계 — 정방향으로 닿는 노드 중 이미 손댄(수동 상태·선택·출구) 것, 위상 순서.
 * BE `list_touched_after`와 같다(사례 파일 touched_after). 비어 있지 않으면 서버는 downstream 확인 없이 409를 준다.
 */
export function findRunTouchedAfter(graph: RunGraph, state: RunScopeState, nodeId: string): string[] {
  const forward = getForwardEdges(graph);
  const successors = groupEdgesBy(forward, (e) => e.source);
  const after = new Set<string>();
  const stack = [nodeId];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    for (const edge of successors.get(current) ?? []) {
      if (after.has(edge.target)) continue;
      after.add(edge.target);
      stack.push(edge.target);
    }
  }
  after.delete(nodeId);
  const isTouched = (id: string) =>
    readOwn(state.manual, id) !== undefined || readOwn(state.choice, id) !== undefined || readOwn(state.exit, id) !== undefined;
  return orderNodes(graph, forward).filter((id) => after.has(id) && isTouched(id));
}

/** 방금 열린 노드 — 전에 진행 가능이 아니던 것 중 지금 진행 가능. 순서는 `after`의 키 순서(= deriveRunStatuses의 위상 순서). */
export function findOpenedNodeIds(before: RunStatusMap, after: RunStatusMap): string[] {
  return Object.keys(after).filter((id) => after[id] === "ready" && readNodeStatus(before, id) !== "ready");
}

/** API 그래프를 실행 엔진 입력으로 — 레거시 응답에서 빠질 수 있는 `parallel_outputs`·`gateway`는 기본값으로 접는다. */
export function toRunGraph(graph: Graph): RunGraph {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      nodeType: n.node_type,
      title: n.title,
      isPrimaryEnd: n.is_primary_end,
      parallelOutputs: n.parallel_outputs ?? [],
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      sourceHandle: e.source_handle,
      label: e.label,
      gateway: e.gateway ?? null,
    })),
  };
}

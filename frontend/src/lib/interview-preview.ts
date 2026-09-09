// 인터뷰 JSON 한 행(rows[i])의 actions/relations를 드라이런 리포트 미리보기용 그래프로 — 드라이런은 롤백돼
// 맵이 DB에 없으니 업로드한 파일에서 직접 그린다. 규칙은 backend consultant_interview(_parse_actions·
// _build_flow_edges)와 import_consultant.build_graph_rows의 FE 동치본(판단 승격·자기 반복 분기 합성·Start/End
// 배선·LR 자동정렬) — 한쪽을 고치면 다른 쪽도 옮긴다. 표시 전용이라 설명·IO 등 속성은 싣지 않는다.

import type { Edge } from "@xyflow/react";

import type { FlatNode, GraphEdge, VersionGraph } from "./api";
import { buildNodeData, normalizeNodeType, type AppNode } from "./canvas";
import { autoLayoutFlow } from "./flow-layout";

export const PREVIEW_EXCEPTION_COLOR = "#c2849a"; // consultant_interview.EXCEPTION_VARIANT_COLOR 동치
export const PREVIEW_LOOP_BRANCH_NAME = "반복 여부(자동 생성됨)"; // consultant_interview.LOOP_BRANCH_NODE_NAME 동치
export const PREVIEW_START_ID = "__start__";
export const PREVIEW_END_ID = "__end__";

const KNOWN_EDGE_KINDS: ReadonlySet<string> = new Set(["seq", "branch", "loop", "bypass"]);

interface PreviewNode {
  code: string;
  name: string;
  type: "process" | "decision";
  color: string;
  seq: number;
}

interface PreviewEdge {
  from: string;
  to: string;
  label: string;
  kind: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asSeq(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function makeSeqChain(ordered: PreviewNode[]): PreviewEdge[] {
  return ordered.slice(1).map((node, i) => ({ from: ordered[i].code, to: node.code, label: "", kind: "seq" }));
}

// relations.edges → 흐름 엣지 + 자기 반복 분기 노드. 택일 branch의 src는 decision으로 승격, self edge는
// ◇(a{seq}r)를 합성해 A→◇→A 루프백으로 바꾸고 A의 기존 진출은 ◇로 이설한다(backend _build_flow_edges).
function buildFlowEdges(
  relations: Record<string, unknown> | null,
  bySeq: Map<number, PreviewNode>,
  ordered: PreviewNode[],
): { edges: PreviewEdge[]; loopNodes: { anchor: string; node: PreviewNode }[] } {
  const rawEdges = relations?.edges;
  if (!Array.isArray(rawEdges)) return { edges: makeSeqChain(ordered), loopNodes: [] };
  const declared = new Set(ordered.filter((n) => n.type === "decision").map((n) => n.code));
  const edges: PreviewEdge[] = [];
  const seen = new Set<string>();
  const selfSpecs: { node: PreviewNode; label: string }[] = [];
  for (const raw of rawEdges) {
    const edge = asRecord(raw);
    if (!edge) continue;
    const srcSeq = asSeq(edge.src);
    const dstSeq = asSeq(edge.dst);
    const src = srcSeq === null ? undefined : bySeq.get(srcSeq);
    const dst = dstSeq === null ? undefined : bySeq.get(dstSeq);
    if (!src || !dst) continue;
    const pair = `${src.code}>${dst.code}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const kindRaw = asText(edge.kind) || "seq";
    const kind = KNOWN_EDGE_KINDS.has(kindRaw) ? kindRaw : "seq";
    // 엣지 라벨 = label + 줄바꿈 + condition (backend _edge_label)
    const label = [asText(edge.label), asText(edge.condition)].filter(Boolean).join("\n");
    if (src === dst) {
      selfSpecs.push({ node: src, label });
      continue;
    }
    edges.push({ from: src.code, to: dst.code, label, kind });
    if (kind === "branch" && asText(edge.gateway) !== "parallel") src.type = "decision";
  }
  const loopNodes: { anchor: string; node: PreviewNode }[] = [];
  for (const { node, label } of selfSpecs) {
    const branch: PreviewNode = {
      code: `${node.code}r`,
      name: PREVIEW_LOOP_BRANCH_NAME,
      type: "decision",
      color: "",
      seq: node.seq,
    };
    for (const edge of edges) {
      if (edge.from === node.code) edge.from = branch.code;
    }
    edges.push({ from: node.code, to: branch.code, label: "", kind: "seq" });
    edges.push({ from: branch.code, to: node.code, label, kind: "loop" });
    if (!declared.has(node.code)) node.type = "process";
    loopNodes.push({ anchor: node.code, node: branch });
  }
  if (edges.length === 0) return { edges: makeSeqChain(ordered), loopNodes: [] };
  return { edges, loopNodes };
}

function makeFlatNode(id: string, title: string, nodeType: string, color: string, sortOrder: number): FlatNode {
  return {
    id,
    title,
    description: "",
    node_type: nodeType,
    color,
    assignee: "",
    department: "",
    system: "",
    duration: "",
    pos_x: 0,
    pos_y: 0,
    sort_order: sortOrder,
    group_ids: [],
    linked_map_id: null,
    follow_latest: false,
    linked_version_id: null,
    is_primary_end: nodeType === "end",
    parent_node_id: null,
    source_node_id: null,
  };
}

/** rows[i] 한 행 → 배치 전(pos 0) 그래프. actions가 없으면 null. 노드 id는 백엔드 코드(a01·a01r·__start__·__end__). */
export function buildPreviewGraph(row: unknown): VersionGraph | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const rawActions = Array.isArray(rec.actions) ? rec.actions : [];
  const bySeq = new Map<number, PreviewNode>();
  rawActions.forEach((raw, i) => {
    const action = asRecord(raw);
    if (!action) return;
    const seqRaw = asSeq(action.seq);
    const seq = seqRaw !== null && seqRaw > 0 ? seqRaw : i + 1;
    if (bySeq.has(seq)) return; // 중복 seq는 어댑터가 에러로 잡는다
    bySeq.set(seq, {
      code: `a${String(seq).padStart(2, "0")}`,
      name: asText(action.label) || `Step ${seq}`,
      type: asText(action.kind) === "decision" ? "decision" : "process",
      color: asText(action.variant) === "exception" ? PREVIEW_EXCEPTION_COLOR : "",
      seq,
    });
  });
  if (bySeq.size === 0) return null;
  const ordered = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const { edges: flowEdges, loopNodes } = buildFlowEdges(asRecord(rec.relations), bySeq, ordered);
  // 합성 분기 노드는 앵커 바로 뒤에 끼운다(어댑터 호출부와 동일)
  const withLoops: PreviewNode[] = [];
  for (const node of ordered) {
    withLoops.push(node);
    for (const loop of loopNodes) {
      if (loop.anchor === node.code) withLoops.push(loop.node);
    }
  }
  // Start/End 보강 — loop은 Start 판정에서 제외(되돌아오는 진입은 진입이 아님), End 판정엔 포함
  const hasIn = new Set(flowEdges.filter((e) => e.kind !== "loop").map((e) => e.to));
  const hasOut = new Set(flowEdges.map((e) => e.from));
  const flow: PreviewEdge[] = [...flowEdges];
  for (const node of withLoops) {
    if (!hasIn.has(node.code)) flow.push({ from: PREVIEW_START_ID, to: node.code, label: "", kind: "seq" });
    if (!hasOut.has(node.code)) flow.push({ from: node.code, to: PREVIEW_END_ID, label: "", kind: "seq" });
  }
  const nodes: FlatNode[] = [
    makeFlatNode(PREVIEW_START_ID, "Start", "start", "", 0),
    ...withLoops.map((node, i) => makeFlatNode(node.code, node.name, node.type, node.color, i + 1)),
    makeFlatNode(PREVIEW_END_ID, "End", "end", "", withLoops.length + 1),
  ];
  const edges: GraphEdge[] = flow.map((edge, i) => ({
    id: `e${i}`,
    source_node_id: edge.from,
    target_node_id: edge.to,
    label: edge.label,
    source_side: "right",
    target_side: "left",
    source_handle: null,
    target_handle: null,
    line_style: "",
  }));
  return { nodes, edges };
}

// L5 연계 캔버스 미리보기 — 파일 최상위 relations.edges가 rows(홈 L6)와 externalTasks(타 L5의 L6)를
// taskId/refId로 잇는다. 노드는 전부 subprocess라 분기 src를 decision으로 승격할 수 없어, 백엔드
// expand_linkage_branches처럼 팬아웃 앞에 분기 노드를 새로 세운다(전부 gateway="parallel"인 병행 팬아웃은 제외).
// 표시 전용 근사치 — 좌표·핸들·계보 키 등 저장 계약은 싣지 않는다.
const L5_FANOUT_MIN = 2;

interface L5Node {
  code: string;
  name: string;
  type: "subprocess" | "decision";
}

/** externalTasks[] → refId별 표시 제목. 미선언 끝점은 호출부가 코드 자체를 제목으로 쓴다 (spec 2026-09-07 §6.3). */
function readExternalTitles(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const ext = asRecord(item);
    const refId = ext ? asText(ext.refId) : "";
    if (!ext || !refId) continue;
    const l5 = asRecord(ext.l5);
    const l5Label = l5 ? asText(l5.label) : "";
    const l6 = asText(ext.l6) || refId;
    out.set(refId, l5Label ? `${l6} (${l5Label})` : l6);
  }
  return out;
}

/** 파일 1건(rows + relations + externalTasks) → 배치 전 연계 캔버스 그래프. rows가 없으면 null. */
export function buildL5PreviewGraph(file: unknown): VersionGraph | null {
  const rec = asRecord(file);
  if (!rec) return null;
  const rawRows = Array.isArray(rec.rows) ? rec.rows : [];
  const byCode = new Map<string, L5Node>();
  for (const raw of rawRows) {
    const row = asRecord(raw);
    const code = row ? asText(row.taskId) : "";
    if (!row || !code || byCode.has(code)) continue;
    byCode.set(code, { code, name: asText(row.l6) || code, type: "subprocess" });
  }
  if (byCode.size === 0) return null;
  const externalTitles = readExternalTitles(rec.externalTasks);

  // 엣지 수집 — 끝점이 rows에 없으면 외부 L6 노드로 세운다(선언 제목 또는 원문 코드)
  const rawEdges = asRecord(rec.relations)?.edges;
  const edges: PreviewEdge[] = [];
  const gatewayOf = new Map<string, string>();
  const seen = new Set<string>();
  const ensure = (code: string): L5Node => {
    const known = byCode.get(code);
    if (known) return known;
    const made: L5Node = { code, name: externalTitles.get(code) ?? code, type: "subprocess" };
    byCode.set(code, made);
    return made;
  };
  for (const raw of Array.isArray(rawEdges) ? rawEdges : []) {
    const edge = asRecord(raw);
    const from = edge ? asText(edge.src) : "";
    const to = edge ? asText(edge.dst) : "";
    if (!edge || !from || !to) continue;
    const pair = `${from}>${to}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    ensure(from);
    ensure(to);
    const kindRaw = asText(edge.kind) || "seq";
    const label = [asText(edge.label), asText(edge.condition)].filter(Boolean).join("\n");
    edges.push({ from, to, label, kind: KNOWN_EDGE_KINDS.has(kindRaw) ? kindRaw : "seq" });
    gatewayOf.set(pair, asText(edge.gateway));
  }
  const ordered = [...byCode.values()];
  if (edges.length === 0) {
    for (let i = 1; i < ordered.length; i += 1) {
      edges.push({ from: ordered[i - 1].code, to: ordered[i].code, label: "", kind: "seq" });
    }
  }

  // 팬아웃 앞 분기 노드 — 자기 자신으로 돌아오는 엣지(되돌아감)가 섞였으면 일괄 생성 티를 내는 이름을 쓴다
  const outgoing = new Map<string, PreviewEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from);
    if (list) list.push(edge);
    else outgoing.set(edge.from, [edge]);
  }
  const flow: PreviewEdge[] = [];
  const branches: { anchor: string; node: L5Node }[] = [];
  for (const node of ordered) {
    const outs = outgoing.get(node.code) ?? [];
    const allParallel = outs.length > 0 && outs.every((e) => gatewayOf.get(`${e.from}>${e.to}`) === "parallel");
    if (outs.length < L5_FANOUT_MIN || allParallel) {
      flow.push(...outs);
      continue;
    }
    const loops = outs.some((e) => e.to === node.code || e.kind === "loop");
    const branch: L5Node = {
      code: `${node.code}__b`,
      name: loops ? PREVIEW_LOOP_BRANCH_NAME : `${node.name} 결과`,
      type: "decision",
    };
    branches.push({ anchor: node.code, node: branch });
    flow.push({ from: node.code, to: branch.code, label: "", kind: "seq" });
    for (const edge of outs) flow.push({ ...edge, from: branch.code });
  }
  const withBranches: L5Node[] = [];
  for (const node of ordered) {
    withBranches.push(node);
    for (const branch of branches) {
      if (branch.anchor === node.code) withBranches.push(branch.node);
    }
  }

  // Start/End 보강 — L6와 같은 규칙(loop 진입은 진입으로 치지 않는다)
  const hasIn = new Set(flow.filter((e) => e.kind !== "loop").map((e) => e.to));
  const hasOut = new Set(flow.map((e) => e.from));
  const full: PreviewEdge[] = [...flow];
  for (const node of withBranches) {
    if (!hasIn.has(node.code)) full.push({ from: PREVIEW_START_ID, to: node.code, label: "", kind: "seq" });
    if (!hasOut.has(node.code)) full.push({ from: node.code, to: PREVIEW_END_ID, label: "", kind: "seq" });
  }
  const nodes: FlatNode[] = [
    makeFlatNode(PREVIEW_START_ID, "Start", "start", "", 0),
    ...withBranches.map((node, i) => makeFlatNode(node.code, node.name, node.type, "", i + 1)),
    makeFlatNode(PREVIEW_END_ID, "End", "end", "", withBranches.length + 1),
  ];
  return {
    nodes,
    edges: full.map((edge, i) => ({
      id: `e${i}`,
      source_node_id: edge.from,
      target_node_id: edge.to,
      label: edge.label,
      source_side: "right",
      target_side: "left",
      source_handle: null,
      target_handle: null,
      line_style: "",
    })),
  };
}

/** 에디터 자동정렬(LR)로 좌표를 채운다 — 임포트 배치(consultant_layout.py)와 같은 계약이라 실제 맵과 같은 모양. */
export function layoutPreviewGraph(graph: VersionGraph): VersionGraph {
  const nodes: AppNode[] = graph.nodes.map((node) => ({
    id: node.id,
    position: { x: node.pos_x, y: node.pos_y },
    data: buildNodeData(normalizeNodeType(node.node_type), node.title),
  }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label,
  }));
  const laid = autoLayoutFlow(nodes, edges, "LR");
  const positions = new Map(laid.nodes.map((node) => [node.id, node.position]));
  return {
    nodes: graph.nodes.map((node) => {
      const pos = positions.get(node.id);
      return pos ? { ...node, pos_x: pos.x, pos_y: pos.y } : node;
    }),
    edges: graph.edges,
  };
}

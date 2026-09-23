// 연결(relations) 캔버스 ↔ ReactFlow 순수 변환 — FwCanvas(서버 세션 진실)와 에디터용 AppNode/Edge를 오간다.

import { MarkerType, type Edge } from "@xyflow/react";

import type { FwCanvas, FwCanvasEdge, FwCanvasNode } from "./api";
import { buildNodeData, normalizeNodeType, type AppNode } from "./canvas";
import { genId } from "./id";

export const START_ID = "__start__";
export const END_ID = "__end__";
export const BRANCH_PREFIX = "__branch__";

// RF 노드에 없는 subprocess/decision/start/end 4종만 캔버스가 허용 — 새 process/section 타입은 subprocess로 접는다.
function toCanvasNodeType(nodeType: string): FwCanvasNode["node_type"] {
  switch (nodeType) {
    case "decision":
    case "start":
    case "end":
    case "subprocess":
      return nodeType;
    default:
      return "subprocess";
  }
}

function readGateway(data: Record<string, unknown> | undefined): "exclusive" | "parallel" | undefined {
  const value = data?.gateway;
  return value === "exclusive" || value === "parallel" ? value : undefined;
}

export function canvasToFlow(canvas: FwCanvas): { nodes: AppNode[]; edges: Edge[] } {
  const nodes: AppNode[] = canvas.nodes.map((node) => ({
    id: node.id,
    type: "process",
    position: { x: node.pos_x, y: node.pos_y },
    data: buildNodeData(normalizeNodeType(node.node_type), node.title),
  }));
  const edges: Edge[] = canvas.edges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label || undefined,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    ...(edge.gateway ? { data: { gateway: edge.gateway } } : {}),
  }));
  return { nodes, edges };
}

export function flowToCanvas(nodes: AppNode[], edges: Edge[], prev: FwCanvas): FwCanvas {
  const prevNodeById = new Map(prev.nodes.map((node) => [node.id, node]));
  const prevEdgeById = new Map(prev.edges.map((edge) => [edge.id, edge]));
  const nextNodes: FwCanvasNode[] = nodes.map((node) => {
    const source = prevNodeById.get(node.id);
    return {
      id: node.id,
      node_type: source?.node_type ?? toCanvasNodeType(node.data.nodeType),
      title: source?.title ?? node.data.label,
      task_id: source?.task_id ?? null,
      pos_x: node.position.x,
      pos_y: node.position.y,
    };
  });
  const nextEdges: FwCanvasEdge[] = edges.map((edge) => {
    const gateway = readGateway(edge.data) ?? prevEdgeById.get(edge.id)?.gateway;
    return {
      id: edge.id,
      source_node_id: edge.source,
      target_node_id: edge.target,
      label: typeof edge.label === "string" ? edge.label : String(edge.label ?? ""),
      ...(gateway ? { gateway } : {}),
    };
  });
  return { nodes: nextNodes, edges: nextEdges };
}

// nodeId의 나가는 엣지를 새 분기(decision) 노드 뒤로 이관 — 이미 분기가 있으면 `__branch__{nodeId}__2`처럼 순번을 늘린다.
export function addBranchAfter(canvas: FwCanvas, nodeId: string): FwCanvas {
  const sourceNode = canvas.nodes.find((node) => node.id === nodeId);
  if (!sourceNode) return canvas;
  let branchId = `${BRANCH_PREFIX}${nodeId}`;
  let suffix = 2;
  const existingIds = new Set(canvas.nodes.map((node) => node.id));
  while (existingIds.has(branchId)) {
    branchId = `${BRANCH_PREFIX}${nodeId}__${suffix}`;
    suffix += 1;
  }
  const branchNode: FwCanvasNode = {
    id: branchId,
    node_type: "decision",
    title: "분기",
    task_id: null,
    pos_x: sourceNode.pos_x + 220,
    pos_y: sourceNode.pos_y,
  };
  const rewired = canvas.edges.map((edge) =>
    edge.source_node_id === nodeId ? { ...edge, source_node_id: branchId } : edge,
  );
  const bridgeEdge: FwCanvasEdge = {
    id: `e-${genId()}`,
    source_node_id: nodeId,
    target_node_id: branchId,
    label: "",
  };
  return {
    nodes: [...canvas.nodes, branchNode],
    edges: [...rewired, bridgeEdge],
  };
}

// 분기 노드 제거 — 들어오는 각 src에서 분기의 나가는 엣지들을 직접 잇는다(라벨·gateway 유지).
// 나가는 엣지의 원래 배열 위치에서 치환해 기존 순서를 보존한다(단일 in/out이면 원래 엣지 id도 유지).
export function removeBranch(canvas: FwCanvas, branchId: string): FwCanvas {
  const incoming = canvas.edges.filter((edge) => edge.target_node_id === branchId);
  const edges: FwCanvasEdge[] = canvas.edges.flatMap((edge) => {
    if (edge.target_node_id === branchId) return [];
    if (edge.source_node_id === branchId) {
      return incoming.map((inEdge) => ({
        ...edge,
        id: incoming.length === 1 ? edge.id : `e-${genId()}`,
        source_node_id: inEdge.source_node_id,
      }));
    }
    return [edge];
  });
  return {
    nodes: canvas.nodes.filter((node) => node.id !== branchId),
    edges,
  };
}

// 중복 쌍(source→target 기존 엣지 존재)이면 그대로 반환.
export function connectNodes(canvas: FwCanvas, sourceId: string, targetId: string): FwCanvas {
  const exists = canvas.edges.some(
    (edge) => edge.source_node_id === sourceId && edge.target_node_id === targetId,
  );
  if (exists) return canvas;
  const newEdge: FwCanvasEdge = {
    id: `e-${genId()}`,
    source_node_id: sourceId,
    target_node_id: targetId,
    label: "",
  };
  return { ...canvas, edges: [...canvas.edges, newEdge] };
}

export function setEdgeLabel(canvas: FwCanvas, edgeId: string, label: string): FwCanvas {
  return {
    ...canvas,
    edges: canvas.edges.map((edge) => (edge.id === edgeId ? { ...edge, label } : edge)),
  };
}

export function removeEdge(canvas: FwCanvas, edgeId: string): FwCanvas {
  return { ...canvas, edges: canvas.edges.filter((edge) => edge.id !== edgeId) };
}

export function moveNode(canvas: FwCanvas, nodeId: string, x: number, y: number): FwCanvas {
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => (node.id === nodeId ? { ...node, pos_x: x, pos_y: y } : node)),
  };
}

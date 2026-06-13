// 캔버스 공용 타입 + 정렬/레이아웃 헬퍼 (순수 함수).

import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type { MessageKey } from "@/lib/i18n-messages";

export type NodeData = {
  label: string;
  description: string;
  nodeType: ProcessNodeType;
  color: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  hasChildren: boolean;
  // 비교 화면 전용 — diff 하이라이트 (spec §7 Phase B). 에디터에서는 미설정.
  diffStatus?: "added" | "removed" | "changed";
  diffNote?: string;
  hasDescendantChange?: boolean;
  // 미해결 코멘트 수 — 에디터가 렌더 시 주입 (spec §7 Phase C)
  commentCount?: number;
};

export type AppNode = Node<NodeData>;

export type ProcessNodeType = "process" | "decision" | "start" | "end";

// 노드 타입 선택지 — 값은 백엔드 node_type 컬럼에 그대로 저장 (spec §7 Phase A)
export const NODE_TYPE_OPTIONS: { value: ProcessNodeType; labelKey: MessageKey }[] = [
  { value: "process", labelKey: "nodeType.process" },
  { value: "decision", labelKey: "nodeType.decision" },
  { value: "start", labelKey: "nodeType.start" },
  { value: "end", labelKey: "nodeType.end" },
];

/** DB의 자유 문자열 node_type을 렌더 가능한 타입으로 정규화 (레거시 "default" → process). */
export function normalizeNodeType(value: string): ProcessNodeType {
  switch (value) {
    case "decision":
    case "start":
    case "end":
      return value;
    default:
      return "process";
  }
}

// ProcessNode 렌더 크기 — dagre 레이아웃 박스 산정·커서 중앙 배치에 사용
export const NODE_WIDTH = 170;
export const NODE_HEIGHT = 52;

// 노드 사이 최소 간격(8px 그리드 정렬과 일치)
const COLLISION_GAP = 8;

/** 노드 타입별 충돌 박스 크기 — process-node.tsx 렌더 크기 근사. */
function getNodeSize(node: AppNode): { w: number; h: number } {
  switch (node.data.nodeType) {
    case "decision":
      return { w: 96, h: 96 };
    case "start":
    case "end":
      return { w: 96, h: 40 };
    default:
      return { w: NODE_WIDTH, h: NODE_HEIGHT };
  }
}

/** 드롭된 노드가 다른 노드와 겹치면 최소 분리 벡터로 밀어내 가장 가까운 빈 자리로 보낸다 (onNodeDragStop). */
export function resolveCollision(nodes: AppNode[], draggedId: string): AppNode[] {
  const dragged = nodes.find((node) => node.id === draggedId);
  if (!dragged) {
    return nodes;
  }
  const others = nodes.filter((node) => node.id !== draggedId);
  const size = getNodeSize(dragged);
  const pos = { ...dragged.position };

  // 최소 분리 벡터(MTV)를 반복 적용 — 겹침이 사라지거나 상한 도달까지
  for (let iter = 0; iter < 20; iter++) {
    let collided = false;
    for (const other of others) {
      const os = getNodeSize(other);
      const dx = pos.x + size.w / 2 - (other.position.x + os.w / 2);
      const dy = pos.y + size.h / 2 - (other.position.y + os.h / 2);
      const overlapX = (size.w + os.w) / 2 + COLLISION_GAP - Math.abs(dx);
      const overlapY = (size.h + os.h) / 2 + COLLISION_GAP - Math.abs(dy);
      if (overlapX > 0 && overlapY > 0) {
        collided = true;
        // 더 짧은 축으로 밀어 가장 가까운 분리
        if (overlapX < overlapY) {
          pos.x += dx >= 0 ? overlapX : -overlapX;
        } else {
          pos.y += dy >= 0 ? overlapY : -overlapY;
        }
      }
    }
    if (!collided) {
      break;
    }
  }

  if (pos.x === dragged.position.x && pos.y === dragged.position.y) {
    return nodes;
  }
  pos.x = Math.round(pos.x / COLLISION_GAP) * COLLISION_GAP;
  pos.y = Math.round(pos.y / COLLISION_GAP) * COLLISION_GAP;
  return nodes.map((node) => (node.id === draggedId ? { ...node, position: pos } : node));
}

// 엣지 기본 — 직각(elbow) + 움직이는 점선 + 화살표. 색/애니메이션은 globals.css(.react-flow__edge-path).
export const EDGE_DEFAULTS = {
  type: "smoothstep",
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-border-strong)" },
} as const;

/** B로 들어오는(B가 target) 엣지들. */
export function getIncomingEdges(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter((edge) => edge.target === nodeId);
}

/** B에서 나가는(B가 source) 엣지들. */
export function getOutgoingEdges(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter((edge) => edge.source === nodeId);
}

// 자기루프·중복 없이 엣지 추가
function withEdge(edges: Edge[], source: string, target: string): Edge[] {
  if (source === target || edges.some((edge) => edge.source === source && edge.target === target)) {
    return edges;
  }
  return [...edges, { ...EDGE_DEFAULTS, id: crypto.randomUUID(), source, target }];
}

/** A를 B의 선행으로 삽입. rewire면 B의 기존 incoming(단, A발 제외)을 A로 재연결 → …→A→B. */
export function insertNodeBefore(
  edges: Edge[],
  aId: string,
  bId: string,
  rewire: boolean,
): Edge[] {
  let next = edges;
  if (rewire) {
    next = next.map((edge) =>
      edge.target === bId && edge.source !== aId ? { ...edge, target: aId } : edge,
    );
  }
  return withEdge(next, aId, bId);
}

/** A를 B의 후행으로 삽입. rewire면 B의 기존 outgoing(단, A행 제외)을 A로 재연결 → B→A→…. */
export function insertNodeAfter(
  edges: Edge[],
  aId: string,
  bId: string,
  rewire: boolean,
): Edge[] {
  let next = edges;
  if (rewire) {
    next = next.map((edge) =>
      edge.source === bId && edge.target !== aId ? { ...edge, source: aId } : edge,
    );
  }
  return withEdge(next, bId, aId);
}

/** 선후(엣지) 흐름 기준 좌→우 자동 배치 (spec §3.3). */
export function layoutWithDagre(nodes: AppNode[], edges: Edge[]): AppNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });
  dagre.layout(graph);

  return nodes.map((node) => {
    const positioned = graph.node(node.id);
    return {
      ...node,
      position: {
        x: positioned.x - NODE_WIDTH / 2,
        y: positioned.y - NODE_HEIGHT / 2,
      },
    };
  });
}

/** 선택된 노드들을 한 축으로 맞춤 정렬. */
export function alignSelected(nodes: AppNode[], axis: "left" | "top"): AppNode[] {
  const selected = nodes.filter((node) => node.selected);
  if (selected.length < 2) {
    return nodes;
  }
  if (axis === "left") {
    const minX = Math.min(...selected.map((node) => node.position.x));
    return nodes.map((node) =>
      node.selected ? { ...node, position: { ...node.position, x: minX } } : node,
    );
  }
  const minY = Math.min(...selected.map((node) => node.position.y));
  return nodes.map((node) =>
    node.selected ? { ...node, position: { ...node.position, y: minY } } : node,
  );
}

/** 선택된 노드들을 한 축으로 등간격 분배. */
export function distributeSelected(nodes: AppNode[], axis: "x" | "y"): AppNode[] {
  const selected = nodes
    .filter((node) => node.selected)
    .sort((a, b) => a.position[axis] - b.position[axis]);
  if (selected.length < 3) {
    return nodes;
  }
  const start = selected[0].position[axis];
  const end = selected[selected.length - 1].position[axis];
  const step = (end - start) / (selected.length - 1);
  const targetById = new Map<string, number>();
  selected.forEach((node, index) => {
    targetById.set(node.id, start + step * index);
  });

  return nodes.map((node) => {
    const target = targetById.get(node.id);
    if (target === undefined) {
      return node;
    }
    return { ...node, position: { ...node.position, [axis]: target } };
  });
}

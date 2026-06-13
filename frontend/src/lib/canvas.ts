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
  // 업무 묶음(그룹 박스) 소속 — 그룹 id, null=무소속 (Phase 2)
  groupId: string | null;
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

/** 노드 타입별 렌더 크기 근사 — 충돌 박스·프리뷰 공용 (process-node.tsx 기준). */
export function nodeSizeOf(nodeType: ProcessNodeType): { w: number; h: number } {
  switch (nodeType) {
    case "decision":
      return { w: 96, h: 96 };
    case "start":
    case "end":
      return { w: 96, h: 40 };
    default:
      return { w: NODE_WIDTH, h: NODE_HEIGHT };
  }
}

function getNodeSize(node: AppNode): { w: number; h: number } {
  return nodeSizeOf(node.data.nodeType);
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

// 아웃라인 입력 — React Flow 타입과 분리(전체 그래프/라이브 상태 모두 매핑 가능)
export interface OutlineNode {
  id: string;
  parentId: string | null; // 계층(하위 프로세스) 부모 — null=최상위 스코프
  label: string;
  nodeType: ProcessNodeType;
}
export interface OutlineEdge {
  source: string;
  target: string;
}

export interface OutlineRow {
  id: string;
  label: string;
  nodeType: ProcessNodeType;
  hasChildren: boolean; // 하위 프로세스(자식 스코프) 보유 → 접기/펼치기 대상
  expanded: boolean;
  hierarchy: boolean; // 하위 스코프에서 펼쳐진 행(색 구분)
  depth: number; // 들여쓰기 단위 (분기 흐름 + 계층 중첩 누적)
  blockIndex: number; // 최상위 독립 연결요소 — 블록 사이 스페이서 구분용
}

/** 한 스코프(같은 부모) 내 노드들을 분기 흐름 구조로 정렬 — out-degree≥2일 때만 자식 들여쓰기. */
function computeScopeFlow(
  scopeNodes: OutlineNode[],
  edges: OutlineEdge[],
): { id: string; depth: number; blockIndex: number }[] {
  const idSet = new Set(scopeNodes.map((node) => node.id));
  const order = new Map(scopeNodes.map((node, index) => [node.id, index]));
  const orderOf = (id: string): number => order.get(id) ?? 0;

  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const node of scopeNodes) {
    out.set(node.id, []);
    indeg.set(node.id, 0);
  }
  const scoped = edges.filter((edge) => idSet.has(edge.source) && idSet.has(edge.target));
  for (const edge of scoped) {
    out.get(edge.source)?.push(edge.target);
    indeg.set(edge.target, (indeg.get(edge.target) ?? 0) + 1);
  }

  const parent = new Map(scopeNodes.map((node) => [node.id, node.id]));
  const find = (start: string): string => {
    let root = start;
    while ((parent.get(root) ?? root) !== root) {
      root = parent.get(root) ?? root;
    }
    let cur = start;
    while (cur !== root) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const edge of scoped) {
    const rootA = find(edge.source);
    const rootB = find(edge.target);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  }
  const components = new Map<string, string[]>();
  for (const node of scopeNodes) {
    const root = find(node.id);
    const members = components.get(root);
    if (members) {
      members.push(node.id);
    } else {
      components.set(root, [node.id]);
    }
  }
  const linked: string[][] = [];
  const isolated: string[] = [];
  for (const members of components.values()) {
    if (members.length > 1) {
      linked.push(members);
    } else {
      isolated.push(members[0]);
    }
  }
  const byOrder = (ids: string[]): string[] => ids.slice().sort((a, b) => orderOf(a) - orderOf(b));
  linked.sort((a, b) => Math.min(...a.map(orderOf)) - Math.min(...b.map(orderOf)));
  isolated.sort((a, b) => orderOf(a) - orderOf(b));

  const result: { id: string; depth: number; blockIndex: number }[] = [];
  let blockIndex = 0;
  for (const members of linked) {
    const memberSet = new Set(members);
    const visited = new Set<string>();
    const roots = byOrder(members.filter((id) => (indeg.get(id) ?? 0) === 0));
    const starts = roots.length > 0 ? roots : byOrder(members).slice(0, 1);
    const stack: { id: string; depth: number }[] = [];
    for (const root of starts) {
      stack.push({ id: root, depth: 0 });
      while (stack.length > 0) {
        const top = stack.pop();
        if (!top || visited.has(top.id)) {
          continue;
        }
        visited.add(top.id);
        result.push({ id: top.id, depth: top.depth, blockIndex });
        const children = byOrder((out.get(top.id) ?? []).filter((target) => memberSet.has(target)));
        // 분기(자식 2개↑)일 때만 들여쓰기 — 단일 후속(순차)은 같은 레벨
        const childDepth = top.depth + (children.length >= 2 ? 1 : 0);
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ id: children[i], depth: childDepth });
        }
      }
    }
    for (const id of byOrder(members)) {
      if (!visited.has(id)) {
        result.push({ id, depth: 0, blockIndex });
      }
    }
    blockIndex++;
  }
  for (const id of isolated) {
    result.push({ id, depth: 0, blockIndex });
  }
  return result;
}

/**
 * 좌측 아웃라인 — 분기 흐름 들여쓰기 + 하위 프로세스 인라인 펼치기.
 * rootParentId 스코프부터 시작, expanded에 든 노드의 자식 스코프를 재귀로 들여쓰기(hierarchy=true).
 */
export function buildOutline(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
  rootParentId: string | null,
  expanded: Set<string>,
): OutlineRow[] {
  const byParent = new Map<string | null, OutlineNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentId);
    if (siblings) {
      siblings.push(node);
    } else {
      byParent.set(node.parentId, [node]);
    }
  }
  const parentsWithChildren = new Set(
    nodes.map((node) => node.parentId).filter((id): id is string => id !== null),
  );
  const labelOf = new Map(nodes.map((node) => [node.id, node.label]));
  const typeOf = new Map(nodes.map((node) => [node.id, node.nodeType]));

  const rows: OutlineRow[] = [];
  const emit = (
    scopeParent: string | null,
    hierarchyLevel: number,
    baseDepth: number,
    inheritedBlock: number,
  ): void => {
    const flow = computeScopeFlow(byParent.get(scopeParent) ?? [], edges);
    for (const entry of flow) {
      const hasChildren = parentsWithChildren.has(entry.id);
      const isExpanded = hasChildren && expanded.has(entry.id);
      const block = hierarchyLevel === 0 ? entry.blockIndex : inheritedBlock;
      rows.push({
        id: entry.id,
        label: labelOf.get(entry.id) ?? "",
        nodeType: typeOf.get(entry.id) ?? "process",
        hasChildren,
        expanded: isExpanded,
        hierarchy: hierarchyLevel > 0,
        depth: baseDepth + entry.depth,
        blockIndex: block,
      });
      if (isExpanded) {
        emit(entry.id, hierarchyLevel + 1, baseDepth + entry.depth + 1, block);
      }
    }
  };
  emit(rootParentId, 0, 0, 0);
  return rows;
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

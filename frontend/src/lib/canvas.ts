// 캔버스 공용 타입 + 정렬/레이아웃 헬퍼 (순수 함수).

import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

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
};

export type AppNode = Node<NodeData>;

// 노드 타입 선택지 — 값은 백엔드 node_type 컬럼에 그대로 저장 (spec §7 Phase A)
export const NODE_TYPE_OPTIONS = [
  { value: "process", label: "프로세스" },
  { value: "decision", label: "판단(분기)" },
  { value: "start", label: "시작" },
  { value: "end", label: "종료" },
] as const;

export type ProcessNodeType = (typeof NODE_TYPE_OPTIONS)[number]["value"];

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

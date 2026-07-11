// 버전 간 그래프 diff — 복제 계보(source_node_id) 우선 매칭, 없으면 (부모 계보, 제목) 매칭 (spec §7 Phase B).

import type { FlatNode, VersionGraph } from "@/lib/api";

export type DiffStatus = "added" | "removed" | "changed";

// 비교 가능한 필드의 언어 중립 키 — compare 화면에서 t()로 번역
export type ChangedField =
  | "title"
  | "description"
  | "type"
  | "color"
  | "assignee"
  | "department"
  | "system"
  | "duration"
  | "headcount"
  | "etf"
  | "cost"
  | "extra"
  | "location";

export interface NodeDiffEntry {
  status: DiffStatus;
  // 루트부터의 제목 경로 (해당 노드 제외) — 변경 목록 표시용
  path: string;
  title: string;
  changedFields: ChangedField[];
  leftNodeId: string | null;
  rightNodeId: string | null;
}

export interface VersionDiff {
  entries: NodeDiffEntry[];
  // 캔버스 하이라이트용 — 각 패널의 노드 ID → diff 항목
  leftNodeStatus: Map<string, NodeDiffEntry>;
  rightNodeStatus: Map<string, NodeDiffEntry>;
  // 하위 계층에 변경이 있는 최상위 노드 ID
  leftDescendantChanged: Set<string>;
  rightDescendantChanged: Set<string>;
  // 엣지 ID → 상태 (left=removed, right=added 만 발생)
  leftEdgeStatus: Map<string, DiffStatus>;
  rightEdgeStatus: Map<string, DiffStatus>;
}

// 비교 대상 필드 → ChangedField 키 매핑 — 위치(pos)는 의미 변경이 아니므로 제외
export const FIELD_KEYS: [keyof FlatNode, ChangedField][] = [
  ["title", "title"],
  ["description", "description"],
  ["node_type", "type"],
  ["color", "color"],
  ["assignee", "assignee"],
  ["department", "department"],
  ["system", "system"],
  ["duration", "duration"],
  ["headcount", "headcount"],
  ["etf", "etf"],
  ["cost", "cost"],
  ["extra", "extra"],
];

// 계보 키 — 복제본은 원본 노드 ID를 공유한다
export function getLineageKey(node: FlatNode): string {
  return node.source_node_id ?? node.id;
}

function buildPath(node: FlatNode, byId: Map<string, FlatNode>): string {
  const titles: string[] = [];
  let current = node.parent_node_id ? byId.get(node.parent_node_id) : undefined;
  while (current) {
    titles.unshift(current.title);
    current = current.parent_node_id ? byId.get(current.parent_node_id) : undefined;
  }
  return titles.join(" › ");
}

function findRootAncestorId(node: FlatNode, byId: Map<string, FlatNode>): string {
  let current = node;
  while (current.parent_node_id) {
    const parent = byId.get(current.parent_node_id);
    if (!parent) {
      break;
    }
    current = parent;
  }
  return current.id;
}

// 부모의 계보 키 — 계층 이동 감지와 fallback 매칭에 사용
function getParentLineageKey(node: FlatNode, byId: Map<string, FlatNode>): string {
  if (!node.parent_node_id) {
    return "root";
  }
  const parent = byId.get(node.parent_node_id);
  return parent ? getLineageKey(parent) : "root";
}

export function computeVersionDiff(
  left: VersionGraph,
  right: VersionGraph,
): VersionDiff {
  const leftById = new Map(left.nodes.map((node) => [node.id, node]));
  const rightById = new Map(right.nodes.map((node) => [node.id, node]));

  const rightByKey = new Map(right.nodes.map((node) => [getLineageKey(node), node]));

  const pairs: [FlatNode, FlatNode][] = [];
  const unmatchedLeft: FlatNode[] = [];
  for (const node of left.nodes) {
    const counterpart = rightByKey.get(getLineageKey(node));
    if (counterpart) {
      pairs.push([node, counterpart]);
    } else {
      unmatchedLeft.push(node);
    }
  }
  const pairedRightIds = new Set(pairs.map(([, rightNode]) => rightNode.id));
  let unmatchedRight = right.nodes.filter((node) => !pairedRightIds.has(node.id));

  // fallback — 계보가 없으면 (부모 계보, 제목)이 같은 노드끼리 매칭
  const fallbackRight = new Map(
    unmatchedRight.map((node) => [
      `${getParentLineageKey(node, rightById)}|${node.title}`,
      node,
    ]),
  );
  const stillUnmatchedLeft: FlatNode[] = [];
  for (const node of unmatchedLeft) {
    const key = `${getParentLineageKey(node, leftById)}|${node.title}`;
    const counterpart = fallbackRight.get(key);
    if (counterpart) {
      pairs.push([node, counterpart]);
      fallbackRight.delete(key);
    } else {
      stillUnmatchedLeft.push(node);
    }
  }
  unmatchedRight = [...fallbackRight.values()];

  const entries: NodeDiffEntry[] = [];
  const leftNodeStatus = new Map<string, NodeDiffEntry>();
  const rightNodeStatus = new Map<string, NodeDiffEntry>();

  for (const [leftNode, rightNode] of pairs) {
    const changedFields: ChangedField[] = FIELD_KEYS.filter(
      ([field]) => leftNode[field] !== rightNode[field],
    ).map(([, key]) => key);
    if (getParentLineageKey(leftNode, leftById) !== getParentLineageKey(rightNode, rightById)) {
      changedFields.push("location");
    }
    if (changedFields.length === 0) {
      continue;
    }
    const entry: NodeDiffEntry = {
      status: "changed",
      path: buildPath(rightNode, rightById),
      title: rightNode.title,
      changedFields,
      leftNodeId: leftNode.id,
      rightNodeId: rightNode.id,
    };
    entries.push(entry);
    leftNodeStatus.set(leftNode.id, entry);
    rightNodeStatus.set(rightNode.id, entry);
  }

  for (const node of stillUnmatchedLeft) {
    const entry: NodeDiffEntry = {
      status: "removed",
      path: buildPath(node, leftById),
      title: node.title,
      changedFields: [],
      leftNodeId: node.id,
      rightNodeId: null,
    };
    entries.push(entry);
    leftNodeStatus.set(node.id, entry);
  }
  for (const node of unmatchedRight) {
    const entry: NodeDiffEntry = {
      status: "added",
      path: buildPath(node, rightById),
      title: node.title,
      changedFields: [],
      leftNodeId: null,
      rightNodeId: node.id,
    };
    entries.push(entry);
    rightNodeStatus.set(node.id, entry);
  }

  // 하위 계층 변경 → 최상위 조상에 뱃지 표시용
  const leftDescendantChanged = new Set<string>();
  const rightDescendantChanged = new Set<string>();
  for (const entry of entries) {
    if (entry.leftNodeId) {
      const node = leftById.get(entry.leftNodeId);
      if (node?.parent_node_id) {
        leftDescendantChanged.add(findRootAncestorId(node, leftById));
      }
    }
    if (entry.rightNodeId) {
      const node = rightById.get(entry.rightNodeId);
      if (node?.parent_node_id) {
        rightDescendantChanged.add(findRootAncestorId(node, rightById));
      }
    }
  }

  // 엣지 — (출발 계보 → 도착 계보) 키로 존재 비교
  const edgeKey = (sourceId: string, targetId: string, byId: Map<string, FlatNode>) => {
    const source = byId.get(sourceId);
    const target = byId.get(targetId);
    return `${source ? getLineageKey(source) : sourceId}→${target ? getLineageKey(target) : targetId}`;
  };
  const leftEdgeKeys = new Set(
    left.edges.map((edge) => edgeKey(edge.source_node_id, edge.target_node_id, leftById)),
  );
  const rightEdgeKeys = new Set(
    right.edges.map((edge) => edgeKey(edge.source_node_id, edge.target_node_id, rightById)),
  );
  const leftEdgeStatus = new Map<string, DiffStatus>();
  const rightEdgeStatus = new Map<string, DiffStatus>();
  for (const edge of left.edges) {
    if (!rightEdgeKeys.has(edgeKey(edge.source_node_id, edge.target_node_id, leftById))) {
      leftEdgeStatus.set(edge.id, "removed");
    }
  }
  for (const edge of right.edges) {
    if (!leftEdgeKeys.has(edgeKey(edge.source_node_id, edge.target_node_id, rightById))) {
      rightEdgeStatus.set(edge.id, "added");
    }
  }

  return {
    entries,
    leftNodeStatus,
    rightNodeStatus,
    leftDescendantChanged,
    rightDescendantChanged,
    leftEdgeStatus,
    rightEdgeStatus,
  };
}

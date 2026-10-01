// 버전 간 그래프 diff — 복제 계보(source_node_id) 우선 매칭, 없으면 (부모 계보, 제목) 매칭 (spec §7 Phase B).
// ⑦ 평면 노드 이후 서버 FlatNodeOut은 parent_node_id를 보내지 않고 buildLiveGraph도 null 고정이라, fallback은
// 항상 ('root', 제목)이고 location·path·*DescendantChanged는 호환용으로 남긴 미발생 경로다(제거는 별도 정리).

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";
import { getOutputKey } from "@/lib/output-rules";
import { PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

export type DiffStatus = "added" | "removed" | "changed";

// 비교 가능한 필드의 언어 중립 키 — compare 화면에서 t()로 번역
export type ChangedField =
  | "title"
  | "description"
  | "type"
  | "color"
  | "assignee"
  | "assignee_role"
  | "department"
  | "system"
  | "duration"
  | "touch_time"
  | "cost_krw"
  | "cost_usd"
  | "headcount"
  | "annual_count"
  | "fte"
  | "input"
  | "output"
  | "input_forms"
  | "output_forms"
  | "gmp"
  | "start_condition"
  | "end_condition"
  | "parallel"
  | "url"
  | "url_label"
  | "linked_map"
  | "placeholder"
  | "primary_end"
  | "follow_latest"
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
  ["assignee_role", "assignee_role"],
  ["department", "department"],
  ["system", "system"],
  ["duration", "duration"],
  ["touch_time", "touch_time"],
  ["cost_krw", "cost_krw"],
  ["cost_usd", "cost_usd"],
  ["headcount", "headcount"],
  ["annual_count", "annual_count"],
  ["fte", "fte"],
  // 인터뷰 승격 필드 — 콘텐츠 diff 대상. 폴백(system_fallback)은 검토 메모라 제외 (design 2026-08-19 §3)
  ["input", "input"],
  ["output", "output"],
  ["input_forms", "input_forms"],
  ["output_forms", "output_forms"],
  ["gmp", "gmp"],
  ["start_condition", "start_condition"],
  ["end_condition", "end_condition"],
  // 병렬 출구 — 흐름 의미라 콘텐츠 diff 대상(백엔드 확정 서명과 같이). 배열이라 getFieldValue로 비교
  ["parallel_outputs", "parallel"],
  // 참조 링크 — 내용으로 센다(사용자 결정 D5, 백엔드 확정 서명과 같이)
  ["url", "url"],
  ["url_label", "url_label"],
  // 링크 정체성 — 백엔드 _canvas_content_signature와 같은 4필드. 빠지면 링크만 바꾼 캔버스의 확정 버튼이 잠긴다
  ["linked_map_id", "linked_map"],
  ["placeholder_category_id", "placeholder"],
  ["is_primary_end", "primary_end"],
  ["follow_latest", "follow_latest"],
];

/**
 * diff 비교·표시용 필드 값 — 배열(병렬 출구)은 정렬 후 ", " 결합해 참조 동일성 대신 내용으로 비교한다.
 * 없음(undefined)은 null로 접는다 — 선택 필드(placeholder_category_id 등)가 응답에 없을 때와 null을 같게.
 */
export function getFieldValue(node: FlatNode, field: keyof FlatNode): unknown {
  const value = node[field];
  return Array.isArray(value) ? [...value].sort().join(", ") : (value ?? null);
}

// 변경 필드 라벨 키 — compare 화면·연계 캔버스 확정 요약 공용 (2026-08-28 승격)
export const FIELD_MSG: Record<ChangedField, MessageKey> = {
  title: "field.title",
  description: "field.description",
  type: "field.type",
  color: "field.color",
  assignee: "field.assignee",
  assignee_role: "field.assigneeRole",
  department: "field.department",
  system: "field.system",
  duration: "field.duration",
  touch_time: "field.touchTime",
  cost_krw: "field.costKrw",
  cost_usd: "field.costUsd",
  headcount: "field.headcount",
  annual_count: "field.annualCount",
  fte: "field.fte",
  input: "field.input",
  output: "field.output",
  input_forms: "field.inputForms",
  output_forms: "field.outputForms",
  gmp: "field.gmp",
  start_condition: "field.startCondition",
  end_condition: "field.endCondition",
  parallel: "field.parallel",
  url: "field.url",
  url_label: "field.urlLabel",
  linked_map: "field.linkedMap",
  placeholder: "field.placeholderSource",
  primary_end: "field.primaryEnd",
  follow_latest: "field.followLatest",
  location: "field.location",
};

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
      ([field]) => getFieldValue(leftNode, field) !== getFieldValue(rightNode, field),
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

  // 엣지 — (출발 계보 → 도착 계보 + 출구 키) 키로 존재 비교. 출구 키는 SP 끝 키만 내용이고
  // 변 id·in 변형은 레이아웃이라 무시한다(사용자 결정 D4, merge-diff·확정 서명과 같은 규칙)
  const edgeKey = (edge: GraphEdge, byId: Map<string, FlatNode>) => {
    const source = byId.get(edge.source_node_id);
    const target = byId.get(edge.target_node_id);
    const exit = getOutputKey(source?.node_type ?? "", edge.source_handle);
    const base = `${source ? getLineageKey(source) : edge.source_node_id}→${target ? getLineageKey(target) : edge.target_node_id}`;
    return exit === PRIMARY_END_HANDLE ? base : `${base}@${exit}`;
  };
  const leftEdgeKeys = new Set(left.edges.map((edge) => edgeKey(edge, leftById)));
  const rightEdgeKeys = new Set(right.edges.map((edge) => edgeKey(edge, rightById)));
  const leftEdgeStatus = new Map<string, DiffStatus>();
  const rightEdgeStatus = new Map<string, DiffStatus>();
  for (const edge of left.edges) {
    if (!rightEdgeKeys.has(edgeKey(edge, leftById))) {
      leftEdgeStatus.set(edge.id, "removed");
    }
  }
  for (const edge of right.edges) {
    if (!leftEdgeKeys.has(edgeKey(edge, rightById))) {
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

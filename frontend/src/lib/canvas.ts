// 캔버스 공용 타입 + 정렬/레이아웃 헬퍼 (순수 함수).

import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";

import { genId } from "@/lib/id";
import type { MessageKey } from "@/lib/i18n-messages";
import {
  PRIMARY_END_HANDLE,
  SUBPROCESS_IN_HANDLE,
  type SubEnd,
} from "@/lib/subprocess-embed";

export type NodeData = {
  label: string;
  description: string;
  nodeType: ProcessNodeType;
  color: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  // 다중 그룹(태그) 소속 — 노드가 여러 그룹에 동시 소속. 빈 배열=무소속
  groupIds: string[];
  hasChildren: boolean;
  // 이 노드가 속한 스코프(parent_node_id). 인라인 펼침·scope-split 저장 식별용. null=루트, undefined=미지정(현재 스코프 취급)
  scopeId?: string | null;
  // 비교 화면 전용 — diff 하이라이트 (spec §7 Phase B). 에디터에서는 미설정.
  diffStatus?: "added" | "removed" | "changed";
  diffNote?: string;
  // 변경 노드의 필드 diff (compare 전용) — before→after 필 렌더용. label/before/after는 표시용 포맷 완료값.
  diffFields?: { label: string; before: string; after: string }[];
  hasDescendantChange?: boolean;
  // 미해결 코멘트 수 — 에디터가 렌더 시 주입 (spec §7 Phase C)
  commentCount?: number;
  // 담당자 부서 드리프트 경고 — 에디터가 렌더 시 주입
  assigneeWarning?: boolean;
  // 하위프로세스 참조 (nodeType==="subprocess")
  linkedMapId?: number | null;
  followLatest?: boolean;
  linkedVersionId?: number | null;
  // 대표 끝 (nodeType==="end")
  isPrimaryEnd?: boolean;
  // 연결된 맵의 최신 버전이 핀된 버전과 다를 때 true — UI 업데이트 알림용
  updateAvailable?: boolean;
  // 링크된 맵의 끝 노드 목록 — 렌더 시 파생, 퍼시스트 안 함 (nodeType==="subprocess")
  subEnds?: SubEnd[];
  // 링크맵 resolved가 잠김(권한 없음)으로 판정됨 — 펼침/드릴 봉인 + Lock 뱃지. 렌더 시 파생.
  // Linked-map resolved as locked (no access) — seals expand/drill + shows Lock badge. Derived at render.
  locked?: boolean;
  // 링크맵이 서브프로세스 미지정/해제 상태 — 경고 뱃지 + 잠금(권한 무관). subprocess_refs에서 파생 (spec 2026-07-06).
  undesignated?: boolean;
  // 지정 어트리뷰트(라이브 참조) — 노드 자체 BPM 필드와 별개, subprocess_refs에서 렌더 시 주입. 지정된 링크맵만 채움.
  spDepartment?: string | null;
  spAssignee?: string | null;
  spSystem?: string | null;
  spDuration?: string | null;
  // 비교 화면 전용 — 엣지가 4변 핸들(t-/s-)로 재매핑되므로 subprocess도 NodeHandles를 렌더해야 함 (F1)
  sideHandles?: boolean;
};

export type AppNode = Node<NodeData>;

export type ProcessNodeType = "process" | "decision" | "start" | "end" | "subprocess";

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
    case "subprocess":
      return value;
    default:
      return "process";
  }
}

// process·decision만 BPM 속성(담당자/부서/시스템/소요)을 가진다. start/end/subprocess는 제외.
export function hasBpmAttributes(nodeType: string): boolean {
  return nodeType !== "start" && nodeType !== "end" && nodeType !== "subprocess";
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
    case "subprocess":
      return { w: 180, h: 64 };
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
  // 잠긴 링크맵(권한 없음) — buildOutline이 펼침 화살표를 억제 / locked linked-map: suppresses the expand arrow
  locked?: boolean;
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
        // 같은 스코프 내 흐름(병렬·분기 포함)은 모두 같은 수준 — 들여쓰기는 하위 프로세스(계층)에만(buildOutline baseDepth)
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ id: children[i], depth: top.depth });
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
  const lockedOf = new Map(nodes.map((node) => [node.id, node.locked ?? false]));

  const rows: OutlineRow[] = [];
  // 계층 사이클(부모가 자기 하위를 가리킴) 가드 — 같은 스코프 재진입 시 중단해 무한 재귀 방지
  const visitedScopes = new Set<string>();
  // 노드 단위 dedup — 입력에 중복 id가 있어도 행은 한 번만
  const emitted = new Set<string>();
  const emit = (
    scopeParent: string | null,
    hierarchyLevel: number,
    baseDepth: number,
    inheritedBlock: number,
  ): void => {
    if (scopeParent !== null) {
      if (visitedScopes.has(scopeParent)) {
        return;
      }
      visitedScopes.add(scopeParent);
    }
    const flow = computeScopeFlow(byParent.get(scopeParent) ?? [], edges);
    for (const entry of flow) {
      if (emitted.has(entry.id)) {
        continue;
      }
      emitted.add(entry.id);
      // 하위프로세스(참조) 노드는 임베드 전이라 outline 입력에 자식이 없어도 항상 펼치기 대상으로 표시한다 —
      // 행 펼침이 inline-embed를 트리거(toggleInlineExpand)해 그때 자식이 들어온다. 일반 노드는 기존대로 실제 자식 보유 시.
      const nodeType = typeOf.get(entry.id) ?? "process";
      // 마스킹: 잠긴 링크맵은 펼침 화살표 억제 / Masking: locked linked-maps suppress the expand arrow.
      const isSubprocessExpandable = (type: string, locked: boolean): boolean => type === "subprocess" && !locked;
      const hasChildren =
        parentsWithChildren.has(entry.id) ||
        isSubprocessExpandable(nodeType, lockedOf.get(entry.id) ?? false);
      const isExpanded = hasChildren && expanded.has(entry.id);
      const block = hierarchyLevel === 0 ? entry.blockIndex : inheritedBlock;
      rows.push({
        id: entry.id,
        label: labelOf.get(entry.id) ?? "",
        nodeType,
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

// 판단(decision) 노드 분기 엣지 — Yes/No는 고정 라벨, 기타는 사용자 지정(빈 값 포함)
export type BranchKind = "yes" | "no" | "other";
export const BRANCH_YES_LABEL = "Yes";
export const BRANCH_NO_LABEL = "No";

/** 엣지 라벨로 분기 종류 판정 — "Yes"/"No"는 고정, 그 외(빈 값·커스텀)는 기타. */
export function branchKindOf(label: unknown): BranchKind {
  if (label === BRANCH_YES_LABEL) {
    return "yes";
  }
  if (label === BRANCH_NO_LABEL) {
    return "no";
  }
  return "other";
}

// 엣지 핸들이 붙는 노드 변 — 엣지의 source/target 각각에 적용(2026-06-17)
export type HandleSide = "left" | "right" | "top" | "bottom";

const SIDE_TO_POSITION: Record<HandleSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

export function toPosition(side: HandleSide): Position {
  return SIDE_TO_POSITION[side];
}

export function sourceHandleId(side: HandleSide): string {
  return `s-${side}`;
}

export function targetHandleId(side: HandleSide): string {
  return `t-${side}`;
}

const HANDLE_SIDES: HandleSide[] = ["left", "right", "top", "bottom"];

// "s-top"/"t-left" → "top"/"left". 미일치 시 fallback(구 데이터·null 대비).
export function sideFromHandleId(
  id: string | null | undefined,
  fallback: HandleSide,
): HandleSide {
  if (!id) {
    return fallback;
  }
  const side = id.replace(/^[st]-/, "");
  return (HANDLE_SIDES as string[]).includes(side) ? (side as HandleSide) : fallback;
}

// 시작/끝 노드 연결 규칙 — 시작은 도착 불가(출발 전용), 끝은 출발 불가(도착 전용).
// source→target 방향 엣지가 이 규칙을 어기는지 판정 (핸들 드래그·드롭존 흐름삽입 공용).
export function violatesTerminalRule(
  source: ProcessNodeType | undefined,
  target: ProcessNodeType | undefined,
): boolean {
  return target === "start" || source === "end";
}

// 스왑(위치·연결 교환) 허용 규칙 — 같은 종류 노드끼리만. 단 subprocess(하위프로세스 참조)는
// 일반 process 노드와 호환(둘 다 활동 노드라 교환이 의미 있음). start/end/decision은 동종만.
export function canSwapTypes(
  a: ProcessNodeType | undefined,
  b: ProcessNodeType | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return (
    (a === "subprocess" && b === "process") || (a === "process" && b === "subprocess")
  );
}

// 시작/끝 노드의 표시 라벨은 i18n·사용자 라벨과 무관하게 항상 영문 고정값.
const TERMINAL_DEFAULT_LABELS = new Set(["start", "end", "시작", "종료"]);

/** 시작/끝 노드 표시명 — 항상 "Start"/"End", 사용자 지정 라벨이 있으면 괄호로 덧붙인다(한영 전환 무관). */
export function terminalDisplayLabel(nodeType: ProcessNodeType, label: string): string {
  const base = nodeType === "start" ? "Start" : "End";
  const custom = label.trim();
  if (!custom || TERMINAL_DEFAULT_LABELS.has(custom.toLowerCase())) {
    return base;
  }
  return `${base} (${custom})`;
}

// 캔버스 내 이름 중복 방지 — 이미 쓰이는 이름이면 " (2)", " (3)"... 접미사를 붙여 고유화.
// 빈/공백 이름은 예외(여러 미명명 노드·그룹 허용). 비교는 trim 기준.
export function makeUniqueLabel(desired: string, taken: string[]): string {
  const trimmed = desired.trim();
  if (!trimmed) {
    return desired;
  }
  const used = new Set(taken.map((name) => name.trim()));
  if (!used.has(trimmed)) {
    return desired;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${trimmed} (${n})`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/** B로 들어오는(B가 target) 엣지들. */
export function getIncomingEdges(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter((edge) => edge.target === nodeId);
}

/** B에서 나가는(B가 source) 엣지들. */
export function getOutgoingEdges(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter((edge) => edge.source === nodeId);
}

/** source→target 추가 시 A↔B 2노드 사이클이 되는지 — 이미 target→source 엣지가 있으면 true. */
export function hasReciprocalEdge(edges: Edge[], source: string, target: string): boolean {
  return edges.some((edge) => edge.source === target && edge.target === source);
}

/** source에서 나가는 엣지를 모두 제거 — 출력 1개 고정(자동 스왑)용. decision 제외는 호출부 책임. */
export function removeOutgoingEdges(edges: Edge[], sourceId: string): Edge[] {
  return edges.filter((edge) => edge.source !== sourceId);
}

/** 흐름상 다음 노드 — nodeId의 첫 출력 엣지 target (F14 스테퍼). 없으면 null. */
export function getNextNodeAlongFlow(edges: Edge[], nodeId: string): string | null {
  return getOutgoingEdges(edges, nodeId)[0]?.target ?? null;
}

/** 흐름상 이전 노드 — nodeId의 첫 입력 엣지 source (F14 스테퍼). 없으면 null. */
export function getPrevNodeAlongFlow(edges: Edge[], nodeId: string): string | null {
  return getIncomingEdges(edges, nodeId)[0]?.source ?? null;
}

/** startId에서 첫 출력 엣지를 hops번 따라간 전방 경로의 엣지 id들 (F14). 끝/사이클에서 중단. */
export function getFlowPathForward(edges: Edge[], startId: string, hops: number): string[] {
  // BFS — 분기가 있으면 모든 분기 엣지를 hops 레벨까지 일괄 수집 (F14 분기 일괄 하이라이트).
  // 직선 흐름이면 기존과 동일한 단일 경로/순서.
  const ids: string[] = [];
  const seen = new Set<string>([startId]);
  let frontier = [startId];
  for (let i = 0; i < hops; i++) {
    const nextFrontier: string[] = [];
    for (const cur of frontier) {
      for (const edge of getOutgoingEdges(edges, cur)) {
        if (seen.has(edge.target)) continue; // 사이클/이미 방문한 합류 노드 차단
        ids.push(edge.id);
        seen.add(edge.target);
        nextFrontier.push(edge.target);
      }
    }
    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }
  return ids;
}

/** startId로 거슬러 올라간 후방 경로의 엣지 id들 (F14). BFS로 분기(합류)도 일괄. 시작/사이클에서 중단. */
export function getFlowPathBackward(edges: Edge[], startId: string, hops: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>([startId]);
  let frontier = [startId];
  for (let i = 0; i < hops; i++) {
    const nextFrontier: string[] = [];
    for (const cur of frontier) {
      for (const edge of getIncomingEdges(edges, cur)) {
        if (seen.has(edge.source)) continue; // 사이클/이미 방문 차단
        ids.push(edge.id);
        seen.add(edge.source);
        nextFrontier.push(edge.source);
      }
    }
    if (nextFrontier.length === 0) break;
    frontier = nextFrontier;
  }
  return ids;
}

// 자기루프·중복 없이 엣지 추가. 기본 핸들 변을 명시(source=right/target=left) —
// 미지정 시 React Flow가 첫 렌더 핸들(left)에 붙어, toAppEdges·buildGraph의 right/left 폴백과 어긋난다.
function withEdge(edges: Edge[], source: string, target: string): Edge[] {
  if (
    source === target ||
    edges.some((edge) => edge.source === source && edge.target === target) ||
    hasReciprocalEdge(edges, source, target)
  ) {
    return edges;
  }
  return [
    ...edges,
    {
      ...EDGE_DEFAULTS,
      id: genId(),
      source,
      target,
      sourceHandle: sourceHandleId("right"),
      targetHandle: targetHandleId("left"),
    },
  ];
}

/**
 * 엣지의 source/target 핸들을 현재 끝점 노드 타입에 맞춘다 — 드롭존/삽입/swap 경로 전용.
 * 하위프로세스(subprocess) 끝점은 전용 핸들(in=입력 / __primary__=대표끝 출력)을 써야 RF가 붙인다.
 * 끝점이 하위프로세스가 아니게 되면(swap 등) 남은 전용 핸들을 변 기본값으로 되돌린다.
 * onConnect(수동 핸들 드래그)와 decision 분기 라벨 source는 건드리지 않는다(이 함수는 드롭존만 호출).
 */
export function withSubprocessHandles(
  edge: Edge,
  isSubprocess: (nodeId: string) => boolean,
): Edge {
  const targetSub = isSubprocess(edge.target);
  const sourceSub = isSubprocess(edge.source);
  let targetHandle = edge.targetHandle;
  let sourceHandle = edge.sourceHandle;
  if (targetSub) {
    targetHandle = SUBPROCESS_IN_HANDLE;
  } else if (targetHandle === SUBPROCESS_IN_HANDLE) {
    // 더 이상 하위프로세스가 아닌데 in 핸들이 남음(swap) → 변 기본값으로
    targetHandle = targetHandleId("left");
  }
  if (sourceSub) {
    sourceHandle = PRIMARY_END_HANDLE;
  } else if (sourceHandle === PRIMARY_END_HANDLE) {
    sourceHandle = sourceHandleId("right");
  }
  if (targetHandle === edge.targetHandle && sourceHandle === edge.sourceHandle) {
    return edge;
  }
  return { ...edge, sourceHandle, targetHandle };
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

/**
 * A를 B의 후행으로 삽입. rewire면 B의 기존 outgoing(단, A행 제외)을 A로 재연결 → B→A→….
 * bIsDecision(=B가 마름모)이면 분기 라벨이 항상 마름모에서 출발하도록 유지한다:
 * 기존 B--Yes-->C 를 B--Yes-->A 로 재타깃하고 A-->C 는 일반 엣지로 잇는다(라벨을 A로 옮기지 않음).
 */
export function insertNodeAfter(
  edges: Edge[],
  aId: string,
  bId: string,
  rewire: boolean,
  bIsDecision = false,
): Edge[] {
  if (rewire && bIsDecision) {
    const branchEdges = edges.filter((edge) => edge.source === bId && edge.target !== aId);
    if (branchEdges.length > 0) {
      let next = edges.filter((edge) => !(edge.source === bId && edge.target !== aId));
      for (const edge of branchEdges) {
        next = [...next, { ...edge, target: aId }]; // B--label-->A (source·라벨 유지)
        next = withEdge(next, aId, edge.target); // A-->기존 타깃 (일반)
      }
      return next;
    }
  }
  let next = edges;
  if (rewire) {
    next = next.map((edge) =>
      edge.source === bId && edge.target !== aId ? { ...edge, source: aId } : edge,
    );
  }
  return withEdge(next, bId, aId);
}

/** 선후(엣지) 흐름 기준 좌→우 자동 배치 (spec §3.3). */
export function layoutWithDagre(
  nodes: AppNode[],
  edges: Edge[],
  rankdir: "LR" | "TB" = "LR",
  spacing?: { nodesep?: number; ranksep?: number },
): AppNode[] {
  const graph = new dagre.graphlib.Graph();
  // 교차/겹침 최소화 — network-simplex 랭커 + 넉넉한 간격(노드끼리·랭크끼리·엣지끼리).
  // edgesep을 키워 평행 엣지가 노드 위로 겹쳐 지나가는 경우를 줄인다.
  const isTB = rankdir === "TB";
  graph.setGraph({
    rankdir,
    ranker: "network-simplex",
    // 간격을 넉넉히 — 랭크 사이(ranksep)를 크게 둬 엣지가 노드 위로 겹쳐 지나가지 않게,
    // 같은 랭크 노드 간격(nodesep)·평행 엣지 간격(edgesep)도 키워 엣지가 노드에 가려지는 일 방지.
    // LR: nodesep=같은 열 세로 간격 — 변경 노드의 before→after 필(노드 아래로 뻗음)이 아래 노드를
    // 침범하지 않도록 넉넉히. TB: ranksep=행 간격을 크게 둬 필(아래로 뻗음)이 다음 행을 침범하지 않게.
    // spacing 인자로 호출부가 밀도를 조정(compare 방향 토글). 없으면 기본값(에디터).
    nodesep: spacing?.nodesep ?? (isTB ? 90 : 120),
    ranksep: spacing?.ranksep ?? (isTB ? 200 : 160),
    edgesep: 40,
    marginx: 20,
    marginy: 20,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  // 노드별 실제 크기로 박스를 잡아야 큰 노드(마름모) 주변 엣지가 노드를 덜 침범한다.
  nodes.forEach((node) => {
    const size = nodeSizeOf(node.data.nodeType);
    graph.setNode(node.id, { width: size.w, height: size.h });
  });
  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });
  dagre.layout(graph);

  // 배치 결과를 좌상단(0,0) 기준으로 정규화 — 누적 드리프트 없이 항상 원점에서 시작(캔버스 비대화 방지).
  const placed = nodes.map((node) => {
    const positioned = graph.node(node.id);
    const size = nodeSizeOf(node.data.nodeType);
    return { node, x: positioned.x - size.w / 2, y: positioned.y - size.h / 2 };
  });
  const minX = Math.min(...placed.map((p) => p.x));
  const minY = Math.min(...placed.map((p) => p.y));
  return placed.map(({ node, x, y }) => ({
    ...node,
    position: { x: x - minX, y: y - minY },
  }));
}

/** 일부 노드(ids)만 자체 서브그래프로 자동 배치하고, 현재 좌상단 위치에 고정해 그룹이 제자리에 남게 한다. */
export function layoutSubsetWithDagre(
  nodes: AppNode[],
  edges: Edge[],
  ids: ReadonlySet<string>,
): AppNode[] {
  const subset = nodes.filter((node) => ids.has(node.id));
  if (subset.length < 2) {
    return nodes;
  }
  const subsetEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  // 배치 전 좌상단 — 배치 후 같은 위치에 고정하기 위한 기준점
  const anchorX = Math.min(...subset.map((node) => node.position.x));
  const anchorY = Math.min(...subset.map((node) => node.position.y));

  const laid = layoutWithDagre(subset, subsetEdges);
  const newMinX = Math.min(...laid.map((node) => node.position.x));
  const newMinY = Math.min(...laid.map((node) => node.position.y));
  const dx = anchorX - newMinX;
  const dy = anchorY - newMinY;

  const positionById = new Map(laid.map((node) => [node.id, node.position]));
  return nodes.map((node) => {
    const positioned = positionById.get(node.id);
    return positioned
      ? { ...node, position: { x: positioned.x + dx, y: positioned.y + dy } }
      : node;
  });
}

/**
 * 대상 노드들을 한 축으로 맞춤 정렬. ids 미지정 시 선택된 노드, 지정 시 해당 id 집합.
 * left=좌측 변, centerX=가로 가운데(중심선), top=상단 변, centerY=세로 가운데(중심선).
 */
export function alignSelected(
  nodes: AppNode[],
  axis: "left" | "centerX" | "top" | "centerY",
  ids?: ReadonlySet<string>,
): AppNode[] {
  const isTarget = (node: AppNode): boolean => (ids ? ids.has(node.id) : node.selected === true);
  const targets = nodes.filter(isTarget);
  if (targets.length < 2) {
    return nodes;
  }
  const widthOf = (node: AppNode): number =>
    node.measured?.width ?? nodeSizeOf(node.data.nodeType).w;
  const heightOf = (node: AppNode): number =>
    node.measured?.height ?? nodeSizeOf(node.data.nodeType).h;

  if (axis === "left") {
    const minX = Math.min(...targets.map((node) => node.position.x));
    return nodes.map((node) =>
      isTarget(node) ? { ...node, position: { ...node.position, x: minX } } : node,
    );
  }
  if (axis === "top") {
    const minY = Math.min(...targets.map((node) => node.position.y));
    return nodes.map((node) =>
      isTarget(node) ? { ...node, position: { ...node.position, y: minY } } : node,
    );
  }
  if (axis === "centerX") {
    // 선택 영역 가로 중심에 각 노드 중심을 맞춤
    const minX = Math.min(...targets.map((node) => node.position.x));
    const maxX = Math.max(...targets.map((node) => node.position.x + widthOf(node)));
    const centerX = (minX + maxX) / 2;
    return nodes.map((node) =>
      isTarget(node)
        ? { ...node, position: { ...node.position, x: centerX - widthOf(node) / 2 } }
        : node,
    );
  }
  // centerY — 선택 영역 세로 중심에 각 노드 중심을 맞춤
  const minY = Math.min(...targets.map((node) => node.position.y));
  const maxY = Math.max(...targets.map((node) => node.position.y + heightOf(node)));
  const centerY = (minY + maxY) / 2;
  return nodes.map((node) =>
    isTarget(node)
      ? { ...node, position: { ...node.position, y: centerY - heightOf(node) / 2 } }
      : node,
  );
}

/** 대상 노드들을 한 축으로 등간격 분배. ids 미지정 시 선택된 노드, 지정 시 해당 id 집합. */
export function distributeSelected(
  nodes: AppNode[],
  axis: "x" | "y",
  ids?: ReadonlySet<string>,
): AppNode[] {
  const isTarget = (node: AppNode): boolean => (ids ? ids.has(node.id) : node.selected === true);
  const selected = nodes
    .filter(isTarget)
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

// ── 그룹 박스 외곽선 (기본 사각형 − 비멤버 notch) ─────────────────────────
// 멤버 bbox 사각형에서, 범위 안에 들어온 비멤버 노드를 "가장 가까운 변쪽으로" 직사각형으로 잘라낸다.
// 90° 직교 폴리곤이라 연결 유지 + 비멤버는 제외.
export interface OrthoUnion {
  fill: string; // 채움 영역 path (filled 셀들의 사각형 모음, 균일 반투명)
  outline: string; // 경계 변만 모은 stroke path (filled↔unfilled 전이)
}

export type Rect = { x: number; y: number; w: number; h: number };

/** 좌표 압축 격자(filled 셀)에서 채움 path + 경계 외곽선 path 생성 — 공용. */
function emitCellPaths(xs: number[], ys: number[], filled: boolean[]): OrthoUnion {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const isFilled = (i: number, j: number): boolean =>
    i >= 0 && i < nx && j >= 0 && j < ny && filled[i * ny + j];
  const fillParts: string[] = [];
  const outlineParts: string[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!filled[i * ny + j]) {
        continue;
      }
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const y0 = ys[j];
      const y1 = ys[j + 1];
      fillParts.push(`M${x0} ${y0}H${x1}V${y1}H${x0}Z`);
      // 경계 변 — 이웃이 비어있으면(또는 격자 밖) 그 변이 외곽선
      if (!isFilled(i, j - 1)) outlineParts.push(`M${x0} ${y0}H${x1}`); // top
      if (!isFilled(i, j + 1)) outlineParts.push(`M${x0} ${y1}H${x1}`); // bottom
      if (!isFilled(i - 1, j)) outlineParts.push(`M${x0} ${y0}V${y1}`); // left
      if (!isFilled(i + 1, j)) outlineParts.push(`M${x1} ${y0}V${y1}`); // right
    }
  }
  return { fill: fillParts.join(""), outline: outlineParts.join("") };
}

/** 침입 사각형을 base 안으로 클램프 후, 가장 가까운 변에서 그 사각형까지 잘라낼 notch 사각형. 겹침 없으면 null. */
function nearestEdgeNotch(base: Rect, it: Rect): Rect | null {
  const ix0 = Math.max(it.x, base.x);
  const iy0 = Math.max(it.y, base.y);
  const ix1 = Math.min(it.x + it.w, base.x + base.w);
  const iy1 = Math.min(it.y + it.h, base.y + base.h);
  if (ix0 >= ix1 || iy0 >= iy1) {
    return null; // base와 겹치지 않음
  }
  const dLeft = ix0 - base.x;
  const dRight = base.x + base.w - ix1;
  const dTop = iy0 - base.y;
  const dBottom = base.y + base.h - iy1;
  const nearest = Math.min(dLeft, dRight, dTop, dBottom);
  if (nearest === dLeft) {
    return { x: base.x, y: iy0, w: ix1 - base.x, h: iy1 - iy0 };
  }
  if (nearest === dRight) {
    return { x: ix0, y: iy0, w: base.x + base.w - ix0, h: iy1 - iy0 };
  }
  if (nearest === dTop) {
    return { x: ix0, y: base.y, w: ix1 - ix0, h: iy1 - base.y };
  }
  return { x: ix0, y: iy0, w: ix1 - ix0, h: base.y + base.h - iy0 }; // bottom
}

/**
 * 기본 사각형 base에서 침입(비멤버) 사각형들을 가장 가까운 변쪽으로 잘라낸 직교 외곽선.
 * members 사각형은 notch보다 우선(항상 채움) — notch가 멤버 노드를 반만 자르지 않게 비껴간다.
 */
export function rectWithExclusions(base: Rect, intruders: Rect[], members: Rect[]): OrthoUnion {
  if (base.w <= 0 || base.h <= 0) {
    return { fill: "", outline: "" };
  }
  const notches = intruders
    .map((it) => nearestEdgeNotch(base, it))
    .filter((r): r is Rect => r !== null);
  // 멤버 변도 격자에 포함해야 멤버 경계가 셀에 정렬됨
  const edgeRects = [...notches, ...members];
  const xs = Array.from(
    new Set([base.x, base.x + base.w, ...edgeRects.flatMap((r) => [r.x, r.x + r.w])]),
  )
    .filter((x) => x >= base.x && x <= base.x + base.w)
    .sort((a, b) => a - b);
  const ys = Array.from(
    new Set([base.y, base.y + base.h, ...edgeRects.flatMap((r) => [r.y, r.y + r.h])]),
  )
    .filter((y) => y >= base.y && y <= base.y + base.h)
    .sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const inRect = (r: Rect, cx: number, cy: number): boolean =>
    cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h;
  const filled = new Array<boolean>(nx * ny).fill(false);
  for (let i = 0; i < nx; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < ny; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      const inNotch = notches.some((notch) => inRect(notch, cx, cy));
      const inMember = members.some((member) => inRect(member, cx, cy));
      // notch 밖이거나, notch에 들어도 멤버 영역이면 채움(멤버 우선)
      filled[i * ny + j] = !inNotch || inMember;
    }
  }
  return emitCellPaths(xs, ys, filled);
}

// 드롭존 부채꼴 적중 판정 — 커서(컨테이너 상대 좌표)를 타깃 중심 기준 극좌표로 바꿔, 4방향
// (좌=front/우=back/상=group/하 S=swap) 부채꼴 중 하나에 들면 그 zone. 대각 간극·밴드 밖이면 null.
// page.tsx 부채꼴 렌더와 정합하되 판정은 살짝 관대(각 ±HIT_HALF, 반경 [radius*HIT_INNER, radius+OUTER_PAD]).
export type DropZone = "front" | "back" | "group" | "swap";

export const DROPZONE_HIT_OUTER_PAD = 60; // 판정 바깥 반경 = radius + this (링 유지 경계도 이 값 사용)
const HIT_INNER_RATIO = 0.72; // 판정 안쪽 반경 = radius * this (시각 ri보다 안쪽까지 관대)
const HIT_HALF = (23 * Math.PI) / 180; // 판정 각 반각(시각 부채꼴 19°보다 살짝 관대)

export function pickDropZone(
  cursorX: number,
  cursorY: number,
  cx: number,
  cy: number,
  radius: number,
): DropZone | null {
  const dx = cursorX - cx;
  const dy = cursorY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < radius * HIT_INNER_RATIO || dist > radius + DROPZONE_HIT_OUTER_PAD) {
    return null;
  }
  const ang = Math.atan2(dy, dx); // 화면좌표(y-down): 0=동, +π/2=남, ±π=서
  const axes: { zone: DropZone; axis: number }[] = [
    { zone: "back", axis: 0 },
    { zone: "swap", axis: Math.PI / 2 },
    { zone: "front", axis: Math.PI },
    { zone: "group", axis: -Math.PI / 2 },
  ];
  for (const { zone, axis } of axes) {
    let d = Math.abs(ang - axis);
    if (d > Math.PI) {
      d = 2 * Math.PI - d; // 각도 wrap(서쪽 ±π 경계)
    }
    if (d <= HIT_HALF) {
      return zone;
    }
  }
  return null;
}

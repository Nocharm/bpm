// 노드(ProcessNode)→에디터 통신 — 펼침/이름편집 트리거. Provider 없으면 no-op(compare 안전).
"use client";

import { createContext, useContext } from "react";

// 노드에 표시할 정보 필드 — 사용자가 좌측 사이드바 체크박스로 토글 (BPM 속성 + URL)
export type NodeDisplayField =
  | "assignee"
  | "department"
  | "system"
  | "url";

export const NODE_DISPLAY_FIELDS: NodeDisplayField[] = [
  "assignee",
  "department",
  "system",
  "url",
];

// 토글 대상 = BPM 속성 4종 + 파라미터 칩 일괄 스위치("params" — 6필드 칩을 한 번에 켬/끔)
export type NodeDisplayToggle = NodeDisplayField | "params";

export const NODE_DISPLAY_TOGGLES: NodeDisplayToggle[] = [...NODE_DISPLAY_FIELDS, "params"];

/** 저장 토글 파싱 — v2 키 우선, 레거시 키(파라미터 토글 도입 전)는 params ON으로 이관. 저장값 없으면 null. */
export function parseDisplayToggles(
  v2: string | null,
  legacy: string | null,
): NodeDisplayToggle[] | null {
  const parse = (raw: string | null): string[] | null => {
    if (!raw) return null;
    try {
      const arr: unknown = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((f): f is string => typeof f === "string") : null;
    } catch {
      return null;
    }
  };
  const valid = (arr: string[]): NodeDisplayToggle[] =>
    arr.filter((f): f is NodeDisplayToggle =>
      (NODE_DISPLAY_TOGGLES as readonly string[]).includes(f),
    );
  const fromV2 = parse(v2);
  if (fromV2 !== null) return valid(fromV2);
  const fromLegacy = parse(legacy);
  if (fromLegacy !== null) return Array.from(new Set([...valid(fromLegacy), "params"]));
  return null;
}

export interface NodeActions {
  // 노드 호버 토글 → 인라인 하위 프로세스 펼치기/접기 (Provider 없으면 비활성)
  onToggleExpand: ((nodeId: string) => void) | null;
  // 현재 인라인 펼쳐진 노드 id 집합 — 토글 버튼 아이콘(펼침/접힘) 표시용
  expandedInlineIds: ReadonlySet<string>;
  // 노드에 표시할 필드 — 미지정 시 담당자+파라미터 칩(항상 표시였던 기존 동작 유지)
  displayFields: NodeDisplayToggle[];
  // 인라인 이름 편집 — 타이틀 더블클릭으로 진입(onStartRename), editingNodeId 일치 노드만 입력 모드.
  // 이름 외 영역 더블클릭은 노드 레벨 핸들러(요약창)로 전달. Provider 없으면 비활성.
  editingNodeId: string | null;
  onStartRename: ((nodeId: string) => void) | null;
  onRename: ((nodeId: string, label: string) => void) | null;
  onCancelRename: (() => void) | null;
  // Ctrl/⌘+드래그 복제 중인 노드 id 집합 — "+" 배지 표시용(Provider 없으면 항상 빈 집합).
  ctrlDragIds: ReadonlySet<string>;
}

const defaultActions: NodeActions = {
  onToggleExpand: null,
  expandedInlineIds: new Set<string>(),
  displayFields: ["assignee", "params"],
  editingNodeId: null,
  onStartRename: null,
  onRename: null,
  onCancelRename: null,
  ctrlDragIds: new Set<string>(),
};

export const NodeActionsContext = createContext<NodeActions>(defaultActions);

export function useNodeActions(): NodeActions {
  return useContext(NodeActionsContext);
}

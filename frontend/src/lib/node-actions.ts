// 노드(ProcessNode)→에디터 통신 — 드릴 트리거. Provider 없으면 no-op(compare 안전).
"use client";

import { createContext, useContext } from "react";

// 노드에 표시할 정보 필드 — 사용자가 좌측 사이드바 체크박스로 토글 (BPM 속성 + 유형)
export type NodeDisplayField =
  | "assignee"
  | "department"
  | "system"
  | "duration"
  | "nodeType";

export const NODE_DISPLAY_FIELDS: NodeDisplayField[] = [
  "assignee",
  "department",
  "system",
  "duration",
  "nodeType",
];

export interface NodeActions {
  onDrill: ((nodeId: string, clientX: number, clientY: number) => void) | null;
  // 노드에 표시할 필드 — 미지정 시 담당자만(기존 동작 유지)
  displayFields: NodeDisplayField[];
  // 인라인 이름 편집 — 타이틀 더블클릭으로 진입(onStartRename), editingNodeId 일치 노드만 입력 모드.
  // 이름 외 영역 더블클릭은 노드 레벨 핸들러(요약창)로 전달. Provider 없으면 비활성.
  editingNodeId: string | null;
  onStartRename: ((nodeId: string) => void) | null;
  onRename: ((nodeId: string, label: string) => void) | null;
  onCancelRename: (() => void) | null;
}

const defaultActions: NodeActions = {
  onDrill: null,
  displayFields: ["assignee"],
  editingNodeId: null,
  onStartRename: null,
  onRename: null,
  onCancelRename: null,
};

export const NodeActionsContext = createContext<NodeActions>(defaultActions);

export function useNodeActions(): NodeActions {
  return useContext(NodeActionsContext);
}

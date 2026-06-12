// 노드(ProcessNode)→에디터 통신 — 드릴 트리거·연결 소스. Provider 없으면 no-op(compare 안전).
"use client";

import { createContext, useContext } from "react";

export interface NodeActions {
  onDrill: ((nodeId: string, clientX: number, clientY: number) => void) | null;
  connectSource: string | null;
}

const defaultActions: NodeActions = { onDrill: null, connectSource: null };

export const NodeActionsContext = createContext<NodeActions>(defaultActions);

export function useNodeActions(): NodeActions {
  return useContext(NodeActionsContext);
}

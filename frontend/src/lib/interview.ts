// AI 컨설턴트 인터뷰 — 순수 헬퍼: 스테이지 상수·선택지 추출·작업본 diff·dagre 배치 (design 2026-07-23)

import type { Edge } from "@xyflow/react";

import type { ChoiceOption, InterviewMessage, WorkingGraph } from "./api";
import type { AppNode } from "./canvas";
import { nodeSizeOf, normalizeNodeType } from "./canvas";
import { autoLayoutFlow } from "./flow-layout";

// 백엔드 engine.STAGES와 키·순서 동기 — 변경 시 양쪽 함께 (UI 라벨은 영어 고정)
export const INTERVIEW_STAGES = [
  { key: "scope", label: "Scope" },
  { key: "io", label: "Inputs & Outputs" },
  { key: "activities", label: "Activities" },
  { key: "branches", label: "Branches" },
  { key: "roles", label: "Roles & Systems" },
  { key: "params", label: "Parameters" },
  { key: "review", label: "Review" },
] as const;

export function stageIndex(key: string): number {
  return INTERVIEW_STAGES.findIndex((s) => s.key === key);
}

export function choiceOptionsOf(messages: InterviewMessage[]): ChoiceOption[] | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "consultant" || last.kind !== "choices") return null;
  const options = (last.payload as { options?: ChoiceOption[] } | null)?.options;
  return options && options.length > 0 ? options : null;
}

export function addedNodeKeys(
  prev: WorkingGraph | null,
  next: WorkingGraph | null,
): Set<string> {
  if (!prev || !next) return new Set(); // 첫 그래프는 전체가 신규 — 하이라이트 안 함
  const before = new Set(prev.nodes.map((n) => n.key));
  return new Set(next.nodes.filter((n) => !before.has(n.key)).map((n) => n.key));
}

export function layoutWorkingGraph(
  graph: WorkingGraph | null,
  added: Set<string>,
): { nodes: AppNode[]; edges: Edge[] } {
  if (!graph || graph.nodes.length === 0) return { nodes: [], edges: [] };
  const nodes: AppNode[] = graph.nodes.map((n) => {
    const nodeType = normalizeNodeType(n.node_type);
    return {
      id: n.key,
      type: "process",
      position: { x: 0, y: 0 },
      width: nodeSizeOf(nodeType).w,
      height: nodeSizeOf(nodeType).h,
      data: {
        label: n.title,
        description: n.description,
        nodeType,
        color: "",
        assignee: "",
        department: "",
        system: "",
        duration: "",
        groupIds: [],
        hasChildren: false,
        sideHandles: true,
        diffStatus: added.has(n.key) ? ("added" as const) : undefined,
      },
    } as AppNode;
  });
  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
  }));
  return autoLayoutFlow(nodes, edges, "LR");
}

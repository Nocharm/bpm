import type { Edge } from "@xyflow/react";

import type { Graph } from "@/lib/api";
import {
  normalizeNodeType,
  sourceHandleId,
  targetHandleId,
  type AppNode,
  type HandleSide,
} from "@/lib/canvas";

// 백엔드 source_side/target_side(string)를 HandleSide로 안전 변환 — 비정상값은 기본 면으로.
function coerceSide(value: string, fallback: HandleSide): HandleSide {
  return value === "left" ||
    value === "right" ||
    value === "top" ||
    value === "bottom"
    ? value
    : fallback;
}

// 저장된 좌표 기반으로 그래프를 React Flow 노드로 변환(비교화면 dagre와 달리 위치 보존).
export function toFlowNodes(graph: Graph): AppNode[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: "process",
    position: { x: n.pos_x, y: n.pos_y },
    data: {
      label: n.title,
      description: n.description,
      nodeType: normalizeNodeType(n.node_type),
      color: n.color,
      assignee: n.assignee,
      department: n.department,
      system: n.system,
      duration: n.duration,
      groupIds: n.group_ids,
      hasChildren: n.has_children ?? false,
      linkedMapId: n.linked_map_id,
      followLatest: n.follow_latest,
      linkedVersionId: n.linked_version_id,
      isPrimaryEnd: n.is_primary_end,
    },
  }));
}

// 그래프 엣지를 핸들 사이드까지 포함해 React Flow 엣지로 변환.
export function toFlowEdges(graph: Graph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    label: e.label || undefined,
    sourceHandle: sourceHandleId(coerceSide(e.source_side, "right")),
    targetHandle: targetHandleId(coerceSide(e.target_side, "left")),
  }));
}

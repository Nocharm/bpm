/** 에디터 그래프 ↔ 저장 Graph 변환(엣지 로드 정규화·저장 직렬화) — Next 페이지 모듈은 임의 export를 못 가져 page.tsx에서 분리. */
import type { Edge } from "@xyflow/react";

import type { EdgeLineStyle, Graph, GraphEdge, GraphGroup } from "@/lib/api";
import {
  buildAppEdge,
  sideFromHandleId,
  sourceHandleId,
  targetHandleId,
  type AppNode,
  type HandleSide,
} from "@/lib/canvas";
import {
  PRIMARY_END_HANDLE,
  isSubprocessEndHandle,
  isSubprocessInHandle,
  subprocessInHandle,
} from "@/lib/subprocess-embed";

// 렌더 type ↔ 저장 line_style 정규화 — ""(레거시)·비정상 값은 기본 꺾은선
export function normalizeEdgeLineStyle(value: string | undefined): EdgeLineStyle {
  return value === "default" || value === "straight" ? value : "smoothstep";
}

export function toAppEdges(graph: Graph): Edge[] {
  const subprocessIds = new Set(
    graph.nodes.filter((node) => node.node_type === "subprocess").map((node) => node.id),
  );
  return graph.edges.map((edge) => {
    // 백엔드가 raw handle id를 보내면 우선 사용(subprocess 끝 핸들·in 변형); 없으면 side에서 파생.
    // 하위프로세스 끝점 정규화 — CSV·AI 임포트 엣지는 handle 없이 저장되는데(s-right/t-left 폴백)
    // SP에는 그 핸들이 없어 RF가 조용히 버렸다: 소스는 대표 끝, 타깃은 저장된 변의 들어오는 문으로.
    const sourceSide = (edge.source_side as HandleSide) || "right";
    const targetSide = (edge.target_side as HandleSide) || "left";
    let sourceHandle = edge.source_handle ?? sourceHandleId(sourceSide);
    let targetHandle = edge.target_handle ?? targetHandleId(targetSide);
    if (subprocessIds.has(edge.source_node_id) && !isSubprocessEndHandle(sourceHandle)) {
      sourceHandle = PRIMARY_END_HANDLE;
    }
    if (subprocessIds.has(edge.target_node_id) && !isSubprocessInHandle(targetHandle)) {
      targetHandle = subprocessInHandle(sideFromHandleId(targetHandle, targetSide));
    }
    return buildAppEdge({
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      label: edge.label,
      sourceHandle,
      targetHandle,
      // 엣지별 저장 선 모양 — ""(레거시)는 기본 꺾은선
      type: normalizeEdgeLineStyle(edge.line_style),
      // 미직렬화 시 저장마다 서버 소거 — 왕복 필수 (§4 게이트 6 plain_fanout 예외 판정 재료)
      gateway: edge.gateway,
    });
  });
}



export function buildGraph(nodes: AppNode[], edges: Edge[], groups: GraphGroup[]): Graph {
  // 자기완결적 payload 보장 — 백엔드 검증(엣지·group 참조) 422 방지
  const nodeIds = new Set(nodes.map((node) => node.id));
  // 어느 노드든 태그로 가진 그룹만 보존(빈 그룹 제거)
  const referencedGroupIds = new Set<string>();
  for (const node of nodes) {
    for (const gid of node.data.groupIds) {
      referencedGroupIds.add(gid);
    }
  }
  const keptGroups = groups.filter((group) => referencedGroupIds.has(group.id));
  const groupIds = new Set(keptGroups.map((group) => group.id));
  return {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      title: node.data.label,
      description: node.data.description,
      node_type: node.data.nodeType,
      color: node.data.color,
      assignee: node.data.assignee,
      assignee_role: node.data.assignee_role ?? "",
      department: node.data.department,
      system: node.data.system,
      duration: node.data.duration,
      cost_krw: node.data.cost_krw ?? "",
      cost_usd: node.data.cost_usd ?? "",
      headcount: node.data.headcount ?? "",
      annual_count: node.data.annual_count ?? "",
      fte: node.data.fte ?? "",
      touch_time: node.data.touch_time ?? "",
      input: node.data.input ?? "",
      output: node.data.output ?? "",
      input_forms: node.data.input_forms ?? "",
      output_forms: node.data.output_forms ?? "",
      output_ids: node.data.output_ids ?? "",
      input_links: node.data.input_links ?? "",
      output_links: node.data.output_links ?? "",
      input_flags: node.data.input_flags ?? "",
      start_condition: node.data.start_condition ?? "",
      end_condition: node.data.end_condition ?? "",
      system_fallback: node.data.system_fallback ?? "",
      gmp: node.data.gmp ?? "",
      url: node.data.url ?? "",
      url_label: node.data.urlLabel ?? "",
      pos_x: node.position.x,
      pos_y: node.position.y,
      sort_order: index,
      // 보존된 그룹만 남김(고아 태그 제거)
      group_ids: node.data.groupIds.filter((gid) => groupIds.has(gid)),
      linked_map_id: node.data.linkedMapId ?? null,
      follow_latest: node.data.followLatest ?? false,
      linked_version_id: node.data.linkedVersionId ?? null,
      // 미직렬화 시 저장마다 서버 소거 — 왕복 필수 (design 2026-08-28 §10.1)
      placeholder_category_id: node.data.placeholderCategoryId ?? null,
      width: node.data.nodeWidth ?? null,
      is_primary_end: node.data.isPrimaryEnd ?? false,
      // 미직렬화 시 저장마다 서버 소거 — 왕복 필수
      parallel_outputs: node.data.parallelOutputs ?? [],
    })),
    // 양 끝이 모두 payload 노드인 엣지만 — 누락 노드 참조 제거
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map<GraphEdge>((edge) => ({
        id: edge.id,
        source_node_id: edge.source,
        target_node_id: edge.target,
        label: typeof edge.label === "string" ? edge.label : "",
        source_side: sideFromHandleId(edge.sourceHandle, "right"),
        target_side: sideFromHandleId(edge.targetHandle, "left"),
        source_handle: edge.sourceHandle ?? null,
        target_handle: edge.targetHandle ?? null,
        line_style: normalizeEdgeLineStyle(edge.type),
        // 미직렬화 시 저장마다 서버 소거 — 왕복 필수 (§4 게이트 6 plain_fanout 예외 판정 재료)
        gateway: (edge.data?.gateway as string | null | undefined) ?? null,
      })),
    groups: keptGroups.map((group) => ({
      id: group.id,
      // 평면 다중 태그 모델 — 중첩(parent_group_id) 미사용
      parent_group_id: null,
      label: group.label,
      color: group.color,
    })),
  };
}

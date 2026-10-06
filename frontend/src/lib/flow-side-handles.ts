// 4변 핸들(data.sideHandles) 노드만 쓰는 RF 표면(캠페인 연결 캔버스·인터뷰 프리뷰·선택지 카드)의 엣지 핸들.
// 자동정렬(autoLayoutFlow)이 고르는 변(역행=위, 척추→곁가지=위·아래, 척추 지름길=아래, 그 외 흐름측)을 그대로 쓰되,
// 그 노드들엔 SP 들어오는 문(in:*)·끝 키 핸들이 없으므로 s-변/t-변 id로 바꾼다 — 없는 핸들 id면 RF가 엣지를 조용히 버린다.

import type { Edge } from "@xyflow/react";

import { type AppNode, sideFromHandleId, sourceHandleId, targetHandleId } from "@/lib/canvas";
import { computeSpine, findMainPath, pickEdgeHandleSides, renderHOf, renderWOf } from "@/lib/flow-layout";

/** 자동정렬 핸들(in:변·끝 키 포함) → 4변 핸들 id. 변을 모르는 끝은 우→좌 기본 */
export function toSideHandleEdges(edges: readonly Edge[]): Edge[] {
  return edges.map((edge) => ({
    ...edge,
    sourceHandle: sourceHandleId(sideFromHandleId(edge.sourceHandle, "right")),
    targetHandle: targetHandleId(sideFromHandleId(edge.targetHandle, "left")),
  }));
}

/**
 * 현재 좌표 기준 핸들 — autoLayoutFlow의 핸들 규칙(척추·역행·곁가지, SP 소스는 우측)을 노드를 옮기지 않고 적용한다.
 * 저장 계약에 핸들이 없는 캔버스(FwCanvas)도 자동정렬 직후·새로고침 뒤 같은 변으로 그려진다.
 */
export function deriveFlowSideHandles(nodes: readonly AppNode[], edges: readonly Edge[]): Edge[] {
  const list = [...nodes];
  const present = new Set(list.map((node) => node.id));
  const seed = findMainPath(list, [...edges]);
  const spine = seed.size > 0 ? computeSpine(present, seed, [...edges]) : new Set<string>();
  const typeById = new Map(list.map((node) => [node.id, node.data.nodeType]));
  const centers = new Map(
    list.map((node) => [
      node.id,
      { cx: node.position.x + renderWOf(node) / 2, cy: node.position.y + renderHOf(node) / 2 },
    ]),
  );
  return edges.map((edge) => {
    const s = centers.get(edge.source);
    const t = centers.get(edge.target);
    if (!s || !t) return edge;
    const { sourceSide, targetSide } = pickEdgeHandleSides(list, "LR", spine, edge, s, t, renderWOf, renderHOf);
    // SP 출구는 우측 한 점(핸들 계약) — 자동정렬도 SP 소스 핸들은 바꾸지 않는다
    const sourceHandle = typeById.get(edge.source) === "subprocess" ? sourceHandleId("right") : sourceHandleId(sourceSide);
    return { ...edge, sourceHandle, targetHandle: targetHandleId(targetSide) };
  });
}

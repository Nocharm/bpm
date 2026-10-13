// 연결선 전달물(렌더 전용) — 원본 산출물→미러(IO 링크)와 서브프로세스 같은 이름 매칭을 흐름 경로 엣지에 투영한다.
// 엣지 가운데 개수 점·호버 카드가 읽는다(edge.data.carry). 저장·서명·비교 diff 무영향.
// 서브프로세스는 IO를 링크 맵에서 물려받아 로컬 링크가 없으므로 같은 이름이면 이어진 것으로 본다(사용자 결정 2026-10-13).
import type { Edge } from "@xyflow/react";

import {
  buildIoIndex,
  buildIoMirrorIndex,
  getFlowPathBetween,
  getIoLine,
  type IoNode,
  type SpRefMap,
} from "@/lib/io-items";

export interface EdgeCarryItem {
  key: string; // 링크 itemId 또는 이름 매칭 키 — 같은 엣지 안 중복 제거용
  text: string;
  originId: string;
  originLabel: string;
  via: boolean; // true = 엣지 출발 노드가 만든 게 아니라 앞에서 받아 넘기는 경유
}

export interface EdgeCarry {
  items: EdgeCarryItem[];
}

export function isEdgeCarry(value: unknown): value is EdgeCarry {
  return typeof value === "object" && value !== null && Array.isArray((value as EdgeCarry).items);
}

interface CarryPair {
  key: string;
  originId: string;
  consumerId: string;
  text: string;
}

function splitLines(joined: string | null | undefined): string[] {
  return (joined ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// 링크 맵 지정 IO(SP)·로컬 IO(그 외)의 산출물 이름
function getOutputTexts(node: IoNode, spRefs: SpRefMap): string[] {
  if (node.data.nodeType !== "subprocess") return splitLines(node.data.output);
  const ref = node.data.linkedMapId != null ? spRefs.get(node.data.linkedMapId) : undefined;
  return ref?.designated ? splitLines(ref.output) : [];
}

// 명시 링크 — 원본 itemId를 미러로 가진 모든 노드(입력·출력 미러)가 소비자
function collectLinkPairs(nodes: IoNode[], spRefs: SpRefMap): CarryPair[] {
  const origins = buildIoIndex(nodes, spRefs);
  const pairs: CarryPair[] = [];
  for (const [itemId, sites] of buildIoMirrorIndex(nodes)) {
    const origin = origins.get(itemId);
    if (!origin) continue;
    for (const site of sites) {
      if (site.nodeId === origin.nodeId) continue;
      pairs.push({ key: itemId, originId: origin.nodeId, consumerId: site.nodeId, text: origin.text });
    }
  }
  return pairs;
}

// 서브프로세스 이름 매칭 — SP 입력은 앞쪽에서 같은 이름을 내는 가장 가까운 노드, SP 출력은 뒤쪽에서
// 같은 이름을 받는 노드(명시 링크가 걸린 입력 줄은 제외 — 링크 쪽이 진실)
function collectSpNamePairs(nodes: IoNode[], edges: Edge[], spRefs: SpRefMap): CarryPair[] {
  const pairs: CarryPair[] = [];
  for (const sp of nodes) {
    if (sp.data.nodeType !== "subprocess" || sp.data.linkedMapId == null) continue;
    const ref = spRefs.get(sp.data.linkedMapId);
    if (!ref?.designated) continue;
    for (const text of new Set(splitLines(ref.input))) {
      let best: { id: string; hops: number } | null = null;
      for (const node of nodes) {
        if (node.id === sp.id || !getOutputTexts(node, spRefs).includes(text)) continue;
        const hops = getFlowPathBetween(edges, node.id, sp.id).length;
        if (hops > 0 && (best === null || hops < best.hops)) best = { id: node.id, hops };
      }
      if (best) pairs.push({ key: `name:${best.id}:${text}`, originId: best.id, consumerId: sp.id, text });
    }
    for (const text of new Set(splitLines(ref.output))) {
      for (const node of nodes) {
        if (node.id === sp.id) continue;
        const inputs = (node.data.input ?? "").split("\n");
        const isPlainMatch = inputs.some(
          (line, index) => line.trim() === text && getIoLine(node.data.input_links, index) === "",
        );
        if (!isPlainMatch || getFlowPathBetween(edges, sp.id, node.id).length === 0) continue;
        pairs.push({ key: `name:${sp.id}:${text}`, originId: sp.id, consumerId: node.id, text });
      }
    }
  }
  return pairs;
}

/** 엣지 id → 그 연결선으로 넘어가는 항목(직접 먼저, 경유 뒤). 원본→소비자 최단 흐름 경로의 모든 엣지에 싣는다. */
export function buildEdgeCarry(nodes: IoNode[], edges: Edge[], spRefs: SpRefMap): Map<string, EdgeCarryItem[]> {
  const labelById = new Map(nodes.map((node) => [node.id, node.data.label]));
  const byEdge = new Map<string, Map<string, EdgeCarryItem>>();
  const pairs = [...collectLinkPairs(nodes, spRefs), ...collectSpNamePairs(nodes, edges, spRefs)];
  for (const pair of pairs) {
    getFlowPathBetween(edges, pair.originId, pair.consumerId).forEach((edgeId, hop) => {
      const items = byEdge.get(edgeId) ?? new Map<string, EdgeCarryItem>();
      const existing = items.get(pair.key);
      // 같은 항목이 직접·경유로 겹치면 직접이 이긴다
      if (!existing || (existing.via && hop === 0)) {
        items.set(pair.key, {
          key: pair.key,
          text: pair.text,
          originId: pair.originId,
          originLabel: labelById.get(pair.originId) ?? "",
          via: hop > 0,
        });
      }
      byEdge.set(edgeId, items);
    });
  }
  const result = new Map<string, EdgeCarryItem[]>();
  for (const [edgeId, items] of byEdge) {
    result.set(
      edgeId,
      [...items.values()].sort((a, b) => Number(a.via) - Number(b.via)),
    );
  }
  return result;
}

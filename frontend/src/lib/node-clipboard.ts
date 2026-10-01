// 노드 클립보드 — localStorage에 복사 노드/내부 엣지를 저장(같은 탭·다른 탭·다른 맵 붙여넣기).
// localStorage는 평문 HTTP(insecure context)에서도 동작(Web Crypto만 제약).

import { makeCopyLabel, type NodeData } from "@/lib/canvas";
import { getOutputGroups } from "@/lib/output-rules";

const KEY = "bpm.nodeClipboard";
const MAX_NODES = 200; // 과대 payload 방지

export interface Point { x: number; y: number; }
export interface ClipboardNode { id: string; position: Point; data: NodeData; }
export interface ClipboardEdge {
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  // 엣지별 선 모양(React Flow type) — 붙여넣기 사본이 원본 스타일을 물려받게
  type?: string;
  // 임포트 출처 게이트웨이 — 속성 없는 레거시 병렬 출구의 도출 재료라 사본도 물려받는다(구 클립보드엔 없음)
  gateway?: string | null;
}
export interface NodeClipboard {
  sourceMapId: number | null;
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
}

export function writeClipboard(c: NodeClipboard): void {
  try {
    const trimmed: NodeClipboard = { ...c, nodes: c.nodes.slice(0, MAX_NODES) };
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // 저장 실패(quota/차단)는 조용히 무시 — 복사 실패는 UX상 치명적이지 않음
  }
}

export function readClipboard(): NodeClipboard | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NodeClipboard;
    if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 사본이 유지할 병렬 출구 키(노드 id별) — 복사된 내부 엣지 기준으로 병렬로 읽히고 갈래가 2개 이상 함께
 * 복사된 출구만. 단독 사본은 엣지 없이 붙어 엣지 1개만 이으면 "병렬인데 1개"로 저장이 막혀 해제하고
 * (사용자 결정 2026-10-01), 묶음 복사로 갈래가 같이 붙으면 해제하는 쪽이 "출구에 엣지 2개" 위반이라 유지한다.
 * 판정은 getOutputGroups라 속성 없이 gateway="parallel"로만 병렬인 레거시 출구도 속성으로 승격된다.
 * Ctrl+C/V(buildPaste)와 Ctrl/Alt 드래그 복제가 같은 규칙을 쓴다.
 */
export function pickParallelForCopy(
  nodes: readonly { id: string; data: Pick<NodeData, "nodeType" | "parallelOutputs"> }[],
  edges: readonly { source: string; target: string; sourceHandle?: string | null; gateway?: string | null }[],
): Map<string, string[]> {
  const copiedIds = new Set(nodes.map((n) => n.id));
  const internal = edges.filter((e) => copiedIds.has(e.source) && copiedIds.has(e.target));
  const kept = new Map<string, string[]>();
  for (const n of nodes) {
    // 분기·끝은 출력 규칙 밖이라 병렬 속성을 두지 않는다(에디터 우클릭 메뉴와 같은 조건) — 레거시 승격도 막는다
    if (n.data.nodeType === "decision" || n.data.nodeType === "end") {
      kept.set(n.id, []);
      continue;
    }
    const groups = getOutputGroups(
      { id: n.id, nodeType: n.data.nodeType, parallelOutputs: n.data.parallelOutputs },
      internal,
    );
    kept.set(n.id, groups.filter((g) => g.parallel && g.count >= 2).map((g) => g.key));
  }
  return kept;
}

/** 붙여넣기 그래프 — 새 id 발급·위치 오프셋·라벨 dedup·내부 엣지 재매핑. */
export function buildPaste(
  clip: NodeClipboard,
  opts: { newId: () => string; existingLabels: string[]; offset: Point },
): { nodes: ClipboardNode[]; edges: (ClipboardEdge & { id: string })[] } {
  const idMap = new Map<string, string>();
  const taken = [...opts.existingLabels];
  const keptParallel = pickParallelForCopy(clip.nodes, clip.edges);
  const nodes = clip.nodes.map((n) => {
    const id = opts.newId();
    idMap.set(n.id, id);
    const label = makeCopyLabel(n.data.label, taken);
    taken.push(label);
    return {
      id,
      position: { x: n.position.x + opts.offset.x, y: n.position.y + opts.offset.y },
      // 대표 끝(isPrimaryEnd)은 맵당 1개 — 사본이 상속하면 대표끝이 중복된다. 사본은 항상 해제.
      // output_ids는 소거 — itemId가 중복되면 원본 판정이 깨진다(io-linking §6). *_links/input_flags는 유지(사본도 같은 원본의 미러).
      data: { ...n.data, label, groupIds: [] as string[], isPrimaryEnd: false, output_ids: "", parallelOutputs: keptParallel.get(n.id) ?? [] },
    };
  });
  const edges = clip.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      id: opts.newId(),
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      label: e.label,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: e.type,
      gateway: e.gateway,
    }));
  return { nodes, edges };
}

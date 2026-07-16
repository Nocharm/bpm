// 노드 클립보드 — localStorage에 복사 노드/내부 엣지를 저장(같은 탭·다른 탭·다른 맵 붙여넣기).
// localStorage는 평문 HTTP(insecure context)에서도 동작(Web Crypto만 제약).

import { makeCopyLabel, type NodeData } from "@/lib/canvas";

const KEY = "bpm.nodeClipboard";
const MAX_NODES = 200; // 과대 payload 방지

export interface Point { x: number; y: number; }
export interface ClipboardNode { id: string; position: Point; data: NodeData; }
export interface ClipboardEdge { source: string; target: string; label?: string; }
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

/** 붙여넣기 그래프 — 새 id 발급·위치 오프셋·라벨 dedup·내부 엣지 재매핑. */
export function buildPaste(
  clip: NodeClipboard,
  opts: { newId: () => string; existingLabels: string[]; offset: Point },
): { nodes: ClipboardNode[]; edges: (ClipboardEdge & { id: string })[] } {
  const idMap = new Map<string, string>();
  const taken = [...opts.existingLabels];
  const nodes = clip.nodes.map((n) => {
    const id = opts.newId();
    idMap.set(n.id, id);
    const label = makeCopyLabel(n.data.label, taken);
    taken.push(label);
    return {
      id,
      position: { x: n.position.x + opts.offset.x, y: n.position.y + opts.offset.y },
      data: { ...n.data, label, groupIds: [] as string[] },
    };
  });
  const edges = clip.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ id: opts.newId(), source: idMap.get(e.source)!, target: idMap.get(e.target)!, label: e.label }));
  return { nodes, edges };
}

// 자동정렬 그래프 전처리 — 엣지 정규 순서(예 우선)·되돌아가는 엣지 분리·주 경로(최장 선행 경로).
// dagre 배치(canvas.ts layoutWithDagre)와 척추 직선화(flow-layout.ts)가 공유한다.
// 임포트 배치 backend/scripts/consultant_layout.py와 동치 이중 구현 — 한쪽을 고치면 다른 쪽과 테스트를 같이 옮긴다.

export interface LayoutEdgeLink {
  id?: string;
  source: string;
  target: string;
  label?: unknown;
  sourceHandle?: string | null;
}

// "예/승인" 계열 분기 라벨 — 주 경로 동점 깨기·분기 세로 순서(위쪽)에 쓴다(사용자 결정 2026-10-06).
// 비교는 trim+소문자 완전 일치. consultant_layout.py _YES_LABELS와 같은 집합.
const YES_LABELS = new Set(["yes", "y", "예", "네", "승인", "approve", "approved", "ok"]);

/** 엣지 라벨 문자열 — React Flow label은 ReactNode라 문자열일 때만 읽는다. */
export function getEdgeLabelText(edge: LayoutEdgeLink): string {
  return typeof edge.label === "string" ? edge.label : "";
}

export function isYesLabel(label: string): boolean {
  return YES_LABELS.has(label.trim().toLowerCase());
}

// SP 출구 끝 키가 아닌 핸들(일반 노드 변 id·대표 끝·없음) — 끝 키 엣지는 같은 소스의 기본 출구 뒤에 둔다.
function isPrimaryOutHandle(handle: string | null | undefined): boolean {
  return !handle || handle === "__primary__" || handle.startsWith("s-");
}

/**
 * 엣지 정규 순서 — 출발 노드 순서 → 예 라벨 먼저 → 기본 출구 먼저 → 라벨 문자열 → 도착 노드 순서 → id.
 * 배열 순서만 바뀐 같은 그래프가 같은 배치를 내도록 dagre 입력·DFS·주 경로가 모두 이 순서를 쓴다.
 * 파이썬은 (예 라벨, 라벨, 도착 노드 순서)를 같은 우선순위로 쓴다(핸들 차원 없음 = 항상 기본 출구).
 */
export function sortLayoutEdges<T extends LayoutEdgeLink>(nodeIds: readonly string[], edges: readonly T[]): T[] {
  const indexOf = new Map(nodeIds.map((id, index) => [id, index]));
  const keyed = edges.map((edge) => {
    const label = getEdgeLabelText(edge);
    return {
      edge,
      source: indexOf.get(edge.source) ?? Number.MAX_SAFE_INTEGER,
      yes: isYesLabel(label) ? 0 : 1,
      handle: isPrimaryOutHandle(edge.sourceHandle) ? 0 : 1,
      label,
      target: indexOf.get(edge.target) ?? Number.MAX_SAFE_INTEGER,
      id: edge.id ?? "",
    };
  });
  keyed.sort(
    (a, b) =>
      a.source - b.source ||
      a.yes - b.yes ||
      a.handle - b.handle ||
      (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) ||
      a.target - b.target ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return keyed.map((item) => item.edge);
}

/**
 * 되돌아가는 엣지(back edge) 탐색 — 진입 노드(선행 없음)부터 DFS, 탐색 스택 위로 향하는 엣지.
 * consultant_layout.py find_back_edges 이식. 빼고 나면 DAG라 랭크·주 경로가 사이클에 흔들리지 않는다.
 */
export function findBackEdges(nodeIds: readonly string[], edges: readonly LayoutEdgeLink[]): Set<LayoutEdgeLink> {
  const present = new Set(nodeIds);
  const out = new Map<string, LayoutEdgeLink[]>(nodeIds.map((id) => [id, []]));
  const indeg = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    if (!present.has(edge.source) || !present.has(edge.target)) continue;
    out.get(edge.source)?.push(edge);
    indeg.set(edge.target, (indeg.get(edge.target) ?? 0) + 1);
  }
  const roots = [
    ...nodeIds.filter((id) => indeg.get(id) === 0),
    ...nodeIds.filter((id) => indeg.get(id) !== 0),
  ];
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodeIds.map((id) => [id, WHITE]));
  const back = new Set<LayoutEdgeLink>();
  for (const root of roots) {
    if (color.get(root) !== WHITE) continue;
    const stack: Array<{ node: string; index: number }> = [{ node: root, index: 0 }];
    color.set(root, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const outs = out.get(top.node) ?? [];
      if (top.index < outs.length) {
        const edge = outs[top.index];
        top.index += 1;
        const next = edge.target;
        if (color.get(next) === GRAY) back.add(edge);
        else if (color.get(next) === WHITE) {
          color.set(next, GRAY);
          stack.push({ node: next, index: 0 });
        }
      } else {
        color.set(top.node, BLACK);
        stack.pop();
      }
    }
  }
  return back;
}

/** (선행 엣지, 되돌아가는 엣지) — 노드에 없는 끝을 가진 엣지는 둘 다에서 빠진다. */
export function splitForwardEdges<T extends LayoutEdgeLink>(
  nodeIds: readonly string[],
  edges: readonly T[],
): { forward: T[]; back: T[] } {
  const present = new Set(nodeIds);
  const scoped = edges.filter((edge) => present.has(edge.source) && present.has(edge.target));
  const backSet = findBackEdges(nodeIds, scoped);
  return {
    forward: scoped.filter((edge) => !backSet.has(edge)),
    back: scoped.filter((edge) => backSet.has(edge)),
  };
}

/**
 * 주 경로(큰길) — 시작→끝의 **최장** 선행 경로, 길이가 같으면 예 라벨을 더 많이 지나는 쪽(사용자 결정 2026-10-06).
 * 최단 경로는 반려 지름길(D→No→끝)을 척추로 골라 실제 흐름을 곁가지로 밀어냈다.
 * forward는 DAG(되돌아가는 엣지 제외) + 정규 순서 전제. 그래도 동점이면 위상 순서·엣지 순서상 먼저 닿은 쪽.
 * 끝에 닿지 못하면 빈 집합. consultant_layout.py find_main_path와 동치.
 */
export function findLongestPath(
  nodeIds: readonly string[],
  forward: readonly LayoutEdgeLink[],
  startId: string,
  endId: string,
): Set<string> {
  const outs = new Map<string, LayoutEdgeLink[]>(nodeIds.map((id) => [id, []]));
  const indeg = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const edge of forward) {
    const list = outs.get(edge.source);
    if (!list || !indeg.has(edge.target)) continue;
    list.push(edge);
    indeg.set(edge.target, (indeg.get(edge.target) ?? 0) + 1);
  }
  // 위상 순서 — Kahn(노드 순서 큐), consultant_layout.compute_ranks와 같은 순회
  const order: string[] = [];
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const edge of outs.get(current) ?? []) {
      const left = (indeg.get(edge.target) ?? 0) - 1;
      indeg.set(edge.target, left);
      if (left === 0) queue.push(edge.target);
    }
  }
  const best = new Map<string, { length: number; yes: number }>([[startId, { length: 0, yes: 0 }]]);
  const prev = new Map<string, string>();
  for (const current of order) {
    const score = best.get(current);
    if (!score) continue;
    for (const edge of outs.get(current) ?? []) {
      const candidate = {
        length: score.length + 1,
        yes: score.yes + (isYesLabel(getEdgeLabelText(edge)) ? 1 : 0),
      };
      const known = best.get(edge.target);
      if (
        !known ||
        candidate.length > known.length ||
        (candidate.length === known.length && candidate.yes > known.yes)
      ) {
        best.set(edge.target, candidate);
        prev.set(edge.target, current);
      }
    }
  }
  if (!best.has(endId)) return new Set();
  const path = new Set<string>();
  let cursor: string | undefined = endId;
  while (cursor !== undefined && !path.has(cursor)) {
    path.add(cursor);
    cursor = prev.get(cursor);
  }
  return path;
}

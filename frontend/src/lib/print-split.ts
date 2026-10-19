// PNG 문서용 나눠 싣기 — 긴 맵을 노드 사이 빈 칸에서 세로로 잘라 같은 배율의 조각 여러 장으로 낸다(사용자 결정 2026-10-19).
// 자를 자리는 노드·캡션·연결선 라벨·영역 제목(blocks)을 피한다. 같은 조각 수라면 연결선이 덜 지나가고 영역을 덜 가르며
// 폭이 고른 쪽을 고른다. 잘린 연결선 양끝에는 같은 문자의 연결 기호를 붙인다(findCutCrossings).
// 좌표는 모두 캡처 프레임 css px(lib/export ExportFrame 기준). DOM 측정은 measureSplitSource, 나머지는 순수 함수.
// 편집 화면 Word 출력과 비교 화면 문서용 출력(lib/export)이 함께 쓴다.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 나눌 그림의 재료 — 프레임 크기와 그 안의 블록·영역·연결선(프레임 css px). */
export interface SplitSource {
  width: number;
  height: number;
  // 자르면 안 되는 것 — 노드(밖 캡션·IO 아일랜드 포함)·연결선 라벨·영역 제목
  blocks: Rect[];
  // 가르면 감점 — 영역(그룹) 박스
  regions: Rect[];
  // 연결선 샘플 점열 — 자를 자리의 교차 수·연결 기호 위치
  edges: Point[][];
}

export interface SplitPiece {
  x0: number;
  x1: number;
}

export interface SplitPlan {
  pieces: SplitPiece[];
  // 가장 넓은 조각 폭 — 모든 조각을 이 폭이 본문 폭에 맞는 같은 배율로 인쇄한다
  maxWidth: number;
}

const BLOCK_CLEARANCE = 6; // 자를 자리와 블록 사이 최소 여백(px)
const CANDIDATE_STEP = 24; // 넓은 빈 칸 안 후보 간격(px) — 조각 폭을 고르게 맞출 여지
const CROSSING_MERGE_PX = 4; // 이만큼 가까운 교차는 한 줄(겹쳐 지나가는 연결선 다발)
const REGION_INSET = 4; // 영역 가장자리 이만큼 안쪽부터 "가른다"로 센다
const CROSSING_COST = 2;
const REGION_COST = 3;
const BALANCE_COST = 1; // 조각 폭 제곱합(한도 대비) 가중 — 같은 수면 고른 폭
const PIECE_PAD_PX = 16; // 조각 위아래 내용 바깥 여백(px)

/** 프레임 폭 [0, width]에서 블록이 차지하지 않는 빈 칸(여백을 둔) 구간들. */
export function findFreeGaps(width: number, blocks: readonly Rect[]): [number, number][] {
  const spans = blocks
    .map((block) => [block.x - BLOCK_CLEARANCE, block.x + block.width + BLOCK_CLEARANCE] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [from, to] of spans) {
    if (from > cursor) gaps.push([cursor, Math.min(from, width)]);
    cursor = Math.max(cursor, to);
    if (cursor >= width) break;
  }
  if (cursor < width) gaps.push([cursor, width]);
  return gaps.filter(([from, to]) => to > from && from > 0 && to < width);
}

/** 빈 칸마다 가운데 + 넓은 칸은 일정 간격 후보 — 프레임 양 끝은 빼고(조각 경계는 따로 둔다). */
function getCutCandidates(width: number, blocks: readonly Rect[]): number[] {
  const out: number[] = [];
  for (const [from, to] of findFreeGaps(width, blocks)) {
    out.push((from + to) / 2);
    for (let x = from + CANDIDATE_STEP; x < to - CANDIDATE_STEP / 2; x += CANDIDATE_STEP) out.push(x);
  }
  return Array.from(new Set(out.map((x) => Math.round(x)))).sort((a, b) => a - b);
}

/** 세로선 x를 지나는 연결선 교차 y — 다발로 겹쳐 지나가는 선은 하나로(위→아래 정렬). */
export function findCutCrossings(edges: readonly Point[][], x: number): number[] {
  const ys: number[] = [];
  for (const points of edges) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if ((a.x - x) * (b.x - x) >= 0 || a.x === b.x) continue;
      ys.push(a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x));
    }
  }
  ys.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const y of ys) {
    if (merged.length === 0 || y - merged[merged.length - 1] > CROSSING_MERGE_PX) merged.push(y);
  }
  return merged;
}

function getCutCost(source: SplitSource, x: number): number {
  const crossings = findCutCrossings(source.edges, x).length;
  const regionCuts = source.regions.filter(
    (region) => x > region.x + REGION_INSET && x < region.x + region.width - REGION_INSET,
  ).length;
  return crossings * CROSSING_COST + regionCuts * REGION_COST;
}

/** 자를 자리 고르기 — 조각 폭 ≤ limit을 지키며 조각 수 최소, 그다음 비용(교차·영역·폭 고르기) 최소.
 *  빈 칸만으로 limit을 지킬 수 없으면(빽빽한 구간) 지킬 수 있는 가장 작은 폭으로 한도를 늘린다. */
export function planSplit(source: SplitSource, limit: number): SplitPlan {
  const { width } = source;
  if (width <= limit) return { pieces: [{ x0: 0, x1: width }], maxWidth: width };
  const stops = [0, ...getCutCandidates(width, source.blocks), width];
  let widest = 0;
  for (let i = 1; i < stops.length; i += 1) widest = Math.max(widest, stops[i] - stops[i - 1]);
  const cap = Math.max(limit, widest);
  const cutCost = stops.map((x, i) => (i === 0 || i === stops.length - 1 ? 0 : getCutCost(source, x)));
  // best[i] = stops[i]에서 끝나는 최선(조각 수, 비용, 직전 자리)
  const best: { pieces: number; cost: number; prev: number }[] = [{ pieces: 0, cost: 0, prev: -1 }];
  for (let i = 1; i < stops.length; i += 1) {
    let pick: { pieces: number; cost: number; prev: number } | null = null;
    for (let j = i - 1; j >= 0 && stops[i] - stops[j] <= cap; j -= 1) {
      const from = best[j];
      if (!from) continue;
      const share = (stops[i] - stops[j]) / cap;
      const candidate = {
        pieces: from.pieces + 1,
        cost: from.cost + cutCost[i] + BALANCE_COST * share * share,
        prev: j,
      };
      if (
        pick === null ||
        candidate.pieces < pick.pieces ||
        (candidate.pieces === pick.pieces && candidate.cost < pick.cost)
      ) {
        pick = candidate;
      }
    }
    // cap이 연속 후보 간격의 최댓값 이상이라 바로 앞 자리는 항상 닿는다
    best[i] = pick ?? { pieces: Number.POSITIVE_INFINITY, cost: 0, prev: i - 1 };
  }
  const pieces: SplitPiece[] = [];
  for (let i = stops.length - 1; i > 0; i = best[i].prev) {
    pieces.unshift({ x0: stops[best[i].prev], x1: stops[i] });
  }
  return { pieces, maxWidth: Math.max(...pieces.map((piece) => piece.x1 - piece.x0)) };
}

/** 조각 세로 범위 — 조각 안의 블록·영역·연결선 점을 감싸고 여백을 둔다(프레임 밖으로는 안 나간다). */
export function getPieceBounds(source: SplitSource, piece: SplitPiece): { y0: number; y1: number } {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const isInside = (x0: number, x1: number) => x1 > piece.x0 && x0 < piece.x1;
  for (const rect of [...source.blocks, ...source.regions]) {
    if (!isInside(rect.x, rect.x + rect.width)) continue;
    top = Math.min(top, rect.y);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  for (const points of source.edges) {
    for (const point of points) {
      if (point.x < piece.x0 || point.x > piece.x1) continue;
      top = Math.min(top, point.y);
      bottom = Math.max(bottom, point.y);
    }
  }
  if (!Number.isFinite(top)) return { y0: 0, y1: source.height };
  return { y0: Math.max(0, top - PIECE_PAD_PX), y1: Math.min(source.height, bottom + PIECE_PAD_PX) };
}

/** 연결 기호 문자 — A..Z, 그다음 AA, AB… */
export function getConnectorLabel(index: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < letters.length
    ? letters[index]
    : `${letters[Math.floor(index / letters.length) - 1]}${letters[index % letters.length]}`;
}

/** 캡처 뷰포트(.react-flow__viewport)에서 나눌 재료를 잰다 — frame은 그 뷰포트를 찍는 프레임(flow → 프레임 좌표). */
export function measureSplitSource(
  viewport: HTMLElement,
  frame: { width: number; height: number; x: number; y: number; zoom: number },
): SplitSource {
  const liveZoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1;
  const origin = viewport.getBoundingClientRect();
  const toFrame = (rect: DOMRect): Rect => ({
    x: ((rect.left - origin.left) / liveZoom) * frame.zoom + frame.x,
    y: ((rect.top - origin.top) / liveZoom) * frame.zoom + frame.y,
    width: (rect.width / liveZoom) * frame.zoom,
    height: (rect.height / liveZoom) * frame.zoom,
  });
  const blocks: Rect[] = [];
  const selector = ".react-flow__node, .react-flow__node *, .react-flow__edgelabel-renderer *, .bpm-group-title";
  for (const el of viewport.querySelectorAll(selector)) {
    // 투명 핸들·숨긴 호버 요소는 그림이 아니다
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    blocks.push(toFrame(rect));
  }
  const regions = Array.from(viewport.querySelectorAll(".bpm-group-fill"), (el) => toFrame(el.getBoundingClientRect()));
  const edges: Point[][] = [];
  for (const path of viewport.querySelectorAll<SVGPathElement>(".react-flow__edge-path")) {
    const group = path.closest(".react-flow__edge");
    if (group && !group.checkVisibility()) continue;
    const length = path.getTotalLength();
    const points: Point[] = [];
    // 연결선 svg는 flow 좌표 그대로다
    for (let at = 0; at <= length; at += 4) {
      const point = path.getPointAtLength(at);
      points.push({ x: point.x * frame.zoom + frame.x, y: point.y * frame.zoom + frame.y });
    }
    const end = path.getPointAtLength(length);
    points.push({ x: end.x * frame.zoom + frame.x, y: end.y * frame.zoom + frame.y });
    edges.push(points);
  }
  return { width: frame.width, height: frame.height, blocks, regions, edges };
}

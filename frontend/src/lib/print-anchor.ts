// PNG 출력 정렬 유지 — 출력 순간의 표시 정보(PNG 옵션 창 선택·Word 글꼴)가 캔버스와 달라 노드 크기가 바뀌어도
// 캔버스에서 보이던 정렬을 지킨다. 노드 좌표는 왼쪽 위 기준이라 폭·높이가 바뀌면 가운데·오른쪽(아래) 정렬이 깨진다
// (정렬 명령 lib/canvas alignSelected는 그 순간의 실측 크기로 왼쪽 위를 계산한다).
// 캔버스 크기로 노드마다 다른 노드와 맞닿은 기준(시작·가운데·끝)을 찾고, 출력 크기에서 그 기준이 제자리에 오도록
// 표시 좌표만 옮긴다(저장 좌표 불변). 편집 화면 PNG 출력(maps/[mapId]/page.tsx handleExportPng)이 쓴다.

/** 축마다 지키는 기준 — 시작(왼쪽·위)·가운데·끝(오른쪽·아래) */
export type AlignAnchor = "start" | "center" | "end";

/** 저장 좌표(왼쪽 위)와 실측 크기 */
export interface AnchorRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeAnchors {
  x: AlignAnchor | null;
  y: AlignAnchor | null;
}

/** 표시 좌표 이동량 */
export interface PrintShift {
  dx: number;
  dy: number;
}

// 정렬 명령은 정확히 맞추지만 실측 크기가 소수라 반올림 여유
const ALIGN_TOLERANCE = 1;
// 이보다 작은 이동은 무시 — 출력에 보이지 않는 지터
const MIN_SHIFT = 0.5;

// 같은 크기로 같은 자리에 겹친 상대(시작·가운데·끝이 모두 맞음)는 의도를 알 수 없어 기본값에 한 표를 준다 —
// 가로는 가운데(위·아래 핸들이 노드 가운데라 세로 연결선이 곧게 남는다), 세로는 시작(좌우 핸들이 제목 줄 높이라 위가 고정이면
// 가로 연결선이 곧게 남는다). 표로 세야 8px 격자 스냅으로 우연히 맞은 먼 노드가 바로 옆 열을 이기지 않는다.
// 다른 노드와 맞닿은 기준이 없으면 옮기지 않는다
const AMBIGUOUS_DEFAULT: Record<"x" | "y", AlignAnchor> = { x: "center", y: "start" };
// 표가 같으면 이 순서로
const TIE_ORDER: Record<"x" | "y", AlignAnchor[]> = {
  x: ["center", "start", "end"],
  y: ["start", "center", "end"],
};

function inferAxis(rect: AnchorRect, others: readonly AnchorRect[], axis: "x" | "y"): AlignAnchor | null {
  const pos = (r: AnchorRect) => (axis === "x" ? r.x : r.y);
  const size = (r: AnchorRect) => (axis === "x" ? r.width : r.height);
  const near = (a: number, b: number) => Math.abs(a - b) <= ALIGN_TOLERANCE;
  const votes: Record<AlignAnchor, number> = { start: 0, center: 0, end: 0 };
  for (const other of others) {
    const start = near(pos(rect), pos(other));
    const center = near(pos(rect) + size(rect) / 2, pos(other) + size(other) / 2);
    const end = near(pos(rect) + size(rect), pos(other) + size(other));
    if (start && center && end) votes[AMBIGUOUS_DEFAULT[axis]] += 1;
    else if (center) votes.center += 1;
    else if (start) votes.start += 1;
    else if (end) votes.end += 1;
  }
  const best = TIE_ORDER[axis].reduce((a, b) => (votes[b] > votes[a] ? b : a));
  return votes[best] > 0 ? best : null;
}

/** 노드마다 가로·세로로 지킬 기준 — 캔버스 크기 기준으로 다른 노드와 맞닿은 시작·가운데·끝 중 가장 많은 쪽 */
export function inferAlignAnchors(rects: readonly AnchorRect[]): Map<string, NodeAnchors> {
  const anchors = new Map<string, NodeAnchors>();
  for (const rect of rects) {
    const others = rects.filter((other) => other.id !== rect.id);
    anchors.set(rect.id, { x: inferAxis(rect, others, "x"), y: inferAxis(rect, others, "y") });
  }
  return anchors;
}

/** React Flow 노드 → 저장 좌표 + 실측 크기. 아직 재지 않은 노드는 뺀다(기준도 이동도 없음) */
export function getAnchorRects(
  nodes: readonly { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }[],
): AnchorRect[] {
  const rects: AnchorRect[] = [];
  for (const node of nodes) {
    const width = node.measured?.width ?? 0;
    const height = node.measured?.height ?? 0;
    if (width > 0 && height > 0) rects.push({ id: node.id, x: node.position.x, y: node.position.y, width, height });
  }
  return rects;
}

const ANCHOR_RATIO: Record<AlignAnchor, number> = { start: 0, center: 0.5, end: 1 };

/** 캔버스 크기(reference) → 출력 크기(next)로 바뀔 때 기준을 제자리에 두는 표시 이동량. 움직일 노드만 담는다 */
export function getPrintShifts(
  reference: readonly AnchorRect[],
  next: ReadonlyMap<string, { width: number; height: number }>,
): Map<string, PrintShift> {
  const anchors = inferAlignAnchors(reference);
  const shifts = new Map<string, PrintShift>();
  for (const rect of reference) {
    const size = next.get(rect.id);
    const anchor = anchors.get(rect.id);
    if (!size || !anchor) continue;
    const dx = anchor.x ? (rect.width - size.width) * ANCHOR_RATIO[anchor.x] : 0;
    const dy = anchor.y ? (rect.height - size.height) * ANCHOR_RATIO[anchor.y] : 0;
    if (Math.abs(dx) < MIN_SHIFT && Math.abs(dy) < MIN_SHIFT) continue;
    shifts.set(rect.id, { dx, dy });
  }
  return shifts;
}

/** 표시용 노드 — 이동량만큼 위치를 옮긴 사본(이동 없는 노드는 같은 객체) */
export function applyPrintShifts<T extends { id: string; position: { x: number; y: number } }>(
  nodes: readonly T[],
  shifts: ReadonlyMap<string, PrintShift>,
): T[] {
  return nodes.map((node) => {
    const shift = shifts.get(node.id);
    return shift ? { ...node, position: { x: node.position.x + shift.dx, y: node.position.y + shift.dy } } : node;
  });
}

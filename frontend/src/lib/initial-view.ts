// 에디터 첫 화면 배율 판정 — 전체 맞춤이 글자를 못 읽을 만큼 작아지면 시작 노드 쪽을 읽을 수 있는 배율로 연다.

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InitialViewport {
  x: number;
  y: number;
  zoom: number;
}

/** 전체 맞춤 배율이 이 값보다 작으면 읽기 배율로 연다(노드 제목 14px 기준 약 8px 아래로 떨어지는 지점). */
export const READABLE_FIT_THRESHOLD = 0.6;
/** 읽기 배율 하한 — 세로가 긴 맵도 이보다 줄이지 않는다. */
export const READABLE_MIN_ZOOM = 0.7;
/** 읽기 배율로 열 때 화면 가장자리와 내용 사이 여백(px). */
export const READABLE_EDGE_GAP = 64;
/** RF fitView 기본 padding과 같은 값 — 전체 맞춤 배율 추정에 쓴다. */
const FIT_PADDING = 0.1;

/**
 * 전체 맞춤이 충분히 크면 null(지금처럼 전체 맞춤), 아니면 읽기 배율 뷰포트.
 * 가로는 anchor(시작 노드)를 왼쪽 여백에 붙이고, 세로는 내용이 다 들어가면 내용 가운데, 아니면 anchor 가운데.
 */
export function pickReadableViewport(
  bounds: ViewRect,
  anchor: ViewRect,
  paneWidth: number,
  paneHeight: number,
): InitialViewport | null {
  if (bounds.width <= 0 || bounds.height <= 0 || paneWidth <= 0 || paneHeight <= 0) {
    return null;
  }
  const fitZoom = Math.min(paneWidth / bounds.width, paneHeight / bounds.height) / (1 + FIT_PADDING * 2);
  if (fitZoom >= READABLE_FIT_THRESHOLD) {
    return null;
  }
  const heightZoom = (paneHeight - READABLE_EDGE_GAP * 2) / bounds.height;
  const zoom = Math.min(1, Math.max(READABLE_MIN_ZOOM, heightZoom));
  const isHeightFitting = bounds.height * zoom <= paneHeight - READABLE_EDGE_GAP * 2 + 0.5;
  const centerY = isHeightFitting ? bounds.y + bounds.height / 2 : anchor.y + anchor.height / 2;
  return {
    x: READABLE_EDGE_GAP - anchor.x * zoom,
    y: paneHeight / 2 - centerY * zoom,
    zoom,
  };
}

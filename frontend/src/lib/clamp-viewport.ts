// 마우스 위치 기준 팝업을 화면 안에 두는 클램프 — 모달이 뷰포트를 벗어나지 않게 (동선 최소화).

export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = 8,
): { left: number; top: number } {
  if (typeof window === "undefined") {
    return { left: x, top: y };
  }
  const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
  return { left, top };
}

/**
 * 앵커(카드) 옆에 붙는 플라이아웃의 세로 위치 — 앵커 상단 정렬이 기본, 화면 아래로 넘치면 **앵커 하단 정렬로 반전**,
 * 그래도 안 들어가면 여백 안쪽으로 클램프. 높이는 실측값을 넘긴다(내용에 따라 행 수가 달라진다).
 */
export function placeBesideAnchor(
  anchor: { top: number; bottom: number },
  height: number,
  viewportHeight: number,
  margin = 8,
): number {
  const limit = viewportHeight - margin;
  if (anchor.top + height <= limit) return anchor.top;
  const flipped = anchor.bottom - height;
  if (flipped >= margin) return flipped;
  return Math.max(margin, Math.min(anchor.top, limit - height));
}

/**
 * 이미 배치된 팝오버의 **실측 박스**가 화면 밖으로 나간 만큼의 보정량.
 * 내용에 따라 높이가 변하거나 CSS transform으로 중앙정렬된 팝오버는 크기 추정이 불가능하므로,
 * 붙인 뒤 재보고 밀어 넣는다(레이아웃 이펙트에서 호출 — 페인트 전이라 튐 없음).
 */
export function getViewportOverflow(el: HTMLElement, margin = 8): { dx: number; dy: number } {
  const rect = el.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (rect.right > window.innerWidth - margin) {
    dx = window.innerWidth - margin - rect.right;
  }
  // 화면보다 넓으면 왼쪽/위쪽 정렬 우선 — 잘리더라도 시작 부분은 보이게
  if (rect.left + dx < margin) {
    dx = margin - rect.left;
  }
  if (rect.bottom > window.innerHeight - margin) {
    dy = window.innerHeight - margin - rect.bottom;
  }
  if (rect.top + dy < margin) {
    dy = margin - rect.top;
  }
  return { dx, dy };
}

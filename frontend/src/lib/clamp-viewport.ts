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

// 홈 필터 필 표시 단계 판정 — 실측 폭 기반(고정 브레이크포인트 아님). full=아이콘+라벨,
// label=라벨만, icon=아이콘만. margin(px)은 스크롤바·서브픽셀 진동 방지 여유.

export type FilterDisplayMode = "full" | "label" | "icon";

export function pickFilterDisplayMode(
  available: number,
  widths: { full: number; label: number },
  marginPx = 8,
): FilterDisplayMode {
  if (widths.full <= 0 || widths.label <= 0) return "full"; // 측정 전 — 강등 금지
  if (available >= widths.full + marginPx) return "full";
  if (available >= widths.label + marginPx) return "label";
  return "icon";
}

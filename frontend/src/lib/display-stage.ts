// 폭 실측 기반 표시 단계 판정 — 상단 네비 등 누적 강등 UI 공용. stageWidths[i]는 단계 i의
// 자연 소요 폭(내림차순). 전부 안 들어가면 미측정 최종 단계(length)로 강등. margin은 진동 방지 여유.

export function pickDisplayStage(
  available: number,
  stageWidths: number[],
  marginPx = 8,
): number {
  if (stageWidths.length === 0 || stageWidths.some((w) => w <= 0)) return 0; // 측정 전 — 강등 금지
  for (let i = 0; i < stageWidths.length; i += 1) {
    if (available >= stageWidths[i] + marginPx) return i;
  }
  return stageWidths.length;
}

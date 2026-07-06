// 노드 참조 링크 가드 — http(s) 스킴만 통과. 액션 바 노출 조건과 미리보기 iframe 로드 게이트가
// 같은 판정을 공유해 javascript:/data: 등 스킴 주입(XSS)을 차단한다.
export function isHttpUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

// 미리보기 표면 전용 가드 — http(s) + 자기 오리진(앱 자신) 차단.
// iframe sandbox가 allow-scripts+allow-same-origin이라 같은 오리진을 프레이밍하면 샌드박스 탈출이
// 가능하므로, 링크 버튼 노출과 iframe 로드 게이트가 이 판정을 공유한다 (2026-07-07 보안 리뷰).
export function isSafePreviewUrl(value: string | null | undefined): boolean {
  if (!isHttpUrl(value) || typeof value !== "string") return false;
  if (typeof window === "undefined") return false;
  try {
    return new URL(value.trim()).origin !== window.location.origin;
  } catch {
    return false;
  }
}

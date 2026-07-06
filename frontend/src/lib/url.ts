// 노드 참조 링크 가드 — http(s) 스킴만 통과. 액션 바 노출 조건과 미리보기 iframe 로드 게이트가
// 같은 판정을 공유해 javascript:/data: 등 스킴 주입(XSS)을 차단한다.
export function isHttpUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

// 노드 참조 링크 가드 — http(s) 스킴만 통과. 액션 바 노출 조건과 미리보기 iframe 로드 게이트가
// 같은 판정을 공유해 javascript:/data: 등 스킴 주입(XSS)을 차단한다.
export function isHttpUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

// 링크로 열 때만 허용하는 스킴 — 그 외(javascript:·data:·vbscript: 등)는 링크를 만들지 않는다
const LINK_SCHEMES = new Set(["http", "https", "mailto"]);

// 앞뒤 C0 제어문자·공백 제거 — 브라우저 URL 파서와 같은 범위(String.trim은 \x01 등을 남긴다)
function trimC0(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

// 저장된 URL → 링크 href. 화면 표시 전용이라 저장값은 바꾸지 않는다(사용자 결정 2026-10-21).
// 스킴이 없으면(복사한 주소에 http가 빠진 경우) https://를 붙이고, 스킴이 있으면 LINK_SCHEMES만 통과,
// 나머지는 null(글자로만 표시). 판정은 브라우저처럼 탭·줄바꿈을 지우고 대소문자를 무시해 끼워 넣기 우회를 막는다.
export function toSafeHref(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = trimC0(value.replace(/[\t\n\r]/g, ""));
  if (cleaned === "") return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  // "intranet:8080/path"처럼 콜론 뒤가 숫자(포트)면 스킴이 아니라 주소다
  if (scheme && !/^\d/.test(cleaned.slice(scheme[0].length))) {
    return LINK_SCHEMES.has(scheme[1].toLowerCase()) ? cleaned : null;
  }
  return cleaned.startsWith("//") ? `https:${cleaned}` : `https://${cleaned}`;
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

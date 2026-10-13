// 악센트 테마 개인 설정 — 프리셋 하나를 골라 <html>의 --color-accent만 덮는다. 파생 톤(tint·focus·sky·선택 엣지·
// 서브프로세스 stroke 등)은 globals.css가 color-mix로 계산하므로 같이 바뀐다. 브라우저(localStorage)에만 저장.
// 프리셋은 대비 검증본만(흰 바탕·흰 글씨·선택 틴트 위 글씨 모두 4.5:1 이상 — accent-theme.test.ts가 지킨다).
// 의미색과 겹치는 색(초록=추가·게시, 빨강·주황=오류·삭제, 앰버=경고, 틸=비교 변경)은 일부러 뺐다.
// 워스트 케이스 검토(2026-10-13)로 로즈(서브프로세스가 End 노드·No 분기·오류 배지와 같은 색)·그래파이트(선택 상태가
// 중립 회색 칩과 구분 안 됨)도 제외 — 저장값이 이 둘이면 기본 바이올렛으로 돌아간다.

export type AccentThemeId = "violet" | "blue" | "ocean" | "plum";

export interface AccentTheme {
  id: AccentThemeId;
  hex: string;
}

export const DEFAULT_ACCENT: AccentThemeId = "violet";

export const ACCENT_THEMES: AccentTheme[] = [
  { id: "violet", hex: "#6a41ff" },
  { id: "blue", hex: "#2f5fe0" },
  { id: "ocean", hex: "#0a6a94" },
  { id: "plum", hex: "#9b2fae" },
];

const ACCENT_KEY = "bpm.accent";

const HEX_BY_ID = Object.fromEntries(ACCENT_THEMES.map((theme) => [theme.id, theme.hex]));

// <head>에서 첫 페인트 전에 실행 — 하이드레이션 후 적용하면 바이올렛이 한 번 번쩍인다
export const ACCENT_INIT_SCRIPT = `var m=${JSON.stringify(HEX_BY_ID)},a=localStorage.getItem("${ACCENT_KEY}");if(Object.prototype.hasOwnProperty.call(m,a))document.documentElement.style.setProperty("--color-accent",m[a])`;

function isAccentThemeId(value: string | null): value is AccentThemeId {
  return value !== null && Object.hasOwn(HEX_BY_ID, value);
}

export function getAccentThemeId(): AccentThemeId {
  const stored = window.localStorage.getItem(ACCENT_KEY);
  return isAccentThemeId(stored) ? stored : DEFAULT_ACCENT;
}

// 출력물(Excel 링크 글자색 등)처럼 CSS 변수를 못 쓰는 곳용 실제 hex
export function getAccentHex(): string {
  return HEX_BY_ID[getAccentThemeId()];
}

export function setAccentTheme(id: AccentThemeId): void {
  const root = document.documentElement;
  if (id === DEFAULT_ACCENT) {
    window.localStorage.removeItem(ACCENT_KEY);
    root.style.removeProperty("--color-accent");
  } else {
    window.localStorage.setItem(ACCENT_KEY, id);
    root.style.setProperty("--color-accent", HEX_BY_ID[id]);
  }
}

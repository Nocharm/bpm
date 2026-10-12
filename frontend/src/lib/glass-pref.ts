// 유리 효과 개인 설정 — 브라우저(localStorage)에 끔만 기록하고 <html data-glass="off">로 globals.css가 불투명 표면으로 되돌린다.
// 기본은 켜짐(키 없음). 저사양 PC 사용자가 사용자 메뉴에서 끈다.

const GLASS_KEY = "bpm.glass";

// <head>에서 첫 페인트 전에 실행 — 하이드레이션 후 적용하면 끈 사용자에게 유리가 한 번 번쩍인다
export const GLASS_INIT_SCRIPT = `if(localStorage.getItem("${GLASS_KEY}")==="off")document.documentElement.dataset.glass="off"`;

export function isGlassEnabled(): boolean {
  return window.localStorage.getItem(GLASS_KEY) !== "off";
}

export function setGlassEnabled(isOn: boolean): void {
  if (isOn) {
    window.localStorage.removeItem(GLASS_KEY);
    delete document.documentElement.dataset.glass;
  } else {
    window.localStorage.setItem(GLASS_KEY, "off");
    document.documentElement.dataset.glass = "off";
  }
}

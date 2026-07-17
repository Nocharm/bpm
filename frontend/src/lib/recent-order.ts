// 최근 목록 최상단 변화 감지 — 순서 갱신을 애니메이션으로 인지시키기 위한 세션 비교.
// StrictMode 이중 렌더에서 자기취소되지 않도록 읽기(render)와 쓰기(effect)를 분리.
const KEY = "bpm.home.recentTop";

/** 읽기 전용 비교 — sessionStorage를 변경하지 않아 render 단계에서 안전. */
export function peekTopChanged(currentTopId: number | null): boolean {
  if (currentTopId == null) return false;
  try {
    return window.sessionStorage.getItem(KEY) !== String(currentTopId);
  } catch {
    return false;
  }
}

/** 쓰기 전용 — effect에서 호출. 같은 값 재기록은 무해(StrictMode mount replay 안전). */
export function commitTop(currentTopId: number | null): void {
  if (currentTopId == null) return;
  try {
    window.sessionStorage.setItem(KEY, String(currentTopId));
  } catch {
    /* ignore */
  }
}

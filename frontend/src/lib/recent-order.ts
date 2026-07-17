// 최근 목록 최상단 변화 감지 — 순서 갱신을 애니메이션으로 인지시키기 위한 세션 비교.
const KEY = "bpm.home.recentTop";

export function readTopChanged(currentTopId: number | null): boolean {
  if (currentTopId == null) return false;
  let prev: string | null = null;
  try { prev = window.sessionStorage.getItem(KEY); } catch { return false; }
  const cur = String(currentTopId);
  if (prev === cur) return false;
  try { window.sessionStorage.setItem(KEY, cur); } catch { /* ignore */ }
  return true;
}

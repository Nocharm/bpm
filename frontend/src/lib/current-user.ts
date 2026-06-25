// 현재 로그인 유저 표시명 — AuthGate가 발행, TopNav가 구독. 로컬(인증 비활성)이면 null.

export interface CurrentUser {
  name: string;
  email: string | null;
  loginId: string;
  role: "admin" | "user";
  department: string;
  // 부서 소속 판정용 org_path(루트→리프, "A/B/C") — 상세 멤버 하이라이트(HM-2)
  orgPath: string;
  // 서버(/api/me)가 산정한 BPM 시스템 관리자 여부 — sysadmin-only UI 게이팅 단일 소스
  isSysadmin: boolean;
}

let currentUser: CurrentUser | null = null;
const listeners = new Set<() => void>();

export function setCurrentUser(user: CurrentUser | null): void {
  currentUser = user;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCurrentUser(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCurrentUser(): CurrentUser | null {
  return currentUser;
}

// 현재 로그인 유저 표시명 — AuthGate가 발행, TopNav가 구독. 로컬(인증 비활성)이면 null.

export interface CurrentUser {
  name: string;
  email: string | null;
  loginId: string;
  role: "admin" | "user";
  department: string;
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

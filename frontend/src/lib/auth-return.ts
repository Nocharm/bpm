// 로그인 리다이렉트 보조 — 딥링크 복원(returnTo) + 자동 silent 로그인 억제 플래그. sessionStorage(탭 단위).
const RETURN_TO_KEY = "bpm.returnTo";
const AUTO_LOGIN_SKIP_KEY = "bpm.autoLoginSkip";

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null; // 프라이버시 모드 등 접근 불가 — 딥링크 복원 없이 기존 흐름으로
  }
}

// open redirect 방지 — 내부 경로만("/" 시작, "//"·"/login"·루트 제외)
export function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && path !== "/" && !path.startsWith("/login");
}

export function saveReturnTo(path: string): void {
  if (!isSafeReturnPath(path)) {
    return;
  }
  getStorage()?.setItem(RETURN_TO_KEY, path);
}

export function peekReturnTo(): string | null {
  const value = getStorage()?.getItem(RETURN_TO_KEY) ?? null;
  return value !== null && isSafeReturnPath(value) ? value : null;
}

export function consumeReturnTo(): string | null {
  const value = peekReturnTo();
  getStorage()?.removeItem(RETURN_TO_KEY);
  return value;
}

export function setAutoLoginSkip(): void {
  getStorage()?.setItem(AUTO_LOGIN_SKIP_KEY, "1");
}

export function clearAutoLoginSkip(): void {
  getStorage()?.removeItem(AUTO_LOGIN_SKIP_KEY);
}

export function hasAutoLoginSkip(): boolean {
  return getStorage()?.getItem(AUTO_LOGIN_SKIP_KEY) === "1";
}

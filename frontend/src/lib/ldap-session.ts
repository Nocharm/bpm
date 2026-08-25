// ldap 모드 세션 토큰 — 서버가 평문 HTTP라 Secure 쿠키를 못 쓰므로 localStorage에 둔다(설계 §4).
// expiresAt(ISO, 서버 발급)을 토큰과 함께 저장 — 만료된 토큰을 그대로 두면 /api/me가 401을 반복해
// 로그인 루프가 된다(LdapGate가 매 401마다 카드로 되돌리므로, 만료는 여기서 조용히 걸러낸다).

const KEY = "bpm.ldapToken";

interface StoredLdapSession {
  token: string;
  expiresAt: string;
}

function isExpired(expiresAt: string): boolean {
  const expiry = Date.parse(expiresAt);
  // 파싱 불가(NaN)는 저장값이 손상됐다는 뜻 — 살아있는 토큰으로 오인하지 않도록 만료 취급한다.
  return !Number.isFinite(expiry) || expiry <= Date.now();
}

export function getStoredLdapToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredLdapSession>;
    if (!parsed.token || !parsed.expiresAt || isExpired(parsed.expiresAt)) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed.token;
  } catch {
    // 손상된 값 — 정리하고 로그아웃 취급
    window.localStorage.removeItem(KEY);
    return null;
  }
}

export function storeLdapToken(token: string, expiresAt: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const payload: StoredLdapSession = { token, expiresAt };
  window.localStorage.setItem(KEY, JSON.stringify(payload));
}

export function clearLdapToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(KEY);
}

// 인증 모드는 백엔드가 런타임에 알려준다 — NEXT_PUBLIC_* 빌드 상수를 쓰면 모드를 바꿀 때마다
// 프론트 이미지를 다시 구워야 한다(설계 §2).

export type AuthMode = "keycloak" | "ldap" | "dev";

export interface AuthModeInfo {
  mode: AuthMode;
  keycloakIssuer: string;
  keycloakClientId: string;
}

const MODES: AuthMode[] = ["keycloak", "ldap", "dev"];

// 모드를 못 읽었을 때 인증이 열리면 안 되므로 가장 엄격한 모드로 떨어진다.
const FALLBACK: AuthModeInfo = { mode: "keycloak", keycloakIssuer: "", keycloakClientId: "" };

function isAuthMode(value: unknown): value is AuthMode {
  return typeof value === "string" && MODES.includes(value as AuthMode);
}

export async function fetchAuthMode(): Promise<AuthModeInfo> {
  try {
    const res = await fetch("/api/auth/mode", { cache: "no-store" });
    if (!res.ok) {
      return FALLBACK;
    }
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("mode" in body)) {
      return FALLBACK;
    }
    const raw = body as Record<string, unknown>;
    if (!isAuthMode(raw.mode)) {
      return FALLBACK;
    }
    return {
      mode: raw.mode,
      keycloakIssuer: typeof raw.keycloakIssuer === "string" ? raw.keycloakIssuer : "",
      keycloakClientId: typeof raw.keycloakClientId === "string" ? raw.keycloakClientId : "",
    };
  } catch {
    return FALLBACK;
  }
}

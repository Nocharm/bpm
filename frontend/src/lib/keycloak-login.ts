// /login은 AuthProvider 안에서 렌더되지만, 빌드 단순화를 위해 UserManager를 직접 구성해 signinRedirect를 호출한다.
import { UserManager } from "oidc-client-ts";

export async function signinRedirectFromLogin(options?: { promptNone?: boolean }): Promise<void> {
  const mgr = new UserManager({
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
    // PKCE는 crypto.subtle을 요구 → 평문 HTTP(insecure context)에선 불가. 사내망 HTTP 접속 위해 비활성.
    // 콜백(providers.tsx buildOidcConfig)도 동일하게 맞춰야 토큰 교환이 깨지지 않음.
    disablePKCE: true,
  });
  // prompt=none: SSO 세션 있으면 폼 없이 즉시 복귀, 없으면 error=login_required로 복귀(AuthGate가 처리)
  await mgr.signinRedirect(options?.promptNone ? { prompt: "none" } : undefined);
}

// 완전 로그아웃 — Keycloak end_session으로 SSO 세션 종료(같은 realm의 다른 앱 세션도 함께 종료됨).
// id_token_hint가 있으면 확인 화면 없이 즉시 종료. post-logout URI는 Keycloak 클라이언트 등록 필요(docs/deploy/deploy.md §1).
export async function signoutAllSessions(idTokenHint: string | null): Promise<void> {
  const mgr = new UserManager({
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
  });
  await mgr.signoutRedirect({
    id_token_hint: idTokenHint ?? undefined,
    post_logout_redirect_uri: `${window.location.origin}/login`,
  });
}

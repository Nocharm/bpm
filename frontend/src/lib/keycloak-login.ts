// /login은 AuthProvider 안에서 렌더되지만, 빌드 단순화를 위해 UserManager를 직접 구성해 signinRedirect를 호출한다.
import { UserManager } from "oidc-client-ts";

export async function signinRedirectFromLogin(): Promise<void> {
  const mgr = new UserManager({
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
    // PKCE는 crypto.subtle을 요구 → 평문 HTTP(insecure context)에선 불가. 사내망 HTTP 접속 위해 비활성.
    // 콜백(providers.tsx buildOidcConfig)도 동일하게 맞춰야 토큰 교환이 깨지지 않음.
    disablePKCE: true,
  });
  await mgr.signinRedirect();
}

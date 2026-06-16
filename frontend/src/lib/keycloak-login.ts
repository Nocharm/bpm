// /login은 AuthProvider 안에서 렌더되지만, 빌드 단순화를 위해 UserManager를 직접 구성해 signinRedirect를 호출한다.
import { UserManager } from "oidc-client-ts";

export async function signinRedirectFromLogin(): Promise<void> {
  const mgr = new UserManager({
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
  });
  await mgr.signinRedirect();
}

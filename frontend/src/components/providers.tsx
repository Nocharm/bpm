"use client";

import { AuthProvider, useAuth } from "react-oidc-context";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { setAuthToken } from "@/lib/api";

// SSR-safe 클라이언트 마운트 감지 (effect 내 setState 없이)
const subscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

// 로컬(Docker 없음)은 Keycloak 접근 불가 → 빌드 시 비활성. 서버 빌드에서만 활성.
const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

function buildOidcConfig() {
  return {
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
    // 로그인 후 URL의 code/state 쿼리를 정리
    onSigninCallback: () => {
      window.history.replaceState({}, document.title, window.location.pathname);
    },
  };
}

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  // 미인증 시 Keycloak으로 리디렉트
  useEffect(() => {
    if (
      !auth.isLoading &&
      !auth.isAuthenticated &&
      !auth.activeNavigator &&
      !auth.error
    ) {
      void auth.signinRedirect();
    }
  }, [auth]);

  // 액세스 토큰을 API 클라이언트에 동기화
  useEffect(() => {
    setAuthToken(auth.user?.access_token ?? null);
  }, [auth.user]);

  if (auth.error) {
    return <div className="p-8 text-sm text-red-600">인증 오류: {auth.error.message}</div>;
  }
  if (auth.isLoading || !auth.isAuthenticated) {
    return <div className="p-8 text-sm text-zinc-500">로그인 중…</div>;
  }
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  // SSR에서 window 접근을 피하려 마운트 후에만 AuthProvider 렌더
  const mounted = useMounted();

  if (!AUTH_ENABLED) {
    return <>{children}</>;
  }
  if (!mounted) {
    return null;
  }
  return (
    <AuthProvider {...buildOidcConfig()}>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}

"use client";

import { AuthProvider, useAuth } from "react-oidc-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { getMe, setAuthToken, setDevUser } from "@/lib/api";
import { setCurrentUser } from "@/lib/current-user";
import { getStoredDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";

const subscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

function buildOidcConfig() {
  return {
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
    // signinRedirect(keycloak-login.ts)와 짝 — 평문 HTTP 접속 위해 PKCE 비활성(crypto.subtle 회피).
    disablePKCE: true,
    onSigninCallback: () => {
      window.history.replaceState({}, document.title, window.location.pathname);
    },
  };
}

// 로그인 후 /api/me로 표시 프로필 + role 발행
async function publishMe(): Promise<void> {
  try {
    const me = await getMe();
    setCurrentUser({
      name: me.name || me.username,
      email: null,
      loginId: me.username,
      role: me.role,
      department: me.department,
      isSysadmin: me.is_sysadmin,
    });
  } catch {
    setCurrentUser(null);
  }
}

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  // 토큰은 렌더 단계에서 동기 반영 — 자식 페이지의 fetch effect가 AuthGate effect보다 먼저 실행되는
  // 레이스(첫 GET /maps가 토큰 없이 나가 401) 방지. React effect는 자식→부모 순서라 effect로 세팅하면 늦다.
  setAuthToken(auth.user?.access_token ?? null);

  useEffect(() => {
    if (auth.user?.access_token) {
      void publishMe();
    } else {
      setCurrentUser(null);
    }
  }, [auth.user]);

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated && !auth.activeNavigator && !auth.error) {
      if (pathname !== "/login") {
        router.replace("/login");
      }
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.error, pathname, router]);

  if (pathname === "/login") {
    return <>{children}</>;
  }
  if (auth.error) {
    return <div className="p-8 text-caption text-error">{t("auth.error", { msg: auth.error.message })}</div>;
  }
  if (auth.isLoading || !auth.isAuthenticated) {
    return <div className="p-8 text-caption text-ink-tertiary">{t("auth.signingIn")}</div>;
  }
  return <>{children}</>;
}

function DevGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stored = getStoredDevUser();

  useEffect(() => {
    setDevUser(stored);
    if (stored) {
      void publishMe();
    } else {
      setCurrentUser(null);
      if (pathname !== "/login") {
        router.replace("/login");
      }
    }
  }, [stored, pathname, router]);

  if (pathname === "/login") {
    return <>{children}</>;
  }
  if (!stored) {
    return null;
  }
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  if (!mounted) {
    return null;
  }
  if (!AUTH_ENABLED) {
    return <DevGate>{children}</DevGate>;
  }
  return (
    <AuthProvider {...buildOidcConfig()}>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}

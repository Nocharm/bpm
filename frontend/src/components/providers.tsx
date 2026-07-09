"use client";

import { AuthProvider, useAuth } from "react-oidc-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { getMe, setAuthToken, setDevUser } from "@/lib/api";
import { clearAutoLoginSkip, consumeReturnTo, peekReturnTo, saveReturnTo, setAutoLoginSkip } from "@/lib/auth-return";
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

// prompt=none 실패(SSO 세션 없음) 신호 — 에러 화면이 아니라 "로그인 카드로" 신호로 해석
function isLoginRequiredError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("error" in err)) {
    return false;
  }
  const code = (err as { error?: unknown }).error;
  return code === "login_required" || code === "interaction_required";
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
      orgPath: me.org_path,
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
        saveReturnTo(pathname + window.location.search); // 딥링크 보존 — 로그인 후 복귀
        router.replace("/login");
      }
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.error, pathname, router]);

  // prompt=none 복귀(error=login_required): 자동 재시도 억제 후 로그인 카드로
  useEffect(() => {
    if (auth.error && isLoginRequiredError(auth.error) && pathname !== "/login") {
      setAutoLoginSkip();
      router.replace("/login");
    }
  }, [auth.error, pathname, router]);

  // 로그인 성공: skip 플래그 해제 + 저장된 딥링크 복원
  useEffect(() => {
    if (auth.isAuthenticated) {
      clearAutoLoginSkip();
      const returnTo = consumeReturnTo();
      if (returnTo && returnTo !== pathname) {
        router.replace(returnTo);
      }
    }
  }, [auth.isAuthenticated, pathname, router]);

  if (pathname === "/login") {
    return <>{children}</>;
  }
  if (auth.error && !isLoginRequiredError(auth.error)) {
    return <div className="p-8 text-caption text-error">{t("auth.error", { msg: auth.error.message })}</div>;
  }
  if (auth.isLoading || !auth.isAuthenticated) {
    return <div className="p-8 text-caption text-ink-tertiary">{t("auth.signingIn")}</div>;
  }
  const pendingReturn = peekReturnTo();
  if (pendingReturn && pendingReturn !== pathname) {
    // returnTo로 replace되기 전 홈(콜백 착지점 "/")이 잠깐 렌더되는 플래시 방지
    return <div className="p-8 text-caption text-ink-tertiary">{t("auth.signingIn")}</div>;
  }
  return <>{children}</>;
}

function DevGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stored = getStoredDevUser();

  // dev 유저도 렌더 단계에서 동기 반영 — 자식 페이지의 fetch effect가 DevGate effect보다 먼저 실행되는
  // 레이스(첫 GET /maps가 X-Dev-User 없이 나가 local-dev 폴백→403→빈 캔버스) 방지.
  // AuthGate의 setAuthToken(렌더 단계 동기 호출)과 동일한 패턴.
  setDevUser(stored);

  useEffect(() => {
    if (stored) {
      void publishMe();
    } else {
      setCurrentUser(null);
      if (pathname !== "/login") {
        saveReturnTo(pathname + window.location.search); // 딥링크 보존 — dev 로그인 후 복귀
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

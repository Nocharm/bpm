"use client";

import { AuthProvider, useAuth } from "react-oidc-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { AuthLoadingScreen } from "@/components/auth-loading";
import { getMe, setAuthToken, setDevUser } from "@/lib/api";
import {
  clearAuthRetry,
  clearAutoLoginSkip,
  consumeReturnTo,
  peekReturnTo,
  saveReturnTo,
  setAutoLoginSkip,
  tryConsumeAuthRetry,
} from "@/lib/auth-return";
import { setCurrentUser } from "@/lib/current-user";
import { getStoredDevUser } from "@/lib/dev-auth";

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
      managerIds: me.manager_ids ?? [],
      canViewDashboard: me.can_view_dashboard ?? false,
    });
  } catch {
    setCurrentUser(null);
  }
}

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
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

  // 인증 에러는 막다른 빨간 화면 대신 /login으로 복귀. 에러 종류로 분기:
  //  - login_required/interaction_required(세션 없음, 정상) → 카드로, silent 재시도 억제(무의미한 루프 방지).
  //  - 그 외(state 불일치·토큰 교환 실패·consent_required 등) → 세션이 살아있을 수 있으니 silent 재시도 1회.
  //    재시도가 소진되면(tryConsumeAuthRetry=false) 그때 카드로 폴백. (성공 시 아래 effect가 예산/억제 해제)
  useEffect(() => {
    if (auth.error && !auth.isAuthenticated && pathname !== "/login") {
      if (isLoginRequiredError(auth.error)) {
        setAutoLoginSkip();
        clearAuthRetry();
      } else {
        console.error("auth error, retrying via login", auth.error);
        if (!tryConsumeAuthRetry()) {
          setAutoLoginSkip();
        }
      }
      router.replace("/login");
    }
  }, [auth.error, auth.isAuthenticated, pathname, router]);

  // 로그인 성공: skip 플래그·재시도 예산 해제 + 저장된 딥링크 복원
  useEffect(() => {
    if (auth.isAuthenticated) {
      clearAutoLoginSkip();
      clearAuthRetry();
      const returnTo = consumeReturnTo();
      if (returnTo && returnTo !== pathname) {
        router.replace(returnTo);
      }
    }
  }, [auth.isAuthenticated, pathname, router]);

  if (pathname === "/login") {
    return <>{children}</>;
  }
  // 에러 상태(위 effect가 /login으로 복귀 처리 중)도 not-authenticated로 여기 걸림 —
  // 막다른 빨간 화면 대신 로딩 화면을 잠깐 보인 뒤 로그인 카드로 넘어간다.
  if (auth.isLoading || !auth.isAuthenticated) {
    return <AuthLoadingScreen />;
  }
  const pendingReturn = peekReturnTo();
  if (pendingReturn && pendingReturn !== pathname) {
    // returnTo로 replace되기 전 홈(콜백 착지점 "/")이 잠깐 렌더되는 플래시 방지
    return <AuthLoadingScreen />;
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

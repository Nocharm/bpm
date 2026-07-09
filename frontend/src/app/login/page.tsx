"use client";

import { Lock, LogIn, LogOut, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthLoadingScreen } from "@/components/auth-loading";
import { DevLoginModal } from "@/components/dev-login-modal";
import { setDevUser } from "@/lib/api";
import {
  clearAutoLoginSkip,
  consumeAutoLoginSkip,
  consumeReturnTo,
  consumeSsoLogoutHint,
  setAutoLoginSkip,
} from "@/lib/auth-return";
import { storeDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

// 자동 silent 시도 여부 — 페이지 로드당 1회만 판정(모듈 캐시).
// 렌더 첫 프레임부터 로딩 화면을 보여야 카드 플래시가 없으므로 useState 초기값에서 호출되고,
// StrictMode 이중 렌더/이중 이펙트에서도 consume(부수효과)이 한 번만 실행되도록 여기서 멱등화한다.
let autoAttemptDecision: boolean | null = null;
let autoAttemptStarted = false;

function shouldAutoAttempt(): boolean {
  if (autoAttemptDecision === null) {
    autoAttemptDecision = AUTH_ENABLED && !consumeAutoLoginSkip();
  }
  return autoAttemptDecision;
}

// 로그아웃 직후 1회성 "모든 세션 종료" 패널용 id_token — consume 부수효과를 모듈 캐시로 멱등화(StrictMode 안전).
let ssoHintDecision: string | null | undefined;

function getSsoLogoutHint(): string | null {
  if (ssoHintDecision === undefined) {
    ssoHintDecision = consumeSsoLogoutHint();
  }
  return ssoHintDecision;
}

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [autoSigning, setAutoSigning] = useState(shouldAutoAttempt);
  const [ssoHint] = useState(getSsoLogoutHint);

  // 자동 silent 로그인 — SSO 세션 있으면 버튼 없이 즉시 복귀. 시도 "직전"에 skip 플래그를 세워
  // 실패(login_required) 복귀 시 다음 로그인 마운트 1회를 억제한다(성공 시 AuthGate가 해제).
  useEffect(() => {
    if (!autoSigning || autoAttemptStarted) {
      return;
    }
    autoAttemptStarted = true;
    setAutoLoginSkip();
    void (async () => {
      try {
        const { signinRedirectFromLogin } = await import("@/lib/keycloak-login");
        await signinRedirectFromLogin({ promptNone: true });
      } catch (e) {
        // Keycloak 미응답 등 — 카드로 폴백. 플래그는 원복해 다음 방문에 자동 시도 유지.
        console.error("silent login attempt failed", e);
        clearAutoLoginSkip();
        autoAttemptDecision = false;
        setAutoSigning(false);
      }
    })();
  }, [autoSigning]);

  const onKeycloak = async () => {
    clearAutoLoginSkip();
    const { signinRedirectFromLogin } = await import("@/lib/keycloak-login");
    await signinRedirectFromLogin();
  };

  // Keycloak 모든 세션 종료 — 종료 후 /login 복귀 시 무의미한 silent 시도(login_required 왕복) 방지 플래그
  const onSsoSignoutAll = async () => {
    setAutoLoginSkip();
    const { signoutAllSessions } = await import("@/lib/keycloak-login");
    await signoutAllSessions(ssoHint);
  };

  const onPickDev = (loginId: string) => {
    storeDevUser(loginId);
    setDevUser(loginId);
    setPicking(false);
    router.replace(consumeReturnTo() ?? "/");
  };

  if (autoSigning) {
    // silent 시도 중 — 클릭 가능한 카드 플래시 대신 로딩 화면(부드러운 전환)
    return <AuthLoadingScreen />;
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-surface-pearl">
      <div className="flex flex-col items-center">
        <div data-id="login-card" className="w-80 rounded-md border border-hairline bg-surface p-6 shadow-lg">
          <div
            data-id="login-brand"
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-tint"
          >
            <Workflow size={28} strokeWidth={1.7} className="text-accent" />
          </div>
          <p className="mb-1 text-body-strong text-ink">{t("login.title")}</p>
          <p className="mb-4 text-caption text-ink-muted">{t("login.subtitle")}</p>

          {AUTH_ENABLED ? (
            // 운영: Keycloak 단독(테스트 계정 로그인은 운영에 미노출)
            <button
              type="button"
              data-id="login-keycloak"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-accent text-caption font-semibold text-on-accent hover:bg-accent-focus"
              onClick={() => void onKeycloak()}
            >
              <Lock size={16} strokeWidth={1.7} />
              {t("login.keycloak")}
            </button>
          ) : (
            // 로컬: 임시 로그인(primary) + Keycloak(secondary)
            <>
              <button
                type="button"
                data-id="login-dev"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-accent text-caption font-semibold text-on-accent hover:bg-accent-focus"
                onClick={() => setPicking(true)}
              >
                <LogIn size={16} strokeWidth={1.7} />
                {t("login.dev")}
              </button>
              <div className="my-4 flex items-center gap-2.5">
                <span className="h-px flex-1 bg-divider" />
                <span className="text-fine text-ink-muted">{t("login.or")}</span>
                <span className="h-px flex-1 bg-divider" />
              </div>
              <button
                type="button"
                data-id="login-keycloak"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-hairline bg-surface text-caption font-semibold text-ink hover:bg-surface-alt"
                onClick={() => void onKeycloak()}
              >
                <Lock size={16} strokeWidth={1.7} className="text-ink-tertiary" />
                {t("login.keycloak")}
              </button>
            </>
          )}
        </div>
        {/* 로그아웃 직후 1회 노출 — SSO 세션은 아직 살아있음을 알리고 전체 종료 제공 */}
        {AUTH_ENABLED && ssoHint && (
          <div
            data-id="sso-logout-panel"
            className="mt-3 w-80 rounded-md border border-hairline bg-surface p-4 shadow-md"
          >
            <p className="mb-3 text-caption text-ink-secondary">{t("login.ssoActiveBody")}</p>
            <button
              type="button"
              data-id="sso-logout-all"
              className="flex h-9 w-full items-center justify-center gap-2 rounded-sm border border-hairline bg-surface text-caption font-semibold text-ink hover:bg-surface-alt"
              onClick={() => void onSsoSignoutAll()}
            >
              <LogOut size={16} strokeWidth={1.7} className="text-ink-tertiary" />
              {t("login.ssoSignoutAll")}
            </button>
          </div>
        )}
        <p className="mt-4 text-fine text-ink-muted">{t("login.terms")}</p>
      </div>
      {picking && <DevLoginModal onPick={onPickDev} onClose={() => setPicking(false)} />}
    </div>
  );
}

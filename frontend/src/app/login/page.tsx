"use client";

import { Lock, LogIn, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DevLoginModal } from "@/components/dev-login-modal";
import { setDevUser } from "@/lib/api";
import { storeDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [picking, setPicking] = useState(false);

  const onKeycloak = async () => {
    const { signinRedirectFromLogin } = await import("@/lib/keycloak-login");
    await signinRedirectFromLogin();
  };

  const onPickDev = (loginId: string) => {
    storeDevUser(loginId);
    setDevUser(loginId);
    setPicking(false);
    router.replace("/");
  };

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
        <p className="mt-4 text-fine text-ink-muted">{t("login.terms")}</p>
      </div>
      {picking && <DevLoginModal onPick={onPickDev} onClose={() => setPicking(false)} />}
    </div>
  );
}

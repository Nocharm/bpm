"use client";

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
    <div className="flex flex-1 items-center justify-center">
      <div className="w-80 rounded-md bg-surface p-6 shadow-md">
        <p className="mb-4 text-body-strong text-ink">{t("login.title")}</p>
        <button
          type="button"
          className="w-full rounded-sm bg-accent px-3 py-2 text-caption font-medium text-on-accent hover:bg-accent-focus"
          onClick={() => (AUTH_ENABLED ? void onKeycloak() : setPicking(true))}
        >
          {AUTH_ENABLED ? t("login.keycloak") : t("login.dev")}
        </button>
      </div>
      {picking && <DevLoginModal onPick={onPickDev} onClose={() => setPicking(false)} />}
    </div>
  );
}

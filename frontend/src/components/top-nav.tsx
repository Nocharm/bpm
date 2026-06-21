// 전역 네비게이션 바 — 브랜드 · 유저칩(드롭다운) · 영/한 토글. 모든 페이지 상단.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { setDevUser } from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser, setCurrentUser } from "@/lib/current-user";
import { storeDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";
import { NotificationBell } from "@/components/notification-bell";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export function TopNav() {
  const { t, lang, toggleLang } = useI18n();
  const router = useRouter();
  const user = useSyncExternalStore(
    subscribeCurrentUser,
    getCurrentUser,
    () => null, // 서버 스냅샷 — SSR에서는 유저 없음
  );
  const [open, setOpen] = useState(false);

  const onLogout = async () => {
    if (AUTH_ENABLED) {
      const { UserManager } = await import("oidc-client-ts");
      const mgr = new UserManager({
        authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
        client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
        redirect_uri: window.location.origin,
      });
      await mgr.removeUser();
    } else {
      storeDevUser(null);
      setDevUser(null);
    }
    setCurrentUser(null);
    router.replace("/login");
  };

  return (
    <nav className="flex h-10 shrink-0 items-center justify-between border-b border-hairline bg-surface px-4">
      <Link href="/" className="text-body-strong text-ink">
        {t("app.name")}
      </Link>
      <div className="flex items-center gap-3">
        {/* 무조건 렌더 — 로컬(인증 비활성)은 user가 null이라 가드 시 벨이 안 뜬다. 서버는 TopNav 자체가 AuthGate 인증 후에만 노출 */}
        <NotificationBell />
        <div className="relative">
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-caption text-ink hover:bg-surface-alt"
            onClick={() => setOpen((v) => !v)}
          >
            {user?.name ?? t("nav.guest")}
          </button>
          {open && user && (
            <>
              <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
              <div className="absolute right-0 z-[1001] mt-1 w-40 rounded-md border border-hairline bg-surface py-1 shadow-lg">
                {user.role === "admin" && (
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                    onClick={() => {
                      setOpen(false);
                      router.push("/admin");
                    }}
                  >
                    {t("nav.adminPage")}
                  </button>
                )}
                {/* sysadmin 전용 권한 관리 콘솔 — 서버(/api/me.is_sysadmin) 게이팅 / Sysadmin-only console (server-gated) */}
                {user.isSysadmin && (
                  <button
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                    onClick={() => {
                      setOpen(false);
                      router.push("/admin/permissions");
                    }}
                  >
                    {t("perm.sysadmin.navLink")}
                  </button>
                )}
                {/* 유저 그룹 관리 페이지 / User group management */}
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                  onClick={() => {
                    setOpen(false);
                    router.push("/groups");
                  }}
                >
                  {t("nav.groups")}
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                  onClick={() => void onLogout()}
                >
                  {t("nav.logout")}
                </button>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          className="rounded-xs border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
          onClick={toggleLang}
        >
          {lang === "en" ? t("nav.toKorean") : t("nav.toEnglish")}
        </button>
      </div>
    </nav>
  );
}

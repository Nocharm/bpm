// 전역 네비게이션 바 — 브랜드 · 유저칩(드롭다운) · 영/한 토글. 모든 페이지 상단.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { setDevUser } from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser, setCurrentUser } from "@/lib/current-user";
import { storeDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";
import { NotificationBell } from "@/components/notification-bell";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export function TopNav() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const user = useSyncExternalStore(
    subscribeCurrentUser,
    getCurrentUser,
    () => null, // 서버 스냅샷 — SSR에서는 유저 없음
  );
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 닫기 — 전체화면 오버레이는 페이지 호버를 가로채므로 document 리스너로 대체
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

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
        <div ref={menuRef} className="relative">
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-caption text-ink hover:bg-surface-alt"
            onClick={() => setOpen((v) => !v)}
          >
            {user?.name ?? t("nav.guest")}
          </button>
          {open && user && (
            <div className="absolute right-0 z-[1001] mt-1 w-40 rounded-md border border-hairline bg-surface py-1 shadow-lg">
                {/* 설정 콘솔 — 누구나 접근(왼쪽 탭이 권한별로 다름). 그룹·어드민·권한 surface를 흡수 / Settings console (everyone) */}
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                  onClick={() => {
                    setOpen(false);
                    router.push("/settings");
                  }}
                >
                  {t("nav.settings")}
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                  onClick={() => void onLogout()}
                >
                  {t("nav.logout")}
                </button>
            </div>
          )}
        </div>
        {/* 한/영 세그먼트 토글 — 두 언어를 모두 노출하고 현재 언어를 accent-tint로 강조 */}
        <div className="inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
          {(["ko", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={lang === code}
              className={
                "rounded-xs px-1.5 py-0.5 " +
                (lang === code
                  ? "bg-accent-tint font-semibold text-accent"
                  : "text-ink-tertiary hover:text-ink-secondary")
              }
              onClick={() => setLang(code)}
            >
              {code === "ko" ? t("nav.langKo") : t("nav.langEn")}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

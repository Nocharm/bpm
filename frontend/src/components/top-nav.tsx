// 전역 네비게이션 바 — 브랜드 · 유저칩 · 영/한 토글. 모든 페이지 상단.
"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useI18n } from "@/lib/i18n";

export function TopNav() {
  const { t, lang, toggleLang } = useI18n();
  const user = useSyncExternalStore(
    subscribeCurrentUser,
    getCurrentUser,
    () => null, // 서버 스냅샷 — SSR에서는 유저 없음
  );

  return (
    <nav className="flex h-10 shrink-0 items-center justify-between border-b border-hairline bg-surface px-4">
      <Link href="/" className="text-body-strong text-ink">
        {t("app.name")}
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-caption text-ink-secondary">{user?.name ?? t("nav.guest")}</span>
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

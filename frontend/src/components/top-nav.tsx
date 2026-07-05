// 전역 네비게이션 바 — 브랜드 · 유저칩(드롭다운) · 영/한 토글. 모든 페이지 상단.
"use client";

import { Inbox, Map as MapIcon, Megaphone, MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { setDevUser } from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser, setCurrentUser } from "@/lib/current-user";
import { storeDevUser } from "@/lib/dev-auth";
import {
  closeFeedbackPanel,
  getFeedbackPanelOpen,
  openFeedbackPanel,
  subscribeFeedbackPanel,
} from "@/lib/feedback-panel";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { FeedbackSidePanel } from "@/components/feedback-side-panel";
import { NotificationBell } from "@/components/notification-bell";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

// 상단 세그먼트 전환 탭 — 맵목록/공지/인박스. 슬라이딩 박스로 현재 경로 강조.
const NAV_TABS: { href: string; labelKey: MessageKey; Icon: typeof MapIcon }[] = [
  { href: "/", labelKey: "nav.tab.maps", Icon: MapIcon },
  { href: "/notices", labelKey: "nav.tab.notices", Icon: Megaphone },
  { href: "/inbox", labelKey: "nav.tab.inbox", Icon: Inbox },
];

// 현재 경로 → 활성 탭 인덱스(-1 = 없음). 맵목록은 홈·에디터(/maps) 포함.
function activeTabIndex(pathname: string): number {
  return NAV_TABS.findIndex((tab) =>
    tab.href === "/" ? pathname === "/" || pathname.startsWith("/maps") : pathname.startsWith(tab.href),
  );
}

export function TopNav() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const tabIndex = activeTabIndex(pathname);
  const user = useSyncExternalStore(
    subscribeCurrentUser,
    getCurrentUser,
    () => null, // 서버 스냅샷 — SSR에서는 유저 없음
  );
  const [open, setOpen] = useState(false);
  const feedbackOpen = useSyncExternalStore(
    subscribeFeedbackPanel,
    getFeedbackPanelOpen,
    () => false,
  );
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
      <div className="flex items-center gap-4">
        {/* 홈 로고 = 새로고침 의미 — 저장된 홈 검색·필터를 비우고 전체 리로드(SPA 아님) */}
        <Link
          href="/"
          className="text-body-strong text-ink"
          onClick={(e) => {
            e.preventDefault();
            try {
              window.sessionStorage.removeItem("bpm.home.filters");
            } catch {
              /* 무시 */
            }
            window.location.assign("/");
          }}
        >
          {t("app.name")}
        </Link>
        {/* 3-way 전환 탭 — 아이콘 필(비활성 아이콘만·활성 라벨 우측 펼침) */}
        <div className="flex items-center gap-1.5 text-fine">
          {NAV_TABS.map((tab, i) => {
            const active = i === tabIndex;
            const Icon = tab.Icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                title={t(tab.labelKey)}
                className={
                  "inline-flex items-center rounded-full px-2 py-1 transition-colors " +
                  (active
                    ? "bg-accent-tint text-accent"
                    : "border border-hairline text-ink-tertiary hover:bg-surface-alt hover:text-ink-secondary")
                }
              >
                <Icon size={14} strokeWidth={1.5} />
                <span
                  className={
                    "overflow-hidden whitespace-nowrap transition-all duration-350 ease-smooth " +
                    (active ? "ml-1 max-w-28 opacity-100" : "max-w-0 opacity-0")
                  }
                >
                  {t(tab.labelKey)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {/* 피드백 진입 — 로그인 시에만 노출. 사이드 패널 오픈 */}
        {user && (
          <button
            type="button"
            onClick={openFeedbackPanel}
            className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-accent hover:bg-accent-tint"
          >
            <MessageSquare size={14} strokeWidth={1.5} />
            {t("feedback.button")}
          </button>
        )}
        {/* 무조건 렌더 — 로컬(인증 비활성)은 user가 null이라 가드 시 벨이 안 뜬다. 서버는 TopNav 자체가 AuthGate 인증 후에만 노출 */}
        <NotificationBell />
        {user ? (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              className="rounded-sm px-2 py-1 text-caption text-ink hover:bg-surface-alt"
              onClick={() => setOpen((v) => !v)}
            >
              {user.name}
            </button>
            {open && (
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
        ) : (
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-caption text-ink hover:bg-surface-alt"
            onClick={() => router.push("/login")}
          >
            {t("nav.login")}
          </button>
        )}
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
      <FeedbackSidePanel open={feedbackOpen} onClose={closeFeedbackPanel} />
    </nav>
  );
}

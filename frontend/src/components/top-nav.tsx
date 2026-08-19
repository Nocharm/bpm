// 전역 네비게이션 바 — 브랜드 · 유저칩(드롭다운) · 영/한 토글. 모든 페이지 상단.
"use client";

import { BookOpen, Bell, Inbox, Map as MapIcon, Megaphone, MessageSquare, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { setAuthToken, setDevUser } from "@/lib/api";
import { type AuthMode, getCachedAuthMode } from "@/lib/auth-mode";
import { saveSsoLogoutHint, setAutoLoginSkip } from "@/lib/auth-return";
import { getCurrentUser, subscribeCurrentUser, setCurrentUser } from "@/lib/current-user";
import { storeDevUser } from "@/lib/dev-auth";
import { pickDisplayStage } from "@/lib/display-stage";
import {
  closeFeedbackPanel,
  getFeedbackPanelOpen,
  openFeedbackPanel,
  subscribeFeedbackPanel,
} from "@/lib/feedback-panel";
import { useI18n } from "@/lib/i18n";
import type { Lang, MessageKey } from "@/lib/i18n-messages";
import { clearLdapToken } from "@/lib/ldap-session";
import { FeedbackSidePanel } from "@/components/feedback-side-panel";
import { InboxBadge } from "@/components/inbox-badge";
import { NotificationBell } from "@/components/notification-bell";
import { Tooltip } from "@/components/tooltip";

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

// 실측 전용 복제 행 — stage s가 요구하는 자연폭을 재는 비상호작용 스팬 마크업(라이브와 동일 클래스).
// InboxBadge/NotificationBell은 폴링·구독을 유발하면 안 되므로 동일 크기 정적 플레이스홀더로 대체.
function NavMeasureRow({
  stage,
  lang,
  userName,
  activeIdx,
  loggedIn,
  t,
}: {
  stage: number;
  lang: Lang;
  userName: string;
  activeIdx: number;
  loggedIn: boolean;
  t: (key: MessageKey) => string;
}) {
  return (
    <>
      <div className="flex items-center gap-4">
        <span className="text-body-strong text-ink">{t("app.name")}</span>
        <div className="inline-flex gap-1 rounded-sm bg-surface-alt p-1 text-fine">
          {NAV_TABS.map((tab, i) => {
            const active = i === activeIdx;
            const Icon = tab.Icon;
            return (
              <span key={tab.href} className="inline-flex items-center justify-center rounded-xs px-2.5 py-1">
                <Icon size={14} strokeWidth={1.5} />
                {(stage === 0 || active) && <span className="ml-1 max-w-28">{t(tab.labelKey)}</span>}
                {tab.href === "/inbox" && <span className="inline-block h-4 min-w-[1.125rem]" />}
              </span>
            );
          })}
        </div>
      </div>
      <span className="inline-block w-4" />
      <div className="flex items-center gap-3">
        {loggedIn && (
          <span className="inline-flex rounded-sm border border-hairline p-1.5">
            <BookOpen size={14} strokeWidth={1.5} />
          </span>
        )}
        {loggedIn &&
          (stage < 2 ? (
            <span className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine">
              <MessageSquare size={14} strokeWidth={1.5} />
              {t("feedback.button")}
            </span>
          ) : (
            <span className="inline-flex rounded-sm border border-hairline p-1.5">
              <MessageSquare size={14} strokeWidth={1.5} />
            </span>
          ))}
        {/* 실 NotificationBell 버튼은 패딩 없이 아이콘만(`flex items-center`) — 복제도 동일 폭으로 맞춘다
            (이전엔 p-1.5로 12px 과대측정, 강등이 실제보다 일찍 트리거됨) */}
        <span className="inline-flex items-center">
          <Bell size={16} strokeWidth={1.5} />
        </span>
        <span className="rounded-sm px-2 py-1 text-caption">{loggedIn ? userName : t("nav.login")}</span>
        <div className="inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
          {stage < 3
            ? (["ko", "en"] as const).map((code) => (
                // 라이브 활성 버튼은 font-semibold — 폭 관련 클래스라 클론도 대칭(활성 언어만)
                <span key={code} className={"rounded-xs px-1.5 py-0.5" + (lang === code ? " font-semibold" : "")}>
                  {code === "ko" ? t("nav.langKo") : t("nav.langEn")}
                </span>
              ))
            : (
                <span className="rounded-xs px-1.5 py-0.5 font-semibold">
                  {lang === "ko" ? t("nav.langKo") : t("nav.langEn")}
                </span>
              )}
        </div>
      </div>
    </>
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
  const [mode, setMode] = useState<AuthMode | null>(null);
  const feedbackOpen = useSyncExternalStore(
    subscribeFeedbackPanel,
    getFeedbackPanelOpen,
    () => false,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const measure0Ref = useRef<HTMLDivElement | null>(null);
  const measure1Ref = useRef<HTMLDivElement | null>(null);
  const measure2Ref = useRef<HTMLDivElement | null>(null);
  const measure3Ref = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState(0);
  const userName = user?.name ?? "";

  // 실측 4복제(S0~S3) 자연폭 vs nav 가용폭(clientWidth − px-4 32px) — 필터 모드 훅 선례
  // (app/page.tsx filterMode). deps는 폭에 영향을 주는 변수(언어·이름·활성 탭)만.
  useEffect(() => {
    const nav = navRef.current;
    const clones = [measure0Ref.current, measure1Ref.current, measure2Ref.current, measure3Ref.current];
    if (!nav || clones.some((c) => c === null)) return;
    const update = () => {
      setStage(
        pickDisplayStage(
          nav.clientWidth - 32,
          clones.map((c) => c?.scrollWidth ?? 0),
        ),
      );
    };
    // 최초 산정은 렌더 커밋 후로 이연 — 이펙트 본문 동기 setState 린트 회피(react-hooks/set-state-in-effect).
    const raf = requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    for (const c of clones) if (c) ro.observe(c);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [lang, userName, tabIndex]);

  // 로그아웃 분기용 모드 — Providers·로그인 페이지와 캐시 공유(부팅당 1회만 fetch)
  useEffect(() => {
    let alive = true;
    void getCachedAuthMode().then((info) => {
      if (alive) setMode(info.mode);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 바깥 클릭 닫기 — 전체화면 오버레이는 페이지 호버를 가로채므로 document 리스너로 대체
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  const onLogout = async () => {
    setAutoLoginSkip();
    // 모드 미확정 시엔 가장 엄격한 keycloak 경로로 폴백(fetchAuthMode의 fail-closed 방침과 동일)
    if (mode === "ldap") {
      clearLdapToken();
      setAuthToken(null);
    } else if (mode === "dev") {
      storeDevUser(null);
      setDevUser(null);
    } else {
      // 로그아웃은 removeUser()만 하고 Keycloak SSO 세션은 살아있음 — /login 자동 재로그인 차단
      const { UserManager } = await import("oidc-client-ts");
      const mgr = new UserManager({
        authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
        client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
        redirect_uri: window.location.origin,
      });
      // "모든 세션 종료" 패널(/login)용 id_token 확보 — removeUser 후에는 사라지므로 먼저 저장
      const user = await mgr.getUser();
      if (user?.id_token) {
        saveSsoLogoutHint(user.id_token);
      }
      await mgr.removeUser();
    }
    setCurrentUser(null);
    router.replace("/login");
  };

  return (
    <nav
      ref={navRef}
      className="relative flex h-10 shrink-0 items-center justify-between border-b border-hairline bg-surface px-4"
    >
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
        {/* 3-way 전환 탭 — 피드백 패널 유형 세그먼트 디자인(회색 트랙 + 흰 활성 pill·아이콘 유지).
            S1+: 비활성은 아이콘만+title, 활성은 아이콘+라벨(IconPillFilter 문법 350ms 슬라이드) */}
        <div className="inline-flex gap-1 rounded-sm bg-surface-alt p-1 text-fine">
          {NAV_TABS.map((tab, i) => {
            const active = i === tabIndex;
            const Icon = tab.Icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                title={stage >= 1 && !active ? t(tab.labelKey) : undefined}
                className={
                  "inline-flex items-center justify-center rounded-xs px-2.5 py-1 transition-colors " +
                  (active ? "bg-surface text-accent shadow-sm" : "text-ink-secondary hover:text-ink")
                }
              >
                <Icon size={14} strokeWidth={1.5} />
                <span
                  className={
                    "overflow-hidden whitespace-nowrap transition-all duration-350 ease-smooth " +
                    (stage === 0 || active ? "ml-1 max-w-28 opacity-100" : "max-w-0 opacity-0")
                  }
                >
                  {t(tab.labelKey)}
                </span>
                {tab.href === "/inbox" && <InboxBadge />}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {/* 매뉴얼 진입 — 로그인 시에만 노출. 아이콘 링크(툴팁) */}
        {user && (
          <Tooltip label={t("manual.title")}>
            <Link
              href="/manual"
              aria-current={pathname.startsWith("/manual") ? "page" : undefined}
              className={
                "inline-flex rounded-sm border border-hairline p-1.5 " +
                (pathname.startsWith("/manual")
                  ? "bg-accent-tint text-accent"
                  : "text-ink-secondary hover:bg-surface-alt hover:text-ink")
              }
            >
              <BookOpen size={14} strokeWidth={1.5} />
            </Link>
          </Tooltip>
        )}
        {/* 피드백 진입 — 로그인 시에만 노출. 사이드 패널 오픈. S2+: 매뉴얼 아이콘 버튼과 동일 스타일로 강등 */}
        {user &&
          (stage >= 2 ? (
            <Tooltip label={t("feedback.button")}>
              <button
                type="button"
                aria-label={t("feedback.button")}
                onClick={openFeedbackPanel}
                className="inline-flex rounded-sm border border-hairline p-1.5 text-accent hover:bg-accent-tint"
              >
                <MessageSquare size={14} strokeWidth={1.5} />
              </button>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={openFeedbackPanel}
              className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-accent hover:bg-accent-tint"
            >
              <MessageSquare size={14} strokeWidth={1.5} />
              {t("feedback.button")}
            </button>
          ))}
        {/* 무조건 렌더 — 로컬(인증 비활성)은 user가 null이라 가드 시 벨이 안 뜬다. 서버는 TopNav 자체가 AuthGate 인증 후에만 노출 */}
        <NotificationBell />
        {user ? (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label={user.name}
              className="rounded-sm px-2 py-1 text-caption text-ink hover:bg-surface-alt"
              onClick={() => setOpen((v) => !v)}
            >
              {stage >= 4 ? (
                <Tooltip label={user.name}>
                  <span className="inline-flex">
                    <User size={16} strokeWidth={1.5} />
                  </span>
                </Tooltip>
              ) : (
                user.name
              )}
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
        {/* 한/영 세그먼트 토글 — 두 언어를 모두 노출하고 현재 언어를 accent-tint로 강조.
            S3+: 현재 언어 버튼 1개만, 클릭 시 반대 언어로 즉시 전환 */}
        <div className="inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
          {stage >= 3 ? (
            <Tooltip label={t(lang === "ko" ? "nav.langSwitchEn" : "nav.langSwitchKo")}>
              <button
                type="button"
                aria-label={t(lang === "ko" ? "nav.langSwitchEn" : "nav.langSwitchKo")}
                className="rounded-xs bg-accent-tint px-1.5 py-0.5 font-semibold text-accent"
                onClick={() => setLang(lang === "ko" ? "en" : "ko")}
              >
                {lang === "ko" ? t("nav.langKo") : t("nav.langEn")}
              </button>
            </Tooltip>
          ) : (
            (["ko", "en"] as const).map((code) => (
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
            ))
          )}
        </div>
      </div>
      <FeedbackSidePanel open={feedbackOpen} onClose={closeFeedbackPanel} />
      {/* 측정 복제 S0~S3 — 좌그룹+스페이서+우그룹 한 줄 자연폭. 비상호작용 스팬만(클론이
          폴링·포커스를 만들면 안 됨), 뱃지/벨은 정적 플레이스홀더. T9 교훈: 이 복제들 때문에
          nav.scrollWidth는 오염되므로 오버플로 검증은 가시 rect 기반이어야 한다.
          w-max 필수(T3 실측 발견): absolute+left-0만 있고 right가 없으면 containing block(nav 전체
          폭)에 대해 shrink-to-fit 계산되어, 좁은 뷰포트에서 자연폭이 nav 폭으로 클램프되어
          과소측정된다(진동 유발 위험) — width:max-content로 뷰포트 무관 고정.
          클리핑 래퍼 필수(코드리뷰 발견, T3 후속): w-max로 자연폭을 살리면 좁은 뷰포트에서 S0 클론이
          nav보다 넓어지고, visibility:hidden 박스도 조상의 스크롤 가능 오버플로엔 반영돼(페인트만
          숨김) 문서에 실제 가로 스크롤이 생긴다. nav 자체엔 overflow-hidden 금지 — 유저메뉴/벨
          드롭다운이 nav 40px 박스 아래로 나가야 한다. 대신 전용 래퍼(absolute inset-0
          overflow-hidden)로 클론 4개만 nav 크기에 시각적으로 가둔다. 클론 각자의 scrollWidth는
          자기 박스 자체의 내재 크기라 조상의 overflow-hidden 클리핑과 무관 — 측정치는 그대로 정확
          (실측 확인 완료). */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        {([0, 1, 2, 3] as const).map((s) => (
          <div
            key={s}
            ref={[measure0Ref, measure1Ref, measure2Ref, measure3Ref][s]}
            className="absolute left-0 top-0 flex w-max items-center"
          >
            <NavMeasureRow stage={s} lang={lang} userName={userName} activeIdx={tabIndex} loggedIn={user !== null} t={t} />
          </div>
        ))}
      </div>
    </nav>
  );
}

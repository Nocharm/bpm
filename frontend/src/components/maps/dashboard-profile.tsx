// 홈 대시보드 마스트헤드 — 내 프로필(아바타·이름·역할 칩·부서 경로·직전 로그인) + 빠른 액션. 아이콘만으로 뜻이 분명한
// 액션(알림·체계 설정·설정)은 아이콘 전용 + 호버 툴팁, "내 맵만" 필터는 라벨 유지 (사용자 지시 2026-09-11).
// 이동 버튼은 1클릭 지연 이동 — 마스트헤드 전체가 레이어로 덮이며 "…로 이동 중"이 뜨고 0.6초 뒤 이동, 레이어 클릭으로 취소.
"use client";

import { Bell, Building2, Clock, Filter, Layers, ShieldCheck, SlidersHorizontal } from "lucide-react";

import type { Me, MeDashboardActivity } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { useDelayedNav } from "@/lib/use-delayed-nav";
import { NavPendingScope } from "@/components/nav-pending-scope";
import { SkeletonLine } from "@/components/skeleton";
import { Tooltip } from "@/components/tooltip";

interface DashboardProfileProps {
  me: Me;
  activity: MeDashboardActivity | null; // 도착 전 null — 알림 배지·직전 로그인 자리는 스켈레톤
  onFilterMine: () => void; // 좌측 목록 권한 필터를 owner로
}

const ACTION_BASE =
  "inline-flex h-[30px] items-center rounded-sm border bg-surface text-[13px] text-ink-secondary hover:border-accent-tint-border hover:bg-accent-tint hover:text-accent-elevated";
const ACTION = `${ACTION_BASE} border-hairline gap-1.5 px-2.5`;
// 아이콘 전용 — 폭 고정, 패딩 없음(패딩과 고정 폭이 겹치면 svg가 눌려 작아진다)
const ICON_ACTION = `${ACTION_BASE} relative w-[30px] justify-center border-hairline`;

// 스코프(NavPendingScope) 안쪽이어야 useDelayedNav가 마스트헤드 레이어에 보고한다
export function DashboardProfile(props: DashboardProfileProps) {
  return (
    <NavPendingScope dataId="home-profile" className="flex items-center gap-3.5 rounded-sm px-1 pt-1">
      <ProfileBody {...props} />
    </NavPendingScope>
  );
}

function ProfileBody({ me, activity, onFilterMine }: DashboardProfileProps) {
  const { t } = useI18n();
  const segments = (me.org_path ?? "").split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? me.department;
  // 전체 경로는 필의 title로만 — 긴 경로가 이름 아래 한 줄을 차지하지 않게 말단만 필 (사용자 지시 2026-09-11)
  const fullPath = segments.join(" / ");
  const isFrameworkAdmin = (me.category_admin_root_ids?.length ?? 0) > 0;
  const unread = activity?.unread_notifications ?? 0;
  const { toggle } = useDelayedNav();
  const go = (href: string, dest: string) => toggle(href, t("home.dash.navGoing", { dest }));
  return (
    <>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-accent-tint-border bg-accent-tint text-body-strong text-accent-elevated">
        {(me.name || me.username).slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body-strong text-ink">{me.name || me.username}</span>
          <span className="shrink-0 text-fine text-ink-tertiary">{me.username}</span>
          {me.is_sysadmin && (
            <RoleChip label={t("home.dash.roleSysadmin")} icon={<ShieldCheck size={12} strokeWidth={1.5} />} />
          )}
          {isFrameworkAdmin && (
            <RoleChip label={t("home.dash.roleFrameworkAdmin")} icon={<Layers size={12} strokeWidth={1.5} />} />
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-tertiary">
          {leaf ? (
            <span
              data-id="home-profile-dept"
              title={fullPath || leaf}
              className="inline-flex h-5 min-w-0 max-w-64 items-center gap-1 rounded-full border border-hairline bg-surface-alt px-1.5 text-[11px] font-semibold text-ink-secondary"
            >
              <Building2 size={11} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">{leaf}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Building2 size={14} strokeWidth={1.5} className="shrink-0" />
              {t("home.dash.noDepartment")}
            </span>
          )}
          <span className="text-ink-muted">·</span>
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-ink-muted">
            <Clock size={14} strokeWidth={1.5} />
            {activity === null ? (
              <SkeletonLine className="w-20" />
            ) : activity.last_login_at ? (
              t("home.dash.lastLogin", { at: formatKst(activity.last_login_at) })
            ) : (
              t("home.dash.firstLogin")
            )}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button type="button" data-id="home-profile-mine" onClick={(e) => { e.stopPropagation(); onFilterMine(); }} className={ACTION}>
          <Filter size={16} strokeWidth={1.5} />
          {t("home.dash.myMapsOnly")}
        </button>
        <Tooltip label={t("home.dash.notifications")}>
          <button
            type="button"
            data-id="home-profile-inbox"
            aria-label={t("home.dash.notifications")}
            onClick={(e) => { e.stopPropagation(); go("/inbox", t("home.dash.destInbox")); }}
            className={ICON_ACTION}
          >
            <Bell size={16} strokeWidth={1.5} />
            <span
              data-id="home-profile-unread"
              className={`absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-on-accent ${unread > 0 ? "bg-accent" : "bg-surface-chip"}`}
            >
              {unread}
            </span>
          </button>
        </Tooltip>
        {isFrameworkAdmin && (
          <Tooltip label={t("home.dash.frameworkSettings")}>
            <button
              type="button"
              data-id="home-profile-framework"
              aria-label={t("home.dash.frameworkSettings")}
              onClick={(e) => { e.stopPropagation(); go("/settings?tab=framework", t("home.dash.frameworkSettings")); }}
              className={ICON_ACTION}
            >
              <Layers size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={t("home.dash.settings")}>
          <button
            type="button"
            data-id="home-profile-settings"
            aria-label={t("home.dash.settings")}
            onClick={(e) => { e.stopPropagation(); go("/settings", t("home.dash.settings")); }}
            className={ICON_ACTION}
          >
            <SlidersHorizontal size={16} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </>
  );
}

function RoleChip({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-accent-tint-border bg-accent-tint px-1.5 text-[11px] font-semibold text-accent-elevated">
      {icon}
      {label}
    </span>
  );
}

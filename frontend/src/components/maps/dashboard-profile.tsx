// 홈 대시보드 마스트헤드 — 내 프로필(아바타·이름·역할 칩·부서 경로·직전 로그인) + 빠른 액션. 아이콘만으로 뜻이 분명한
// 액션(알림·체계 설정·설정)은 아이콘 전용 + 호버 툴팁, "내 맵만" 필터는 라벨 유지 (사용자 지시 2026-09-11).
"use client";

import { Bell, Building2, Clock, Filter, Layers, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";

import type { Me, MeDashboardActivity } from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { useGoToMenu } from "@/components/maps/go-to-menu";
import { SkeletonLine } from "@/components/skeleton";
import { Tooltip } from "@/components/tooltip";

interface DashboardProfileProps {
  me: Me;
  activity: MeDashboardActivity | null; // 도착 전 null — 알림 배지·직전 로그인 자리는 스켈레톤
  onFilterMine: () => void; // 좌측 목록 권한 필터를 owner로
}

const ACTION_BASE =
  "inline-flex h-[30px] items-center rounded-sm border border-hairline bg-surface text-[13px] text-ink-secondary hover:border-accent-tint-border hover:bg-accent-tint hover:text-accent-elevated";
const ACTION = `${ACTION_BASE} gap-1.5 px-2.5`;
// 아이콘 전용 — 폭 고정, 패딩 없음(패딩과 고정 폭이 겹치면 svg가 눌려 작아진다)
const ICON_ACTION = `${ACTION_BASE} relative w-[30px] justify-center`;

export function DashboardProfile({ me, activity, onFilterMine }: DashboardProfileProps) {
  const { t } = useI18n();
  const router = useRouter();
  const segments = (me.org_path ?? "").split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? me.department;
  const parents = segments.slice(0, -1).join(" / ");
  const isFrameworkAdmin = (me.category_admin_root_ids?.length ?? 0) > 0;
  const unread = activity?.unread_notifications ?? 0;
  // 알림은 이동 메뉴를 거치고, 설정·체계 설정은 바로 이동 (사용자 지시 2026-09-11)
  const { menu, openAt } = useGoToMenu();
  return (
    <div data-id="home-profile" className="flex items-center gap-3.5 px-1 pt-1">
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
          <Building2 size={14} strokeWidth={1.5} className="shrink-0" />
          {leaf ? (
            <span className="truncate">
              {parents && <>{parents} / </>}
              <span className="font-semibold text-ink-secondary">{leaf}</span>
            </span>
          ) : (
            <span>{t("home.dash.noDepartment")}</span>
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
          <button type="button" data-id="home-profile-inbox" aria-label={t("home.dash.notifications")} onClick={(e) => openAt(e, [{ label: t("home.dash.goInbox"), onSelect: () => router.push("/inbox") }])} className={ICON_ACTION}>
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
            <button type="button" data-id="home-profile-framework" aria-label={t("home.dash.frameworkSettings")} onClick={() => router.push("/settings?tab=framework")} className={ICON_ACTION}>
              <Layers size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={t("home.dash.settings")}>
          <button type="button" data-id="home-profile-settings" aria-label={t("home.dash.settings")} onClick={() => router.push("/settings")} className={ICON_ACTION}>
            <SlidersHorizontal size={16} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
      {menu}
    </div>
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

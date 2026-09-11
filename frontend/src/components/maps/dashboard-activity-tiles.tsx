// 홈 대시보드 활동 타일 5종 — 결재 대기·내가 낸 요청·점유 중 버전·미읽음 알림·내 피드백. 0도 숨기지 않고 뮤트.
// 점유 타일은 클릭 시 아래로 점유 목록을 펼친다. 페이지 이동 타일은 1클릭 지연 이동 — 타일이 카운트다운 링으로 바뀌고 1초 뒤
// 이동, 그 사이 다시 클릭하면 취소(실수 클릭 복귀, 사용자 지시 2026-09-11).
"use client";

import { Bell, Inbox, Lock, MessageSquare, Send } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import type { MeDashboard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAgo } from "@/lib/use-ago";
import { useDelayedNav } from "@/lib/use-delayed-nav";
import { HoverLinkedRow } from "@/components/maps/dashboard-hover-row";
import { NavRing } from "@/components/nav-ring";
import { SkeletonBlock, SkeletonLine } from "@/components/skeleton";

interface DashboardActivityTilesProps {
  data: MeDashboard | null; // 도착 전 null → 스켈레톤
  onSelect: (mapId: number) => void;
}

export function DashboardActivityTiles({ data, onSelect }: DashboardActivityTilesProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const [checkoutsOpen, setCheckoutsOpen] = useState(false);
  const { pending, toggle } = useDelayedNav();
  // 같은 목적지(인박스) 타일이 셋이라 href만으로는 어느 타일을 눌렀는지 모른다 — 클릭한 타일만 링으로 바꾼다
  const [clicked, setClicked] = useState<string | null>(null);
  const go = (tileId: string, href: string) => { setClicked(tileId); toggle(href); };
  const navText = (tileId: string, href: string, dest: string) =>
    pending === href && clicked === tileId ? t("home.dash.navPending", { dest }) : null;
  const inboxNav = (tileId: string) => navText(tileId, "/inbox", t("home.dash.destInbox"));
  if (data === null) {
    return (
      <div data-id="home-activity" className="grid grid-cols-5 gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-sm border border-hairline bg-surface px-3 py-2.5">
            <SkeletonLine className="w-3/5" />
            <SkeletonBlock className="h-6 w-8" />
            <SkeletonLine className="w-4/5" />
          </div>
        ))}
      </div>
    );
  }
  const a = data.activity;
  const waiting = data.checkouts.reduce((n, c) => n + c.waiting_requests, 0);
  return (
    <div data-id="home-activity" className="flex flex-col gap-2">
      <div className="grid grid-cols-5 gap-2">
        <Tile
          dataId="home-activity-approvals"
          icon={<Inbox size={14} strokeWidth={1.5} />}
          label={t("home.dash.tileApprovals")}
          value={a.approvals_pending}
          hot
          sub={a.approvals_pending > 0 ? t("home.dash.tileApprovalsSub") : t("home.dash.tileApprovalsNone")}
          navigating={inboxNav("home-activity-approvals")}
          onClick={() => go("home-activity-approvals", "/inbox")}
        />
        <Tile
          dataId="home-activity-requests"
          icon={<Send size={14} strokeWidth={1.5} />}
          label={t("home.dash.tileRequests")}
          value={a.requests_pending}
          sub={a.requests_pending > 0 ? t("home.dash.tileRequestsSub") : t("home.dash.tileRequestsNone")}
          navigating={inboxNav("home-activity-requests")}
          onClick={() => go("home-activity-requests", "/inbox")}
        />
        <Tile
          dataId="home-activity-checkouts"
          icon={<Lock size={14} strokeWidth={1.5} />}
          label={t("home.dash.tileCheckouts")}
          value={a.checkouts_held}
          sub={
            a.checkouts_held === 0
              ? t("home.dash.tileCheckoutsNone")
              : waiting > 0
                ? t("home.dash.tileCheckoutsWaiting", { n: waiting })
                : t("home.dash.tileCheckoutsSub")
          }
          warn={waiting > 0}
          pressed={checkoutsOpen}
          onClick={a.checkouts_held > 0 ? () => setCheckoutsOpen((v) => !v) : undefined}
        />
        <Tile
          dataId="home-activity-unread"
          icon={<Bell size={14} strokeWidth={1.5} />}
          label={t("home.dash.tileUnread")}
          value={a.unread_notifications}
          sub={a.unread_notifications > 0 ? t("home.dash.tileUnreadSub") : t("home.dash.tileUnreadNone")}
          navigating={inboxNav("home-activity-unread")}
          onClick={() => go("home-activity-unread", "/inbox")}
        />
        <Tile
          dataId="home-activity-feedback"
          icon={<MessageSquare size={14} strokeWidth={1.5} />}
          label={t("home.dash.tileFeedback")}
          value={a.feedback_mine}
          sub={
            a.feedback_mine === 0
              ? t("home.dash.tileFeedbackNone")
              : a.feedback_mine_open > 0
                ? t("home.dash.tileFeedbackOpen", { n: a.feedback_mine_open })
                : t("home.dash.tileFeedbackDone")
          }
          navigating={navText("home-activity-feedback", "/feedback", t("home.dash.destFeedback"))}
          onClick={() => go("home-activity-feedback", "/feedback")}
        />
      </div>
      {checkoutsOpen && data.checkouts.length > 0 && (
        <ul data-id="home-activity-checkout-list" className="flex flex-col rounded-sm border border-hairline bg-surface">
          {data.checkouts.map((c) => (
            <li key={c.version_id}>
              <HoverLinkedRow
                mapId={c.map_id}
                onClick={() => onSelect(c.map_id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left [li+li>&]:border-t [li+li>&]:border-divider"
              >
                <Lock size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                <span className="min-w-0 flex-1 truncate text-caption text-ink">{c.map_name}</span>
                <span className="shrink-0 text-fine text-ink-tertiary">{c.version_number != null ? `v${c.version_number}` : c.version_label}</span>
                {c.waiting_requests > 0 && (
                  <span className="shrink-0 text-fine font-semibold text-warn">{t("home.dash.checkoutWaiting", { n: c.waiting_requests })}</span>
                )}
                <span className="shrink-0 text-fine text-ink-tertiary">{ago(c.checked_out_at)}</span>
              </HoverLinkedRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TileProps {
  dataId: string;
  icon: ReactNode;
  label: string;
  value: number;
  sub: string;
  hot?: boolean; // 0 초과일 때 액센트 강조(내 결정 필요)
  warn?: boolean; // 보조 문구 경고색
  pressed?: boolean;
  navigating?: string | null; // 지연 이동 대기 중 — 아이콘은 링, 보조 문구는 이 값(취소 안내)
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}

function Tile({ dataId, icon, label, value, sub, hot, warn, pressed, navigating, onClick }: TileProps) {
  const zero = value === 0;
  const active = pressed || Boolean(navigating);
  const cls = `flex min-w-0 flex-col gap-1.5 rounded-sm border bg-surface px-3 py-2.5 text-left transition-[border-color,box-shadow] duration-150 ease-smooth ${
    active ? "border-accent-tint-border shadow-sm" : "border-hairline"
  } ${onClick ? "hover:border-accent-tint-border hover:shadow-sm" : "cursor-default"}`;
  const inner = (
    <>
      <span className="inline-flex items-center gap-1.5 truncate text-fine text-ink-tertiary">
        {navigating ? <NavRing size={14} /> : icon}
        {label}
      </span>
      <span className={`text-tagline tabular-nums ${zero ? "font-light text-ink-muted" : hot ? "text-accent-elevated" : "text-ink"}`}>{value}</span>
      <span className={`truncate text-[11px] ${navigating ? "text-accent" : warn ? "text-warn" : "text-ink-tertiary"}`}>{navigating ?? sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" data-id={dataId} aria-pressed={pressed} data-navigating={navigating ? "" : undefined} onClick={(e) => { e.stopPropagation(); onClick(e); }} className={cls}>
      {inner}
    </button>
  ) : (
    <div data-id={dataId} className={cls}>{inner}</div>
  );
}

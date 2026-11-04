// 홈 대시보드 활동 타일 5종 — 결재 대기·내가 낸 요청·Check out 중 버전·진행 중 실행·알림 · 피드백. 0도 숨기지 않고 뮤트.
// Check out·진행 중 실행·알림 · 피드백 타일은 누르면 타일 줄 아래로 목록을 아코디언으로 펼친다(한 번에 하나, 접힘 고스트는 useClosingKeys,
// design 2026-11-04 §4.8). 페이지 이동 타일은 1클릭 지연 이동 — 누른 타일 한 칸만 레이어로 덮이며 가운데에 링 + "…로 이동 중"이 뜨고,
// 레이어를 클릭하면 취소(실수 클릭 복귀, 사용자 지시 2026-09-18). 타일로 칸을 접거나 바꾸면 대기 중인 이동도 취소된다.
"use client";

import { Bell, Globe, Inbox, ListChecks, Lock, Send } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import type { MeDashboard } from "@/lib/api";
import { loadHomeListPrefs, saveHomeListPrefs, type HomeListPrefs } from "@/lib/home-list-prefs";
import { useI18n } from "@/lib/i18n";
import { useAgo } from "@/lib/use-ago";
import { useClosingKeys } from "@/lib/use-closing-keys";
import { cancelActiveDelayedNav, useDelayedNav } from "@/lib/use-delayed-nav";
import { DashboardInboxPanel } from "@/components/maps/dashboard-inbox-panel";
import { DashboardRunPanel } from "@/components/maps/dashboard-run-panel";
import { HoverLinkedRow } from "@/components/maps/dashboard-hover-row";
import { NavPendingScope } from "@/components/nav-pending-scope";
import { SkeletonBlock, SkeletonLine } from "@/components/skeleton";

type PanelKey = "checkouts" | "runs" | "inbox";

interface DashboardActivityTilesProps {
  data: MeDashboard | null; // 도착 전 null → 스켈레톤
  unread: number; // 알림 · 피드백 타일 수 — 홈 대시보드가 프로필 배지와 같은 값으로 내려 준다
  onUnreadChange: (n: number) => void; // 알림 칸이 읽어 온·읽음 처리한 미읽음 수를 위로 올린다
  onSelect: (mapId: number) => void;
}

export function DashboardActivityTiles({ data, unread, onUnreadChange, onSelect }: DashboardActivityTilesProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const [open, setOpen] = useState<PanelKey | null>(null);
  // 펼침 목록의 거르기·정렬 — 브라우저에 기억(펼침 여부는 기억하지 않는다)
  const [prefs, setPrefs] = useState<HomeListPrefs>(loadHomeListPrefs);
  const { closingKeys, beginClose, cancelClose, getSectionClass } = useClosingKeys<PanelKey>();
  const togglePanel = (key: PanelKey) => {
    cancelActiveDelayedNav();
    if (open !== null) beginClose(open);
    if (open === key) {
      setOpen(null);
      return;
    }
    cancelClose(key);
    setOpen(key);
  };
  const updatePrefs = (next: HomeListPrefs) => {
    setPrefs(next);
    saveHomeListPrefs(next);
  };
  const isShown = (key: PanelKey) => open === key || closingKeys.has(key);
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
      <TileGrid a={a} waiting={waiting} unread={unread} open={open} onToggle={togglePanel} />
      {isShown("checkouts") && data.checkouts.length > 0 && (
        <div className={getSectionClass("checkouts")}>
        <NavPendingScope className="rounded-sm">
        <ul data-id="home-activity-checkout-list" className="flex flex-col rounded-sm border border-hairline bg-surface">
          {data.checkouts.map((c) => (
            <li key={c.version_id}>
              <HoverLinkedRow
                mapId={c.map_id}
                onClick={() => onSelect(c.map_id)}
                pendingLabel={t("home.dash.selectingMap", { name: c.map_name })}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left [li+li>&]:border-t [li+li>&]:border-divider"
                leading={
                  c.visibility === "public" ? (
                    <Globe size={14} strokeWidth={1.5} className="shrink-0 text-accent" aria-label={t("perm.visibilityPublic")} />
                  ) : (
                    <Lock size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" aria-label={t("perm.visibilityPrivate")} />
                  )
                }
              >
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
        </NavPendingScope>
        </div>
      )}
      {isShown("runs") && (
        <div className={getSectionClass("runs")}>
          <DashboardRunPanel runs={data.runs} prefs={prefs} onPrefs={updatePrefs} />
        </div>
      )}
      {isShown("inbox") && (
        <div className={getSectionClass("inbox")}>
          <DashboardInboxPanel prefs={prefs} onPrefs={updatePrefs} onUnreadChange={onUnreadChange} />
        </div>
      )}
    </div>
  );
}

interface TileGridProps {
  a: MeDashboard["activity"];
  waiting: number;
  unread: number;
  open: PanelKey | null;
  onToggle: (key: PanelKey) => void;
}

function TileGrid({ a, waiting, unread, open, onToggle }: TileGridProps) {
  const { t } = useI18n();
  const inbox = { href: "/inbox", label: t("home.dash.navGoing", { dest: t("home.dash.destInbox") }) };
  // Check out·실행 타일은 0이면 펼치지 않는다(펼친 채 0이 되면 다시 눌러 접을 수 있게 둔다). 알림 · 피드백 타일은 읽은 알림(전체 필)과
  // 내 피드백도 보여 주므로 수와 상관없이 늘 펼친다(R34)
  const toggleFor = (key: PanelKey, value: number) => (value > 0 || open === key ? () => onToggle(key) : undefined);
  const runIssues = a.runs_problem + a.runs_idle;
  return (
    <div className="grid grid-cols-5 gap-2">
      <Tile
        dataId="home-activity-approvals"
        icon={<Inbox size={14} strokeWidth={1.5} />}
        label={t("home.dash.tileApprovals")}
        value={a.approvals_pending}
        hot
        sub={a.approvals_pending > 0 ? t("home.dash.tileApprovalsSub") : t("home.dash.tileApprovalsNone")}
        nav={inbox}
      />
      <Tile
        dataId="home-activity-requests"
        icon={<Send size={14} strokeWidth={1.5} />}
        label={t("home.dash.tileRequests")}
        value={a.requests_pending}
        sub={a.requests_pending > 0 ? t("home.dash.tileRequestsSub") : t("home.dash.tileRequestsNone")}
        nav={inbox}
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
        pressed={open === "checkouts"}
        onClick={toggleFor("checkouts", a.checkouts_held)}
      />
      <Tile
        dataId="home-activity-runs"
        icon={<ListChecks size={14} strokeWidth={1.5} />}
        label={t("home.dash.tileRuns")}
        value={a.runs_open}
        sub={
          a.runs_open === 0
            ? t("home.dash.tileRunsNone")
            : runIssues > 0
              ? t("home.dash.tileRunsSub", { p: a.runs_problem, i: a.runs_idle })
              : t("home.dash.tileRunsCalm")
        }
        warn={runIssues > 0}
        pressed={open === "runs"}
        onClick={toggleFor("runs", a.runs_open)}
      />
      <Tile
        dataId="home-activity-inbox"
        icon={<Bell size={14} strokeWidth={1.5} />}
        label={t("home.dash.tileInbox")}
        value={unread}
        unit={t("home.dash.tileInboxUnit")}
        sub={t("home.dash.tileInboxSub", { n: a.feedback_mine_open })}
        pressed={open === "inbox"}
        onClick={() => onToggle("inbox")}
      />
    </div>
  );
}

interface TileProps {
  dataId: string;
  icon: ReactNode;
  label: string;
  value: number;
  unit?: string; // 숫자 옆 작은 단위 글씨("미읽음")
  sub: string;
  hot?: boolean; // 0 초과일 때 액센트 강조(내 결정 필요)
  warn?: boolean; // 보조 문구 경고색
  pressed?: boolean; // 아래 목록을 펼친 타일 — 틴트 배경
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void; // 즉시 동작(아래 목록 펼침)
  nav?: { href: string; label: string }; // 지연 페이지 이동 — 타일 한 칸이 스코프가 되어 자기 위에 레이어를 띄운다
}

function Tile(props: TileProps) {
  if (!props.nav) return <TileBody {...props} />;
  return (
    <NavPendingScope compact className="flex min-w-0 rounded-sm">
      <NavTile {...props} nav={props.nav} />
    </NavPendingScope>
  );
}

// 스코프 안쪽에서 훅을 돌려야 이 타일의 레이어에 보고된다
function NavTile({ nav, ...rest }: TileProps & { nav: { href: string; label: string } }) {
  const { toggle } = useDelayedNav();
  return <TileBody {...rest} onClick={() => toggle(nav.href, nav.label)} />;
}

function TileBody({ dataId, icon, label, value, unit, sub, hot, warn, pressed, onClick }: TileProps) {
  const zero = value === 0;
  const cls = `flex w-full min-w-0 flex-col gap-1.5 rounded-sm border px-3 py-2.5 text-left transition-[border-color,box-shadow,background-color] duration-150 ease-smooth ${
    pressed ? "border-accent-tint-border bg-accent-tint shadow-sm" : "border-hairline bg-surface"
  } ${onClick ? "hover:border-accent-tint-border hover:shadow-sm" : "cursor-default"}`;
  const inner = (
    <>
      <span className="inline-flex items-center gap-1.5 truncate text-fine text-ink-tertiary">
        {icon}
        {label}
      </span>
      <span className={`text-tagline tabular-nums ${zero ? "font-light text-ink-muted" : hot ? "text-accent-elevated" : "text-ink"}`}>
        {value}
        {unit && <span className="ml-1 text-fine font-normal text-ink-tertiary">{unit}</span>}
      </span>
      <span className={`truncate text-[11px] ${warn ? "text-warn" : "text-ink-tertiary"}`}>{sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" data-id={dataId} aria-pressed={pressed} onClick={(e) => { e.stopPropagation(); onClick(e); }} className={cls}>
      {inner}
    </button>
  ) : (
    <div data-id={dataId} className={cls}>{inner}</div>
  );
}

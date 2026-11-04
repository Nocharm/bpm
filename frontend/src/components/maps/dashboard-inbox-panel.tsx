// 홈 대시보드 "알림 · 피드백" 펼침 칸 — 왼쪽 알림(미읽음·전체 필 + 종류 메뉴), 오른쪽 내 피드백(진행 중·전체 필 + 종류 메뉴).
// 펼칠 때 기존 API로 읽는다. 줄·아래 링크는 0.6초 지연 이동(누른 쪽 칸만 레이어로 덮고 레이어 클릭 = 취소), 알림 읽음은 실제로 이동할 때 바꾼다.
// "모두 읽음"·"+ 새 피드백"·거르기는 바로 된다. 칸이 좁으면 위아래로 쌓인다. 활동 타일이 펼친다 (design 2026-11-04 §4.8).
"use client";

import { CircleDashed, List, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  listFeedback,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type FeedbackItem,
  type FeedbackKind,
  type NotificationItem,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { formatKstShort } from "@/lib/datetime";
import { FEEDBACK_KIND_LABEL, FEEDBACK_KIND_STYLE, FEEDBACK_KINDS, FEEDBACK_STATUS_LABEL, FEEDBACK_STATUS_STYLE } from "@/lib/feedback-meta";
import { openFeedbackPanel } from "@/lib/feedback-panel";
import { getFeedbackUpdatedAt, selectMyFeedback, type HomeListPrefs } from "@/lib/home-list-prefs";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { getNotificationCategory, NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notification-categories";
import { formatNotification, getRunNotificationHref, isRunNotificationInTrash } from "@/lib/notification-format";
import { useAgo } from "@/lib/use-ago";
import { useDelayedNav } from "@/lib/use-delayed-nav";
import { IconPillFilter } from "@/components/icon-pill-filter";
import { MenuSelect } from "@/components/menu-select";
import { NavPendingScope } from "@/components/nav-pending-scope";
import { RunTrashChip } from "@/components/run/run-trash-chip";
import { SkeletonLine } from "@/components/skeleton";

const LIST_LIMIT = 20; // 칸마다 보이는 줄 상한 — 나머지는 알림 탭·피드백 화면에서

const CATEGORY_LABEL: Record<NotificationCategory, MessageKey> = {
  run: "inbox.cat.run",
  version: "inbox.cat.version",
  checkout: "inbox.cat.checkout",
  permission: "inbox.cat.permission",
  subprocess: "inbox.cat.subprocess",
  notice: "inbox.cat.notice",
};

const NOTI_CAT_VALUES: (NotificationCategory | "all")[] = ["all", ...NOTIFICATION_CATEGORIES];
const FB_KIND_VALUES: (FeedbackKind | "all")[] = ["all", ...FEEDBACK_KINDS];

const ROW_CLASS =
  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-left transition-colors duration-150 enabled:hover:bg-surface-pearl [li+li>&]:border-t [li+li>&]:border-divider";
const LINK_CLASS = "whitespace-nowrap text-accent hover:underline disabled:text-ink-muted disabled:no-underline";

interface DashboardInboxPanelProps {
  prefs: HomeListPrefs;
  onPrefs: (prefs: HomeListPrefs) => void;
  onUnreadChange: (n: number) => void; // 타일의 미읽음 수를 목록과 맞춘다(읽어 온 뒤·읽음 처리 뒤)
}

export function DashboardInboxPanel({ prefs, onPrefs, onUnreadChange }: DashboardInboxPanelProps) {
  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null);
  const [notiError, setNotiError] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null);
  const [feedbackError, setFeedbackError] = useState(false);
  const [readAllError, setReadAllError] = useState(false);
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const reportUnread = useEffectEvent((items: NotificationItem[]) => onUnreadChange(countUnread(items)));

  // 펼칠 때마다 새로 읽는다(접으면 언마운트) — 두 목록은 따로 실패한다
  useEffect(() => {
    let alive = true;
    listNotifications()
      .then((items) => {
        if (!alive) return;
        setNotifications(items);
        reportUnread(items);
      })
      .catch(() => {
        if (alive) setNotiError(true);
      });
    listFeedback()
      .then((list) => {
        if (alive) setFeedback(list.items);
      })
      .catch(() => {
        if (alive) setFeedbackError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 이동이 확정된 알림만 읽음으로 — 서버 반영은 이동과 같이 나가고, 실패해도 인박스 딥링크가 다시 읽음 처리한다
  const markRead = (id: number) => {
    if (!notifications) return;
    const next = notifications.map((item) => (item.id === id ? { ...item, read: true } : item));
    setNotifications(next);
    onUnreadChange(countUnread(next));
    markNotificationRead(id).catch((error: unknown) => console.warn("markNotificationRead failed", { id, error }));
  };

  const readAll = async () => {
    setReadAllError(false);
    try {
      await markAllNotificationsRead();
    } catch {
      setReadAllError(true);
      return;
    }
    setNotifications((prev) => prev?.map((item) => ({ ...item, read: true })) ?? prev);
    onUnreadChange(0);
  };

  return (
    <div
      data-id="home-inbox-panel"
      className="grid grid-cols-1 rounded-sm border border-accent-tint-border bg-surface @[36rem]:grid-cols-2"
    >
      <NavPendingScope dataId="home-inbox-noti" className="flex min-w-0 flex-col">
        <NotificationColumn
          items={notifications}
          error={notiError}
          prefs={prefs}
          onPrefs={onPrefs}
          onRead={markRead}
          onReadAll={() => void readAll()}
          readAllError={readAllError}
        />
      </NavPendingScope>
      <NavPendingScope
        dataId="home-inbox-feedback"
        className="flex min-w-0 flex-col border-t border-hairline @[36rem]:border-l @[36rem]:border-t-0"
      >
        <FeedbackColumn
          items={feedback ? selectMyFeedback(feedback, user?.loginId ?? "") : null}
          error={feedbackError}
          prefs={prefs}
          onPrefs={onPrefs}
        />
      </NavPendingScope>
    </div>
  );
}

function countUnread(items: NotificationItem[]): number {
  return items.filter((item) => !item.read).length;
}

interface NotificationColumnProps {
  items: NotificationItem[] | null; // null = 읽는 중
  error: boolean;
  prefs: HomeListPrefs;
  onPrefs: (prefs: HomeListPrefs) => void;
  onRead: (id: number) => void;
  onReadAll: () => void;
  readAllError: boolean;
}

// 스코프 안쪽에서 훅을 돌려야 이 칸(왼쪽)의 레이어에 보고된다
function NotificationColumn({ items, error, prefs, onPrefs, onRead, onReadAll, readAllError }: NotificationColumnProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const router = useRouter();
  const { pending, toggle, toggleAction } = useDelayedNav();
  const inCategory = (items ?? []).filter(
    (item) => prefs.notiCat === "all" || getNotificationCategory(item.type) === prefs.notiCat,
  );
  const unreadInCategory = inCategory.filter((item) => !item.read);
  const shown = (prefs.notiRead === "unread" ? unreadInCategory : inCategory).slice(0, LIST_LIMIT);
  const hasUnread = (items ?? []).some((item) => !item.read);

  const open = (item: NotificationItem) => {
    const runHref = getRunNotificationHref(item);
    const href = runHref ?? `/inbox?notification=${item.id}`;
    const key = `notification:${item.id}`;
    if (pending !== key) router.prefetch(href);
    const dest = t(runHref ? "home.dash.destRun" : "home.dash.destInbox");
    toggleAction(
      key,
      () => {
        if (!item.read) onRead(item.id);
        router.push(href);
      },
      t("home.dash.navGoing", { dest }),
    );
  };

  return (
    <>
      <ColumnBar
        title={t("home.dash.inbox.notiTitle")}
        pills={
          <IconPillFilter
            dataId="home-inbox-noti-read"
            options={[
              { value: "unread", label: t("home.dash.inbox.unread"), Icon: Mail, count: unreadInCategory.length },
              { value: "all", label: t("home.dash.inbox.all"), Icon: List, count: inCategory.length },
            ]}
            value={prefs.notiRead}
            onChange={(notiRead) => onPrefs({ ...prefs, notiRead })}
          />
        }
        menu={
          <MenuSelect
            dataId="home-inbox-noti-kind"
            value={prefs.notiCat}
            items={NOTI_CAT_VALUES.map((cat) => ({
              value: cat,
              label: t(cat === "all" ? "home.dash.inbox.kindAll" : CATEGORY_LABEL[cat]),
            }))}
            leading={<span className="text-ink-tertiary">{t("home.dash.inbox.kindLabel")}</span>}
            onChange={(value) => {
              const notiCat = NOTI_CAT_VALUES.find((cat) => cat === value);
              if (notiCat) onPrefs({ ...prefs, notiCat });
            }}
          />
        }
      />
      <ColumnList
        dataId="home-inbox-noti-list"
        loading={items === null && !error}
        error={error}
        empty={
          shown.length === 0
            ? t(prefs.notiRead === "unread" ? "home.dash.inbox.notiEmptyUnread" : "home.dash.inbox.notiEmpty")
            : null
        }
      >
        {shown.map((item) => {
          const view = formatNotification(item, t);
          const category = getNotificationCategory(item.type);
          const selecting = pending === `notification:${item.id}`;
          // 맵이 휴지통인 실행 알림 — 열 실행이 없어 줄을 끄고 흐리게(복구하면 다시 열린다)
          const inTrash = isRunNotificationInTrash(item);
          return (
            <li key={item.id}>
              <button
                type="button"
                data-id={`home-inbox-noti-row-${item.id}`}
                data-unread={!item.read || undefined}
                data-selecting={selecting || undefined}
                disabled={inTrash}
                title={inTrash ? t("notif.runInTrashHint") : undefined}
                onClick={() => open(item)}
                className={`${ROW_CLASS} ${selecting ? "bg-accent-tint/40" : ""} ${inTrash ? "opacity-60" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {!item.read && (
                    <span role="img" aria-label={t("home.dash.inbox.unreadDot")} className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  )}
                  {category && (
                    <span
                      className={`shrink-0 rounded-xs px-1 text-[10px] font-semibold leading-4 ${
                        category === "run" ? "bg-accent-tint text-accent" : "bg-surface-alt text-ink-tertiary"
                      }`}
                    >
                      {t(CATEGORY_LABEL[category])}
                    </span>
                  )}
                  <span className={`min-w-0 truncate text-caption ${item.read ? "text-ink-secondary" : "font-semibold text-ink"}`}>
                    {view.title}
                  </span>
                  {inTrash && <RunTrashChip dataId={`home-inbox-noti-trash-${item.id}`} />}
                </span>
                <span title={formatKstShort(item.created_at)} className="row-span-2 self-start text-fine tabular-nums text-ink-tertiary">
                  {ago(item.created_at)}
                </span>
                {view.body && <span className="min-w-0 truncate text-fine text-ink-tertiary">{view.body}</span>}
              </button>
            </li>
          );
        })}
      </ColumnList>
      {readAllError && <p className="px-3 pt-1 text-fine text-error">{t("home.dash.inbox.readAllError")}</p>}
      <ColumnFoot>
        <button type="button" data-id="home-inbox-read-all" disabled={!hasUnread} onClick={onReadAll} className={LINK_CLASS}>
          {t("home.dash.inbox.readAll")}
        </button>
        <button
          type="button"
          data-id="home-inbox-go-inbox"
          onClick={() => toggle("/inbox", t("home.dash.navGoing", { dest: t("home.dash.destInbox") }))}
          className={LINK_CLASS}
        >
          {t("home.dash.inbox.goInbox")}
        </button>
      </ColumnFoot>
    </>
  );
}

interface FeedbackColumnProps {
  items: FeedbackItem[] | null; // 내 피드백(최근 갱신 순), null = 읽는 중
  error: boolean;
  prefs: HomeListPrefs;
  onPrefs: (prefs: HomeListPrefs) => void;
}

// 스코프 안쪽에서 훅을 돌려야 이 칸(오른쪽)의 레이어에 보고된다
function FeedbackColumn({ items, error, prefs, onPrefs }: FeedbackColumnProps) {
  const { t } = useI18n();
  const ago = useAgo();
  const { pending, toggle } = useDelayedNav();
  const ofKind = (items ?? []).filter((item) => prefs.fbKind === "all" || item.kind === prefs.fbKind);
  const openOfKind = ofKind.filter((item) => item.status !== "done");
  const shown = (prefs.fbStatus === "open" ? openOfKind : ofKind).slice(0, LIST_LIMIT);
  const detailLabel = t("home.dash.navGoing", { dest: t("home.dash.destFeedbackDetail") });

  return (
    <>
      <ColumnBar
        title={t("home.dash.inbox.fbTitle")}
        pills={
          <IconPillFilter
            dataId="home-inbox-fb-status"
            options={[
              { value: "open", label: t("home.dash.inbox.fbOpen"), Icon: CircleDashed, count: openOfKind.length },
              { value: "all", label: t("home.dash.inbox.all"), Icon: List, count: ofKind.length },
            ]}
            value={prefs.fbStatus}
            onChange={(fbStatus) => onPrefs({ ...prefs, fbStatus })}
          />
        }
        menu={
          <MenuSelect
            dataId="home-inbox-fb-kind"
            value={prefs.fbKind}
            items={FB_KIND_VALUES.map((kind) => ({
              value: kind,
              label: t(kind === "all" ? "home.dash.inbox.kindAll" : FEEDBACK_KIND_LABEL[kind]),
            }))}
            leading={<span className="text-ink-tertiary">{t("home.dash.inbox.kindLabel")}</span>}
            onChange={(value) => {
              const fbKind = FB_KIND_VALUES.find((kind) => kind === value);
              if (fbKind) onPrefs({ ...prefs, fbKind });
            }}
          />
        }
      />
      <ColumnList
        dataId="home-inbox-fb-list"
        loading={items === null && !error}
        error={error}
        empty={
          shown.length === 0 ? t((items ?? []).length === 0 ? "home.dash.inbox.fbNone" : "home.dash.inbox.fbEmpty") : null
        }
      >
        {shown.map((item) => {
          const href = `/feedback?feedback=${item.id}`;
          const selecting = pending === href;
          const updatedAt = getFeedbackUpdatedAt(item);
          return (
            <li key={item.id}>
              <button
                type="button"
                data-id={`home-inbox-fb-row-${item.id}`}
                data-selecting={selecting || undefined}
                onClick={() => toggle(href, detailLabel)}
                className={`${ROW_CLASS} ${selecting ? "bg-accent-tint/40" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`shrink-0 rounded-xs px-1 text-[10px] font-semibold leading-4 ${FEEDBACK_KIND_STYLE[item.kind]}`}>
                    {t(FEEDBACK_KIND_LABEL[item.kind])}
                  </span>
                  <span className="min-w-0 truncate text-caption text-ink">{item.body}</span>
                </span>
                <span
                  className={`row-span-2 shrink-0 rounded-xs px-1.5 text-[10px] font-semibold leading-4 ${FEEDBACK_STATUS_STYLE[item.status]}`}
                >
                  {t(FEEDBACK_STATUS_LABEL[item.status])}
                </span>
                <span title={formatKstShort(updatedAt)} className="min-w-0 truncate text-fine text-ink-tertiary">
                  {item.reply ? `${t("home.dash.inbox.fbReplied")} · ${ago(updatedAt)}` : ago(updatedAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ColumnList>
      <ColumnFoot>
        <button type="button" data-id="home-inbox-fb-new" onClick={openFeedbackPanel} className={LINK_CLASS}>
          {t("home.dash.inbox.fbNew")}
        </button>
        <button
          type="button"
          data-id="home-inbox-go-feedback"
          onClick={() => toggle("/feedback", t("home.dash.navGoing", { dest: t("home.dash.destFeedback") }))}
          className={LINK_CLASS}
        >
          {t("home.dash.inbox.goFeedback")}
        </button>
      </ColumnFoot>
    </>
  );
}

// 칸 머리 — 제목 + 거르기 필(왼쪽) · 종류 메뉴(오른쪽)
function ColumnBar({ title, pills, menu }: { title: string; pills: ReactNode; menu: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-2.5 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-caption-strong text-ink">{title}</span>
        {pills}
      </div>
      {menu}
    </div>
  );
}

interface ColumnListProps {
  dataId: string;
  loading: boolean;
  error: boolean;
  empty: string | null; // 거른 결과가 비었을 때 문구
  children: ReactNode;
}

function ColumnList({ dataId, loading, error, empty, children }: ColumnListProps) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div data-id={`${dataId}-loading`} className="flex flex-col gap-2 px-3 py-2.5">
        <SkeletonLine className="w-4/5" />
        <SkeletonLine className="w-3/5" />
        <SkeletonLine className="w-2/3" />
      </div>
    );
  }
  if (error) {
    return (
      <p data-id={`${dataId}-error`} className="px-3 py-4 text-center text-fine text-error">
        {t("home.dash.inbox.loadError")}
      </p>
    );
  }
  // 목록 높이는 화면 높이에 맞춰 줄인다 — 펼친 칸은 홈의 sticky 상단 안이라, 칸이 화면보다 길면 아래 링크(모두 읽음·새 피드백)가
  // 붙어 있는 동안 화면 밖에 남는다. 좁은 분할(두 목록이 위아래)은 목록 둘이 나눠 쓰고, 넓으면(@36rem 좌우) 하나 몫. 상한 15rem
  return (
    <ul
      data-id={dataId}
      className="max-h-[clamp(5rem,calc(50dvh_-_14rem),15rem)] overflow-y-auto @[36rem]:max-h-[clamp(5rem,calc(100dvh_-_24rem),15rem)]"
    >
      {empty !== null ? (
        <li data-id={`${dataId}-empty`} className="px-3 py-4 text-center text-fine text-ink-muted">
          {empty}
        </li>
      ) : (
        children
      )}
    </ul>
  );
}

function ColumnFoot({ children }: { children: ReactNode }) {
  return (
    <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline px-3 py-1.5 text-fine">
      {children}
    </div>
  );
}

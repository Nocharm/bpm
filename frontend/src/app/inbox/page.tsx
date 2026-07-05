"use client";

// 알림·승인 인박스 — 홈 폭. 탭(승인 대기/알림) + 알림 마스터-디테일(카드 목록·아이콘 필터). (design 2026-07-05)
// 공지 뷰어와 동일 레이아웃. 승인 대기 탭은 S7에서 구현.

import { Bell, Check, FileCheck, List, Mail, Megaphone, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { filterByQuery } from "@/lib/search";
import { useSlashFocus } from "@/lib/use-slash-focus";
import { IconPillFilter, type IconPillOption } from "@/components/icon-pill-filter";
import { SearchBox } from "@/components/search-box";
import { TimePills } from "@/components/time-pills";

type Tab = "approvals" | "notifications";
type ReadFilter = "all" | "unread";

const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "approvals", labelKey: "inbox.tabApprovals" },
  { id: "notifications", labelKey: "inbox.tabNotifications" },
];

// 알림 유형별 아이콘 — 공지/승인요청/기타
function typeIcon(type: string): LucideIcon {
  if (type === "notice") return Megaphone;
  if (type === "review_requested") return FileCheck;
  return Bell;
}

export default function InboxPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("notifications");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nowMs] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  useEffect(() => {
    let alive = true;
    listNotifications().then((data) => {
      if (alive) setItems(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const unread = items.filter((n) => !n.read).length;
  const byRead = readFilter === "unread" ? items.filter((n) => !n.read) : items;
  const filtered = filterByQuery(byRead, search, (n) => [
    { field: "message", text: n.message },
  ]).map((hit) => hit.item);
  const selected = items.find((n) => n.id === selectedId) ?? null;

  const openNotification = async (notification: NotificationItem) => {
    setSelectedId(notification.id);
    if (!notification.read) {
      const updated = await markNotificationRead(notification.id);
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    }
  };

  const markAll = async () => {
    await markAllNotificationsRead();
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
  };

  const filterOptions: IconPillOption<ReadFilter>[] = [
    { value: "all", label: t("inbox.filterAll"), Icon: List },
    { value: "unread", label: t("inbox.filterUnread"), Icon: Mail },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col px-8 py-6">
      <div className="mx-auto flex min-h-0 w-full max-w-[80rem] flex-1 flex-col gap-4">
        {/* 페이지 헤더 — 타이틀(좌) · 모두 읽음(우), 노티스 헤더와 정렬 */}
        <div className="flex shrink-0 items-center justify-between gap-4">
          <h1 className="text-tagline text-ink">Inbox</h1>
          {tab === "notifications" && unread > 0 && (
            <button
              type="button"
              onClick={() => void markAll()}
              className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt hover:text-ink"
            >
              <Check size={14} strokeWidth={1.5} />
              {t("inbox.markAllRead")}
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 gap-4">
          {/* 좌 목록 — 검색(상단) + 필터(좌)·탭(우) + 카드 */}
          <aside className="flex min-w-[18rem] flex-1 flex-col border-r border-hairline">
            <div className="flex flex-col gap-2 py-3 pr-3">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={t("inbox.searchPlaceholder")}
                inputRef={searchRef}
              />
              {/* All/안읽음 필터(좌) · 승인대기/알림 탭(우측정렬) 한 행 */}
              <div className="flex items-center justify-between gap-2">
                <IconPillFilter
                  options={filterOptions}
                  value={readFilter}
                  onChange={setReadFilter}
                />
                <div className="inline-grid grid-cols-2 gap-1 rounded-sm bg-surface-alt p-1 text-fine">
                  {TABS.map((tabDef) => {
                    const active = tab === tabDef.id;
                    return (
                      <button
                        key={tabDef.id}
                        type="button"
                        onClick={() => setTab(tabDef.id)}
                        className={
                          "inline-flex items-center justify-center gap-1 rounded-xs px-3 py-1 transition-colors " +
                          (active ? "bg-surface text-accent shadow-sm" : "text-ink-secondary hover:text-ink")
                        }
                      >
                        {t(tabDef.labelKey)}
                        {tabDef.id === "notifications" && unread > 0 && (
                          <span className="rounded-full bg-accent px-1 text-fine text-on-accent">
                            {unread}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {tab === "approvals" ? null : filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-caption text-ink-tertiary">
                {t("inbox.empty")}
              </p>
            ) : (
              <ul className="flex flex-1 flex-col gap-2 overflow-y-auto pr-3 pb-3">
                  {filtered.map((n) => {
                    const TypeIcon = typeIcon(n.type);
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => void openNotification(n)}
                          className={
                            "flex w-full flex-col gap-1.5 rounded-xs border border-hairline px-3 py-2.5 text-left " +
                            (n.id === selectedId
                              ? "border-l-2 border-l-accent bg-accent-tint"
                              : "bg-surface hover:bg-surface-alt")
                          }
                        >
                          {/* 유형 아이콘(좌) · 읽음(우) */}
                          <div className="flex items-center justify-between">
                            <TypeIcon size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                            {n.read ? (
                              <span className="text-fine text-ink-tertiary">
                                {t("notices.read")}
                              </span>
                            ) : (
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-accent"
                                aria-hidden
                              />
                            )}
                          </div>
                          <span
                            className={
                              "line-clamp-2 text-caption " +
                              (n.read ? "text-ink-tertiary" : "font-semibold text-ink")
                            }
                          >
                            {n.message}
                          </span>
                          <div className="flex justify-end gap-1">
                            <TimePills iso={n.created_at} nowMs={nowMs} />
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>
            {/* 우 상세 — 승인대기 탭은 준비 중 안내(S7) */}
            <div className="min-w-0 flex-[2] overflow-y-auto">
              {tab === "approvals" ? (
                <div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
                  {t("inbox.approvalsComingSoon")}
                </div>
              ) : selected ? (
                <article className="px-6 py-4">
                  <p className="whitespace-pre-wrap text-body text-ink">{selected.message}</p>
                  <p className="mt-2 text-fine text-ink-tertiary">
                    {formatKst(selected.created_at)}
                  </p>
                  {selected.map_id !== null && (
                    <Link
                      href={`/maps/${selected.map_id}`}
                      className="mt-4 inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
                    >
                      {t("inbox.relatedMap")}
                    </Link>
                  )}
                </article>
              ) : (
                <div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
                  {t("inbox.selectPrompt")}
                </div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
}

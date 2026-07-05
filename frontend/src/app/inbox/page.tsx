"use client";

// 알림·승인 인박스 — 홈 폭. 탭(승인 대기/알림) + 알림 마스터-디테일. (design 2026-07-05)
// 승인 대기 탭은 S7에서 구현.

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

type Tab = "approvals" | "notifications";

const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "approvals", labelKey: "inbox.tabApprovals" },
  { id: "notifications", labelKey: "inbox.tabNotifications" },
];

export default function InboxPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("notifications");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  return (
    <div className="flex h-full min-h-0 flex-col px-8 py-6">
      <div className="mx-auto flex min-h-0 w-full max-w-[80rem] flex-1 flex-col gap-4">
        {/* 탭 + 모두 읽음 */}
        <div className="flex items-center justify-between gap-4">
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

        {tab === "approvals" ? (
          <div className="flex flex-1 items-center justify-center text-caption text-ink-tertiary">
            {t("inbox.approvalsComingSoon")}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-4">
            {/* 좌 목록 */}
            <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-hairline">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-caption text-ink-tertiary">
                  {t("inbox.empty")}
                </p>
              ) : (
                <ul className="flex flex-col">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => void openNotification(n)}
                        className={
                          "flex w-full flex-col gap-1 border-b border-hairline px-4 py-3 text-left " +
                          (n.id === selectedId ? "bg-accent-tint" : "hover:bg-surface-alt")
                        }
                      >
                        <div className="flex items-start gap-2">
                          {!n.read && (
                            <span
                              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                              aria-hidden
                            />
                          )}
                          <span
                            className={
                              "line-clamp-2 text-caption " +
                              (n.read ? "text-ink-tertiary" : "font-semibold text-ink")
                            }
                          >
                            {n.message}
                          </span>
                        </div>
                        <span className="text-fine text-ink-tertiary">
                          {formatKst(n.created_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
            {/* 우 상세 */}
            <div className="min-w-0 flex-1 overflow-y-auto">
              {selected ? (
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
        )}
      </div>
    </div>
  );
}

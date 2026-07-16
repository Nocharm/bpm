"use client";

// 인앱 알림 벨 — 5초 폴링, 미읽음 점 + 드롭다운 (design 2026-06-14)
import { Bell, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { deleteNotification, listNotifications, markNotificationRead, type NotificationItem } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

const POLL_MS = 5000;

export function NotificationBell() {
  const { t } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 시 닫기 — context-menu.tsx와 동일 패턴 (열려 있을 때만 바인딩)
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  useEffect(() => {
    let alive = true;
    const fetchItems = async () => {
      try {
        const data = await listNotifications();
        if (alive) setItems(data);
      } catch {
        // 폴링 지속 — 일시 실패 무시
      }
    };
    void fetchItems();
    const id = setInterval(() => void fetchItems(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const unread = items.filter((item) => !item.read).length;
  // 25개씩 증분 렌더 — resetKey 상수라 5초 폴링(배열 교체)에도 로드 수 유지
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(items, "");

  const handleRead = async (id: number) => {
    try {
      await markNotificationRead(id);
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, read: true } : item)),
      );
    } catch {
      // 무시 — 다음 폴링에서 정합
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteNotification(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      // 무시 — 다음 폴링에서 정합
    }
  };

  const handleOpen = (id: number) => {
    setOpen(false);
    if (window.location.pathname === "/inbox") {
      // 같은 라우트에선 push가 리마운트를 안 일으켜 딥링크 소비(마운트 1회 effect)가 무동작 — 하드 네비게이션으로 강제
      window.location.assign(`/inbox?notification=${id}`);
      return;
    }
    router.push(`/inbox?notification=${id}`);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="relative flex items-center"
        aria-label={t("notif.title")}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} strokeWidth={1.5} className="text-ink-secondary" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-[1300] w-72 rounded-md bg-surface p-2 shadow-lg">
          <p className="px-1 pb-1 text-caption-strong text-ink">{t("notif.title")}</p>
          {items.length === 0 ? (
            <p className="px-1 py-2 text-fine text-ink-tertiary">{t("notif.empty")}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {visible.map((item) => (
                <li
                  key={item.id}
                  onClick={() => handleOpen(item.id)}
                  className={`flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1.5 text-caption hover:bg-surface-alt ${
                    item.read ? "text-ink-tertiary" : "text-ink"
                  }`}
                >
                  <span className="flex-1">{item.message}</span>
                  {!item.read && (
                    <button
                      type="button"
                      className="text-fine text-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRead(item.id);
                      }}
                    >
                      {t("notif.markRead")}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t("notif.delete")}
                    className="mt-0.5 shrink-0 text-ink-tertiary hover:text-error"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(item.id);
                    }}
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
              {hasMore && <li ref={sentinelRef} className="h-px" />}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

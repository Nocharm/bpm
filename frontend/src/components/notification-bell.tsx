"use client";

// 인앱 알림 벨 — 5초 폴링, 미읽음 점 + 드롭다운 (design 2026-06-14)
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { listNotifications, markNotificationRead, type NotificationItem } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const POLL_MS = 5000;

export function NotificationBell() {
  const { t } = useI18n();
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
        <div className="absolute right-0 top-7 z-50 w-72 rounded-md bg-surface p-2 shadow-lg">
          <p className="px-1 pb-1 text-caption-strong text-ink">{t("notif.title")}</p>
          {items.length === 0 ? (
            <p className="px-1 py-2 text-fine text-ink-tertiary">{t("notif.empty")}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`flex items-start gap-2 rounded-sm px-1 py-1.5 text-caption ${
                    item.read ? "text-ink-tertiary" : "text-ink"
                  }`}
                >
                  <span className="flex-1">{item.message}</span>
                  {!item.read && (
                    <button
                      type="button"
                      className="text-fine text-accent"
                      onClick={() => void handleRead(item.id)}
                    >
                      {t("notif.markRead")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// 공지사항 열람 — 좌 목록(전체/중요/일반·미읽음 점) + 우 마크다운 상세 (design 2026-07-05).
// 읽음은 클라 캐시(notices-read) — 서버 저장 없음.

import { useEffect, useState } from "react";

import { listNotices, type NoticeImportance, type NoticeItem } from "@/lib/api";
import { formatKst, formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { countUnreadNotices, getReadNoticeIds, markNoticeRead } from "@/lib/notices-read";
import { MarkdownView } from "@/components/markdown-view";

type Filter = "all" | NoticeImportance;

const FILTERS: Filter[] = ["all", "important", "normal"];

const FILTER_LABEL: Record<Filter, MessageKey> = {
  all: "notices.filterAll",
  important: "notices.filterImportant",
  normal: "notices.filterNormal",
};

const IMPORTANCE_STYLE: Record<NoticeImportance, string> = {
  important: "bg-error/15 text-error",
  normal: "bg-surface-alt text-ink-secondary",
};

const IMPORTANCE_LABEL: Record<NoticeImportance, MessageKey> = {
  important: "notices.filterImportant",
  normal: "notices.filterNormal",
};

// "MM-DD" — 목록/게시기간용(시각 없이)
function dateOnly(iso: string): string {
  return formatKstShort(iso).split(" ")[0];
}

export default function NoticesPage() {
  const { t } = useI18n();
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [readIds, setReadIds] = useState<number[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    listNotices().then((data) => {
      if (!alive) return;
      setNotices(data);
      setReadIds(getReadNoticeIds());
    });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = notices.filter((n) => filter === "all" || n.importance === filter);
  const unread = countUnreadNotices(
    notices.map((n) => n.id),
    readIds,
  );
  const readSet = new Set(readIds);
  const selected = notices.find((n) => n.id === selectedId) ?? null;

  const openNotice = (id: number) => {
    setSelectedId(id);
    setReadIds(markNoticeRead(id));
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 좌 목록 */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-hairline">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-body-strong text-ink">{t("nav.tab.notices")}</h1>
          {unread > 0 && (
            <span className="text-caption text-changed">
              {t("notices.unreadCount", { n: unread })}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 px-4 pb-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "rounded-sm px-2 py-0.5 text-fine " +
                (filter === f
                  ? "bg-accent-tint text-accent"
                  : "border border-hairline text-ink-secondary hover:bg-surface-alt")
              }
            >
              {t(FILTER_LABEL[f])}
            </button>
          ))}
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filtered.map((n) => {
            const isRead = readSet.has(n.id);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotice(n.id)}
                  className={
                    "flex w-full flex-col gap-1 border-b border-hairline px-4 py-3 text-left " +
                    (n.id === selectedId ? "bg-accent-tint" : "hover:bg-surface-alt")
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={
                        "rounded-sm px-1.5 py-0.5 text-fine " + IMPORTANCE_STYLE[n.importance]
                      }
                    >
                      {t(IMPORTANCE_LABEL[n.importance])}
                    </span>
                    {!isRead && (
                      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                    )}
                  </div>
                  <span className={"text-caption " + (isRead ? "text-ink-tertiary" : "text-ink")}>
                    {n.title}
                  </span>
                  <span className="text-fine text-ink-tertiary">
                    {n.created_by} · {dateOnly(n.starts_at)}
                  </span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-caption text-ink-tertiary">
              {t("notices.empty")}
            </li>
          )}
        </ul>
      </aside>

      {/* 우 상세 */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <article className="mx-auto max-w-3xl px-8 py-6">
            <div className="flex items-center gap-2 text-caption text-ink-tertiary">
              <span
                className={
                  "rounded-sm px-1.5 py-0.5 text-fine " + IMPORTANCE_STYLE[selected.importance]
                }
              >
                {t(IMPORTANCE_LABEL[selected.importance])}
              </span>
              <span>
                {t("notices.label")} · #{selected.id}
              </span>
            </div>
            <h2 className="mt-2 text-tagline text-ink">{selected.title}</h2>
            <div className="mt-2 flex items-center justify-between text-fine text-ink-tertiary">
              <span>
                {selected.created_by} · {formatKst(selected.created_at)}
              </span>
              <span>
                {t("notices.period")} {dateOnly(selected.starts_at)} ~{" "}
                {selected.ends_at ? dateOnly(selected.ends_at) : t("notices.unlimited")}
              </span>
            </div>
            <hr className="my-4 border-hairline" />
            <MarkdownView source={selected.body_md} />
          </article>
        ) : (
          <div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
            {t("notices.selectPrompt")}
          </div>
        )}
      </div>
    </div>
  );
}

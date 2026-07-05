"use client";

// 공지사항 열람 — 홈 폭(max-w-[80rem]) 경계 카드 안 마스터-디테일. 좌 목록(전체/중요/일반·미읽음 점)
// + 우 마크다운 상세. 읽음은 클라 캐시(notices-read) — 서버 저장 없음. (design 2026-07-05)

import { useEffect, useState } from "react";

import { listNotices, type NoticeImportance, type NoticeItem } from "@/lib/api";
import { formatKst, formatKstShort } from "@/lib/datetime";
import { openFeedbackPanel } from "@/lib/feedback-panel";
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

// 내용 첫 줄 미리보기 — 첫 비어있지 않은 줄에서 마크다운 마커 제거 후 앞부분만
function bodyPreview(md: string): string {
  const firstLine = md.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  return firstLine
    .replace(/[#>*_`~[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
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
    <div className="flex h-full min-h-0 flex-col px-8 py-6">
      <div className="mx-auto flex min-h-0 w-full max-w-[80rem] flex-1 overflow-hidden">
        {/* 좌 목록 */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-hairline">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
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
                  "rounded-full px-3 py-0.5 text-fine " +
                  (filter === f
                    ? "bg-accent-tint text-accent"
                    : "border border-hairline text-ink-secondary hover:bg-surface-alt")
                }
              >
                {t(FILTER_LABEL[f])}
              </button>
            ))}
          </div>
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
            {filtered.map((n) => {
              const isRead = readSet.has(n.id);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNotice(n.id)}
                    className={
                      "flex w-full flex-col gap-1.5 rounded-xs border px-3 py-2.5 text-left " +
                      (n.id === selectedId
                        ? "border-accent bg-accent-tint"
                        : "border-hairline bg-surface hover:bg-surface-alt")
                    }
                  >
                    {/* 유형 필(좌) · 읽음 표시(우) */}
                    <div className="flex items-center justify-between">
                      <span
                        className={
                          "rounded-sm px-1.5 py-0.5 text-fine " + IMPORTANCE_STYLE[n.importance]
                        }
                      >
                        {t(IMPORTANCE_LABEL[n.importance])}
                      </span>
                      {isRead ? (
                        <span className="text-fine text-ink-tertiary">{t("notices.read")}</span>
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                      )}
                    </div>
                    <span className="truncate text-caption font-semibold text-ink">{n.title}</span>
                    <span className="truncate text-fine text-ink-tertiary">
                      {bodyPreview(n.body_md)}
                    </span>
                    {/* 작성자(좌) · 시간(우) */}
                    <div className="flex items-center justify-between gap-2 text-fine text-ink-tertiary">
                      <span className="truncate">{n.created_by}</span>
                      <span className="shrink-0">{formatKstShort(n.starts_at)}</span>
                    </div>
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
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <article className="px-8 py-6">
              <div className="flex items-center gap-2">
                <span
                  className={
                    "rounded-sm px-1.5 py-0.5 text-fine " + IMPORTANCE_STYLE[selected.importance]
                  }
                >
                  {t(IMPORTANCE_LABEL[selected.importance])}
                </span>
                <span className="text-caption text-ink-tertiary">
                  {t("notices.label")} · #{selected.id}
                </span>
              </div>
              <h2 className="mt-2 text-tagline text-ink">{selected.title}</h2>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-caption text-ink-secondary">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint text-fine text-accent">
                    {selected.created_by.charAt(0).toUpperCase()}
                  </span>
                  <span>{selected.created_by}</span>
                  <span className="text-ink-tertiary">{formatKst(selected.created_at)}</span>
                </div>
                <span className="shrink-0 text-fine text-ink-tertiary">
                  {t("notices.period")} {dateOnly(selected.starts_at)} ~{" "}
                  {selected.ends_at ? dateOnly(selected.ends_at) : t("notices.unlimited")}
                </span>
              </div>
              <hr className="my-5 border-hairline" />
              <MarkdownView source={selected.body_md} />
              <div className="mt-6 rounded-md bg-accent-tint px-4 py-3 text-caption text-ink-secondary">
                {t("notices.contactPre")}{" "}
                <button
                  type="button"
                  onClick={openFeedbackPanel}
                  className="font-semibold text-accent hover:underline"
                >
                  {t("feedback.button")}
                </button>{" "}
                {t("notices.contactPost")}
              </div>
            </article>
          ) : (
            <div className="flex h-full items-center justify-center text-caption text-ink-tertiary">
              {t("notices.selectPrompt")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// 전체 피드백 페이지 — 집계 카드 · 유형 필터 · 목록 · 관리자 상태변경 (design 2026-07-05).

import { Plus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  listFeedback,
  updateFeedbackStatus,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { formatKstShort } from "@/lib/datetime";
import { openFeedbackPanel } from "@/lib/feedback-panel";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

const KIND_STYLE: Record<FeedbackKind, string> = {
  bug: "border-error text-error",
  suggestion: "border-accent text-accent",
  question: "border-changed text-changed",
  etc: "border-hairline text-ink-tertiary",
};

const KIND_LABEL: Record<FeedbackKind, MessageKey> = {
  bug: "feedback.kind.bug",
  suggestion: "feedback.kind.suggestion",
  question: "feedback.kind.question",
  etc: "feedback.kind.etc",
};

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  new: "border-hairline text-ink-tertiary",
  in_progress: "border-changed text-changed",
  done: "border-added text-added",
};

const STATUS_LABEL: Record<FeedbackStatus, MessageKey> = {
  new: "feedback.status.new",
  in_progress: "feedback.status.in_progress",
  done: "feedback.status.done",
};

const STATUSES: FeedbackStatus[] = ["new", "in_progress", "done"];
const KIND_FILTERS: (FeedbackKind | "all")[] = [
  "all",
  "bug",
  "suggestion",
  "question",
  "etc",
];

export default function FeedbackPage() {
  const { t } = useI18n();
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const isSysadmin = user?.isSysadmin ?? false;
  const loginId = user?.loginId ?? "";

  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [kindFilter, setKindFilter] = useState<FeedbackKind | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    listFeedback().then((data) => {
      if (alive) setItems(data.items);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 집계·필터는 파생값 — 렌더 중 계산(React Compiler가 메모이즈)
  const counts = {
    total: items.length,
    mine: items.filter((f) => f.author === loginId).length,
    inProgress: items.filter((f) => f.status === "in_progress").length,
    done: items.filter((f) => f.status === "done").length,
  };
  const donePct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

  const query = search.trim().toLowerCase();
  const filtered = items.filter(
    (f) =>
      (kindFilter === "all" || f.kind === kindFilter) &&
      (query === "" || f.body.toLowerCase().includes(query)),
  );

  const handleStatusChange = async (id: number, status: FeedbackStatus) => {
    const updated = await updateFeedbackStatus(id, status);
    setItems((prev) => prev.map((f) => (f.id === id ? updated : f)));
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-tagline text-ink">{t("feedback.button")}</h1>
          <p className="text-caption text-ink-secondary">{t("feedback.pageSubtitle")}</p>
        </div>
        <button
          type="button"
          onClick={openFeedbackPanel}
          className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-surface hover:opacity-90"
        >
          <Plus size={16} strokeWidth={1.5} />
          {t("feedback.panelTitle")}
        </button>
      </div>

      {/* 집계 카드 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-hairline bg-surface px-4 py-3">
          <p className="text-caption text-ink-secondary">{t("feedback.stat.total")}</p>
          <p className="mt-1 text-tagline text-ink">{counts.total}</p>
        </div>
        <div className="rounded-md border border-accent bg-accent-tint px-4 py-3">
          <p className="text-caption text-accent">{t("feedback.stat.mine")}</p>
          <p className="mt-1 text-tagline text-accent">{counts.mine}</p>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-4 py-3">
          <p className="text-caption text-ink-secondary">{t("feedback.stat.inProgress")}</p>
          <p className="mt-1 text-tagline text-changed">{counts.inProgress}</p>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-4 py-3">
          <p className="text-caption text-ink-secondary">{t("feedback.stat.done")}</p>
          <p className="mt-1 text-tagline text-added">
            {counts.done}
            <span className="ml-1 text-caption text-ink-tertiary">{donePct}%</span>
          </p>
        </div>
      </div>

      {/* 유형 필터 + 검색 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {KIND_FILTERS.map((k) => {
            const active = kindFilter === k;
            const label = k === "all" ? t("feedback.filterAll") : t(KIND_LABEL[k]);
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(k)}
                className={
                  "rounded-sm px-2.5 py-1 text-caption " +
                  (active
                    ? "bg-accent-tint text-accent"
                    : "border border-hairline text-ink-secondary hover:bg-surface-alt")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("feedback.searchPlaceholder")}
          className="w-56 rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
      </div>

      {/* 목록 */}
      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className="w-full border-collapse text-caption">
          <thead>
            <tr className="border-b border-hairline bg-surface-alt text-left text-ink-secondary">
              <th className="px-3 py-2 font-normal">{t("feedback.typeLabel")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.contentLabel")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.colAuthor")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.colStatus")}</th>
              <th className="px-3 py-2 font-normal">{t("feedback.colDate")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.id} className="border-b border-hairline last:border-0">
                <td className="px-3 py-2">
                  <span
                    className={"rounded-sm border px-1.5 py-0.5 text-fine " + KIND_STYLE[f.kind]}
                  >
                    {t(KIND_LABEL[f.kind])}
                  </span>
                </td>
                <td className="max-w-0 px-3 py-2 text-ink">
                  <span className="block truncate" title={f.body}>
                    {f.body}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{f.author}</td>
                <td className="px-3 py-2">
                  {isSysadmin ? (
                    <select
                      value={f.status}
                      onChange={(event) =>
                        void handleStatusChange(f.id, event.target.value as FeedbackStatus)
                      }
                      className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink focus:border-accent focus:outline-none"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(STATUS_LABEL[s])}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={
                        "rounded-sm border px-1.5 py-0.5 text-fine " + STATUS_STYLE[f.status]
                      }
                    >
                      {t(STATUS_LABEL[f.status])}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-tertiary">
                  {formatKstShort(f.created_at).split(" ")[0]}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-ink-tertiary">
                  {t("feedback.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

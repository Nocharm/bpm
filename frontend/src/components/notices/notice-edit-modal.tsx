"use client";

// 공지 등록/수정 모달 — 제목·중요도·게시기간(캘린더·무제한)·본문(md)·전체 알림. (design 2026-07-05)

import { X } from "lucide-react";
import { useState } from "react";

import {
  createNotice,
  updateNotice,
  type NoticeImportance,
  type NoticeItem,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { DateRangeCalendar } from "@/components/notices/date-range-calendar";

// ISO(KST) 경계 — 시작=자정, 종료=하루 끝
function toStartIso(date: string): string {
  return `${date}T00:00:00+09:00`;
}
function toEndIso(date: string): string {
  return `${date}T23:59:59+09:00`;
}

const IMPORTANCES: NoticeImportance[] = ["important", "normal"];

export function NoticeEditModal({
  notice,
  onClose,
  onSaved,
}: {
  notice: NoticeItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(notice?.title ?? "");
  const [importance, setImportance] = useState<NoticeImportance>(
    notice?.importance ?? "normal",
  );
  const [startDate, setStartDate] = useState(notice ? notice.starts_at.slice(0, 10) : "");
  const [endDate, setEndDate] = useState(
    notice?.ends_at ? notice.ends_at.slice(0, 10) : "",
  );
  const [unlimited, setUnlimited] = useState(notice ? notice.ends_at === null : false);
  const [bodyMd, setBodyMd] = useState(notice?.body_md ?? "");
  const [notifyAll, setNotifyAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSave =
    title.trim().length > 0 &&
    startDate !== "" &&
    (unlimited || endDate !== "") &&
    !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const input = {
        title: title.trim(),
        body_md: bodyMd,
        importance,
        starts_at: toStartIso(startDate),
        ends_at: unlimited ? null : toEndIso(endDate),
      };
      if (notice) {
        await updateNotice(notice.id, input);
      } else {
        await createNotice({ ...input, notify_all: notifyAll });
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const days =
    startDate && endDate && !unlimited
      ? Math.max(
          1,
          Math.round(
            (new Date(`${endDate}T00:00:00`).getTime() -
              new Date(`${startDate}T00:00:00`).getTime()) /
              86_400_000,
          ) + 1,
        )
      : null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={t(notice ? "noticeEdit.titleEdit" : "noticeEdit.titleNew")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
      >
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <span className="text-body-strong text-ink">
            {t(notice ? "noticeEdit.titleEdit" : "noticeEdit.titleNew")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("action.close")}
            className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {/* 제목 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-caption-strong text-ink-secondary">
              {t("noticeEdit.fieldTitle")}
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              className="rounded-sm border border-hairline bg-surface px-3 py-2 text-caption text-ink focus:border-accent focus:outline-none"
            />
          </label>

          {/* 중요도 세그먼트 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-caption-strong text-ink-secondary">
              {t("noticeEdit.fieldImportance")}
            </span>
            <div className="grid grid-cols-2 gap-1 rounded-sm bg-surface-alt p-1">
              {IMPORTANCES.map((imp) => (
                <button
                  key={imp}
                  type="button"
                  onClick={() => setImportance(imp)}
                  className={
                    "rounded-xs px-2 py-1.5 text-caption " +
                    (importance === imp
                      ? "bg-surface text-accent shadow-sm"
                      : "text-ink-secondary hover:text-ink")
                  }
                >
                  {t(imp === "important" ? "notices.filterImportant" : "notices.filterNormal")}
                </button>
              ))}
            </div>
          </div>

          {/* 게시기간 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-caption-strong text-ink-secondary">
                {t("noticeEdit.fieldPeriod")}
              </span>
              <label className="flex items-center gap-1.5 text-fine text-ink-secondary">
                <input
                  type="checkbox"
                  checked={unlimited}
                  onChange={(event) => setUnlimited(event.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                {t("noticeEdit.unlimited")}
              </label>
            </div>
            <div className="flex items-center gap-2 text-caption text-ink">
              <span>{startDate || "—"}</span>
              <span className="text-ink-tertiary">→</span>
              <span>{unlimited ? t("notices.unlimited") : endDate || "—"}</span>
              {days ? (
                <span className="ml-auto text-fine text-ink-tertiary">
                  {t("noticeEdit.days", { n: days })}
                </span>
              ) : null}
            </div>
            {!unlimited && (
              <DateRangeCalendar
                start={startDate}
                end={endDate}
                onChange={(s, e) => {
                  setStartDate(s);
                  setEndDate(e);
                }}
              />
            )}
          </div>

          {/* 본문 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-caption-strong text-ink-secondary">
                {t("noticeEdit.fieldBody")}
              </span>
              <span className="text-fine text-ink-tertiary">{t("noticeEdit.bodyHint")}</span>
            </div>
            <textarea
              value={bodyMd}
              onChange={(event) => setBodyMd(event.target.value)}
              maxLength={20_000}
              className="min-h-40 w-full resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-caption text-ink focus:border-accent focus:outline-none"
            />
          </div>

          {/* 전체 알림 — 신규 등록 시만 */}
          {!notice && (
            <label className="flex items-center gap-2 text-caption text-ink-secondary">
              <input
                type="checkbox"
                checked={notifyAll}
                onChange={(event) => setNotifyAll(event.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              {t("noticeEdit.notifyAll")}
            </label>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-hairline px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
          >
            {t("feedback.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-sm bg-accent px-4 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
          >
            {t("noticeEdit.publish")}
          </button>
        </footer>
      </div>
    </div>
  );
}

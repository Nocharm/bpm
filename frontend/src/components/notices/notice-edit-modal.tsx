"use client";

// 공지 등록/수정 모달 — 제목·중요도·게시기간(캘린더·무제한)·본문(md)·전체 알림. (design 2026-07-05)
// 본문은 배포에 실린 공지 초안 파일(docs/notices)에서 불러올 수 있다(새 글·수정 모두, 사용자 결정 2026-11-05).

import { FileDown, X } from "lucide-react";
import { useState } from "react";

import {
  createNotice,
  getNoticeDraft,
  listNoticeDrafts,
  updateNotice,
  type NoticeDraft,
  type NoticeImportance,
  type NoticeItem,
} from "@/lib/api";
import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { DateRangeCalendar } from "@/components/notices/date-range-calendar";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { CheckInput } from "@/components/check-input";

// ISO(KST) 경계 — 시작=자정, 종료=하루 끝
function toStartIso(date: string): string {
  return `${date}T00:00:00+09:00`;
}
function toEndIso(date: string): string {
  return `${date}T23:59:59+09:00`;
}

const IMPORTANCES: NoticeImportance[] = ["important", "normal"];
// 서버 `NoticeCreate.body_md` max_length와 같은 값 — 불러온 초안이 넘으면 저장 전에 알린다
const BODY_MAX = 20_000;

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
  // 날짜는 KST로 자른다 — 운영(Postgres)은 UTC(`Z`)로 응답해 원문을 자르면 시작일이 하루 앞당겨진다(리뷰 H-5)
  const [startDate, setStartDate] = useState(notice ? formatKst(notice.starts_at).slice(0, 10) : "");
  const [endDate, setEndDate] = useState(
    notice?.ends_at ? formatKst(notice.ends_at).slice(0, 10) : "",
  );
  const [unlimited, setUnlimited] = useState(notice ? notice.ends_at === null : false);
  const [bodyMd, setBodyMd] = useState(notice?.body_md ?? "");
  const [notifyAll, setNotifyAll] = useState(false);
  const [busy, setBusy] = useState(false);
  // 초안 불러오기 — 목록은 처음 펼칠 때 읽는다(null = 아직, "error" = 실패)
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [drafts, setDrafts] = useState<NoticeDraft[] | "error" | null>(null);
  const [loadedFile, setLoadedFile] = useState<string | null>(null);

  const bodyTooLong = bodyMd.length > BODY_MAX;
  const canSave =
    title.trim().length > 0 &&
    startDate !== "" &&
    (unlimited || endDate !== "") &&
    !bodyTooLong &&
    !busy;

  const toggleDrafts = () => {
    setDraftsOpen((open) => !open);
    if (drafts === null || drafts === "error") {
      listNoticeDrafts()
        .then(setDrafts)
        .catch(() => setDrafts("error"));
    }
  };

  const loadDraft = async (file: string) => {
    try {
      const draft = await getNoticeDraft(file);
      setTitle(draft.title);
      setBodyMd(draft.body);
      setLoadedFile(draft.file);
      setDraftsOpen(false);
    } catch {
      setDrafts("error");
    }
  };

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
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4"
      onClose={onClose}
    >
      <div
        role="dialog"
        aria-label={t(notice ? "noticeEdit.titleEdit" : "noticeEdit.titleNew")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-md border glass glass-dense"
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
                <CheckInput checked={unlimited} onChange={() => setUnlimited((v) => !v)} />
                {t("noticeEdit.unlimited")}
              </label>
            </div>
            <div className="flex items-center gap-2 text-caption text-ink">
              <span>{startDate || "-"}</span>
              <span className="text-ink-tertiary">→</span>
              <span>{unlimited ? t("notices.unlimited") : endDate || "-"}</span>
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption-strong text-ink-secondary">
                {t("noticeEdit.fieldBody")}
              </span>
              <span className="ml-auto text-fine text-ink-tertiary">{t("noticeEdit.bodyHint")}</span>
              <button
                type="button"
                data-id="notice-load-draft"
                aria-expanded={draftsOpen}
                onClick={toggleDrafts}
                className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
              >
                <FileDown size={14} strokeWidth={1.5} />
                {t("noticeEdit.loadDraft")}
              </button>
            </div>
            {/* 초안 목록 — 모달 안 펼침(떠 있는 메뉴가 아니라 z 사다리를 타지 않는다) */}
            {draftsOpen && (
              <div data-id="notice-draft-list" className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt p-2">
                <p className="text-fine text-ink-tertiary">{t("noticeEdit.loadDraftHint")}</p>
                {drafts === null ? null : drafts === "error" ? (
                  <p role="alert" className="text-fine text-error">{t("noticeEdit.loadDraftError")}</p>
                ) : drafts.length === 0 ? (
                  <p className="text-fine text-ink-tertiary">{t("noticeEdit.loadDraftEmpty")}</p>
                ) : (
                  <ul className="flex max-h-40 flex-col overflow-y-auto">
                    {drafts.map((draft) => (
                      <li key={draft.file}>
                        <button
                          type="button"
                          data-id={`notice-draft-${draft.file}`}
                          onClick={() => void loadDraft(draft.file)}
                          className="flex w-full min-w-0 items-baseline gap-2 rounded-xs px-2 py-1 text-left hover:bg-surface"
                        >
                          <span className="min-w-0 truncate text-caption text-ink">{draft.title}</span>
                          <span className="ml-auto shrink-0 font-mono text-fine text-ink-tertiary">{draft.file}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {loadedFile && (
              <p data-id="notice-draft-loaded" className="text-fine text-ink-tertiary">
                {t("noticeEdit.loadedDraft", { file: loadedFile })}
              </p>
            )}
            <textarea
              value={bodyMd}
              onChange={(event) => setBodyMd(event.target.value)}
              className="min-h-40 w-full resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-caption text-ink focus:border-accent focus:outline-none"
            />
            {bodyTooLong && (
              <p role="alert" data-id="notice-body-too-long" className="text-fine text-error">
                {t("noticeEdit.bodyTooLong", { n: bodyMd.length.toLocaleString(), max: BODY_MAX.toLocaleString() })}
              </p>
            )}
          </div>

          {/* 전체 알림 — 신규 등록 시만 */}
          {!notice && (
            <label className="flex items-center gap-2 text-caption text-ink-secondary">
              <CheckInput checked={notifyAll} onChange={() => setNotifyAll((v) => !v)} />
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
    </ModalBackdrop>
  );
}

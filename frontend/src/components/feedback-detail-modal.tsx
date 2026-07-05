"use client";

// 피드백 상세/관리 모달 — 상태변경(관리자)·답글(관리자, done 제외)·본문수정/삭제(작성자, draft만).

import { Check, PencilLine, Send, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  deleteFeedback,
  patchFeedback,
  type FeedbackItem,
  type FeedbackStatus,
} from "@/lib/api";
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_KIND_STYLE,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  FEEDBACK_STATUS_STYLE,
} from "@/lib/feedback-meta";
import { useI18n } from "@/lib/i18n";
import { TimePills } from "@/components/time-pills";
import { UserPill } from "@/components/user-pill";

// 상태별 슬라이딩 인디케이터 배경·활성 텍스트 색
const STATUS_INDICATOR: Record<FeedbackStatus, string> = {
  draft: "bg-ink-secondary/15",
  in_progress: "bg-changed/25",
  done: "bg-added/25",
};
const STATUS_TEXT: Record<FeedbackStatus, string> = {
  draft: "text-ink",
  in_progress: "text-changed",
  done: "text-added",
};

export function FeedbackDetailModal({
  feedback,
  currentLoginId,
  isSysadmin,
  onClose,
  onChanged,
}: {
  feedback: FeedbackItem;
  currentLoginId: string;
  isSysadmin: boolean;
  onClose: () => void;
  onChanged: (updated: FeedbackItem | null) => void;
}) {
  const { t } = useI18n();
  const [nowMs] = useState(() => Date.now());
  const [reply, setReply] = useState(feedback.reply);
  const [bodyDraft, setBodyDraft] = useState(feedback.body);
  const [editingBody, setEditingBody] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const isAuthor = feedback.author === currentLoginId;
  const canReply = isSysadmin && feedback.status !== "done";
  const canEditBody = isAuthor && feedback.status === "draft";
  const canDelete = isAuthor && feedback.status === "draft";
  const statusIndex = FEEDBACK_STATUSES.indexOf(feedback.status);

  const run = async (fn: () => Promise<FeedbackItem | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      onChanged(await fn());
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (status: FeedbackStatus) =>
    run(() => patchFeedback(feedback.id, { status }));
  const saveReply = () => run(() => patchFeedback(feedback.id, { reply }));
  const saveBody = () =>
    run(async () => {
      const updated = await patchFeedback(feedback.id, { body: bodyDraft });
      setEditingBody(false);
      return updated;
    });
  const remove = () =>
    run(async () => {
      await deleteFeedback(feedback.id);
      return null;
    });

  const route = feedback.context?.route;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={t("feedback.detail.title")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-hairline bg-surface shadow-lg"
      >
        <header className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span
              className={"rounded-sm px-1.5 py-0.5 text-fine " + FEEDBACK_KIND_STYLE[feedback.kind]}
            >
              {t(FEEDBACK_KIND_LABEL[feedback.kind])}
            </span>
            <span
              className={
                "rounded-sm px-1.5 py-0.5 text-fine " + FEEDBACK_STATUS_STYLE[feedback.status]
              }
            >
              {t(FEEDBACK_STATUS_LABEL[feedback.status])}
            </span>
          </div>
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
          {/* 본문 — 작성자·draft이면 수정 가능 */}
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-caption-strong text-ink-secondary">
                {t("feedback.contentLabel")}
              </span>
              {canEditBody && !editingBody && (
                <button
                  type="button"
                  onClick={() => setEditingBody(true)}
                  className="inline-flex items-center gap-1 text-fine text-accent hover:underline"
                >
                  <PencilLine size={12} strokeWidth={1.5} />
                  {t("feedback.detail.editBody")}
                </button>
              )}
            </div>
            {editingBody ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={bodyDraft}
                  onChange={(event) => setBodyDraft(event.target.value)}
                  maxLength={4000}
                  className="min-h-28 w-full resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-caption text-ink focus:border-accent focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBody(false);
                      setBodyDraft(feedback.body);
                    }}
                    className="inline-flex items-center gap-1 rounded-sm border border-hairline px-3 py-1 text-fine text-ink hover:bg-surface-alt"
                  >
                    <X size={14} strokeWidth={1.5} />
                    {t("feedback.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={saveBody}
                    disabled={busy || bodyDraft.trim().length === 0}
                    className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1 text-fine text-surface hover:opacity-90 disabled:opacity-40"
                  >
                    <Check size={14} strokeWidth={1.5} />
                    {t("feedback.detail.save")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-caption text-ink">{feedback.body}</p>
            )}
          </section>

          {/* 답글 — 관리자·done 아닐 때 작성/수정 */}
          <section className="flex flex-col gap-1.5">
            <span className="text-caption-strong text-ink-secondary">
              {t("feedback.detail.reply")}
            </span>
            {canReply ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  maxLength={4000}
                  placeholder={t("feedback.detail.replyPlaceholder")}
                  className="min-h-24 w-full resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={saveReply}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1 text-fine text-surface hover:opacity-90 disabled:opacity-40"
                  >
                    <Send size={14} strokeWidth={1.5} />
                    {t("feedback.detail.saveReply")}
                  </button>
                </div>
              </div>
            ) : feedback.reply ? (
              <p className="whitespace-pre-wrap rounded-sm bg-surface-alt px-3 py-2 text-caption text-ink">
                {feedback.reply}
              </p>
            ) : (
              <p className="text-fine text-ink-tertiary">
                {feedback.status === "done"
                  ? t("feedback.detail.lockedDone")
                  : t("feedback.detail.replyEmpty")}
              </p>
            )}
          </section>

          {/* 메타 — 작성자·화면·시각들 */}
          <section className="flex flex-col gap-1 border-t border-hairline pt-3 text-fine text-ink-tertiary">
            <MetaRow label={t("feedback.colAuthor")} value={<UserPill loginId={feedback.author} />} />
            {route && (
              <MetaRow
                label={t("feedback.detail.screen")}
                value={
                  <span className="rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary">
                    {route}
                  </span>
                }
              />
            )}
            <MetaRow
              label={t("feedback.detail.submittedAt")}
              value={<TimePills iso={feedback.created_at} nowMs={nowMs} />}
            />
            {feedback.body_edited_at && (
              <MetaRow
                label={t("feedback.detail.bodyEditedAt")}
                value={<TimePills iso={feedback.body_edited_at} nowMs={nowMs} />}
              />
            )}
            {feedback.reply_at && (
              <MetaRow
                label={t("feedback.detail.repliedAt")}
                value={<TimePills iso={feedback.reply_at} nowMs={nowMs} />}
              />
            )}
            {feedback.done_at && (
              <MetaRow
                label={t("feedback.detail.doneAt")}
                value={<TimePills iso={feedback.done_at} nowMs={nowMs} />}
              />
            )}
          </section>
        </div>

        {/* 푸터 — 상태변경(관리자) + 삭제(작성자·draft) */}
        {(isSysadmin || canDelete) && (
          <footer className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-3">
            {isSysadmin ? (
              <div className="flex items-center gap-2">
                <span className="text-fine text-ink-tertiary">
                  {t("feedback.detail.changeStatus")}
                </span>
                <div className="relative inline-grid grid-cols-3 overflow-hidden rounded-sm border border-hairline">
                  {/* 상태 위치로 미끄러지는 인디케이터 — 색도 상태별 */}
                  <span
                    aria-hidden
                    className={
                      "pointer-events-none absolute inset-y-0 left-0 w-1/3 transition-[transform,background-color] duration-350 ease-spring " +
                      STATUS_INDICATOR[feedback.status]
                    }
                    style={{ transform: `translateX(${statusIndex * 100}%)` }}
                  />
                  {FEEDBACK_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => changeStatus(s)}
                      disabled={busy || feedback.status === s}
                      className={
                        "relative z-10 px-2.5 py-0.5 text-fine transition-colors " +
                        (feedback.status === s
                          ? "font-semibold " + STATUS_TEXT[s]
                          : "text-ink-tertiary hover:text-ink-secondary")
                      }
                    >
                      {t(FEEDBACK_STATUS_LABEL[s])}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <span />
            )}
            {canDelete &&
              (confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-fine text-ink-secondary hover:underline"
                  >
                    {t("feedback.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-sm bg-error px-3 py-1 text-fine text-surface hover:opacity-90 disabled:opacity-40"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                    {t("feedback.detail.deleteConfirm")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1 rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-error/10"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                  {t("feedback.detail.delete")}
                </button>
              ))}
          </footer>
        )}
      </div>
    </div>
  );
}

// 값은 이미 필/컴포넌트(UserPill·TimePills·pill span)로 전달 — 여기서 감싸지 않는다.
function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="flex items-center gap-1">{value}</span>
    </div>
  );
}

"use client";

// 승인요청 확인 다이얼로그 — 현재 설정된 승인자 목록 노출(없으면 안내). 동봉 옵션 UI는 슬롯으로 주입.
// 2026-09-21: 코멘트 AI 초안 버튼(onDraftComment) — 최신 게시본 대비 변경 사유를 개조식으로 받아 textarea에 채운다(제출자가 고쳐 올림).

import { type ReactNode, useState } from "react";
import { Loader2, Send, Sparkles, User } from "lucide-react";

import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { RequesterCommentBanner } from "@/components/version/requester-comment-banner";
import { useI18n } from "@/lib/i18n";
import { type VersionEvent, type WorkflowState } from "@/lib/api";

interface SubmitConfirmDialogProps {
  workflow: WorkflowState | null;
  nameById: Map<string, string>;
  subtitle?: string;
  // 승인요청에 동봉할 옵션 UI(예: 가시성 변경 체크박스) — 호출자가 렌더한 JSX를 그대로 주입.
  bundleSlot?: ReactNode;
  // 최신 반려 이벤트 — 반려 기록이 있으면 재요청 맥락으로 이전 반려 사유·반려자 배너 노출.
  previousRejection?: VersionEvent | null;
  comment: string;
  onCommentChange: (value: string) => void;
  // 코멘트 AI 초안 — 있으면 버튼 노출. 결과 문자열을 코멘트로 덮어쓴다(AI 비활성 서버는 호출자가 undefined).
  onDraftComment?: () => Promise<string>;
  onConfirm: () => void;
  onClose: () => void;
}

export function SubmitConfirmDialog({
  workflow,
  nameById,
  subtitle,
  bundleSlot,
  previousRejection,
  comment,
  onCommentChange,
  onDraftComment,
  onConfirm,
  onClose,
}: SubmitConfirmDialogProps) {
  const { t } = useI18n();
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const approvers = workflow?.approvers ?? [];
  const lines: ConfirmLine[] =
    approvers.length > 0
      ? approvers.map((id) => ({
          icon: <User size={14} strokeWidth={1.5} />,
          text: nameById.get(id) ?? id,
        }))
      : [
          {
            icon: <User size={14} strokeWidth={1.5} />,
            text: t("approval.noApprovers"),
            tone: "muted" as const,
          },
        ];
  const draftComment = async () => {
    if (!onDraftComment || drafting) return;
    setDrafting(true);
    setDraftError(null);
    try {
      onCommentChange(await onDraftComment());
    } catch (err: unknown) {
      setDraftError(err instanceof Error && err.message ? err.message : t("wf.aiDraftNoteFailed"));
    } finally {
      setDrafting(false);
    }
  };
  return (
    <ConfirmDialog
      icon={<Send size={28} strokeWidth={1.5} />}
      title={t("approval.submitConfirmTitle")}
      message={subtitle}
      banner={
        previousRejection?.note ? (
          <RequesterCommentBanner
            kind="rejection"
            authorName={nameById.get(previousRejection.actor) ?? previousRejection.actor}
            comment={previousRejection.note}
          />
        ) : undefined
      }
      lines={lines}
      input={{ value: comment, onChange: onCommentChange, placeholder: t("wf.commentPlaceholder") }}
      confirmLabel={t("common.confirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      {onDraftComment && (
        <div className="flex flex-col gap-1" data-id="submit-ai-draft">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-id="submit-ai-draft-button"
              title={t("wf.aiDraftNoteHint")}
              disabled={drafting}
              onClick={() => void draftComment()}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-accent-tint hover:text-accent disabled:cursor-default disabled:opacity-60"
            >
              {drafting ? (
                <Loader2 size={12} strokeWidth={1.6} className="animate-spin text-accent" />
              ) : (
                <Sparkles size={12} strokeWidth={1.5} className="text-accent" />
              )}
              {drafting ? t("wf.aiDraftNoteBusy") : t("wf.aiDraftNote")}
            </button>
            <span className="text-left text-fine text-ink-tertiary">{t("wf.aiDraftNoteHint")}</span>
          </div>
          {draftError && (
            <div data-id="submit-ai-draft-error" className="text-fine text-error">
              {draftError}
            </div>
          )}
        </div>
      )}
      {bundleSlot}
    </ConfirmDialog>
  );
}

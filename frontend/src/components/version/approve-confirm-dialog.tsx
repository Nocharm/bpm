"use client";

// 승인 확인 다이얼로그 — 승인자별 상태(Approved/Pending/Rejected) 안내.

import { Check } from "lucide-react";

import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { buildApproverStatusLines } from "@/components/version/approver-status-lines";
import { RequesterCommentBanner } from "@/components/version/requester-comment-banner";
import { useI18n } from "@/lib/i18n";
import { type WorkflowState } from "@/lib/api";

interface ApproveConfirmDialogProps {
  workflow: WorkflowState | null;
  nameById: Map<string, string>;
  username: string | null;
  subtitle?: string;
  // 동봉 공개 라인(가시성 변경 등) — 승인자 상태 라인 뒤에 이어붙는다.
  extraLines?: ConfirmLine[];
  // 요청자(제출자)의 제출 코멘트 — 있으면 배너로 승인자에게 공개.
  submitComment?: string | null;
  comment: string;
  onCommentChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ApproveConfirmDialog({
  workflow,
  nameById,
  username,
  subtitle,
  extraLines,
  submitComment,
  comment,
  onCommentChange,
  onConfirm,
  onClose,
}: ApproveConfirmDialogProps) {
  const { t } = useI18n();
  const lines = buildApproverStatusLines(workflow, nameById, username, t);
  const combined = extraLines && extraLines.length > 0 ? [...lines, ...extraLines] : lines;
  return (
    <ConfirmDialog
      icon={<Check size={28} strokeWidth={1.5} />}
      title={t("approval.approveConfirmTitle")}
      message={subtitle}
      banner={
        submitComment ? (
          <RequesterCommentBanner
            submitterName={
              workflow?.submitted_by
                ? (nameById.get(workflow.submitted_by) ?? workflow.submitted_by)
                : undefined
            }
            comment={submitComment}
          />
        ) : undefined
      }
      lines={combined}
      input={{ value: comment, onChange: onCommentChange, placeholder: t("wf.commentPlaceholder") }}
      confirmLabel={t("common.confirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

"use client";

// 승인 확인 다이얼로그 — 승인자별 상태(Approved/Pending/Rejected) 안내.

import { Check } from "lucide-react";

import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { buildApproverStatusLines } from "@/components/version/approver-status-lines";
import { useI18n } from "@/lib/i18n";
import { type WorkflowState } from "@/lib/api";

interface ApproveConfirmDialogProps {
  workflow: WorkflowState | null;
  nameById: Map<string, string>;
  username: string | null;
  subtitle?: string;
  // 동봉 공개 라인(가시성 변경 등) — 승인자 상태 라인 뒤에 이어붙는다.
  extraLines?: ConfirmLine[];
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
      lines={combined}
      input={{ value: comment, onChange: onCommentChange, placeholder: t("wf.commentPlaceholder") }}
      confirmLabel={t("common.confirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

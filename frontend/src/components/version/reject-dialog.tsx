"use client";

// 반려 다이얼로그 — 사유 입력 필수(빈 값이면 confirm 비활성), 승인자별 상태 안내.

import { X } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { buildApproverStatusLines } from "@/components/version/approver-status-lines";
import { useI18n } from "@/lib/i18n";
import { type WorkflowState } from "@/lib/api";

interface RejectDialogProps {
  workflow: WorkflowState | null;
  nameById: Map<string, string>;
  username: string | null;
  subtitle?: string;
  reason: string;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function RejectDialog({
  workflow,
  nameById,
  username,
  subtitle,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
}: RejectDialogProps) {
  const { t } = useI18n();
  const lines = buildApproverStatusLines(workflow, nameById, username, t);
  return (
    <ConfirmDialog
      icon={<X size={28} strokeWidth={1.5} />}
      danger
      title={t("wf.rejectTitle")}
      message={subtitle}
      lines={lines}
      input={{ value: reason, onChange: onReasonChange, placeholder: t("wf.rejectReason") }}
      confirmDisabled={reason.trim().length === 0}
      confirmLabel={t("wf.reject")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

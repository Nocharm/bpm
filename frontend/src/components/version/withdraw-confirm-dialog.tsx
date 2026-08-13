"use client";

// 회수 확인 다이얼로그 — 제출자→회수자 핸드오프 배너(WithdrawHandoff) + 승인자별 상태.

import { Undo2 } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { WithdrawHandoff } from "@/components/withdraw-handoff";
import { buildApproverStatusLines } from "@/components/version/approver-status-lines";
import { useI18n } from "@/lib/i18n";
import { type WorkflowState } from "@/lib/api";

interface WithdrawConfirmDialogProps {
  workflow: WorkflowState | null;
  nameById: Map<string, string>;
  username: string | null;
  subtitle?: string;
  // 회수 대상 버전의 제출자 — 제출 시 체크아웃이 해제돼 보유자가 늘 없으므로 제출자를 노출.
  withdrawSubmitter: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function WithdrawConfirmDialog({
  workflow,
  nameById,
  username,
  subtitle,
  withdrawSubmitter,
  onConfirm,
  onClose,
}: WithdrawConfirmDialogProps) {
  const { t } = useI18n();
  const approverStatusLines = buildApproverStatusLines(workflow, nameById, username, t);
  return (
    <ConfirmDialog
      icon={<Undo2 size={28} strokeWidth={1.5} />}
      title={t("approval.withdrawConfirmTitle")}
      message={subtitle}
      banner={
        <WithdrawHandoff
          submitterName={
            withdrawSubmitter ? (nameById.get(withdrawSubmitter) ?? withdrawSubmitter) : t("checkout.none")
          }
          youName={t("approval.you")}
          transfers={!!withdrawSubmitter && withdrawSubmitter !== username}
        />
      }
      sections={approverStatusLines.length ? [approverStatusLines] : undefined}
      confirmLabel={t("common.confirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

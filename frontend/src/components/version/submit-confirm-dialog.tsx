"use client";

// 승인요청 확인 다이얼로그 — 현재 설정된 승인자 목록 노출(없으면 안내). 동봉 옵션 UI는 슬롯으로 주입.

import { type ReactNode } from "react";
import { Send, User } from "lucide-react";

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
  onConfirm,
  onClose,
}: SubmitConfirmDialogProps) {
  const { t } = useI18n();
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
      {bundleSlot}
    </ConfirmDialog>
  );
}

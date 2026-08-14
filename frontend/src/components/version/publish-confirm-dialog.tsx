"use client";

// 게시 확인 다이얼로그 — 기존 게시본이 있으면 만료됨을 경고.

import { Info, Upload } from "lucide-react";

import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n";
import { type VersionSummary } from "@/lib/api";

interface PublishConfirmDialogProps {
  subtitle?: string;
  // 현재 게시본 — 있으면 확인 시 만료됨을 경고, null이면 첫 게시.
  priorPublished: VersionSummary | null;
  comment: string;
  onCommentChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function PublishConfirmDialog({
  subtitle,
  priorPublished,
  comment,
  onCommentChange,
  onConfirm,
  onClose,
}: PublishConfirmDialogProps) {
  const { t } = useI18n();
  const lines: ConfirmLine[] | undefined = priorPublished
    ? [
        {
          icon: <Info size={14} strokeWidth={1.5} />,
          text: t("approval.publishExpireLine", {
            name: `v${priorPublished.version_number ?? "?"} · ${priorPublished.label}`,
          }),
          tone: "error" as const,
        },
      ]
    : undefined;
  return (
    <ConfirmDialog
      icon={<Upload size={28} strokeWidth={1.5} />}
      title={t("approval.publishConfirmTitle")}
      message={subtitle}
      lines={lines}
      input={{ value: comment, onChange: onCommentChange, placeholder: t("wf.commentPlaceholder") }}
      confirmLabel={t("common.confirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

"use client";

// 버전 전환 확인 — 편집 중 전환 시 미저장 변경 손실 안내. VersionPill·버전 타임라인 go-to 공용.

import { AlertTriangle, ArrowLeftRight, GitBranch } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n";

interface VersionSwitchConfirmProps {
  /** 전환 대상 버전 라벨. */
  label: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function VersionSwitchConfirm({ label, onConfirm, onClose }: VersionSwitchConfirmProps) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      icon={<GitBranch size={28} strokeWidth={1.5} />}
      title={t("editor.confirmSwitchTitle")}
      lines={[
        {
          icon: <ArrowLeftRight size={14} strokeWidth={1.5} />,
          text: t("editor.confirmSwitchBody", { label }),
        },
        { icon: <AlertTriangle size={14} strokeWidth={1.5} />, text: t("editor.unsavedNotice"), tone: "error" },
      ]}
      confirmLabel={t("common.confirm")}
      cancelLabel={t("common.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

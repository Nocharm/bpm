"use client";

// 버전 라이프사이클 상태 pill — 디자인 토큰만 사용 (rules/frontend/design.md)
import type { VersionStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

const STYLES: Record<VersionStatus, string> = {
  draft: "border-hairline text-ink-tertiary",
  pending: "border-changed text-changed",
  approved: "border-added text-added",
  published: "border-accent text-accent",
  rejected: "border-error text-error",
};

const LABEL_KEY: Record<VersionStatus, MessageKey> = {
  draft: "status.draft",
  pending: "status.pending",
  approved: "status.approved",
  published: "status.published",
  rejected: "status.rejected",
};

export function StatusBadge({ status }: { status: VersionStatus }) {
  const { t } = useI18n();
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 text-fine ${STYLES[status]}`}>
      {t(LABEL_KEY[status])}
    </span>
  );
}

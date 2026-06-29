// 버전 워크플로 상태 → 라벨/스타일 (홈 카드·상세 카드 공용) / version status → label & pill style.

import type { VersionStatus } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";

export const VERSION_STATUS_LABEL: Record<VersionStatus, MessageKey> = {
  draft: "home.verStatus.draft",
  pending: "home.verStatus.pending",
  approved: "home.verStatus.approved",
  published: "home.verStatus.published",
  rejected: "home.verStatus.rejected",
  expired: "home.verStatus.expired",
};

// 상태별 pill 스타일 — 토큰만(raw hex 금지) / status pill styles, tokens only.
export const VERSION_STATUS_STYLE: Record<VersionStatus, string> = {
  draft: "border-hairline text-ink-tertiary",
  pending: "border-changed text-changed",
  approved: "border-accent text-accent",
  published: "border-added text-added",
  rejected: "border-error text-error",
  expired: "border-hairline text-ink-tertiary",
};

// 공개 범위 pill — public/private 색 구분 / visibility pill, public vs private distinct.
export function visibilityPillClass(visibility: string): string {
  return visibility === "public"
    ? "border-added text-added"
    : "border-divider text-ink-secondary";
}

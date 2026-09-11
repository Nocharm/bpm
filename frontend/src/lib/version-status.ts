// 버전 워크플로 상태 → 라벨/스타일 (홈 카드·상세 카드 공용) / version status → label & pill style.

import type { VersionStatus } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n-messages";

export const VERSION_STATUS_LABEL: Record<VersionStatus, MessageKey> = {
  draft: "home.verStatus.draft",
  pending: "home.verStatus.pending",
  approved: "home.verStatus.approved",
  published: "home.verStatus.published",
  confirmed: "home.verStatus.confirmed",
  rejected: "home.verStatus.rejected",
  expired: "home.verStatus.expired",
};

// 홈 맵 카드 상태 필 — 언어 설정과 무관하게 영어 고정(사용자 결정 2026-09-10). 상세 카드 등 다른 표면은
// 여전히 VERSION_STATUS_LABEL(i18n)을 쓴다.
export const VERSION_STATUS_LABEL_EN: Record<VersionStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  published: "Published",
  confirmed: "Confirmed",
  rejected: "Rejected",
  expired: "Expired",
};

// 홈 맵 카드 상태 필 — 도트+틴트 배경 톤(테두리 없음). [필 배경+글자, 도트] 순.
export const VERSION_STATUS_TONE: Record<VersionStatus, { pill: string; dot: string }> = {
  // dot은 차트 전용 채움 토큰(globals.css --color-chart-*) — 텍스트 시맨틱보다 밝아 8px 점·막대 조각에서 칙칙하지 않다
  draft: { pill: "bg-ink/5 text-ink-tertiary", dot: "bg-chart-draft" },
  pending: { pill: "bg-changed/10 text-changed", dot: "bg-chart-pending" },
  approved: { pill: "bg-accent-tint text-accent", dot: "bg-chart-approved" },
  published: { pill: "bg-added/10 text-added", dot: "bg-chart-published" },
  confirmed: { pill: "bg-accent-tint text-accent", dot: "bg-chart-approved" },
  rejected: { pill: "bg-error/10 text-error", dot: "bg-chart-rejected" },
  expired: { pill: "bg-ink/5 text-ink-muted", dot: "bg-chart-expired" },
};

// 상태별 pill 스타일 — 토큰만(raw hex 금지) / status pill styles, tokens only.
export const VERSION_STATUS_STYLE: Record<VersionStatus, string> = {
  draft: "border-hairline text-ink-tertiary",
  pending: "border-changed text-changed",
  approved: "border-accent text-accent",
  published: "border-added text-added",
  confirmed: "border-accent text-accent",
  rejected: "border-error text-error",
  expired: "border-hairline text-ink-tertiary",
};

// 공개 범위 pill — public/private 색 구분 / visibility pill, public vs private distinct.
export function visibilityPillClass(visibility: string): string {
  return visibility === "public"
    ? "border-added text-added"
    : "border-divider text-ink-secondary";
}

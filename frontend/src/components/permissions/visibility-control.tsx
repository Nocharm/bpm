"use client";

// 맵 공개 범위 제어 — 현재 값 표시, 소유자 토글, 승인 대기 표시 /
// Map visibility control: show current value, owner-only toggle, pending indicator.

import { useI18n } from "@/lib/i18n";
import type { MapVisibility } from "@/lib/mock/permissions";
import {
  getMapMeta,
  requestVisibilityChange,
  usePermissions,
} from "@/lib/mock/permissions";

interface VisibilityControlProps {
  mapId: string;
  /** 현재 유저 id — requestVisibilityChange의 by 인자 / Current user id for the 'by' argument. */
  currentUserId: string;
  /** 소유자 여부 — false면 읽기 전용 / Whether current user is owner; false = read-only. */
  isOwner: boolean;
  /** 토스트 발행 콜백 / Callback to show a toast. */
  onToast: (msg: string) => void;
}

export function VisibilityControl({
  mapId,
  currentUserId,
  isOwner,
  onToast,
}: VisibilityControlProps) {
  const { t } = useI18n();
  const state = usePermissions();

  const meta = getMapMeta(state, mapId);
  const current: MapVisibility = meta.visibility;

  // 이 맵에 대해 pending인 visibility_change 요청 유무 / Any pending visibility_change request.
  const hasPending = state.requests.some(
    (r) => r.mapId === mapId && r.kind === "visibility_change" && r.status === "pending",
  );

  function handleToggle() {
    if (!isOwner || hasPending) return;
    const target: MapVisibility = current === "public" ? "private" : "public";
    requestVisibilityChange(mapId, target, currentUserId);
    onToast(t("perm.visibilityToastRequested"));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-caption-strong text-ink">{t("perm.visibilityTitle")}</p>
        <p className="mt-0.5 text-fine text-ink-tertiary">{t("perm.visibilityHint")}</p>
      </div>

      <div className="flex items-center gap-3">
        {/* 현재 값 표시 / Current value display */}
        <span className="rounded-sm border border-hairline px-2 py-1 text-caption text-ink">
          {current === "public" ? t("perm.visibilityPublic") : t("perm.visibilityPrivate")}
        </span>

        {/* 승인 대기 배지 / Pending indicator */}
        {hasPending && (
          <span className="rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
            {t("perm.visibilityPending")}
          </span>
        )}

        {/* 토글 버튼 — 소유자만, 대기 중이면 비활성 / Toggle: owner-only, disabled while pending */}
        {isOwner && (
          <button
            type="button"
            disabled={hasPending}
            className="rounded-sm border border-hairline px-2 py-1 text-caption text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleToggle}
          >
            {current === "public"
              ? `→ ${t("perm.visibilityPrivate")}`
              : `→ ${t("perm.visibilityPublic")}`}
          </button>
        )}
      </div>

      {/* 공개 맵 안내 — 뷰어 그랜트 불필요 설명 / Note about viewer grants on public maps */}
      {current === "public" && (
        <p className="text-fine text-ink-tertiary">{t("perm.visibilityViewerNote")}</p>
      )}

      {/* 비소유자 읽기 전용 안내 / Read-only notice for non-owners */}
      {!isOwner && (
        <p className="text-fine text-ink-tertiary">{t("perm.visibilityReadOnly")}</p>
      )}
    </div>
  );
}

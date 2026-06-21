"use client";

// 맵 공개 범위 제어 — 현재 값 표시, 소유자 토글, 승인 대기 표시 (실 API) /
// Map visibility control wired to the real Layer-2 visibility-request API.
// 변경은 즉시 적용되지 않는다: POST 가 pending ApprovalRequest 를 반환하면 현재 값은 그대로
// 두고(서버 진실) "승인 대기"만 표시한다(낙관적 적용 금지).

import { useState } from "react";

import { requestVisibilityChange, type MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface VisibilityControlProps {
  mapId: string;
  /** 서버 진실 현재 가시성 — getMap 응답에서 전달 / Current visibility from getMap (server truth). */
  visibility: MapSummary["visibility"];
  /** 소유자 여부 — false면 읽기 전용 / Whether current user is owner; false = read-only. */
  isOwner: boolean;
  /** 토스트 발행 콜백 / Callback to show a toast. */
  onToast: (msg: string) => void;
}

export function VisibilityControl({
  mapId,
  visibility,
  isOwner,
  onToast,
}: VisibilityControlProps) {
  const { t } = useI18n();
  const mapIdNum = Number(mapId);

  // 변경 요청을 보낸 직후 pending — POST 응답(status="pending")에서 설정 /
  // Pending flag set from the POST response (status="pending"); not optimistic on visibility.
  const [pending, setPending] = useState(false);

  async function handleToggle() {
    if (!isOwner || pending) return;
    const target: MapSummary["visibility"] = visibility === "public" ? "private" : "public";
    try {
      const req = await requestVisibilityChange(mapIdNum, target);
      if (req.status === "pending") setPending(true);
      onToast(t("perm.visibilityToastRequested"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-caption-strong text-ink">{t("perm.visibilityTitle")}</p>
        <p className="mt-0.5 text-fine text-ink-tertiary">{t("perm.visibilityHint")}</p>
      </div>

      <div className="flex items-center gap-3">
        {/* 현재 값 표시 — 서버 진실(변경 미적용) / Current value (server truth, unchanged) */}
        <span className="rounded-sm border border-hairline px-2 py-1 text-caption text-ink">
          {visibility === "public" ? t("perm.visibilityPublic") : t("perm.visibilityPrivate")}
        </span>

        {/* 승인 대기 배지 / Pending indicator */}
        {pending && (
          <span className="rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
            {t("perm.visibilityPending")}
          </span>
        )}

        {/* 토글 버튼 — 소유자만, 대기 중이면 비활성 / Toggle: owner-only, disabled while pending */}
        {isOwner && (
          <button
            type="button"
            disabled={pending}
            className="rounded-sm border border-hairline px-2 py-1 text-caption text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void handleToggle()}
          >
            {visibility === "public"
              ? `→ ${t("perm.visibilityPrivate")}`
              : `→ ${t("perm.visibilityPublic")}`}
          </button>
        )}
      </div>

      {/* 공개 맵 안내 — 뷰어 그랜트 불필요 / Note about viewer grants on public maps */}
      {visibility === "public" && (
        <p className="text-fine text-ink-tertiary">{t("perm.visibilityViewerNote")}</p>
      )}

      {/* 비소유자 읽기 전용 안내 / Read-only notice for non-owners */}
      {!isOwner && (
        <p className="text-fine text-ink-tertiary">{t("perm.visibilityReadOnly")}</p>
      )}
    </div>
  );
}

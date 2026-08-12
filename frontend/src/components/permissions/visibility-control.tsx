"use client";

// 맵 공개 범위 제어 — 즉시 적용 대신 "스테이징 + 변경 적용" (PV). 적용 버튼 근처에 바뀌는 내용 미리보기.
// 변경은 visibility-request(승인 워크플로) 경유 — 적용 시 pending 마커만 표시(낙관적 적용 금지).
// 퍼블릭 전환 시 잔존 viewer 그랜트는 승인 적용 시 서버가 제거(PV).

import { useEffect, useState } from "react";

import {
  getPendingVisibilityRequest,
  requestVisibilityChange,
  withdrawApprovalRequest,
  type ApprovalRequest,
  type MapSummary,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Visibility = MapSummary["visibility"];

interface VisibilityControlProps {
  mapId: string;
  /** 서버 진실 현재 가시성 / current visibility (server truth). */
  visibility: Visibility;
  /** 소유자 여부 — false면 읽기 전용. */
  isOwner: boolean;
  onToast: (msg: string) => void;
}

export function VisibilityControl({ mapId, visibility, isOwner, onToast }: VisibilityControlProps) {
  const { t } = useI18n();
  const mapIdNum = Number(mapId);

  // 선택만 스테이징 — 적용 버튼을 눌러야 요청 전송 (PV)
  const [staged, setStaged] = useState<Visibility>(visibility);
  const [pendingReq, setPendingReq] = useState<ApprovalRequest | null>(null);
  const pending = pendingReq !== null;
  const changed = staged !== visibility;

  // 마운트 시 서버 pending 복원 — 새로고침해도 마커·철회 버튼 유지
  useEffect(() => {
    let alive = true;
    getPendingVisibilityRequest(mapIdNum)
      .then((req) => {
        if (alive) setPendingReq(req);
      })
      .catch(() => {
        // 복원 실패는 치명적이지 않음 — 요청 시 서버 409가 중복을 재차 방어
      });
    return () => {
      alive = false;
    };
  }, [mapIdNum]);

  async function handleApply() {
    if (!isOwner || pending || !changed) return;
    try {
      const req = await requestVisibilityChange(mapIdNum, staged);
      if (req.status === "pending") setPendingReq(req);
      onToast(t("perm.visibilityToastRequested"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleWithdraw() {
    if (!pendingReq) return;
    try {
      await withdrawApprovalRequest(pendingReq.id);
      setPendingReq(null);
      setStaged(visibility);
      onToast(t("perm.visibilityToastWithdrawn"));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  const options: Visibility[] = ["private", "public"];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-caption-strong text-ink">{t("perm.visibilityTitle")}</p>
        <p className="mt-0.5 text-fine text-ink-tertiary">{t("perm.visibilityHint")}</p>
      </div>

      {isOwner ? (
        <div className="flex items-center gap-1.5">
          {options.map((v) => (
            <button
              key={v}
              type="button"
              disabled={pending}
              aria-pressed={staged === v}
              className={`rounded-sm border px-2.5 py-1 text-caption disabled:cursor-not-allowed disabled:opacity-40 ${
                staged === v
                  ? "border-accent bg-accent-tint text-accent"
                  : "border-hairline text-ink hover:bg-surface-alt"
              }`}
              onClick={() => setStaged(v)}
            >
              {v === "public" ? t("perm.visibilityPublic") : t("perm.visibilityPrivate")}
              {v === visibility ? ` · ${t("perm.visibilityCurrent")}` : ""}
            </button>
          ))}
        </div>
      ) : (
        <span className="rounded-sm border border-hairline px-2 py-1 text-caption text-ink">
          {visibility === "public" ? t("perm.visibilityPublic") : t("perm.visibilityPrivate")}
        </span>
      )}

      {/* 변경 미리보기 + 적용 버튼 — 적용 버튼 근처에 바뀌는 내용 노출 (PV) */}
      {isOwner && changed && !pending && (
        <div className="flex flex-col gap-2 rounded-sm border border-hairline bg-surface-alt p-3">
          <p className="text-fine text-ink-secondary">
            {staged === "public"
              ? t("perm.visibilityPreviewPublic")
              : t("perm.visibilityPreviewPrivate")}
          </p>
          <button
            type="button"
            data-id="visibility-apply"
            className="self-start rounded-sm bg-accent px-3 py-1 text-caption font-medium text-on-accent hover:bg-accent-focus"
            onClick={() => void handleApply()}
          >
            {t("perm.visibilityApply")}
          </button>
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-2 self-start">
          <span className="rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
            {t("perm.visibilityPending")}
          </span>
          {isOwner && (
            <button
              type="button"
              data-id="visibility-withdraw"
              className="rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink hover:bg-surface-alt"
              onClick={() => void handleWithdraw()}
            >
              {t("perm.visibilityWithdraw")}
            </button>
          )}
        </div>
      )}

      {!isOwner && (
        <p className="text-fine text-ink-tertiary">{t("perm.visibilityReadOnly")}</p>
      )}
    </div>
  );
}

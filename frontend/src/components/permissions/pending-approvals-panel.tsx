"use client";

// 맵별 결재 대기 패널 — 승인자·sysadmin 전용 / Per-map pending approvals panel (approver or sysadmin only).
// ③ 권한 하향 / ④ 공개범위 변경 요청만 표시 — version_publish는 버전 탭에서, owner-transfer는 confirm 모달에서 처리.

import { useI18n } from "@/lib/i18n";
import { usePermissions, decideRequest } from "@/lib/mock/permissions";
import type { DowngradePayload, VisibilityChangePayload } from "@/lib/mock/permissions-types";
import { genId } from "@/lib/id";
import type { ToastItem } from "@/components/toast-stack";

interface Props {
  mapId: string;
  currentUserId: string;
  onToast: (item: ToastItem) => void;
}

export function PendingApprovalsPanel({ mapId, currentUserId, onToast }: Props) {
  const { t } = useI18n();
  const state = usePermissions();

  // 이 맵의 ③④ 대기 요청만 필터 / Filter only ③④ pending requests for this map.
  const pendingRequests = state.requests.filter(
    (r) =>
      r.mapId === mapId &&
      r.status === "pending" &&
      (r.kind === "permission_downgrade" || r.kind === "visibility_change"),
  );

  function handleDecide(requestId: string, decision: "approved" | "rejected") {
    decideRequest(requestId, decision, currentUserId);
    onToast({
      id: genId(),
      message: decision === "approved" ? t("perm.approvals.toastApproved") : t("perm.approvals.toastRejected"),
    });
  }

  // 요청 내용 요약 — kind별 / Summarise request detail by kind.
  function renderDetail(kind: string, payload: unknown): string {
    if (kind === "permission_downgrade") {
      const p = payload as DowngradePayload;
      const to = p.toRole ?? t("perm.approvals.roleRemoved");
      return `${p.principalType}:${p.principalId}  ${p.fromRole} → ${to}`;
    }
    if (kind === "visibility_change") {
      const p = payload as VisibilityChangePayload;
      return `${p.from} → ${p.to}`;
    }
    return String(payload);
  }

  if (pendingRequests.length === 0) {
    return (
      <p className="py-8 text-center text-caption text-ink-tertiary">
        {t("perm.approvals.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {pendingRequests.map((req) => {
        const kindLabel =
          req.kind === "permission_downgrade"
            ? t("perm.approvals.kindDowngrade")
            : t("perm.approvals.kindVisibility");
        const detail = renderDetail(req.kind, req.payload);

        return (
          <div
            key={req.id}
            className="flex items-center justify-between rounded-md border border-hairline bg-surface px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              {/* 종류 + 요약 / Kind badge + summary */}
              <div className="flex items-center gap-2">
                <span className="rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
                  {kindLabel}
                </span>
                <span className="truncate text-caption text-ink">{detail}</span>
              </div>
              {/* 요청자 / Requester */}
              <span className="text-fine text-ink-tertiary">
                {t("perm.approvals.requesterLabel")}: {req.requestedBy}
              </span>
            </div>

            {/* 승인/반려 버튼 / Approve / reject buttons */}
            <div className="ml-4 flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="rounded-sm border border-added px-2.5 py-1 text-fine text-added hover:bg-surface-alt"
                onClick={() => handleDecide(req.id, "approved")}
              >
                {t("perm.approvals.approve")}
              </button>
              <button
                type="button"
                className="rounded-sm border border-error px-2.5 py-1 text-fine text-error hover:bg-surface-alt"
                onClick={() => handleDecide(req.id, "rejected")}
              >
                {t("perm.approvals.reject")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

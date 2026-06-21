"use client";

// 시스템 관리자 승인 큐 — 그룹 생성(mock, Layer 4) + 권한 하향/공개범위 변경(mock 미리보기) /
// Sysadmin approval queue: group creation (mock, Layer 4) + permission/visibility requests (mock preview).
// REAL vs MOCK: 맵 권한·가시성 결재의 실 API(decide)는 맵별 설정 화면(PendingApprovalsPanel)에서 처리한다.
// 여기 MAP 요청은 mock 그대로 둔다 — 백엔드에 cross-map 결재 목록 엔드포인트가 없어 전역 큐를 실 API로 채울 수 없음(Layer 4 보고).
// REAL map decisions live in the per-map settings panel; this console has no cross-map list endpoint, so MAP rows stay mock.
// Owner-transfer is excluded (handled by confirm modal, not a queue item).
// version_publish is absent from state.requests (lives in versionFlow) — excluded by design.

import { useI18n } from "@/lib/i18n";
import { usePermissions, decideRequest, decideGroup } from "@/lib/mock/permissions";
import type { ApprovalKind, DowngradePayload, VisibilityChangePayload } from "@/lib/mock/permissions-types";
import { genId } from "@/lib/id";
import type { ToastItem } from "@/components/toast-stack";

interface Props {
  currentUserId: string;
  onToast: (item: ToastItem) => void;
}

export function ApprovalQueue({ currentUserId, onToast }: Props) {
  const { t } = useI18n();
  const state = usePermissions();

  // 그룹 생성 대기 / Pending group creation requests.
  const pendingGroups = state.groups.filter((g) => g.status === "pending");

  // 권한·가시성 변경 대기 (version_publish는 versionFlow 전용 — 여기 미포함) /
  // Pending permission/visibility requests (version_publish excluded — lives in versionFlow).
  const pendingRequests = state.requests.filter(
    (r) => r.status === "pending" && r.kind !== "version_publish",
  );

  const isEmpty = pendingGroups.length === 0 && pendingRequests.length === 0;

  function handleDecideGroup(groupId: string, decision: "active" | "rejected") {
    decideGroup(groupId, decision);
    onToast({
      id: genId(),
      message: decision === "active" ? t("perm.sysadmin.toastApproved") : t("perm.sysadmin.toastRejected"),
    });
  }

  function handleDecideRequest(requestId: string, decision: "approved" | "rejected") {
    decideRequest(requestId, decision, currentUserId);
    onToast({
      id: genId(),
      message: decision === "approved" ? t("perm.sysadmin.toastApproved") : t("perm.sysadmin.toastRejected"),
    });
  }

  // 요청 내용 요약 — kind별 / Summarise request detail by kind.
  function renderRequestDetail(kind: ApprovalKind, payload: unknown): string {
    if (kind === "permission_downgrade") {
      const p = payload as DowngradePayload;
      const to = p.toRole ?? t("perm.approvals.roleRemoved");
      return `${p.principalType}:${p.principalId} ${p.fromRole} → ${to}`;
    }
    if (kind === "visibility_change") {
      const p = payload as VisibilityChangePayload;
      return `${p.from} → ${p.to}`;
    }
    return String(payload);
  }

  if (isEmpty) {
    return (
      <p className="py-8 text-center text-caption text-ink-tertiary">
        {t("perm.sysadmin.queueEmpty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 그룹 생성 요청 / Group creation requests */}
      {pendingGroups.map((group) => (
        <div
          key={group.id}
          className="flex items-center justify-between rounded-md border border-hairline bg-surface px-4 py-3"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
                {t("perm.sysadmin.kindGroupCreate")}
              </span>
              <span className="truncate text-caption text-ink">{group.name}</span>
            </div>
            <span className="text-fine text-ink-tertiary">
              {t("perm.sysadmin.managerLabel")}: {group.managerIds.join(", ")}
            </span>
          </div>
          <div className="ml-4 flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-sm border border-added px-3 py-1 text-fine text-added hover:bg-surface-alt"
              onClick={() => handleDecideGroup(group.id, "active")}
            >
              {t("perm.sysadmin.approve")}
            </button>
            <button
              type="button"
              className="rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-surface-alt"
              onClick={() => handleDecideGroup(group.id, "rejected")}
            >
              {t("perm.sysadmin.reject")}
            </button>
          </div>
        </div>
      ))}

      {/* 맵 권한·가시성 요청은 mock 미리보기 — 실 결재는 맵별 설정 화면에서 / Map rows are a mock preview; real decisions are per-map. */}
      {pendingRequests.length > 0 && (
        <p className="px-1 pt-1 text-fine text-ink-tertiary">
          {t("perm.sysadmin.mapMockNote")}
        </p>
      )}

      {/* 권한·가시성 변경 요청 / Permission & visibility change requests */}
      {pendingRequests.map((req) => {
        const kindLabel =
          req.kind === "permission_downgrade"
            ? t("perm.sysadmin.kindDowngrade")
            : t("perm.sysadmin.kindVisibility");
        const detail = renderRequestDetail(req.kind, req.payload);
        return (
          <div
            key={req.id}
            className="flex items-center justify-between rounded-md border border-hairline bg-surface px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="rounded-sm border border-changed px-1.5 py-0.5 text-fine text-changed">
                  {kindLabel}
                </span>
                <span className="text-fine text-ink-secondary">
                  {t("perm.sysadmin.mapLabel")} {req.mapId}
                </span>
              </div>
              <span className="truncate text-fine text-ink-tertiary">
                {t("perm.sysadmin.detailLabel")}: {detail}
              </span>
              <span className="text-fine text-ink-tertiary">
                {t("perm.sysadmin.requesterLabel")}: {req.requestedBy}
              </span>
            </div>
            <div className="ml-4 flex shrink-0 gap-2">
              <button
                type="button"
                className="rounded-sm border border-added px-3 py-1 text-fine text-added hover:bg-surface-alt"
                onClick={() => handleDecideRequest(req.id, "approved")}
              >
                {t("perm.sysadmin.approve")}
              </button>
              <button
                type="button"
                className="rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-surface-alt"
                onClick={() => handleDecideRequest(req.id, "rejected")}
              >
                {t("perm.sysadmin.reject")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

// 시스템 관리자 승인 큐 — 그룹 생성(실 API) + 권한 하향/공개범위 변경(mock 미리보기) /
// Sysadmin approval queue: group creation (REAL API) + permission/visibility requests (mock preview).
// 그룹 큐는 GET /api/groups/pending + POST /api/groups/{id}/decide(실 API). 결정 후 재조회한다.
// MAP 요청 행은 mock 그대로 — 백엔드에 cross-map 결재 목록 엔드포인트가 없어 전역 큐를 실 API로 채울 수 없음(Layer 4 보고).
// 맵 권한·가시성 실 결재는 맵별 설정(PendingApprovalsPanel)에서 처리한다. /
// Group queue is REAL; MAP rows stay a labeled mock preview (no cross-map list endpoint).
// Owner-transfer is excluded (handled by confirm modal). version_publish lives in versionFlow.

import { useCallback, useEffect, useState } from "react";

import { decideGroup, listPendingGroups, type Group } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermissions, decideRequest } from "@/lib/mock/permissions";
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

  // 그룹 생성 대기 — 실 API / Pending group creations (real API).
  const [pendingGroups, setPendingGroups] = useState<Group[]>([]);

  const reloadGroups = useCallback(async () => {
    try {
      setPendingGroups(await listPendingGroups());
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
  }, [onToast]);

  // 초기 로드 — 인라인 async + active 가드(set-state-in-effect 회피, lessons) /
  // Initial load: inline async with an active guard (avoids set-state-in-effect lint).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await listPendingGroups();
        if (active) setPendingGroups(rows);
      } catch (err) {
        if (active) onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      active = false;
    };
  }, [onToast]);

  // 권한·가시성 변경 대기 (version_publish는 versionFlow 전용 — 여기 미포함, mock) /
  // Pending permission/visibility requests (mock preview; version_publish excluded).
  const pendingRequests = state.requests.filter(
    (r) => r.status === "pending" && r.kind !== "version_publish",
  );

  const isEmpty = pendingGroups.length === 0 && pendingRequests.length === 0;

  async function handleDecideGroup(groupId: number, decision: "approve" | "reject") {
    try {
      await decideGroup(groupId, decision);
      onToast({
        id: genId(),
        message: decision === "approve" ? t("perm.sysadmin.toastApproved") : t("perm.sysadmin.toastRejected"),
      });
      await reloadGroups();
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
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
      {/* 그룹 생성 요청 — 실 API / Group creation requests (real API) */}
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
              {t("perm.sysadmin.managerLabel")}: {group.managers.join(", ")}
            </span>
          </div>
          <div className="ml-4 flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded-sm border border-added px-3 py-1 text-fine text-added hover:bg-surface-alt"
              onClick={() => void handleDecideGroup(group.id, "approve")}
            >
              {t("perm.sysadmin.approve")}
            </button>
            <button
              type="button"
              className="rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-surface-alt"
              onClick={() => void handleDecideGroup(group.id, "reject")}
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

      {/* 권한·가시성 변경 요청 (mock) / Permission & visibility change requests (mock) */}
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

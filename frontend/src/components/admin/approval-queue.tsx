"use client";

// 시스템 관리자 승인 큐 — 그룹 생성 + 맵 권한 하향/공개범위 변경 (모두 실 API) (A3) /
// Sysadmin approval queue: group creation + map permission/visibility requests (all REAL API).
// 그룹: GET /api/groups/pending + POST /api/groups/{id}/decide.
// 맵 요청: GET /api/approval-requests(교차맵 sysadmin 큐) + POST /api/approval-requests/{id}/decide(approve→적용).
// 결정 후 재조회(낙관적 갱신 금지). Owner-transfer·version_publish 는 별도 경로.

import { useCallback, useEffect, useState } from "react";

import {
  decideApprovalRequest,
  decideGroup,
  listPendingApprovalRequests,
  listPendingGroups,
  type ApprovalRequest,
  type Group,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import type { ToastItem } from "@/components/toast-stack";

interface Props {
  onToast: (item: ToastItem) => void;
  // 좌측 nav 배지용 — 로드/결정 후 대기 건수(그룹+요청) 보고 / report pending count for the nav badge.
  onCountChange?: (count: number) => void;
}

export function ApprovalQueue({ onToast, onCountChange }: Props) {
  const { t } = useI18n();

  // 그룹 생성 대기 + 맵 권한·가시성 변경 대기 — 둘 다 실 API / Both queues from real API.
  const [pendingGroups, setPendingGroups] = useState<Group[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ApprovalRequest[]>([]);
  // 결정 진행 중 요청 id — 버튼 중복 클릭 방지 / in-flight decisions to disable buttons.
  const [decidingIds, setDecidingIds] = useState<Set<number>>(new Set());

  const reload = useCallback(async () => {
    try {
      const [groups, requests] = await Promise.all([
        listPendingGroups(),
        listPendingApprovalRequests(),
      ]);
      setPendingGroups(groups);
      setPendingRequests(requests);
      onCountChange?.(groups.length + requests.length);
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
  }, [onToast, onCountChange]);

  // 초기 로드 — 인라인 async + active 가드(set-state-in-effect 회피) / Initial load with active guard.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [groups, requests] = await Promise.all([
          listPendingGroups(),
          listPendingApprovalRequests(),
        ]);
        if (active) {
          setPendingGroups(groups);
          setPendingRequests(requests);
          onCountChange?.(groups.length + requests.length);
        }
      } catch (err) {
        if (active) onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      active = false;
    };
  }, [onToast, onCountChange]);

  const isEmpty = pendingGroups.length === 0 && pendingRequests.length === 0;

  async function handleDecideGroup(groupId: number, decision: "approve" | "reject") {
    try {
      await decideGroup(groupId, decision);
      onToast({
        id: genId(),
        message: decision === "approve" ? t("perm.sysadmin.toastApproved") : t("perm.sysadmin.toastRejected"),
      });
      await reload();
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleDecideRequest(requestId: number, decision: "approve" | "reject") {
    setDecidingIds((prev) => new Set(prev).add(requestId));
    try {
      // approve → 서버가 권한 하향/가시성 변경을 즉시 적용(applied), reject → 변경 없음.
      await decideApprovalRequest(requestId, decision);
      onToast({
        id: genId(),
        message: decision === "approve" ? t("perm.sysadmin.toastApproved") : t("perm.sysadmin.toastRejected"),
      });
      await reload();
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    } finally {
      setDecidingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  }

  // 요청 내용 요약 — kind별 실 payload / Summarise request detail by kind (real payload).
  function renderRequestDetail(req: ApprovalRequest): string {
    if (req.kind === "permission_downgrade") {
      const p = req.payload;
      const from = String(p.from_role ?? "");
      const to = p.to_role == null ? t("perm.approvals.roleRemoved") : String(p.to_role);
      return `${String(p.principal_type)}:${String(p.principal_id)}  ${from} → ${to}`;
    }
    if (req.kind === "visibility_change") {
      return String(req.payload.to_visibility ?? "");
    }
    return JSON.stringify(req.payload);
  }

  if (isEmpty) {
    return (
      <p className="py-8 text-center text-caption text-ink-tertiary">
        {t("perm.sysadmin.queueEmpty")}
      </p>
    );
  }

  return (
    <div className="flex max-w-4xl flex-col gap-2">
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

      {/* 맵 권한·가시성 변경 요청 — 실 API (교차맵). approve 시 서버가 즉시 적용 / Map requests (real, cross-map). */}
      {pendingRequests.map((req) => {
        const kindLabel =
          req.kind === "permission_downgrade"
            ? t("perm.sysadmin.kindDowngrade")
            : t("perm.sysadmin.kindVisibility");
        const detail = renderRequestDetail(req);
        const isDeciding = decidingIds.has(req.id);
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
                  {t("perm.sysadmin.mapLabel")} {req.map_id}
                </span>
              </div>
              <span className="truncate text-fine text-ink-tertiary">
                {t("perm.sysadmin.detailLabel")}: {detail}
              </span>
              <span className="text-fine text-ink-tertiary">
                {t("perm.sysadmin.requesterLabel")}: {req.requested_by}
              </span>
            </div>
            <div className="ml-4 flex shrink-0 gap-2">
              <button
                type="button"
                className="rounded-sm border border-added px-3 py-1 text-fine text-added hover:bg-surface-alt disabled:opacity-40"
                onClick={() => void handleDecideRequest(req.id, "approve")}
                disabled={isDeciding}
              >
                {t("perm.sysadmin.approve")}
              </button>
              <button
                type="button"
                className="rounded-sm border border-error px-3 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-40"
                onClick={() => void handleDecideRequest(req.id, "reject")}
                disabled={isDeciding}
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

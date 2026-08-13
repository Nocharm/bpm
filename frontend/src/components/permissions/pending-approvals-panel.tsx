"use client";

// 맵별 결재 대기 패널 — 오너·승인자·sysadmin, 실 API / Per-map pending approvals panel (owner/approver/sysadmin), real API.
// permission_downgrade·visibility_change·map_rename·sp_designation 4종 — version_publish는 버전 탭, owner-transfer는 confirm 모달에서 처리.
// 서버 진실: approve 시 서버가 각 kind의 변경을 적용한다. 결정 후 요청 목록을 재조회한다(낙관적 갱신 금지).

import { useCallback, useEffect, useState } from "react";

import {
  decideApprovalRequest,
  listApprovalRequests,
  type ApprovalRequest,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import type { ToastItem } from "@/components/toast-stack";
import { genId } from "@/lib/id";

// 결재 대기 탭이 다루는 ApprovalRequest 4종 — 결정권은 kind별로 다름(오너 vs 승인자) (설계 §C)
const APPROVAL_KINDS = new Set([
  "permission_downgrade",
  "visibility_change",
  "map_rename",
  "sp_designation",
]);

// 버전에 동봉된 visibility_change 행 — 버전 승인으로만 결정되는 읽기전용이라 결재 대기 배지에 세지 않는다.
function isBundledRow(r: ApprovalRequest): boolean {
  return r.kind === "visibility_change" && r.payload.version_id != null;
}

function countPending(rows: ApprovalRequest[]): number {
  return rows.filter((r) => r.status === "pending" && APPROVAL_KINDS.has(r.kind) && !isBundledRow(r)).length;
}

interface Props {
  mapId: string;
  /** rename/sp_designation 행 결정권 — 오너(sysadmin 포함) 여부. */
  isOwner: boolean;
  /** permission/visibility 행 결정권 — 지정 승인자 또는 sysadmin 여부. */
  isApprover: boolean;
  /** pending 개수 통지 — 좌측 레일 배지용(로드·결정 후 호출). */
  onCountChange?: (count: number) => void;
  /** 결정 후 호출 — 호스트가 맵/협업자 데이터를 재조회하도록 / Called after a decision so the host can refetch map data. */
  onDecided?: () => void;
  onToast: (item: ToastItem) => void;
}

export function PendingApprovalsPanel({
  mapId,
  isOwner,
  isApprover,
  onCountChange,
  onDecided,
  onToast,
}: Props) {
  const { t } = useI18n();
  const mapIdNum = Number(mapId);

  // 서버 결재 요청 목록 / Server-sourced approval requests.
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  // 결정 진행 중인 요청 id — 더블클릭/중복 결정 방지 / Ids being decided, to disable buttons.
  const [decidingIds, setDecidingIds] = useState<Set<number>>(new Set());

  const reload = useCallback(async () => {
    try {
      const rows = await listApprovalRequests(mapIdNum);
      setRequests(rows);
      onCountChange?.(countPending(rows));
    } catch (err) {
      onToast({ id: genId(), message: humanizeApiError(err, t) });
    }
  }, [mapIdNum, onToast, onCountChange, t]);

  // 초기 로드 — active 가드로 언마운트 후 setState 방지 / Initial load with an unmount guard.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await listApprovalRequests(mapIdNum);
        if (active) {
          setRequests(rows);
          onCountChange?.(countPending(rows));
        }
      } catch (err) {
        if (active) onToast({ id: genId(), message: humanizeApiError(err, t) });
      }
    })();
    return () => {
      active = false;
    };
  }, [mapIdNum, onToast, onCountChange, t]);

  const handleDecide = useCallback(
    async (requestId: number, decision: "approve" | "reject") => {
      setDecidingIds((prev) => new Set(prev).add(requestId));
      try {
        await decideApprovalRequest(requestId, decision);
        // 서버가 적용함 — 목록 + 호스트의 맵 데이터(역할/가시성) 재조회 / Server applied; refetch list + host map data.
        await reload();
        onDecided?.();
        onToast({
          id: genId(),
          message:
            decision === "approve"
              ? t("perm.approvals.toastApproved")
              : t("perm.approvals.toastRejected"),
        });
      } catch (err) {
        onToast({ id: genId(), message: humanizeApiError(err, t) });
      } finally {
        setDecidingIds((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      }
    },
    [reload, onDecided, onToast, t],
  );

  const pendingRequests = requests.filter(
    (r) => r.status === "pending" && APPROVAL_KINDS.has(r.kind),
  );

  function canDecideKind(kind: string): boolean {
    return kind === "map_rename" || kind === "sp_designation" ? isOwner : isApprover;
  }

  // 요청 내용 요약 — kind별 / Summarise request detail by kind.
  function renderDetail(req: ApprovalRequest): string {
    if (req.kind === "permission_downgrade") {
      const p = req.payload;
      const from = String(p.from_role ?? "");
      const to = p.to_role == null ? t("perm.approvals.roleRemoved") : String(p.to_role);
      return `${String(p.principal_type)}:${String(p.principal_id)}  ${from} → ${to}`;
    }
    if (req.kind === "visibility_change") {
      return String(req.payload.to_visibility ?? "");
    }
    if (req.kind === "map_rename") {
      return `${String(req.payload.from_name ?? "")} → ${String(req.payload.to_name ?? "")}`;
    }
    if (req.kind === "sp_designation") {
      // 요청 발원 맵 표시 — 이 맵을 SP로 등록해달라는 요청
      return String(req.payload.from_map_name ?? req.payload.map_name ?? "");
    }
    return JSON.stringify(req.payload);
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
            : req.kind === "visibility_change"
              ? t("perm.approvals.kindVisibility")
              : req.kind === "map_rename"
                ? t("perm.approvals.kindRename")
                : t("perm.approvals.kindSpDesignation");
        const detail = renderDetail(req);
        const isDeciding = decidingIds.has(req.id);
        const isBundled = isBundledRow(req);

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
                {t("perm.approvals.requesterLabel")}: {req.requested_by}
              </span>
            </div>

            {/* 승인/반려 버튼 — 결정권 없는 행은 안내만 / Approve / reject buttons — read-only hint otherwise */}
            {isBundled ? (
              <span className="ml-4 shrink-0 text-fine text-ink-tertiary">
                {t("perm.approvals.bundledWithVersion")}
              </span>
            ) : canDecideKind(req.kind) ? (
              <div className="ml-4 flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={isDeciding}
                  className="rounded-sm border border-added px-2.5 py-1 text-fine text-added hover:bg-surface-alt disabled:opacity-50"
                  onClick={() => void handleDecide(req.id, "approve")}
                >
                  {t("perm.approvals.approve")}
                </button>
                <button
                  type="button"
                  disabled={isDeciding}
                  className="rounded-sm border border-error px-2.5 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-50"
                  onClick={() => void handleDecide(req.id, "reject")}
                >
                  {t("perm.approvals.reject")}
                </button>
              </div>
            ) : (
              <span className="ml-4 shrink-0 text-fine text-ink-tertiary">
                {req.kind === "map_rename" || req.kind === "sp_designation"
                  ? t("perm.approvals.ownerDecides")
                  : t("perm.approvals.approverDecides")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

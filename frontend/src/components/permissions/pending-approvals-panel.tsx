"use client";

// 맵별 결재 대기 패널 — 승인자·sysadmin 전용, 실 API / Per-map pending approvals panel (approver/sysadmin), real API.
// ③ 권한 하향 / ④ 공개범위 변경 요청만 표시 — version_publish는 버전 탭, owner-transfer는 confirm 모달에서 처리.
// 서버 진실: approve 시 서버가 권한 하향/가시성 변경을 적용한다. 결정 후 요청 목록을 재조회한다(낙관적 갱신 금지).

import { useCallback, useEffect, useState } from "react";

import {
  decideApprovalRequest,
  listApprovalRequests,
  type ApprovalRequest,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ToastItem } from "@/components/toast-stack";
import { genId } from "@/lib/id";

interface Props {
  mapId: string;
  /** 결정 후 호출 — 호스트가 맵/협업자 데이터를 재조회하도록 / Called after a decision so the host can refetch map data. */
  onDecided?: () => void;
  onToast: (item: ToastItem) => void;
}

export function PendingApprovalsPanel({ mapId, onDecided, onToast }: Props) {
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
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
  }, [mapIdNum, onToast]);

  // 초기 로드 — active 가드로 언마운트 후 setState 방지 / Initial load with an unmount guard.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await listApprovalRequests(mapIdNum);
        if (active) setRequests(rows);
      } catch (err) {
        if (active) onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      active = false;
    };
  }, [mapIdNum, onToast]);

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
        onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
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

  // 이 맵의 ③④ 대기 요청만 / Only pending ③④ requests for this map.
  const pendingRequests = requests.filter(
    (r) =>
      r.status === "pending" &&
      (r.kind === "permission_downgrade" || r.kind === "visibility_change"),
  );

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
            : t("perm.approvals.kindVisibility");
        const detail = renderDetail(req);
        const isDeciding = decidingIds.has(req.id);

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

            {/* 승인/반려 버튼 / Approve / reject buttons */}
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
          </div>
        );
      })}
    </div>
  );
}

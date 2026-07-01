"use client";

// 맵별 점유권 요청 대기 패널 — 소유자·sysadmin 전용 / Per-map checkout request panel (owner/sysadmin).
// 보유자(holder)는 에디터 승인탭에서 처리 — 여기선 소유자·sysadmin만 표시.
// 결정 후 목록 재조회(낙관적 갱신 금지).

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, X } from "lucide-react";

import {
  decideCheckoutRequest,
  getDirectory,
  getPendingCheckoutRequests,
  type CheckoutRequestQueue,
  type DirectoryUser,
} from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { genId } from "@/lib/id";
import type { ToastItem } from "@/components/toast-stack";

interface Props {
  mapId: string;
  /** 결정 후 호출 — 호스트가 맵 데이터를 재조회하도록 / Called after a decision so the host can refetch. */
  onDecided?: () => void;
  onToast: (item: ToastItem) => void;
}

export function CheckoutRequestsPanel({ mapId, onDecided, onToast }: Props) {
  const { t } = useI18n();
  const mapIdNum = Number(mapId);

  const [requests, setRequests] = useState<CheckoutRequestQueue[]>([]);
  // 결정 진행 중인 요청 id — 중복 결정 방지 / Ids being decided, to disable buttons.
  const [decidingIds, setDecidingIds] = useState<Set<number>>(new Set());
  // 요청자 login_id → 이름 해석 / resolve requester login_id to display name.
  const [usersById, setUsersById] = useState<Map<string, DirectoryUser>>(new Map());

  useEffect(() => {
    let active = true;
    void getDirectory()
      .then((dir) => {
        if (active) setUsersById(new Map(dir.users.map((u) => [u.id, u])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const rows = await getPendingCheckoutRequests(mapIdNum);
      setRequests(rows);
    } catch (err) {
      onToast({ id: genId(), message: err instanceof Error ? err.message : String(err) });
    }
  }, [mapIdNum, onToast]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await getPendingCheckoutRequests(mapIdNum);
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
    async (requestId: number, approve: boolean) => {
      setDecidingIds((prev) => new Set(prev).add(requestId));
      try {
        await decideCheckoutRequest(requestId, approve);
        // 서버가 적용함 — 목록 + 호스트 재조회 / Server applied; refetch list + notify host.
        await reload();
        onDecided?.();
        onToast({
          id: genId(),
          message: approve ? t("perm.checkout.toastApproved") : t("perm.checkout.toastRejected"),
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

  if (requests.length === 0) {
    return (
      <p className="py-8 text-center text-caption text-ink-tertiary">
        {t("perm.checkout.empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {requests.map((req) => {
        const isDeciding = decidingIds.has(req.id);
        return (
          <div
            key={req.id}
            className="flex items-center justify-between rounded-md border border-hairline bg-surface px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              {/* 버전 라벨 / Version label */}
              <span className="text-caption-strong text-ink">{req.version_label}</span>
              {/* 요청자 + 요청 시각 / Requester + requested at */}
              <span className="flex items-center gap-2 text-fine text-ink-tertiary">
                <span>
                  {t("perm.checkout.requesterLabel")}: {usersById.get(req.requested_by)?.name ?? req.requested_by}
                </span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} strokeWidth={1.5} />
                  {formatKstShort(req.created_at)}
                </span>
              </span>
            </div>

            {/* 승인/반려 버튼 / Approve / reject buttons */}
            <div className="ml-4 flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={isDeciding}
                className="inline-flex items-center gap-1 rounded-sm border border-added px-2.5 py-1 text-fine text-added hover:bg-surface-alt disabled:opacity-50"
                onClick={() => void handleDecide(req.id, true)}
              >
                <Check size={13} strokeWidth={1.5} />
                {t("perm.checkout.approve")}
              </button>
              <button
                type="button"
                disabled={isDeciding}
                className="inline-flex items-center gap-1 rounded-sm border border-error px-2.5 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-50"
                onClick={() => void handleDecide(req.id, false)}
              >
                <X size={13} strokeWidth={1.5} />
                {t("perm.checkout.reject")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

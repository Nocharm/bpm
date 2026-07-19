"use client";

// 미지정 링크 등록 요청 CTA — 인스펙터 subprocess 섹션 (spec 2026-07-19).
// pending이면 Requested 배지(본인 요청은 철회 가능), 없으면 요청 발송 버튼.
// 부모가 key={linkedMapId}로 마운트해 링크 전환 시 상태가 리셋된다.

import { Send, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ApiError,
  createSpDesignationRequest,
  getApiErrorDetail,
  getPendingSpDesignationRequest,
  withdrawSpDesignationRequest,
  type ApprovalRequest,
} from "@/lib/api";
import { useCurrentMockUser } from "@/lib/mock/current-mock-user";
import { useI18n } from "@/lib/i18n";

interface SubprocessRegistrationCtaProps {
  linkedMapId: number;
  // 요청 컨텍스트 — 현재 편집 중인 호스트 맵(Inbox 카드의 from_map 표시)
  fromMapId: number;
  onToast?: (message: string) => void;
}

export function SubprocessRegistrationCta({
  linkedMapId,
  fromMapId,
  onToast,
}: SubprocessRegistrationCtaProps) {
  const { t } = useI18n();
  const currentUser = useCurrentMockUser();
  const [pending, setPending] = useState<ApprovalRequest | null>(null);
  const [busy, setBusy] = useState(false);

  // pending 조회 — 실패는 조용히 무시(요청 버튼만 노출, 발송 시 서버가 재검증)
  useEffect(() => {
    let active = true;
    void getPendingSpDesignationRequest(linkedMapId)
      .then((req) => {
        if (active) setPending(req);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [linkedMapId]);

  async function refreshPending() {
    try {
      setPending(await getPendingSpDesignationRequest(linkedMapId));
    } catch {
      // 조회 실패 — 기존 표시 유지
    }
  }

  async function handleRequest() {
    if (busy) return;
    setBusy(true);
    try {
      const req = await createSpDesignationRequest(linkedMapId, fromMapId);
      setPending(req);
      onToast?.(t("library.requestSent"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        onToast?.(t("library.requestAlreadyPending"));
        await refreshPending();
      } else {
        onToast?.(getApiErrorDetail(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (busy) return;
    setBusy(true);
    try {
      await withdrawSpDesignationRequest(linkedMapId);
      setPending(null);
      onToast?.(t("sp.request.withdrawn"));
    } catch (err) {
      onToast?.(getApiErrorDetail(err));
      await refreshPending();
    } finally {
      setBusy(false);
    }
  }

  if (pending !== null) {
    const mine = currentUser !== null && pending.requested_by === currentUser.id;
    return (
      <div
        data-id="sp-registration-pending"
        className="flex items-center justify-between gap-2 rounded-md border border-hairline px-3 py-2"
      >
        <span className="rounded-xs bg-accent-tint px-1.5 py-px text-fine font-semibold text-accent">
          {t("sp.request.pending")}
        </span>
        {mine && (
          <button
            type="button"
            data-id="sp-registration-withdraw"
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
            onClick={() => void handleWithdraw()}
            disabled={busy}
          >
            <Undo2 size={14} strokeWidth={1.5} />
            {t("sp.request.withdraw")}
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-id="sp-registration-cta"
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-caption text-accent hover:bg-surface-alt"
      onClick={() => void handleRequest()}
      disabled={busy}
    >
      <Send size={16} strokeWidth={1.5} />
      {t("sp.request.cta")}
    </button>
  );
}

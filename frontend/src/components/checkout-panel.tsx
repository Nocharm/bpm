"use client";

// 점유권 탭 — 프로그레스바 위 접이식 섹션(기본 접힘). 현재 점유자(+출처/획득시각) + 미결 요청자들.
// 요청이 있으면 헤더에 빨간 닷. 결정권자(보유자/오너/sysadmin)는 요청 카드 호버 시 승인/거절,
// 요청자는 자기 요청을 철회. draft에서만 조작 가능(그 외 view-only, 버튼 숨김·흐림).
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, User, X } from "lucide-react";

import type { WorkflowState } from "@/lib/api";
import { relativeAgo } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

interface CheckoutPanelProps {
  workflow: WorkflowState | null;
  username: string | null;
  /** 결정권자 — 보유자/오너/sysadmin (승인·거절 가능) */
  canDecide: boolean;
  /** 조작 가능 상태 — draft 전용. false면 view-only(버튼 숨김) */
  interactive: boolean;
  /** login_id → 표시명 */
  resolveName: (id: string) => string;
  onDecide: (requestId: number, approve: boolean) => void;
  onWithdraw: (requestId: number) => void;
}

export function CheckoutPanel({
  workflow,
  username,
  canDecide,
  interactive,
  resolveName,
  onDecide,
  onWithdraw,
}: CheckoutPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const holder = workflow?.checkout_holder ?? null;
  const requests = workflow?.pending_checkout_requests ?? [];
  const hasRequests = requests.length > 0;

  const relText = (iso?: string | null): string => {
    const r = relativeAgo(iso);
    if (r === null) return "";
    if (r.unit === "now") return t("time.now");
    const key: MessageKey =
      r.unit === "min" ? "time.minAgo" : r.unit === "hour" ? "time.hourAgo" : "time.dayAgo";
    return t(key, { n: r.n });
  };

  return (
    <div
      data-id="checkout-panel"
      className={`rounded-sm border border-hairline ${interactive ? "" : "opacity-60"}`}
    >
      {/* 헤더 — 접기 토글 + 현재 점유자 + 요청 빨간 닷 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-sm px-3 py-2 text-left hover:bg-surface-alt"
      >
        {open ? (
          <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        ) : (
          <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        )}
        <span className="shrink-0 text-fine text-ink-tertiary">{t("checkout.title")}</span>
        <span className="min-w-0 flex-1 truncate text-caption text-ink">
          {holder ? resolveName(holder) : t("checkout.none")}
        </span>
        {hasRequests && (
          <span className="flex shrink-0 items-center gap-1 text-fine text-error">
            <span className="h-1.5 w-1.5 rounded-full bg-error" />
            {requests.length}
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-hairline px-3 py-2">
          {/* 현재 점유자 — 아바타 + 출처(누구에게서)·획득 상대시각 */}
          {holder ? (
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-fine font-semibold text-accent">
                {resolveName(holder).slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-caption text-ink">
                  {resolveName(holder)}
                  {holder === username ? ` (${t("approval.you")})` : ""}
                </div>
                <div className="truncate text-fine text-ink-tertiary">
                  {workflow?.checkout_from
                    ? t("checkout.fromWhen", {
                        name: resolveName(workflow.checkout_from),
                        ago: relText(workflow.checkout_holder_since),
                      })
                    : relText(workflow?.checkout_holder_since)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-caption text-ink-tertiary">{t("checkout.none")}</p>
          )}

          {/* 미결 요청자들 */}
          {hasRequests && (
            <div className="flex flex-col gap-1.5">
              <span className="text-fine text-ink-tertiary">{t("checkout.requesters")}</span>
              {requests.map((req) => {
                const isMine = req.requested_by === username;
                return (
                  <div
                    key={req.id}
                    className="group flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2 py-1"
                  >
                    <User size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-caption text-ink">
                      {resolveName(req.requested_by)}
                      {isMine ? ` (${t("approval.you")})` : ""}
                    </span>
                    <span className="shrink-0 text-fine text-ink-tertiary">
                      {relText(req.created_at)}
                    </span>
                    {/* 결정권자 — 호버 시 승인/거절 아이콘 */}
                    {interactive && canDecide && !isMine && (
                      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        <button
                          type="button"
                          title={t("approval.checkoutApprove")}
                          aria-label={t("approval.checkoutApprove")}
                          className="rounded-sm p-1 text-added hover:bg-added/10"
                          onClick={() => onDecide(req.id, true)}
                        >
                          <Check size={14} strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          title={t("approval.checkoutReject")}
                          aria-label={t("approval.checkoutReject")}
                          className="rounded-sm p-1 text-error hover:bg-error/10"
                          onClick={() => onDecide(req.id, false)}
                        >
                          <X size={14} strokeWidth={1.5} />
                        </button>
                      </span>
                    )}
                    {/* 요청자 본인 — 철회 */}
                    {interactive && isMine && (
                      <button
                        type="button"
                        title={t("checkout.withdraw")}
                        aria-label={t("checkout.withdraw")}
                        className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-error"
                        onClick={() => onWithdraw(req.id)}
                      >
                        <X size={14} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// R5c 승인 탭 — 3단계 스테퍼(제출→검토→게시) + 상태 배지 + 승인자 현황 + 액션.
// Part D: pending_checkout_request 배너 — 결정 권한자(보유자/소유자/sysadmin)에게 승인/거절 UI 노출.
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import { getDirectory, type VersionStatus, type WorkflowState } from "@/lib/api";
import { CheckoutPanel } from "@/components/checkout-panel";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowActions } from "@/components/workflow-actions";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

interface ApprovalPanelProps {
  status: VersionStatus;
  workflow: WorkflowState | null;
  isCheckoutHolder: boolean;
  isApprover: boolean;
  isSubmitter: boolean;
  // 회수 가능 — 제출자 또는 오너·sysadmin(백엔드 withdraw 오버라이드와 일치).
  canWithdraw: boolean;
  hasApproved: boolean;
  // 승인자 목록 관리 가능 여부 — 오너이면서 승인 진행 중이 아닐 때(draft/rejected 등). / can edit approver list.
  canManageApprovers: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPublish: () => void;
  onWithdraw: () => void;
  onManageApprovers: () => void;
  // 점유권 탭 — 결정 권한자에게 요청 승인/거절, 요청자에게 철회 UI
  username?: string | null;
  canDecideCheckout?: boolean;
  onDecideCheckout?: (requestId: number, approve: boolean) => void;
  onWithdrawCheckout?: (requestId: number) => void;
}

const STEPS: { key: string; labelKey: MessageKey }[] = [
  { key: "submit", labelKey: "approval.stepSubmit" },
  { key: "review", labelKey: "approval.stepReview" },
  { key: "publish", labelKey: "approval.stepPublish" },
];

// 상태 → 현재 단계(0=제출,1=검토,2=게시, 3=전부완료). rejected는 검토 단계에서 멈춤(에러).
function currentStage(status: VersionStatus): number {
  switch (status) {
    case "draft":
      return 0;
    case "pending":
    case "rejected":
      return 1;
    case "approved":
      return 2;
    case "published":
    case "expired":
      return 3;
  }
}

export function ApprovalPanel({
  status,
  workflow,
  isCheckoutHolder,
  isApprover,
  isSubmitter,
  canWithdraw,
  hasApproved,
  canManageApprovers,
  onSubmit,
  onApprove,
  onReject,
  onPublish,
  onWithdraw,
  onManageApprovers,
  username = null,
  canDecideCheckout = false,
  onDecideCheckout,
  onWithdrawCheckout,
}: ApprovalPanelProps) {
  const { t } = useI18n();
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    let active = true;
    void getDirectory()
      .then((dir) => {
        if (!active) return;
        setNameById(new Map(dir.users.map((user) => [user.id, user.name])));
        loaded.current = true;
      })
      .catch(() => {
        // 디렉터리 조회 실패 시 login_id 그대로 표시
      });
    return () => {
      active = false;
    };
  }, []);

  const approvers = workflow?.approvers ?? [];
  const approvals = new Set(workflow?.approvals ?? []);
  // 반려자 — 승인했다 거절해도 목록에 'Approved'로 남지 않게 Rejected 우선.
  const rejectedBy = workflow?.rejected_by ?? null;
  const stage = currentStage(status);
  const rejected = status === "rejected";
  const isExpired = status === "expired";
  // 점유권 탭 조작 가능 상태 — draft에서만(그 외 view-only). 점유 이동(요청/이전/결정)은 draft 전용.
  const checkoutInteractive = status === "draft";
  const resolve = (id: string): string => nameById.get(id) ?? id;
  const pendingNames = approvers.filter((id) => !approvals.has(id)).map(resolve);

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 — 승인 워크플로 + 상태 배지 */}
      <div className="flex items-center justify-between">
        <span className="text-fine text-ink-tertiary">{t("approval.workflowTitle")}</span>
        <StatusBadge status={status} />
      </div>

      {/* 점유권 탭 — 프로그레스바 위, 기본 접힘. draft에서만 조작 가능 */}
      <CheckoutPanel
        workflow={workflow}
        username={username}
        canDecide={canDecideCheckout}
        interactive={checkoutInteractive}
        resolveName={resolve}
        onDecide={(id, approve) => onDecideCheckout?.(id, approve)}
        onWithdraw={(id) => onWithdrawCheckout?.(id)}
      />

      {/* 스테퍼 — 제출 → 검토 → 게시. 만료(expired) 시 전체 비활성 + "Expired" 워터마크 */}
      <div className="relative">
        {isExpired && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="select-none -rotate-12 text-2xl font-semibold tracking-wide text-ink-tertiary opacity-40">
              Expired
            </span>
          </div>
        )}
        <div className={`flex items-start ${isExpired ? "opacity-60" : ""}`}>
          {STEPS.map((step, index) => {
            const done = !isExpired && (stage > index || status === "published");
            const active = !isExpired && stage === index && !rejected;
            const errorStep = !isExpired && rejected && index === 1;
            return (
              <div key={step.key} className="flex flex-1 items-start last:flex-none">
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-fine font-semibold ${
                      isExpired
                        ? "border border-divider text-ink-tertiary"
                        : errorStep
                          ? "border-2 border-error text-error"
                          : done
                            ? "bg-accent text-on-accent"
                            : active
                              ? "border-2 border-accent text-accent"
                              : "border border-divider text-ink-tertiary"
                    }`}
                  >
                    {done ? (
                      <Check size={14} strokeWidth={2} />
                    ) : active ? (
                      <span className="h-2 w-2 rounded-full bg-accent" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span
                    className={`text-fine ${
                      isExpired
                        ? "text-ink-tertiary"
                        : active
                          ? "font-semibold text-accent"
                          : errorStep
                            ? "text-error"
                            : done
                              ? "text-ink"
                              : "text-ink-tertiary"
                    }`}
                  >
                    {t(step.labelKey)}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={`mx-1 mt-3.5 h-0.5 flex-1 rounded-full ${
                      done ? "bg-accent" : "bg-divider"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 승인자 현황 — 이름 + 승인/대기, 소유자는 관리 링크 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-fine text-ink-tertiary">
            {t("approval.approversCount", { n: approvers.length })}
          </span>
          {canManageApprovers && (
            <button
              type="button"
              className="text-fine text-accent hover:underline"
              onClick={onManageApprovers}
            >
              {t("approvers.manage")}
            </button>
          )}
        </div>
        {approvers.length === 0 ? (
          <p className="text-caption text-ink-tertiary">{t("approval.noApprovers")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {approvers.map((id) => {
              const name = resolve(id);
              const rejected = id === rejectedBy;
              const approved = !rejected && approvals.has(id);
              return (
                <li key={id} className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-fine font-semibold text-accent">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-caption text-ink">{name}</span>
                  {rejected ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-fine text-error">
                      <X size={12} strokeWidth={2} />
                      {t("approval.statusRejected")}
                    </span>
                  ) : approved ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-fine text-added">
                      <Check size={12} strokeWidth={2} />
                      {t("approval.statusApproved")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-fine text-ink-tertiary">{t("approval.statusPending")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* 누구에게 검토 대기 중인지 — 검토 단계에서만 */}
        {status === "pending" && pendingNames.length > 0 && (
          <p className="text-fine text-changed">
            {t("approval.pendingOn", { names: pendingNames.join(", ") })}
          </p>
        )}
      </div>

      {/* 상태·역할별 액션 — 기존 WorkflowActions 재사용(제출/승인/반려/게시/회수) */}
      <WorkflowActions
        status={status}
        workflow={workflow}
        isCheckoutHolder={isCheckoutHolder}
        isApprover={isApprover}
        isSubmitter={isSubmitter}
        canWithdraw={canWithdraw}
        hasApproved={hasApproved}
        onSubmit={onSubmit}
        onApprove={onApprove}
        onReject={onReject}
        onPublish={onPublish}
        onWithdraw={onWithdraw}
      />
    </div>
  );
}

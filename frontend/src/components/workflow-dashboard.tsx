"use client";

// 승인 워크플로우 대시보드 — 인스펙터 하단, 진행 순서도 + 상태·승인자 현황·액션 (design 2026-06-14)
import { Check, Circle, X } from "lucide-react";
import { Fragment } from "react";

import { StatusBadge } from "@/components/status-badge";
import { WorkflowActions } from "@/components/workflow-actions";
import type { VersionStatus, WorkflowState } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

interface WorkflowDashboardProps {
  versionLabel: string;
  status: VersionStatus;
  submittedBy: string | null;
  rejectReason: string | null;
  workflow: WorkflowState | null;
  isCheckoutHolder: boolean;
  isApprover: boolean;
  isSubmitter: boolean;
  hasApproved: boolean;
  isMapOwner: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onPublish: () => void;
  onWithdraw: () => void;
  onManageApprovers: () => void;
}

// 라이프사이클 순서: Draft→Pending→Approved→Published. Rejected는 Pending 위치에서 이탈(빨강).
const STEP_ORDER: VersionStatus[] = ["draft", "pending", "approved", "published"];
const STEP_LABEL_KEY: Record<VersionStatus, MessageKey> = {
  draft: "status.draft",
  pending: "status.pending",
  approved: "status.approved",
  published: "status.published",
  rejected: "status.rejected",
};

function LifecycleStepper({ status }: { status: VersionStatus }) {
  const { t } = useI18n();
  const rejected = status === "rejected";
  // 반려는 Pending 단계에서 멈춘 것으로 표시
  const currentIndex = rejected ? 1 : STEP_ORDER.indexOf(status);

  return (
    <div className="mb-3 flex items-start">
      {STEP_ORDER.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const rejectedActive = rejected && active;

        const dotClass = rejectedActive
          ? "border-error bg-error text-surface"
          : done
            ? "border-accent bg-accent text-surface"
            : active
              ? "border-accent bg-accent-tint text-accent"
              : "border-hairline text-ink-tertiary";

        return (
          <Fragment key={step}>
            {index > 0 && (
              <div
                className={`mt-2.5 h-px flex-1 ${
                  index <= currentIndex && !rejected ? "bg-accent" : "bg-hairline"
                }`}
              />
            )}
            <div className="flex w-12 shrink-0 flex-col items-center">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full border ${dotClass}`}
              >
                {rejectedActive ? (
                  <X size={11} strokeWidth={2} />
                ) : done ? (
                  <Check size={11} strokeWidth={2} />
                ) : (
                  <span className="text-[10px]">{index + 1}</span>
                )}
              </div>
              <span
                className={`mt-1 text-center text-[10px] leading-tight ${
                  active ? "text-ink" : "text-ink-tertiary"
                }`}
              >
                {t(STEP_LABEL_KEY[step])}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export function WorkflowDashboard({
  versionLabel,
  status,
  submittedBy,
  rejectReason,
  workflow,
  isCheckoutHolder,
  isApprover,
  isSubmitter,
  hasApproved,
  isMapOwner,
  onSubmit,
  onApprove,
  onReject,
  onPublish,
  onWithdraw,
  onManageApprovers,
}: WorkflowDashboardProps) {
  const { t } = useI18n();
  const approvers = workflow?.approvers ?? [];
  const approvals = workflow?.approvals ?? [];

  return (
    <div className="flex h-full flex-col bg-surface-alt">
      {/* 상단 고정 — 진행바 + 버전 제목(길면 ellipsis) */}
      <div className="shrink-0 border-b border-hairline p-4 pb-2">
        <LifecycleStepper status={status} />
        <div className="flex items-center justify-between">
          <h2 className="truncate text-caption-strong text-ink-secondary">{versionLabel}</h2>
          <StatusBadge status={status} />
        </div>
      </div>

      {/* 본문 — 공간 부족 시 보이지 않는 스크롤, 배경 채워 흰 영역 방지 */}
      <div className="flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {submittedBy && (
        <p className="mb-2 text-fine text-ink-tertiary">
          {t("dash.submittedBy", { name: submittedBy })}
        </p>
      )}

      {status === "rejected" && rejectReason && (
        <p className="mb-2 text-caption text-error">
          {t("wf.rejectedBanner", { reason: rejectReason })}
        </p>
      )}

      {/* 승인자 체크리스트 — ✓ 승인 / ○ 대기 */}
      {approvers.length === 0 ? (
        <p className="mb-2 text-fine text-ink-tertiary">{t("dash.noApprovers")}</p>
      ) : (
        <ul className="mb-2 flex flex-col gap-0.5">
          {approvers.map((name) => {
            const approved = approvals.includes(name);
            return (
              <li key={name} className="flex items-center gap-1.5 text-caption">
                {approved ? (
                  <Check size={14} strokeWidth={1.5} className="shrink-0 text-added" />
                ) : (
                  <Circle
                    size={14}
                    strokeWidth={1.5}
                    className="shrink-0 text-ink-tertiary"
                  />
                )}
                <span className={`truncate ${approved ? "text-ink" : "text-ink-tertiary"}`}>
                  {name}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {approvers.length > 0 && (
        <p className="mb-3 text-fine text-ink-tertiary">
          {t("wf.approvalProgress", {
            done: approvals.length,
            total: approvers.length,
          })}
        </p>
      )}

      <WorkflowActions
        status={status}
        workflow={workflow}
        isCheckoutHolder={isCheckoutHolder}
        isApprover={isApprover}
        isSubmitter={isSubmitter}
        hasApproved={hasApproved}
        onSubmit={onSubmit}
        onApprove={onApprove}
        onReject={onReject}
        onPublish={onPublish}
        onWithdraw={onWithdraw}
      />
      </div>

      {/* 가장 아래 버튼 — 항상 하단 고정 */}
      {isMapOwner && (
        <div className="shrink-0 border-t border-hairline p-2">
          <button
            type="button"
            className="w-full rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface"
            onClick={onManageApprovers}
          >
            {t("approvers.manage")}
          </button>
        </div>
      )}
    </div>
  );
}

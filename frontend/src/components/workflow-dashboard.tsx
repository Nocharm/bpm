"use client";

// 승인 워크플로우 대시보드 — 인스펙터 하단 고정, 상태·승인자 현황·액션을 한곳에 (design 2026-06-14)
import { Check, Circle } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { WorkflowActions } from "@/components/workflow-actions";
import type { VersionStatus, WorkflowState } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

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
    <div className="shrink-0 border-t border-hairline bg-surface-alt p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-caption-strong text-ink-secondary">{t("dash.title")}</h2>
        <StatusBadge status={status} />
      </div>

      <p className="mb-2 truncate text-fine text-ink-tertiary">{versionLabel}</p>

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

      {isMapOwner && (
        <button
          type="button"
          className="mt-2 w-full rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface"
          onClick={onManageApprovers}
        >
          {t("approvers.manage")}
        </button>
      )}
    </div>
  );
}

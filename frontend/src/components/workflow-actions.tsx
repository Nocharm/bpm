"use client";

// 버전 상태·역할에 따라 조건부 전이 버튼을 노출 (design 2026-06-14)
import { useState } from "react";

import type { VersionStatus, WorkflowState } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface WorkflowActionsProps {
  status: VersionStatus;
  workflow: WorkflowState | null;
  isCheckoutHolder: boolean;
  isApprover: boolean;
  isSubmitter: boolean;
  hasApproved: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onPublish: () => void;
  onWithdraw: () => void;
}

export function WorkflowActions({
  status,
  workflow,
  isCheckoutHolder,
  isApprover,
  isSubmitter,
  hasApproved,
  onSubmit,
  onApprove,
  onReject,
  onPublish,
  onWithdraw,
}: WorkflowActionsProps) {
  const { t } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt disabled:opacity-40";

  // 승인자 미지정이면 제출은 백엔드 409 — 막다른 클릭 대신 비활성 + 안내
  const noApprovers = (workflow?.approvers.length ?? 0) === 0;

  return (
    <div className="flex items-center gap-1">
      {(status === "draft" || status === "rejected") && isCheckoutHolder && (
        <>
          <button
            type="button"
            className={btn}
            onClick={onSubmit}
            disabled={noApprovers}
            title={noApprovers ? t("wf.submitNeedsApprovers") : undefined}
          >
            {t("wf.submit")}
          </button>
          {noApprovers && (
            <span className="text-fine text-ink-tertiary">
              {t("wf.submitNeedsApprovers")}
            </span>
          )}
        </>
      )}

      {status === "pending" && isApprover && (
        <>
          <button
            type="button"
            className={btn}
            onClick={onApprove}
            disabled={hasApproved}
          >
            {t("wf.approve")}
          </button>
          <button type="button" className={btn} onClick={() => setRejecting(true)}>
            {t("wf.reject")}
          </button>
        </>
      )}

      {status === "pending" && workflow && (
        <span className="text-fine text-ink-tertiary">
          {t("wf.approvalProgress", {
            done: workflow.approvals.length,
            total: workflow.approvers.length,
          })}
        </span>
      )}

      {status === "approved" && isSubmitter && (
        <button type="button" className={btn} onClick={onPublish}>
          {t("wf.publish")}
        </button>
      )}

      {(status === "pending" || status === "approved") && isSubmitter && (
        <button type="button" className={btn} onClick={onWithdraw}>
          {t("wf.withdraw")}
        </button>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-80 rounded-md bg-surface p-4 shadow-lg">
            <p className="text-body-strong text-ink">{t("wf.rejectTitle")}</p>
            <label className="mt-2 block text-caption text-ink-secondary">
              {t("wf.rejectReason")}
            </label>
            <textarea
              className="mt-1 w-full rounded-sm border border-hairline p-2 text-caption"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                }}
              >
                {t("wf.rejectCancel")}
              </button>
              <button
                type="button"
                className={`${btn} text-error`}
                disabled={reason.trim().length === 0}
                onClick={() => {
                  onReject(reason.trim());
                  setRejecting(false);
                  setReason("");
                }}
              >
                {t("wf.rejectConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

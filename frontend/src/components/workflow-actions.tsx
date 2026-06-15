"use client";

// 버전 상태·역할에 따라 조건부 전이 버튼을 노출 (design 2026-06-14)
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
    "rounded-sm border border-hairline px-2 py-1 text-caption disabled:opacity-40";
  // 하단 푸터(bg-surface-alt) 위 — 흰 배경으로 호버 가시화. 남은 폭을 나눠 채움
  const actionBtn = `${btn} flex-1 hover:border-accent hover:bg-surface`;
  // 반려 모달(bg-surface) 위 — surface-alt로 호버 가시화
  const modalBtn = `${btn} hover:bg-surface-alt`;

  // 승인자 미지정이면 제출은 백엔드 409 — 막다른 클릭 대신 비활성 + 안내
  const noApprovers = (workflow?.approvers.length ?? 0) === 0;

  // 버튼 왼쪽에 둘 안내/진행 메시지 — 있을 때만 노출
  const message =
    (status === "draft" || status === "rejected") && isCheckoutHolder && noApprovers
      ? t("wf.submitNeedsApprovers")
      : status === "pending" && workflow
        ? t("wf.approvalProgress", {
            done: workflow.approvals.length,
            total: workflow.approvers.length,
          })
        : null;

  const closeReject = () => {
    setRejecting(false);
    setReason("");
  };

  // Esc로 반려 모달 닫기 — 캔버스 뒤에 갇히지 않도록
  useEffect(() => {
    if (!rejecting) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeReject();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [rejecting]);

  return (
    <div className="flex items-center gap-1.5">
      {message && (
        <span className="shrink-0 text-fine leading-tight text-ink-tertiary">
          {message}
        </span>
      )}

      {(status === "draft" || status === "rejected") && isCheckoutHolder && (
        <button
          type="button"
          className={actionBtn}
          onClick={onSubmit}
          disabled={noApprovers}
          title={noApprovers ? t("wf.submitNeedsApprovers") : undefined}
        >
          {t("wf.submit")}
        </button>
      )}

      {status === "pending" && isApprover && (
        <>
          <button
            type="button"
            className={actionBtn}
            onClick={onApprove}
            disabled={hasApproved}
          >
            {t("wf.approve")}
          </button>
          <button type="button" className={actionBtn} onClick={() => setRejecting(true)}>
            {t("wf.reject")}
          </button>
        </>
      )}

      {status === "approved" && isSubmitter && (
        <button type="button" className={actionBtn} onClick={onPublish}>
          {t("wf.publish")}
        </button>
      )}

      {(status === "pending" || status === "approved") && isSubmitter && (
        <button type="button" className={actionBtn} onClick={onWithdraw}>
          {t("wf.withdraw")}
        </button>
      )}

      {rejecting &&
        createPortal(
          <div
            className="fixed inset-0 z-[1200] flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
            onClick={closeReject}
          >
            <div
              className="w-80 rounded-md bg-surface p-4 shadow-lg"
              onClick={(event) => event.stopPropagation()}
            >
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
                className={modalBtn}
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                }}
              >
                {t("wf.rejectCancel")}
              </button>
              <button
                type="button"
                className={`${modalBtn} text-error`}
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
          </div>,
          document.body,
        )}
    </div>
  );
}

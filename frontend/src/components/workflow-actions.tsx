"use client";

// 버전 상태·역할에 따라 조건부 전이 버튼을 노출 (design 2026-06-14).
// 전이 확인 모달(제출/승인/거절/게시/회수)은 부모(page.tsx)가 ConfirmDialog로 통일 처리 —
// 여기선 버튼만 노출하고 각 핸들러가 해당 모달을 연다.
import type { VersionStatus, WorkflowState } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface WorkflowActionsProps {
  status: VersionStatus;
  workflow: WorkflowState | null;
  isCheckoutHolder: boolean;
  isApprover: boolean;
  isSubmitter: boolean;
  // 회수 가능 — 제출자 또는 오너·sysadmin(백엔드 withdraw 오버라이드와 일치). 게시는 제출자 전용이라 별도.
  canWithdraw: boolean;
  hasApproved: boolean;
  // 클릭 지점 전달 — 셀프 게시 팝오버를 마우스 근처에 띄우기 위함.
  onSubmit: (at: { x: number; y: number }) => void;
  onApprove: () => void;
  onReject: () => void;
  onPublish: () => void;
  onWithdraw: () => void;
}

export function WorkflowActions({
  status,
  workflow,
  isCheckoutHolder,
  isApprover,
  isSubmitter,
  canWithdraw,
  hasApproved,
  onSubmit,
  onApprove,
  onReject,
  onPublish,
  onWithdraw,
}: WorkflowActionsProps) {
  const { t } = useI18n();

  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption disabled:opacity-40";
  // 하단 푸터(bg-surface-alt) 위 — 흰 배경으로 호버 가시화. 남은 폭을 나눠 채움
  const actionBtn = `${btn} flex-1 hover:border-accent hover:bg-surface`;

  // 승인자 미지정이면 제출은 백엔드 409 — 막다른 클릭 대신 비활성 + 안내
  const noApprovers = (workflow?.approvers.length ?? 0) === 0;

  // 버튼 왼쪽에 둘 안내/진행 메시지 — 있을 때만 노출
  const message =
    status === "draft" && isCheckoutHolder && noApprovers
      ? t("wf.submitNeedsApprovers")
      : status === "pending" && workflow
        ? t("wf.approvalProgress", {
            done: workflow.approvals.length,
            total: workflow.approvers.length,
          })
        : null;

  return (
    <div className="flex items-center gap-1.5">
      {message && (
        <span className="shrink-0 text-fine leading-tight text-ink-tertiary">
          {message}
        </span>
      )}

      {status === "draft" && isCheckoutHolder && (
        <button
          type="button"
          className={actionBtn}
          onClick={(event) => onSubmit({ x: event.clientX, y: event.clientY })}
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
          <button type="button" className={actionBtn} onClick={onReject}>
            {t("wf.reject")}
          </button>
        </>
      )}

      {status === "approved" && isSubmitter && (
        <button type="button" className={actionBtn} onClick={onPublish}>
          {t("wf.publish")}
        </button>
      )}

      {(status === "pending" || status === "approved" || status === "rejected") &&
        canWithdraw && (
          <button type="button" className={actionBtn} onClick={onWithdraw}>
            {t("wf.withdraw")}
          </button>
        )}
    </div>
  );
}

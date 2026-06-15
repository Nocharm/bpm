"use client";

// 승인 워크플로우 대시보드 — 인스펙터 하단, 진행 순서도 + 상태·승인자 현황·액션 (design 2026-06-14)
import { Check, Circle } from "lucide-react";

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

// powerline(agnoster) 셰브론 깊이 — 점이 다음 칸 노치에 맞물리는 px
const ARROW = 9;

function LifecycleStepper({ status }: { status: VersionStatus }) {
  const { t } = useI18n();
  const rejected = status === "rejected";
  // 반려는 Pending 단계에서 멈춘 것으로 표시
  const currentIndex = rejected ? 1 : STEP_ORDER.indexOf(status);
  const lastIndex = STEP_ORDER.length - 1;

  return (
    <div className="mb-3 flex items-stretch">
      {STEP_ORDER.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const rejectedActive = rejected && active;

        const segClass = rejectedActive
          ? "bg-error text-surface"
          : done || active
            ? "bg-accent text-surface"
            // 미완료 — 패널(surface-alt)과 구분되는 중간 회색 + 진한 텍스트로 가시성 확보
            : "bg-surface-chip text-ink-secondary";

        // 첫 칸: 좌측 노치 없음 / 끝 칸: 우측 화살표 없음 / 중간: 양쪽 셰브론
        const clip =
          index === 0
            ? `polygon(0 0, calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%, 0 100%)`
            : index === lastIndex
              ? `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${ARROW}px 50%)`
              : `polygon(0 0, calc(100% - ${ARROW}px) 0, 100% 50%, calc(100% - ${ARROW}px) 100%, 0 100%, ${ARROW}px 50%)`;

        return (
          <div
            key={step}
            className={`flex h-7 min-w-0 flex-1 items-center justify-center px-3 text-[11px] leading-none ${
              active ? "font-semibold" : ""
            } ${segClass}`}
            // 음수 marginLeft로 점↔노치를 겹쳐 powerline처럼 맞물림 (첫 칸 제외)
            style={{ clipPath: clip, marginLeft: index === 0 ? undefined : -ARROW }}
          >
            <span className="truncate">{t(STEP_LABEL_KEY[step])}</span>
          </div>
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

      {/* 승인자 관리 — 본문(이전 승인 버튼 위치)으로 이동 */}
      {isMapOwner && (
        <button
          type="button"
          className="w-full rounded-sm border border-hairline px-2 py-1 text-caption hover:border-accent hover:bg-surface"
          onClick={onManageApprovers}
        >
          {t("approvers.manage")}
        </button>
      )}
      </div>

      {/* 승인 절차 버튼 — 항상 하단 고정 */}
      <div className="shrink-0 border-t border-hairline p-2">
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
    </div>
  );
}

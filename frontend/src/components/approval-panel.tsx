"use client";

// R5c 승인 탭 — 3단계 스테퍼(제출→검토→게시) + 상태 배지 + 승인자 현황 + 액션.
// Part D: pending_checkout_request 배너 — 결정 권한자(보유자/소유자/sysadmin)에게 승인/거절 UI 노출.
// 2026-08-14 리디자인: 상태 태그 필 + 이벤트 기반 툴팁(시각·코멘트) + 인물 카드 — 영구 노출 정보는 늘리지 않고 호버로.
import { Check, Globe, Lock, Send, X } from "lucide-react";

import { type VersionEvent, type VersionStatus, type WorkflowState } from "@/lib/api";
import { CheckoutPanel } from "@/components/checkout-panel";
import { HoverTip } from "@/components/hover-tip";
import { PersonHoverCard } from "@/components/person-hover-card";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowActions } from "@/components/workflow-actions";
import { formatKstShort } from "@/lib/datetime";
import { useDirectory } from "@/lib/directory";
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
  // 클릭 지점 전달 — 셀프 게시 팝오버를 마우스 근처에 띄우기 위함 (WorkflowActions에서 발원).
  onSubmit: (at: { x: number; y: number }) => void;
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
  // 래핑 섹션(page.tsx 승인 워크플로 접힘 헤더)이 제목+상태배지를 대신 그릴 때 내부 헤더 생략
  // — 동일 텍스트 중복 렌더 방지 (R6 W2 리뷰 수정).
  hideHeader?: boolean;
  // 현재 버전 이벤트(에디터 보유 VersionDetail.events) — 제출/승인/반려 시각·코멘트 툴팁 소스.
  events?: VersionEvent[];
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
  hideHeader = false,
  events,
}: ApprovalPanelProps) {
  const { t, lang } = useI18n();
  // 디렉터리 캐시 — 이름 한/영 전환(ko는 한글명·영문 폴백), 조회 실패 시 login_id 그대로.
  const users = useDirectory();

  const approvers = workflow?.approvers ?? [];
  const approvals = new Set(workflow?.approvals ?? []);
  // 반려자 — 승인했다 거절해도 목록에 'Approved'로 남지 않게 Rejected 우선.
  const rejectedBy = workflow?.rejected_by ?? null;
  const stage = currentStage(status);
  const rejected = status === "rejected";
  const isExpired = status === "expired";
  // 점유권 탭 조작 가능 상태 — draft에서만(그 외 view-only). 점유 이동(요청/이전/결정)은 draft 전용.
  const checkoutInteractive = status === "draft";
  // 체크아웃 탭 노출 — draft에서만(그 외 상태는 비어 있어 숨김). rejected는 R6 W2에서 제외(사용자 지시).
  const showCheckout = status === "draft";
  const resolve = (id: string): string => {
    const user = users.get(id);
    const english = user?.name || id;
    return lang === "ko" ? user?.korean_name || english : english;
  };
  const pendingNames = approvers.filter((id) => !approvals.has(id)).map(resolve);

  // 이번 승인 사이클 이벤트 — submit이 사이클마다 쌓이므로 최신 submitted 이후만이 현재 사이클.
  const allEvents = events ?? [];
  let lastSubmitIdx = -1;
  for (let i = allEvents.length - 1; i >= 0; i -= 1) {
    if (allEvents[i]?.event_type === "submitted") {
      lastSubmitIdx = i;
      break;
    }
  }
  const submittedEvt = lastSubmitIdx >= 0 ? (allEvents[lastSubmitIdx] ?? null) : null;
  const approvedEvtByActor = new Map<string, VersionEvent>();
  let rejectedEvt: VersionEvent | null = null;
  for (const evt of lastSubmitIdx >= 0 ? allEvents.slice(lastSubmitIdx) : []) {
    if (evt.event_type === "approved") approvedEvtByActor.set(evt.actor, evt);
    else if (evt.event_type === "rejected") rejectedEvt = evt;
  }
  // 시각·코멘트 툴팁 — 이벤트가 없으면(설정 등 미전달 표면) 툴팁 자체를 생략.
  const buildEventTip = (evt: VersionEvent | null, fallbackNote?: string | null) =>
    evt || fallbackNote ? (
      <div className="flex flex-col gap-0.5 text-fine">
        {evt && <span className="text-ink-tertiary">{formatKstShort(evt.created_at)}</span>}
        {(evt?.note ?? fallbackNote) && (
          <span className="whitespace-pre-wrap break-keep text-ink-secondary">
            {evt?.note ?? fallbackNote}
          </span>
        )}
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* 체크아웃 탭 — 워크플로 상태 헤더 위. draft에서만(그 외 비어 있어 숨김). 기본 접힘. */}
      {showCheckout && (
        <CheckoutPanel
          workflow={workflow}
          username={username}
          canDecide={canDecideCheckout}
          interactive={checkoutInteractive}
          resolveName={resolve}
          onDecide={(id, approve) => onDecideCheckout?.(id, approve)}
          onWithdraw={(id) => onWithdrawCheckout?.(id)}
        />
      )}

      {/* 헤더 — 승인 워크플로 + 상태 배지. hideHeader=true면 생략(래핑 섹션 헤더가 대신 그림, R6 W2) */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <span className="text-fine text-ink-tertiary">{t("approval.workflowTitle")}</span>
          <StatusBadge status={status} />
        </div>
      )}

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
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-fine font-semibold ${
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
                    className={`${active ? "text-caption-strong" : "text-fine"} ${
                      isExpired
                        ? "text-ink-tertiary"
                        : active
                          ? "text-accent"
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
                    className={`mx-1 mt-3.5 h-1 flex-1 rounded-full ${
                      done ? "bg-accent" : "bg-divider"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 동봉 가시성 변경 — 버전 결정에 편승 중임을 패널에서도 표시 */}
      {workflow?.bundled_visibility && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-accent-tint-border bg-accent-tint px-2 py-0.5 text-fine text-accent">
          {workflow.bundled_visibility.to_visibility === "public" ? (
            <Globe size={12} strokeWidth={1.5} />
          ) : (
            <Lock size={12} strokeWidth={1.5} />
          )}
          {t("approval.bundledVisibility", { v: workflow.bundled_visibility.to_visibility })}
        </span>
      )}

      {/* 승인자 현황 — 제목 + 진행 필 + 제출 컨텍스트(호버 아이콘, 영구 노출 지양), 소유자는 관리 링크 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-caption-strong text-ink">{t("approval.approversTitle")}</span>
            {approvers.length > 0 && (
              <span
                className={`rounded-full border px-1.5 py-0.5 text-fine ${
                  approvals.size >= approvers.length
                    ? "border-added/40 bg-added/10 text-added"
                    : status === "pending"
                      ? "border-changed/40 bg-changed/10 text-changed"
                      : "border-hairline bg-surface-alt text-ink-secondary"
                }`}
              >
                {approvals.size}/{approvers.length}
              </span>
            )}
            {submittedEvt && (
              <HoverTip
                tip={
                  <div className="flex flex-col gap-0.5 text-fine">
                    <span className="text-ink">
                      {t("approval.submittedBy", { name: resolve(submittedEvt.actor) })}
                    </span>
                    <span className="text-ink-tertiary">{formatKstShort(submittedEvt.created_at)}</span>
                    {submittedEvt.note && (
                      <span className="whitespace-pre-wrap break-keep text-ink-secondary">
                        {submittedEvt.note}
                      </span>
                    )}
                  </div>
                }
              >
                <Send
                  size={13}
                  strokeWidth={1.5}
                  className="text-ink-tertiary transition-colors duration-150 hover:text-ink-secondary"
                />
              </HoverTip>
            )}
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
              const isRowRejected = id === rejectedBy;
              const approved = !isRowRejected && approvals.has(id);
              return (
                <li key={id} className="flex items-center gap-2">
                  {/* 이름·아바타 — 인물 카드(호버 0.7초/클릭 즉시: 직급·보직·부서·메신저) */}
                  <PersonHoverCard userId={id} className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint text-fine font-semibold text-accent">
                      {name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption text-ink">{name}</span>
                  </PersonHoverCard>
                  {/* 상태 태그 필 — 호버 시 시각·코멘트(이벤트 기반, 영구 노출 지양) */}
                  {isRowRejected ? (
                    <HoverTip tip={buildEventTip(rejectedEvt, workflow?.reject_reason)}>
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-error/40 bg-error/10 px-2 py-0.5 text-fine text-error">
                        <X size={12} strokeWidth={2} />
                        {t("approval.statusRejected")}
                      </span>
                    </HoverTip>
                  ) : approved ? (
                    <HoverTip tip={buildEventTip(approvedEvtByActor.get(id) ?? null)}>
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-added/40 bg-added/10 px-2 py-0.5 text-fine text-added">
                        <Check size={12} strokeWidth={2} />
                        {t("approval.statusApproved")}
                      </span>
                    </HoverTip>
                  ) : (
                    <span className="shrink-0 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-fine text-ink-secondary">
                      {t("approval.statusPending")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* 누구에게 검토 대기 중인지 — 검토 단계에서만, 대기자 필 나열 */}
        {status === "pending" && pendingNames.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-fine text-ink-tertiary">{t("approval.waitingLabel")}</span>
            {pendingNames.map((pendingName) => (
              <span
                key={pendingName}
                className="rounded-full border border-changed/40 bg-changed/10 px-1.5 py-0.5 text-fine text-changed"
              >
                {pendingName}
              </span>
            ))}
          </div>
        )}
        {/* 반려 사유 — 패널 단독으로도 읽히게(에디터 헤더 배너와 별개, truncate+툴팁) */}
        {rejected && workflow?.reject_reason && (
          <p
            title={workflow.reject_reason}
            className="truncate rounded-sm border border-error/40 bg-error/10 px-2 py-1 text-fine text-error"
          >
            {workflow.reject_reason}
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

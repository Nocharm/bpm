"use client";

// 버전 게시 패널 — 실 버전 워크플로 API 배선 / Version publish panel wired to the real version workflow API.
// 상태 머신: draft/rejected→submit(pending)→approve(전원 만장일치)→approved→publish(published) | reject→rejected | withdraw→draft.
// 서버 진실: 각 버전 행이 GET /versions/{id}/workflow 로 상태를 읽고, 액션 후 워크플로를 재조회한다(낙관적 갱신 금지).
// 게이팅은 워크플로 상태 + (approvers/submitted_by ↔ currentUserId)에서 파생하되, 서버가 최종 게이트(403/409)다.

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, XCircle, Send, Upload, Undo2 } from "lucide-react";

import type { VersionSummary, WorkflowState } from "@/lib/api";
import {
  approveVersion,
  getMap,
  getWorkflowState,
  publishVersion,
  rejectVersion,
  submitVersion,
  withdrawVersion,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { StatusBadge } from "@/components/status-badge";

// ── 타입 / Types ─────────────────────────────────────────────

interface VersionsPublishPanelProps {
  mapId: string;
  /** 현재 유저 ID — 워크플로의 approvers/submitted_by 와 비교해 버튼 게이팅 / Current user id for button gating. */
  currentUserId: string;
  /** 상위에서 이미 fetch한 버전 목록 — 없으면 내부에서 fetch / Pre-fetched versions or fetch internally. */
  versions?: VersionSummary[];
  /** editor 이상 여부 / Whether current user has editor+ role. */
  canEdit: boolean;
  /** 액션 실패(403/409/422) 토스트 / Toast for action failures. */
  onToast?: (msg: string) => void;
}

// ── 메인 컴포넌트 / Main component ───────────────────────────

export function VersionsPublishPanel({
  mapId,
  currentUserId,
  versions: versionsProp,
  canEdit,
  onToast,
}: VersionsPublishPanelProps) {
  const { t } = useI18n();

  // 버전 목록 — props 없으면 getMap으로 내부 fetch / Fetch internally only when prop is absent.
  const [fetchedVersions, setFetchedVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(!versionsProp);

  useEffect(() => {
    // versionsProp이 있으면 fetch 불필요 / Skip fetch when versions are provided by parent.
    if (versionsProp) return;
    let active = true;
    void (async () => {
      try {
        const detail = await getMap(Number(mapId));
        if (active) {
          setFetchedVersions(detail.versions);
          setLoading(false);
        }
      } catch {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId, versionsProp]);

  // props 우선, 없으면 내부 fetch 결과 / Prefer prop; fall back to internal fetch result.
  const versions = versionsProp ?? fetchedVersions;

  if (loading) {
    return <p className="text-caption text-ink-tertiary">…</p>;
  }

  if (versions.length === 0) {
    return (
      <p className="text-caption text-ink-tertiary">{t("perm.version.noVersions")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-2 text-caption text-ink-secondary">{t("perm.version.hint")}</p>
      {versions.map((version) => (
        <VersionRow
          key={version.id}
          versionId={version.id}
          label={version.label}
          currentUserId={currentUserId}
          canEdit={canEdit}
          onToast={onToast}
        />
      ))}
    </div>
  );
}

// ── 버전 행 / Version row ─────────────────────────────────────

interface VersionRowProps {
  versionId: number;
  label: string;
  currentUserId: string;
  canEdit: boolean;
  onToast?: (msg: string) => void;
}

function VersionRow({
  versionId,
  label,
  currentUserId,
  canEdit,
  onToast,
}: VersionRowProps) {
  const { t } = useI18n();

  // 워크플로 상태 — 서버 진실. 액션 후 재조회 / Server-truth workflow state; refetched after each action.
  const [wf, setWf] = useState<WorkflowState | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await getWorkflowState(versionId);
      setWf(next);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : String(err));
    }
  }, [versionId, onToast]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await getWorkflowState(versionId);
        if (active) setWf(next);
      } catch (err) {
        if (active) onToast?.(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, [versionId, onToast]);

  // 액션 실행 헬퍼 — 호출 후 워크플로 재조회, 실패 시 토스트 / Run an action, then refetch; surface failures.
  const runAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        await reload();
      } catch (err) {
        onToast?.(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [reload, onToast],
  );

  if (wf === null) {
    return (
      <div className="flex items-center gap-3 rounded-sm border border-hairline bg-surface px-3 py-2.5">
        <span className="flex-1 text-caption text-ink">{label}</span>
        <span className="text-fine text-ink-tertiary">…</span>
      </div>
    );
  }

  const status = wf.status;
  const isApprover = wf.approvers.includes(currentUserId);
  const isSubmitter = wf.submitted_by === currentUserId;
  // 이번 사이클에 본인이 이미 승인했는지 / Whether this user already approved this cycle.
  const hasApproved = wf.approvals.includes(currentUserId);

  // 반려 — 사유 필수(서버 RejectIn min_length=1) / Reject requires a reason (server enforces non-empty).
  function handleReject() {
    const reason = window.prompt(t("perm.version.rejectReasonPrompt"));
    if (reason === null) return; // 취소 / cancelled
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      onToast?.(t("perm.version.rejectReasonRequired"));
      return;
    }
    void runAction(() => rejectVersion(versionId, trimmed));
  }

  return (
    <div className="flex items-center gap-3 rounded-sm border border-hairline bg-surface px-3 py-2.5">
      {/* 버전 라벨 / Version label */}
      <span className="flex-1 text-caption text-ink">{label}</span>

      {/* 승인 집계 (pending일 때) / Approval tally while pending */}
      {status === "pending" && wf.approvers.length > 0 && (
        <span className="text-fine text-ink-tertiary">
          {wf.approvals.length}/{wf.approvers.length}
        </span>
      )}

      {/* 상태 배지 / Status badge */}
      <StatusBadge status={status} />

      {/* 액션 버튼 — 상태·역할별 조건부 / Action buttons: conditional on status and role */}
      <div className="flex items-center gap-1.5">
        {/* draft / rejected → editor+는 승인 요청(submit) 가능. 서버가 체크아웃 보유자·승인자 존재 검증 /
            editor+ can request approval (submit); server gates checkout holder + approvers-present */}
        {(status === "draft" || status === "rejected") && canEdit && (
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-50"
            onClick={() => void runAction(() => submitVersion(versionId))}
          >
            <Send size={16} strokeWidth={1.5} />
            {t("perm.version.request")}
          </button>
        )}

        {/* pending → 승인자(미승인): 승인/반려 / approver who hasn't yet approved: approve or reject */}
        {status === "pending" && isApprover && !hasApproved && (
          <>
            <button
              type="button"
              disabled={busy}
              className="flex items-center gap-1 rounded-sm border border-added px-2 py-1 text-fine text-added hover:bg-surface-alt disabled:opacity-50"
              onClick={() => void runAction(() => approveVersion(versionId))}
            >
              <CheckCircle size={16} strokeWidth={1.5} />
              {t("perm.version.approve")}
            </button>
            <button
              type="button"
              disabled={busy}
              className="flex items-center gap-1 rounded-sm border border-error px-2 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-50"
              onClick={handleReject}
            >
              <XCircle size={16} strokeWidth={1.5} />
              {t("perm.version.reject")}
            </button>
          </>
        )}

        {/* pending → 이미 승인한 승인자: 타인 승인 대기 / approver who already approved: awaiting others */}
        {status === "pending" && isApprover && hasApproved && (
          <span className="text-fine text-ink-tertiary">{t("perm.version.approvedByYou")}</span>
        )}

        {/* pending → 비승인자: 대기 표시 / non-approver: waiting label */}
        {status === "pending" && !isApprover && (
          <span className="text-fine text-ink-tertiary">{t("perm.version.waitingApproval")}</span>
        )}

        {/* approved → 제출자: 게시 버튼 / submitter: publish button */}
        {status === "approved" && isSubmitter && (
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-1 rounded-sm border border-accent px-2 py-1 text-fine text-accent hover:bg-surface-alt disabled:opacity-50"
            onClick={() => void runAction(() => publishVersion(versionId))}
          >
            <Upload size={16} strokeWidth={1.5} />
            {t("perm.version.publish")}
          </button>
        )}

        {/* approved → 비제출자: 대기 표시 / non-submitter: waiting label */}
        {status === "approved" && !isSubmitter && (
          <span className="text-fine text-ink-tertiary">{t("perm.version.approvedWaiting")}</span>
        )}

        {/* pending/approved/rejected → 제출자: 회수(withdraw)로 draft 복귀 / submitter can withdraw back to draft */}
        {(status === "pending" || status === "approved" || status === "rejected") && isSubmitter && (
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-surface-alt disabled:opacity-50"
            onClick={() => void runAction(() => withdrawVersion(versionId))}
          >
            <Undo2 size={16} strokeWidth={1.5} />
            {t("perm.version.withdraw")}
          </button>
        )}

        {/* published: 별도 액션 없음 / published: no actions */}
      </div>
    </div>
  );
}

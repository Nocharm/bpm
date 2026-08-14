"use client";

// 버전 게시 패널 — 실 버전 워크플로 API 배선 / Version publish panel wired to the real version workflow API.
// 상태 머신: draft/rejected→submit(pending)→approve(전원 만장일치)→approved→publish(published) | reject→rejected | withdraw→draft.
// 서버 진실: 각 버전 행이 GET /versions/{id}/workflow 로 상태를 읽고, 액션 후 워크플로를 재조회한다(낙관적 갱신 금지).
// 게이팅은 워크플로 상태 + (approvers/submitted_by ↔ currentUserId)에서 파생하되, 서버가 최종 게이트(403/409)다.
// 전이 확인은 에디터와 동일한 5종 공용 다이얼로그(components/version/) 경유 — 이전엔 패널만 자체 ConfirmDialog/직행/
// PromptDialog를 써서 승인요청 시 승인자 목록·동봉 가시성 변경이 안 보이는 등 표면 드리프트가 있었다(원 신고 건).

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, MessageSquare, XCircle, Send, Upload, Undo2 } from "lucide-react";

import type { VersionDetail, VersionEvent, VersionSummary, WorkflowState } from "@/lib/api";
import {
  approveVersion,
  getDirectory,
  getMap,
  getWorkflowState,
  publishVersion,
  rejectVersion,
  submitVersion,
  withdrawVersion,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import { isSoleSelfApprover, runSelfPublishChain } from "@/lib/self-publish";
import { StatusBadge } from "@/components/status-badge";
import { SelfPublishPopover } from "@/components/self-publish-popover";
import { VisibilityBundlePicker } from "@/components/visibility-bundle-picker";
import { CommentHistoryModal } from "@/components/version/comment-history-modal";
import { SubmitConfirmDialog } from "@/components/version/submit-confirm-dialog";
import { ApproveConfirmDialog } from "@/components/version/approve-confirm-dialog";
import { PublishConfirmDialog } from "@/components/version/publish-confirm-dialog";
import { WithdrawConfirmDialog } from "@/components/version/withdraw-confirm-dialog";
import { RejectDialog } from "@/components/version/reject-dialog";
import { buildBundledVisibilityLines } from "@/components/version/approver-status-lines";

// ── 타입 / Types ─────────────────────────────────────────────

interface VersionsPublishPanelProps {
  mapId: string;
  /** 현재 유저 ID — 워크플로의 approvers/submitted_by 와 비교해 버튼 게이팅 / Current user id for button gating. */
  currentUserId: string;
  /** 상위에서 이미 fetch한 버전 목록 — 없으면 내부에서 fetch / Pre-fetched versions or fetch internally. */
  versions?: VersionSummary[];
  /** editor 이상 여부 / Whether current user has editor+ role. */
  canEdit: boolean;
  /** 현재 맵 가시성 — 승인요청 동봉 옵션의 대상(반대값) 계산용 / Current map visibility, for the bundle-option target. */
  visibility: "public" | "private";
  /** 오너 여부 — 가시성 동봉은 오너 전용(서버 403)이라 비오너에겐 픽커를 숨긴다 / Owner-only bundle option. */
  canBundle: boolean;
  /** 액션 실패(403/409/422) 토스트 / Toast for action failures. */
  onToast?: (msg: string, tone?: "error") => void;
  /** 액션 성공 후 호출 — 동봉 가시성 변경이 맵 레벨 상태(visibility)를 바꿀 수 있어 호스트가 재조회하도록 신호 / Notify host after a successful action, since bundled visibility changes affect map-level state. */
  onChanged?: () => void;
}

// ── 메인 컴포넌트 / Main component ───────────────────────────

export function VersionsPublishPanel({
  mapId,
  currentUserId,
  versions: versionsProp,
  canEdit,
  visibility,
  canBundle,
  onToast,
  onChanged,
}: VersionsPublishPanelProps) {
  const { t } = useI18n();

  // 버전 목록 — props 없으면 getMap으로 내부 fetch / Fetch internally only when prop is absent.
  // VersionDetail로 events까지 보존 — 코멘트 이력 모달이 각 버전의 전이 이벤트를 참조.
  const [fetchedVersions, setFetchedVersions] = useState<VersionDetail[]>([]);
  const [loading, setLoading] = useState(!versionsProp);
  // login_id → 표시 이름 캐시 — 승인자/요청자 이름 공개(원 신고 건: 패널이 승인자를 안 보여줬다).
  // 협업자 패널과 동일 패턴(getDirectory 1회, 실패 시 login id 폴백).
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  // 액션(승인/게시/반려 등) 후 이벤트 목록을 재조회하기 위한 트리거 — 행의 워크플로 재조회와
  // 별개로, 방금 남긴 코멘트가 모달에 바로 보이려면 fetchedVersions(events 포함)도 갱신돼야 한다.
  const [eventsReloadKey, setEventsReloadKey] = useState(0);

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
  }, [mapId, versionsProp, eventsReloadKey]);

  useEffect(() => {
    let alive = true;
    void getDirectory()
      .then((dir) => {
        if (alive) setNameById(new Map(dir.users.map((u) => [u.id, u.name])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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
          versions={versions}
          currentUserId={currentUserId}
          canEdit={canEdit}
          visibility={visibility}
          canBundle={canBundle}
          nameById={nameById}
          events={versionsProp ? undefined : fetchedVersions.find((v) => v.id === version.id)?.events}
          onToast={onToast}
          onChanged={() => {
            setEventsReloadKey((k) => k + 1);
            onChanged?.();
          }}
        />
      ))}
    </div>
  );
}

// ── 버전 행 / Version row ─────────────────────────────────────

interface VersionRowProps {
  versionId: number;
  label: string;
  versions: VersionSummary[];
  currentUserId: string;
  canEdit: boolean;
  visibility: "public" | "private";
  canBundle: boolean;
  nameById: Map<string, string>;
  /** 이 버전의 전이 이벤트 — 코멘트 이력 모달용. props 버전 목록 사용 시엔 events가 없어 버튼 미노출. */
  events?: VersionEvent[];
  onToast?: (msg: string, tone?: "error") => void;
  onChanged?: () => void;
}

function VersionRow({
  versionId,
  label,
  versions,
  currentUserId,
  canEdit,
  visibility,
  canBundle,
  nameById,
  events,
  onToast,
  onChanged,
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
      onToast?.(humanizeApiError(err, t), "error");
    }
  }, [versionId, onToast, t]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await getWorkflowState(versionId);
        if (active) setWf(next);
      } catch (err) {
        if (active) onToast?.(humanizeApiError(err, t), "error");
      }
    })();
    return () => {
      active = false;
    };
  }, [versionId, onToast, t]);

  // 액션 실행 헬퍼 — 호출 후 워크플로 재조회, 실패 시 토스트 / Run an action, then refetch; surface failures.
  // 성공 시 onChanged로 호스트에 알림 — 동봉 가시성 변경이 맵 레벨 visibility를 바꿔 이 행 밖의 상태(VisibilityControl 등)도 재조회돼야 함.
  const runAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        await reload();
        onChanged?.();
      } catch (err) {
        onToast?.(humanizeApiError(err, t), "error");
      } finally {
        setBusy(false);
      }
    },
    [reload, onToast, onChanged, t],
  );

  // 전이 확인 모달 상태 — 에디터와 동일한 5종 공용 다이얼로그(항상 모달 경유, 동봉 유무 무관).
  const [selfPublishAt, setSelfPublishAt] = useState<{ x: number; y: number } | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // 4종 전이 모달(submit/approve/publish/withdraw) 공용 코멘트 입력 — 동시에 하나만 열리므로 상태 1개로 공유.
  const [transitionComment, setTransitionComment] = useState("");
  // 승인요청/셀프게시에 동봉할 가시성 변경 선택 — VisibilityBundlePicker가 직접 값 제공(체크박스 대체).
  const [bundleValue, setBundleValue] = useState<"public" | "private" | null>(null);
  // 코멘트 이력 모달 — 열림 트리거인 클릭 지점(등장 애니메이션 시작점)을 상태로 보관.
  const [commentsOrigin, setCommentsOrigin] = useState<{ x: number; y: number } | null>(null);
  const commentCount = (events ?? []).filter((e) => e.note).length;

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
  // 회수 모달 핸드오프용 제출자 — 제출 시 체크아웃이 해제돼 보유자가 늘 없으므로 제출자를 노출(에디터와 동일).
  const withdrawSubmitter = wf.submitted_by ?? null;
  // 게시 확인의 만료 경고 대상 — 맵 내 현재 게시본(에디터와 동일 계산).
  const priorPublished = versions.find((v) => v.status === "published") ?? null;

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
        {/* 코멘트 있는 이벤트가 하나라도 있으면 이력 모달 열기 버튼 노출 / Shown only when at least one event has a comment. */}
        {commentCount > 0 && (
          <button
            type="button"
            data-id={`version-comments-open-${versionId}`}
            title={t("wf.viewComments")}
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
            onClick={(event) => setCommentsOrigin({ x: event.clientX, y: event.clientY })}
          >
            <MessageSquare size={16} strokeWidth={1.5} />
            {commentCount}
          </button>
        )}
        {/* draft / rejected → editor+는 승인 요청(submit) 가능. 서버가 체크아웃 보유자·승인자 존재 검증 /
            editor+ can request approval (submit); server gates checkout holder + approvers-present */}
        {(status === "draft" || status === "rejected") && canEdit && (
          <button
            type="button"
            disabled={busy}
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-50"
            onClick={(event) => {
              // 동봉 선택은 오픈 시점에 리셋 — dismiss 경로는 confirm과 달리 값을 지우지 않으므로,
              // 이전 취소된 선택이 다음 오픈에 미리 선택된 채로 남아 의도치 않은 동봉을 유발할 수 있다.
              setBundleValue(null);
              // 승인자가 본인 1인이면 클릭 지점에 셀프 게시 제안 — No/닫기는 기존 제출 플로우.
              if (isSoleSelfApprover(wf.approvers, currentUserId)) {
                setSelfPublishAt({ x: event.clientX, y: event.clientY });
                return;
              }
              setTransitionComment("");
              setSubmitConfirmOpen(true);
            }}
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
              onClick={() => {
                setTransitionComment("");
                setApproveConfirmOpen(true);
              }}
            >
              <CheckCircle size={16} strokeWidth={1.5} />
              {t("perm.version.approve")}
            </button>
            <button
              type="button"
              disabled={busy}
              className="flex items-center gap-1 rounded-sm border border-error px-2 py-1 text-fine text-error hover:bg-surface-alt disabled:opacity-50"
              onClick={() => setRejecting(true)}
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
            onClick={() => {
              setTransitionComment("");
              setPublishConfirmOpen(true);
            }}
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
            onClick={() => {
              setTransitionComment("");
              setWithdrawConfirmOpen(true);
            }}
          >
            <Undo2 size={16} strokeWidth={1.5} />
            {t("perm.version.withdraw")}
          </button>
        )}

        {/* published: 별도 액션 없음 / published: no actions */}
      </div>
      {selfPublishAt && (
        <SelfPublishPopover
          position={selfPublishAt}
          onYes={() => {
            setSelfPublishAt(null);
            void runAction(() => runSelfPublishChain(versionId, bundleValue ?? undefined));
            setBundleValue(null);
          }}
          onNo={() => {
            // 직행 submit 대신 SubmitConfirmDialog로 — 에디터와 동일 플로우(승인자 목록 노출 + 동봉 재선택 가능).
            setSelfPublishAt(null);
            setBundleValue(null);
            setTransitionComment("");
            setSubmitConfirmOpen(true);
          }}
          onClose={() => {
            setSelfPublishAt(null);
            // dismiss(Escape/바깥클릭)는 confirm 경로와 달리 값을 지우지 않아, 다음 오픈에 픽커가
            // 미리 선택된 채로 뜰 수 있다 — belt and braces로 여기서도 리셋.
            setBundleValue(null);
          }}
          bundleSlot={
            canBundle ? (
              <VisibilityBundlePicker current={visibility} value={bundleValue} onChange={setBundleValue} />
            ) : undefined
          }
        />
      )}
      {submitConfirmOpen && (
        <SubmitConfirmDialog
          workflow={wf}
          nameById={nameById}
          subtitle={label}
          bundleSlot={
            canBundle ? (
              <VisibilityBundlePicker current={visibility} value={bundleValue} onChange={setBundleValue} />
            ) : undefined
          }
          comment={transitionComment}
          onCommentChange={setTransitionComment}
          onConfirm={() => {
            setSubmitConfirmOpen(false);
            void runAction(() => submitVersion(versionId, bundleValue ?? undefined, transitionComment.trim() || undefined));
            setBundleValue(null);
          }}
          onClose={() => {
            setSubmitConfirmOpen(false);
            setBundleValue(null);
          }}
        />
      )}
      {approveConfirmOpen && (
        <ApproveConfirmDialog
          workflow={wf}
          nameById={nameById}
          username={currentUserId}
          subtitle={label}
          extraLines={buildBundledVisibilityLines(wf, nameById, t)}
          comment={transitionComment}
          onCommentChange={setTransitionComment}
          onConfirm={() => {
            setApproveConfirmOpen(false);
            void runAction(() => approveVersion(versionId, transitionComment.trim() || undefined));
          }}
          onClose={() => setApproveConfirmOpen(false)}
        />
      )}
      {publishConfirmOpen && (
        <PublishConfirmDialog
          subtitle={label}
          priorPublished={priorPublished}
          comment={transitionComment}
          onCommentChange={setTransitionComment}
          onConfirm={() => {
            setPublishConfirmOpen(false);
            void runAction(() => publishVersion(versionId, transitionComment.trim() || undefined));
          }}
          onClose={() => setPublishConfirmOpen(false)}
        />
      )}
      {withdrawConfirmOpen && (
        <WithdrawConfirmDialog
          workflow={wf}
          nameById={nameById}
          username={currentUserId}
          subtitle={label}
          withdrawSubmitter={withdrawSubmitter}
          showCommentInput={wf.status === "rejected" || wf.approvals.length >= 1}
          comment={transitionComment}
          onCommentChange={setTransitionComment}
          onConfirm={() => {
            setWithdrawConfirmOpen(false);
            void runAction(() => withdrawVersion(versionId, transitionComment.trim() || undefined));
          }}
          onClose={() => setWithdrawConfirmOpen(false)}
        />
      )}
      {rejecting && (
        <RejectDialog
          workflow={wf}
          nameById={nameById}
          username={currentUserId}
          subtitle={label}
          reason={rejectReason}
          onReasonChange={setRejectReason}
          onConfirm={() => {
            const reason = rejectReason.trim();
            setRejecting(false);
            setRejectReason("");
            void runAction(() => rejectVersion(versionId, reason));
          }}
          onClose={() => {
            setRejecting(false);
            setRejectReason("");
          }}
        />
      )}
      {commentsOrigin && (
        <CommentHistoryModal
          label={label}
          events={events ?? []}
          nameById={nameById}
          origin={commentsOrigin}
          onClose={() => setCommentsOrigin(null)}
        />
      )}
    </div>
  );
}

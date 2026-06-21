"use client";

// 버전 게시 mock 패널 — 버전별 승인 상태 머신 UI / Version publish mock panel: per-version approval state machine UI.
// 실제 버전 API 미사용 — versionFlow mock 스토어만 구동 / Does NOT call real version API; driven by mock versionFlow store.

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Send, Upload } from "lucide-react";

import type { VersionSummary } from "@/lib/api";
import { getMap } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  usePermissions,
  getActiveApprovers,
  approveVersionPublish,
  rejectVersionPublish,
  publishVersionFlow,
  requestVersionPublish,
} from "@/lib/mock/permissions";
import { StatusBadge } from "@/components/status-badge";
import type { VersionStatus } from "@/lib/api";

// ── 타입 / Types ─────────────────────────────────────────────

interface VersionsPublishPanelProps {
  mapId: string;
  /** 현재 mock 유저 ID / Current mock user ID. */
  currentUserId: string;
  /** 상위에서 이미 fetch한 버전 목록 — 없으면 내부에서 fetch / Pre-fetched versions or fetch internally. */
  versions?: VersionSummary[];
  /** editor 이상 여부 / Whether current user has editor+ role. */
  canEdit: boolean;
}

// ── 메인 컴포넌트 / Main component ───────────────────────────

export function VersionsPublishPanel({
  mapId,
  currentUserId,
  versions: versionsProp,
  canEdit,
}: VersionsPublishPanelProps) {
  const { t } = useI18n();
  // mock store 구독 / Subscribe to mock store.
  const permState = usePermissions();

  // 버전 목록 — props 없으면 getMap으로 내부 fetch / Fetch internally only when prop is absent.
  const [fetchedVersions, setFetchedVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(!versionsProp);

  useEffect(() => {
    // versionsProp이 있으면 fetch 불필요 / Skip fetch when versions are provided by parent.
    if (versionsProp) return;
    let active = true;
    // loading은 useState 초기값에서 true로 시작 / loading starts true from useState initializer.
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

  // 현재 맵의 활성 승인자 목록 / Active approvers for this map.
  const activeApprovers = getActiveApprovers(permState, mapId);
  const isApprover = activeApprovers.some((a) => a.userId === currentUserId);

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
      {versions.map((version) => {
        const vid = String(version.id);
        // mock 상태 우선 — 실제 version.status는 무시 / Mock status takes precedence; real version.status ignored.
        const flowEntry = permState.versionFlow[vid];
        const mockStatus: VersionStatus = flowEntry?.status ?? "draft";
        const requestedBy = flowEntry?.requestedBy;
        const isRequester = requestedBy === currentUserId;

        return (
          <VersionRow
            key={vid}
            versionId={vid}
            label={version.label}
            mockStatus={mockStatus}
            mapId={mapId}
            currentUserId={currentUserId}
            canEdit={canEdit}
            isApprover={isApprover}
            isRequester={isRequester}
          />
        );
      })}
    </div>
  );
}

// ── 버전 행 / Version row ─────────────────────────────────────

interface VersionRowProps {
  versionId: string;
  label: string;
  mockStatus: VersionStatus;
  mapId: string;
  currentUserId: string;
  canEdit: boolean;
  isApprover: boolean;
  isRequester: boolean;
}

function VersionRow({
  versionId,
  label,
  mockStatus,
  mapId,
  currentUserId,
  canEdit,
  isApprover,
  isRequester,
}: VersionRowProps) {
  const { t } = useI18n();

  // 승인 요청 핸들러 / Request publish handler.
  function handleRequest() {
    requestVersionPublish(mapId, versionId, label, currentUserId);
  }

  // 승인 핸들러 / Approve handler.
  function handleApprove() {
    approveVersionPublish(versionId, currentUserId);
  }

  // 반려 핸들러 / Reject handler.
  function handleReject() {
    rejectVersionPublish(versionId, currentUserId);
  }

  // 게시 핸들러 (요청자만) / Publish handler (requester only).
  function handlePublish() {
    publishVersionFlow(versionId, currentUserId);
  }

  return (
    <div className="flex items-center gap-3 rounded-sm border border-hairline bg-surface px-3 py-2.5">
      {/* 버전 라벨 / Version label */}
      <span className="flex-1 text-caption text-ink">{label}</span>

      {/* 상태 배지 / Status badge */}
      <StatusBadge status={mockStatus} />

      {/* 액션 버튼 — 상태·역할별 조건부 / Action buttons: conditional on status and role */}
      <div className="flex items-center gap-1.5">
        {/* draft / rejected → editor+는 승인 요청 가능 / editor+ can request publish */}
        {(mockStatus === "draft" || mockStatus === "rejected") && canEdit && (
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt"
            onClick={handleRequest}
          >
            <Send size={16} strokeWidth={1.5} />
            {t("perm.version.request")}
          </button>
        )}

        {/* pending → 승인자: 승인/반려 / approver: approve or reject */}
        {mockStatus === "pending" && isApprover && (
          <>
            <button
              type="button"
              className="flex items-center gap-1 rounded-sm border border-added px-2 py-1 text-fine text-added hover:bg-surface-alt"
              onClick={handleApprove}
            >
              <CheckCircle size={16} strokeWidth={1.5} />
              {t("perm.version.approve")}
            </button>
            <button
              type="button"
              className="flex items-center gap-1 rounded-sm border border-error px-2 py-1 text-fine text-error hover:bg-surface-alt"
              onClick={handleReject}
            >
              <XCircle size={16} strokeWidth={1.5} />
              {t("perm.version.reject")}
            </button>
          </>
        )}

        {/* pending → 비승인자 (요청자 등): 대기 표시 / non-approver (e.g. requester): waiting label */}
        {mockStatus === "pending" && !isApprover && (
          <span className="text-fine text-ink-tertiary">{t("perm.version.waitingApproval")}</span>
        )}

        {/* approved → 요청자: 게시 버튼 / requester: publish button */}
        {mockStatus === "approved" && isRequester && (
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm border border-accent px-2 py-1 text-fine text-accent hover:bg-surface-alt"
            onClick={handlePublish}
          >
            <Upload size={16} strokeWidth={1.5} />
            {t("perm.version.publish")}
          </button>
        )}

        {/* approved → 비요청자: 대기 표시 / non-requester: waiting label */}
        {mockStatus === "approved" && !isRequester && (
          <span className="text-fine text-ink-tertiary">{t("perm.version.approvedWaiting")}</span>
        )}

        {/* published: 별도 액션 없음 / published: no actions */}
      </div>
    </div>
  );
}

"use client";

// 결재자 관리 패널 — 서버 결재자 목록 조회·추가·제거 (실 API) /
// Approvers panel wired to the real Layer-2 approvers API.
// 추가/제거는 전체 목록을 PUT 으로 교체한 뒤 재조회해 반영한다(서버 진실).
// 표시명은 디렉터리 API 우선, 미일치 시 mock 시드 폴백.
// 결재자 0 경고는 목록 비어있음 기준.

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import {
  listApprovers,
  listEligibleApprovers,
  setApprovers,
  type DirectoryUser,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/mock/permissions";
import { PrincipalPicker, type PrincipalOption } from "@/components/permissions/principal-picker";
import { SkeletonPills } from "@/components/permissions/loading-skeleton";

interface ApproversPanelProps {
  mapId: string;
  /** 소유자 여부 — false면 읽기 전용 / Whether current user is owner; false = read-only. */
  isOwner: boolean;
  /** 토스트 발행 콜백 / Callback to show a toast message. */
  onToast: (msg: string) => void;
}

export function ApproversPanel({ mapId, isOwner, onToast }: ApproversPanelProps) {
  const { t } = useI18n();
  const state = usePermissions();
  const mapIdNum = Number(mapId);

  // 서버 결재자 userId 목록 / Server-sourced approver userIds.
  const [approverIds, setApproverIds] = useState<string[]>([]);
  // 초기 로드 중 — 데이터 도착 전 "결재자 0" 경고 대신 스켈레톤 표시 (F8).
  const [loading, setLoading] = useState(true);

  // 승인자 후보 = 맵 조회권한(viewer+) 보유 직원만 (AP) — 전체 디렉터리 대신 자격자 목록.
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  useEffect(() => {
    let active = true;
    void listEligibleApprovers(mapIdNum)
      .then((users) => { if (active) setDirUsers(users); })
      .catch(() => { /* picker falls back to empty */ });
    return () => { active = false; };
  }, [mapIdNum]);

  // 표시명 해석 — mock 시드 사용, 미일치 시 id 폴백 / Resolve display name from mock seed.
  const userName = useCallback(
    (userId: string): string => state.users.find((u) => u.id === userId)?.name ?? userId,
    [state.users],
  );

  // 디렉터리 우선 표시명, 폴백 mock / Directory-first name resolver.
  const pickerUsers = dirUsers.map((u) => ({
    id: u.id, name: u.name, email: "", departmentId: "",
    status: "active" as const, isSysadmin: false,
  }));
  const userDepartments = Object.fromEntries(dirUsers.map((u) => [u.id, u.department]));
  const dirName = (id: string) => dirUsers.find((u) => u.id === id)?.name ?? userName(id);

  const reload = useCallback(async () => {
    try {
      setApproverIds(await listApprovers(mapIdNum));
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }, [mapIdNum, onToast]);

  // 초기 로드 — 인라인 async + active 가드 / Initial load: inline async with an active guard.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const ids = await listApprovers(mapIdNum);
        if (active) setApproverIds(ids);
      } catch (err) {
        if (active) onToast(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [mapIdNum, onToast]);

  // 결재자 0 경고 — 목록 비어있음 기준(서버엔 active 개념 없음, Layer 4) /
  // Active-0 warning is now list-emptiness (server has no active concept yet — Layer 4).
  const hasNone = approverIds.length === 0;

  const handleRemove = useCallback(
    async (userId: string) => {
      const newIds = approverIds.filter((id) => id !== userId);
      try {
        await setApprovers(mapIdNum, newIds);
        await reload();
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err));
      }
    },
    [approverIds, mapIdNum, reload, onToast],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-caption-strong text-ink">{t("perm.approversTitle")}</p>
        <p className="mt-0.5 text-fine text-ink-tertiary">{t("perm.approversHint")}</p>
      </div>

      {/* 로딩 중 스켈레톤 / Skeleton while loading (F8) */}
      {loading && <SkeletonPills />}

      {/* 결재자 0 경고 배너 — 로딩 끝난 뒤에만 / Empty-list warning, only after load */}
      {!loading && hasNone && (
        <div className="rounded-sm border border-error bg-error/10 px-3 py-2 text-caption text-error">
          {t("perm.approversWarn")}
        </div>
      )}

      {/* 결재자 목록 — 필 형태 / Approver list as pills */}
      {approverIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {approverIds.map((userId) => (
            <span
              key={userId}
              data-id={`approver-pill-${userId}`}
              className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-2 py-0.5 text-caption text-ink"
            >
              {dirName(userId)}
              {isOwner && (
                <button
                  type="button"
                  title={t("perm.removeButton")}
                  className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface hover:text-error"
                  onClick={() => void handleRemove(userId)}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* 소유자가 아니면 읽기 전용 안내 / Read-only notice for non-owners */}
      {!isOwner && (
        <p className="text-fine text-ink-tertiary">{t("perm.approversReadOnly")}</p>
      )}

      {/* 결재자 추가 — 소유자만, PrincipalPicker 사용 / Add form: owner only, uses PrincipalPicker */}
      {isOwner && (
        <div className="mt-2 flex flex-col gap-2 border-t border-hairline pt-3">
          <p className="text-caption-strong text-ink">{t("perm.approversAdd")}</p>
          <PrincipalPicker
            users={pickerUsers}
            departments={[]}
            groups={[]}
            excludeIds={new Set(approverIds)}
            userDepartments={userDepartments}
            onSelect={(opt: PrincipalOption) => {
              if (opt.principalType !== "user") return;
              void (async () => {
                try {
                  await setApprovers(mapIdNum, [...approverIds, opt.principalId]);
                  await reload();
                } catch (err) {
                  onToast(err instanceof Error ? err.message : String(err));
                }
              })();
            }}
          />
        </div>
      )}
    </div>
  );
}

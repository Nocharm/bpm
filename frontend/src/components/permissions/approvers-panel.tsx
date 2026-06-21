"use client";

// 결재자 관리 패널 — 목록 조회, 추가, 제거, 비활성 배너 /
// Approvers management panel: list, add, remove, active-0 warning banner.

import { useState } from "react";
import { X } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { User } from "@/lib/mock/permissions";
import {
  getActiveApprovers,
  setApprovers,
  toggleUserActive,
  usePermissions,
} from "@/lib/mock/permissions";

interface ApproversPanelProps {
  mapId: string;
  /** 현재 유저 id — setApprovers의 by 인자 / Current user id for the 'by' argument. */
  currentUserId: string;
  /** 소유자 여부 — false면 읽기 전용 / Whether current user is owner; false = read-only. */
  isOwner: boolean;
}

// 유저 표시명 / User display name helper.
function userName(users: User[], userId: string): string {
  return users.find((u) => u.id === userId)?.name ?? userId;
}

export function ApproversPanel({ mapId, currentUserId, isOwner }: ApproversPanelProps) {
  const { t } = useI18n();
  const state = usePermissions();

  // 이 맵의 결재자 목록 / Approvers for this map.
  const approvers = state.approvers.filter((a) => a.mapId === mapId);
  // 활성 결재자 / Active approvers (user status = active).
  const activeApprovers = getActiveApprovers(state, mapId);
  const hasNoActive = approvers.length > 0 && activeApprovers.length === 0;

  // 결재자 추가 선택 상태 / Selected user to add.
  const [selectedUserId, setSelectedUserId] = useState("");

  // 현재 결재자 userId 집합 / Set of already-assigned approver userIds.
  const assignedIds = new Set(approvers.map((a) => a.userId));

  // 추가 가능한 사용자 — 미지정 유저만 / Users not yet assigned as approvers.
  const eligible = state.users.filter((u) => !assignedIds.has(u.id));

  function handleAdd() {
    if (!selectedUserId) return;
    const newIds = [...Array.from(assignedIds), selectedUserId];
    setApprovers(mapId, newIds, currentUserId);
    setSelectedUserId("");
  }

  function handleRemove(userId: string) {
    const newIds = Array.from(assignedIds).filter((id) => id !== userId);
    setApprovers(mapId, newIds, currentUserId);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-caption-strong text-ink">{t("perm.approversTitle")}</p>
        <p className="mt-0.5 text-fine text-ink-tertiary">{t("perm.approversHint")}</p>
      </div>

      {/* 비활성 결재자 경고 배너 / Active-0 warning banner */}
      {hasNoActive && (
        <div className="rounded-sm border border-error bg-error/10 px-3 py-2 text-caption text-error">
          {t("perm.approversWarn")}
        </div>
      )}

      {/* 결재자 목록 / Approver list */}
      {approvers.length === 0 ? (
        <p className="text-caption text-ink-tertiary">{t("perm.approversEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {approvers.map((a) => {
            const user = state.users.find((u) => u.id === a.userId);
            const isInactive = user?.status === "inactive";
            return (
              <div
                key={a.userId}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-alt"
              >
                {/* 이름 + 비활성 태그 / Name + inactive tag */}
                <span className="flex-1 text-caption text-ink">
                  {userName(state.users, a.userId)}
                  {isInactive && (
                    <span className="ml-1.5 text-fine text-ink-tertiary">
                      {t("perm.approversInactive")}
                    </span>
                  )}
                </span>

                {isOwner && (
                  <>
                    {/* [Dev] 비활성 토글 — 활성0 배너 검증용 / [Dev] toggle: verify active-0 banner */}
                    <button
                      type="button"
                      title={t("perm.approversToggle")}
                      className="rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary hover:bg-surface-alt"
                      onClick={() => toggleUserActive(a.userId)}
                    >
                      {isInactive ? t("perm.approversDevActive") : t("perm.approversDevInactive")}
                    </button>

                    {/* 제거 버튼 / Remove button */}
                    <button
                      type="button"
                      title={t("perm.removeButton")}
                      className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-error"
                      onClick={() => handleRemove(a.userId)}
                    >
                      <X size={16} strokeWidth={1.5} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 소유자가 아니면 읽기 전용 안내 / Read-only notice for non-owners */}
      {!isOwner && (
        <p className="text-fine text-ink-tertiary">{t("perm.approversReadOnly")}</p>
      )}

      {/* 결재자 추가 폼 — 소유자만 / Add form: owner only */}
      {isOwner && (
        <div className="mt-2 flex flex-col gap-2 border-t border-hairline pt-3">
          <p className="text-caption-strong text-ink">{t("perm.approversAdd")}</p>
          <div className="flex items-center gap-2">
            <select
              className="flex-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">{t("perm.transferPickPlaceholder")}</option>
              {eligible.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.id})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedUserId}
              className="rounded-sm bg-accent px-2 py-1 text-fine text-on-accent hover:bg-accent-focus disabled:opacity-40"
              onClick={handleAdd}
            >
              {t("perm.addButton")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

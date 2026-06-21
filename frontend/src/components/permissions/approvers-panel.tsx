"use client";

// 결재자 관리 패널 — 서버 결재자 목록 조회·추가·제거 (실 API) /
// Approvers panel wired to the real Layer-2 approvers API.
// 추가/제거는 전체 목록을 PUT 으로 교체한 뒤 재조회해 반영한다(서버 진실).
// 표시명은 아직 Layer-4 디렉터리 API가 없어 mock 시드를 사용한다.
// active/inactive 토글은 백엔드가 없어(Layer 4) 비활성화한다. "결재자 0" 경고는 목록 비어있음 기준.

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import { listApprovers, setApprovers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/mock/permissions";

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
  const [selectedUserId, setSelectedUserId] = useState("");

  // 표시명 해석 — mock 시드 사용, 미일치 시 id 폴백 / Resolve display name from mock seed.
  const userName = useCallback(
    (userId: string): string => state.users.find((u) => u.id === userId)?.name ?? userId,
    [state.users],
  );

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
      }
    })();
    return () => {
      active = false;
    };
  }, [mapIdNum, onToast]);

  // 결재자 0 경고 — 목록 비어있음 기준(서버엔 active 개념 없음, Layer 4) /
  // Active-0 warning is now list-emptiness (server has no active concept yet — Layer 4).
  const hasNone = approverIds.length === 0;

  // 현재 결재자 집합 / Set of already-assigned approver userIds.
  const assignedIds = new Set(approverIds);
  // 추가 가능한 사용자 — 미지정 유저만 / Users not yet assigned.
  const eligible = state.users.filter((u) => !assignedIds.has(u.id));

  const handleAdd = useCallback(async () => {
    if (!selectedUserId) return;
    const newIds = [...approverIds, selectedUserId];
    try {
      await setApprovers(mapIdNum, newIds);
      await reload();
      setSelectedUserId("");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  }, [selectedUserId, approverIds, mapIdNum, reload, onToast]);

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

      {/* 결재자 0 경고 배너 / Empty-list warning banner */}
      {hasNone && (
        <div className="rounded-sm border border-error bg-error/10 px-3 py-2 text-caption text-error">
          {t("perm.approversWarn")}
        </div>
      )}

      {/* 결재자 목록 / Approver list */}
      {approverIds.length > 0 && (
        <div className="flex flex-col gap-1">
          {approverIds.map((userId) => (
            <div
              key={userId}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-alt"
            >
              {/* 이름 / Name */}
              <span className="flex-1 text-caption text-ink">{userName(userId)}</span>

              {isOwner && (
                <>
                  {/* 활성 토글 — 백엔드 없음(Layer 4), 비활성 / Active toggle: no backend (Layer 4), disabled */}
                  <span
                    className="cursor-not-allowed rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary opacity-50"
                    title={t("perm.approversToggleLayer4")}
                  >
                    {t("perm.approversToggle")}
                  </span>

                  {/* 제거 버튼 / Remove button */}
                  <button
                    type="button"
                    title={t("perm.removeButton")}
                    className="rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-error"
                    onClick={() => void handleRemove(userId)}
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                </>
              )}
            </div>
          ))}
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
              onClick={() => void handleAdd()}
            >
              {t("perm.addButton")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

// 승인자 재지정 강제 모달 — 활성 승인자가 0명일 때 소유자에게 표시, 닫기 불가 /
// Forced reassign-approver modal: shown to owner when zero active approvers; non-dismissable.

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { ModalBackdrop } from "@/components/modal-backdrop";
import {
  setApprovers,
  usePermissions,
} from "@/lib/mock/permissions";

interface ReassignApproverModalProps {
  mapId: string;
  /** 지정 행위자 id — setApprovers의 by 인자 / Assignor id for the 'by' argument. */
  by: string;
}

export function ReassignApproverModal({ mapId, by }: ReassignApproverModalProps) {
  const { t } = useI18n();
  const state = usePermissions();

  // 현재 결재자 userId 집합 / Set of currently-assigned approver userIds.
  const assignedIds = new Set(
    state.approvers.filter((a) => a.mapId === mapId).map((a) => a.userId),
  );

  // 픽커 후보: 활성 상태이면서 아직 결재자로 미지정된 유저만 /
  // Eligible: active users not yet assigned as approver.
  const eligible = state.users.filter(
    (u) => u.status === "active" && !assignedIds.has(u.id),
  );

  const [selectedUserId, setSelectedUserId] = useState("");

  function handleConfirm() {
    if (!selectedUserId) return;
    // 기존 결재자 유지하며 선택 유저 추가 / Keep existing approvers, append newly picked one.
    const newIds = [...Array.from(assignedIds), selectedUserId];
    setApprovers(mapId, newIds, by);
    // 부모의 파생 조건(isOwner && activeApprovers.length === 0)이 false가 되어
    // 모달이 자동으로 언마운트됨 / Parent's derived condition flips false → modal auto-unmounts.
  }

  return (
    // 비닫기 백드롭 — onClose는 no-op / Non-dismissable backdrop: onClose is intentionally a no-op.
    <ModalBackdrop
      onClose={() => {}}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/30"
    >
      <div
        className="w-full max-w-sm rounded-md border border-hairline bg-surface p-6 shadow-lg"
        // 백드롭 클릭 이벤트가 올라오지 않도록 차단 / Stop propagation so backdrop click cannot fire.
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 제목 / Title */}
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={16} strokeWidth={1.5} className="shrink-0 text-error" />
          <h2 className="text-body-strong font-semibold text-ink">
            {t("perm.reassign.title")}
          </h2>
        </div>

        {/* 설명 / Description */}
        <p className="mb-5 text-caption text-ink-secondary">
          {t("perm.reassign.desc")}
        </p>

        {/* 픽커 — 활성 유저만 표시 / Picker: active users only */}
        <div className="flex items-center gap-2">
          <select
            className="flex-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">{t("perm.reassign.pickPlaceholder")}</option>
            {eligible.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.id})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedUserId}
            className="rounded-sm bg-accent px-3 py-1 text-fine text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={handleConfirm}
          >
            {t("perm.reassign.confirm")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
